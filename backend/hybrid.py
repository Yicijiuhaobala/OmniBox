from __future__ import annotations

import json
import hashlib
import re
import time
import uuid
from pathlib import Path
from threading import Lock
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from .config_store import get_secret
except ImportError:
    from config_store import get_secret


router = APIRouter(prefix="/api/hybrid", tags=["hybrid"])


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5_000)
    source: str = Field(default="auto", max_length=20)
    target: str = Field(default="zh-CN", max_length=20)
    engine: Literal["youdao", "baidu"] = "youdao"


class CodeRequest(BaseModel):
    action: Literal["format", "rename"]
    text: str = Field(min_length=1, max_length=100_000)
    language: Literal["javascript", "typescript", "json", "html", "css", "python", "text"] = "javascript"
    naming: Literal["camel", "pascal", "snake", "kebab", "constant"] = "camel"


class OCRRequest(BaseModel):
    files: list[str] = Field(min_length=1, max_length=30)


LANGUAGE_LABELS = {
    "zh-CN": "简体中文", "en": "英文", "ja": "日文", "ko": "韩文",
    "fr": "法文", "de": "德文", "es": "西班牙文", "ru": "俄文",
}
YOUDAO_TARGETS = {
    "zh-CN": "zh-CHS", "en": "en", "ja": "ja", "ko": "ko",
    "fr": "fr", "de": "de", "es": "es", "ru": "ru",
}
YOUDAO_SOURCES = {
    "zh-chs": "zh-CN", "zh-cht": "zh-CN", "en": "en", "ja": "ja", "ko": "ko",
    "fr": "fr", "de": "de", "es": "es", "ru": "ru",
}
BAIDU_TARGETS = {
    "zh-CN": "zh", "en": "en", "ja": "jp", "ko": "kor",
    "fr": "fra", "de": "de", "es": "spa", "ru": "ru",
}
BAIDU_SOURCES = {
    "zh": "zh-CN", "en": "en", "jp": "ja", "kor": "ko",
    "fra": "fr", "de": "de", "spa": "es", "ru": "ru",
}
YOUDAO_ERRORS = {
    "101": "缺少必要参数", "102": "不支持的语言类型", "103": "翻译文本过长",
    "108": "有道应用无效", "110": "应用没有文本翻译服务权限", "111": "开发者账号无效",
    "202": "签名校验失败，请检查 App Key 和 App Secret", "205": "请求时间戳无效",
    "206": "请求因重放保护被拒绝", "401": "账户余额不足", "411": "访问频率受限",
}
BAIDU_ERRORS = {
    "52001": "请求超时，请重试", "52002": "系统错误，请重试", "52003": "百度应用未授权",
    "54000": "缺少必要参数", "54001": "签名错误，请检查 APP ID 和密钥", "54003": "访问频率受限",
    "54004": "账户余额不足", "54005": "长文本请求频率受限", "58000": "客户端 IP 非法",
    "58001": "不支持的语言方向", "58002": "服务已关闭", "90107": "认证未通过或未生效",
}


def detect_script_language(text: str) -> Optional[str]:
    if re.search(r"[\u3040-\u30ff]", text):
        return "ja"
    if re.search(r"[\uac00-\ud7af]", text):
        return "ko"
    if re.search(r"[\u4e00-\u9fff]", text):
        return "zh-CN"
    if re.search(r"[\u0400-\u04ff]", text):
        return "ru"
    return None


def youdao_sign_input(text: str) -> str:
    return text if len(text) <= 20 else f"{text[:10]}{len(text)}{text[-10:]}"


def build_youdao_params(text: str, target: str, app_key: str, app_secret: str) -> dict:
    salt = uuid.uuid4().hex
    curtime = str(int(time.time()))
    sign_source = f"{app_key}{youdao_sign_input(text)}{salt}{curtime}{app_secret}"
    return {
        "q": text, "from": "auto", "to": YOUDAO_TARGETS[target], "appKey": app_key,
        "salt": salt, "sign": hashlib.sha256(sign_source.encode("utf-8")).hexdigest(),
        "signType": "v3", "curtime": curtime, "strict": "false",
    }


def parse_detected_source(pair: str) -> Optional[str]:
    code = pair.split("2", 1)[0].strip().lower()
    return YOUDAO_SOURCES.get(code)


def build_baidu_params(text: str, target: str, app_id: str, app_key: str) -> dict:
    salt = uuid.uuid4().hex
    sign_source = f"{app_id}{text}{salt}{app_key}"
    return {
        "q": text, "from": "auto", "to": BAIDU_TARGETS[target],
        "appid": app_id, "salt": salt,
        "sign": hashlib.md5(sign_source.encode("utf-8")).hexdigest(),
    }


@router.post("/translate")
async def translate(payload: TranslateRequest) -> dict:
    targets = YOUDAO_TARGETS if payload.engine == "youdao" else BAIDU_TARGETS
    if payload.target not in targets:
        raise HTTPException(400, f"{'有道' if payload.engine == 'youdao' else '百度'}翻译暂不支持该目标语言")
    if payload.source != "auto" and payload.source == payload.target:
        raise HTTPException(400, "源语言与目标语言不能相同")

    script_language = detect_script_language(payload.text)
    if script_language and script_language == payload.target:
        label = LANGUAGE_LABELS.get(script_language, script_language)
        raise HTTPException(400, f"检测到输入内容是{label}，与目标语言相同")
    ambiguous_han = script_language == "zh-CN" and payload.source == "ja"
    if payload.source != "auto" and script_language and payload.source != script_language and not ambiguous_han:
        expected = LANGUAGE_LABELS.get(payload.source, payload.source)
        actual = LANGUAGE_LABELS.get(script_language, script_language)
        raise HTTPException(400, f"源语言选择了{expected}，但输入内容检测为{actual}；请改为自动识别或修正源语言")

    if payload.engine == "youdao":
        app_key = get_secret("youdao_app_key")
        app_secret = get_secret("youdao_app_secret")
        if not app_key or not app_secret:
            raise HTTPException(401, "请先在设置中配置有道翻译 App Key 和 App Secret")
        params = build_youdao_params(payload.text, payload.target, app_key, app_secret)
        endpoint = "https://openapi.youdao.com/api"
    else:
        app_id = get_secret("baidu_app_id")
        app_key = get_secret("baidu_app_key")
        if not app_id or not app_key:
            raise HTTPException(401, "请先在设置中配置百度翻译 APP ID 和密钥")
        params = build_baidu_params(payload.text, payload.target, app_id, app_key)
        endpoint = "https://fanyi-api.baidu.com/api/trans/vip/translate"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(endpoint, data=params)
            response.raise_for_status()
            data = response.json()
        if payload.engine == "youdao":
            error_code = str(data.get("errorCode", ""))
            if error_code != "0":
                detail = YOUDAO_ERRORS.get(error_code, "未知错误")
                raise HTTPException(502, f"有道翻译失败（{error_code}）：{detail}")
            translations = data.get("translation") or []
            detected_source = parse_detected_source(str(data.get("l", "")))
            engine_label = "有道智云文本翻译"
        else:
            error_code = str(data.get("error_code", ""))
            if error_code:
                detail = BAIDU_ERRORS.get(error_code, str(data.get("error_msg") or "未知错误"))
                raise HTTPException(502, f"百度翻译失败（{error_code}）：{detail}")
            translations = [item.get("dst", "") for item in (data.get("trans_result") or [])]
            detected_source = BAIDU_SOURCES.get(str(data.get("from", "")).lower())
            engine_label = "百度翻译开放平台"
        if not translations:
            raise ValueError(f"{'有道' if payload.engine == 'youdao' else '百度'}没有返回翻译结果")
        if detected_source and detected_source == payload.target:
            label = LANGUAGE_LABELS.get(detected_source, detected_source)
            raise HTTPException(400, f"有道检测到源语言是{label}，与目标语言相同")
        warning = ""
        if payload.source != "auto" and detected_source and detected_source != payload.source:
            expected = LANGUAGE_LABELS.get(payload.source, payload.source)
            actual = LANGUAGE_LABELS.get(detected_source, detected_source)
            warning = f"源语言选择了{expected}，服务检测为{actual}；本次已按自动检测结果翻译"
        return {
            "result": "\n".join(str(item) for item in translations),
            "engine": engine_label,
            "detected_source": detected_source,
            "detected_source_label": LANGUAGE_LABELS.get(detected_source or "", "未知"),
            "warning": warning,
        }
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(502, f"无法连接{'有道' if payload.engine == 'youdao' else '百度'}翻译服务：{exc}") from exc


def words(value: str) -> list[str]:
    prepared = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value)
    return [part.lower() for part in re.split(r"[^A-Za-z0-9\u4e00-\u9fff]+", prepared) if part]


def convert_case(value: str, style: str) -> str:
    parts = words(value)
    if not parts:
        return ""
    if style == "snake":
        return "_".join(parts)
    if style == "kebab":
        return "-".join(parts)
    if style == "constant":
        return "_".join(parts).upper()
    if style == "pascal":
        return "".join(part[:1].upper() + part[1:] for part in parts)
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


@router.post("/code")
def code(payload: CodeRequest) -> dict:
    if payload.action == "rename":
        return {"result": convert_case(payload.text, payload.naming)}
    try:
        if payload.language == "python":
            import autopep8

            result = autopep8.fix_code(payload.text)
        elif payload.language == "json":
            result = json.dumps(json.loads(payload.text), ensure_ascii=False, indent=2)
        elif payload.language == "html":
            from bs4 import BeautifulSoup

            result = BeautifulSoup(payload.text, "html.parser").prettify()
        elif payload.language == "css":
            import cssbeautifier

            result = cssbeautifier.beautify(payload.text)
        elif payload.language in {"javascript", "typescript"}:
            import jsbeautifier

            result = jsbeautifier.beautify(payload.text)
        else:
            result = payload.text
        return {"result": result.rstrip() + "\n"}
    except (ValueError, SyntaxError, json.JSONDecodeError) as exc:
        raise HTTPException(400, f"无法格式化：{exc}") from exc


_ocr_engine = None
_ocr_lock = Lock()


def get_ocr_engine():
    global _ocr_engine
    with _ocr_lock:
        if _ocr_engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR

                _ocr_engine = RapidOCR()
            except Exception as exc:
                raise HTTPException(503, f"本地 OCR 引擎加载失败：{exc}") from exc
    return _ocr_engine


@router.post("/ocr")
def ocr(payload: OCRRequest) -> dict:
    engine = get_ocr_engine()
    items = []
    failures = []
    for raw_path in payload.files:
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file():
            failures.append({"source": str(path), "error": "文件不存在"})
            continue
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
            failures.append({"source": str(path), "error": "本地 OCR 暂不支持该格式"})
            continue
        try:
            result, elapsed = engine(str(path))
            lines = []
            blocks = []
            for block in result or []:
                box, text, score = block
                lines.append(text)
                blocks.append({"text": text, "confidence": round(float(score), 4), "box": box})
            elapsed_values = elapsed if isinstance(elapsed, (list, tuple)) else [elapsed]
            total_elapsed = sum(float(value) for value in elapsed_values if isinstance(value, (int, float)))
            items.append({
                "source": str(path), "text": "\n".join(lines), "blocks": blocks,
                "elapsed": round(total_elapsed, 3),
            })
        except Exception as exc:
            failures.append({"source": str(path), "error": str(exc)})
    return {"items": items, "failures": failures, "engine": "RapidOCR / ONNX Runtime"}
