from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

try:
    from .config_store import CONFIG_DIR
except ImportError:
    from config_store import CONFIG_DIR


router = APIRouter(prefix="/api/presentation-templates", tags=["presentation-templates"])
DEFAULT_CATALOG_URL = "https://raw.githubusercontent.com/Yicijiuhaobala/OmniBox/develop/templates/catalog.json"
CATALOG_URL = os.getenv("OMNIBOX_TEMPLATE_CATALOG_URL", DEFAULT_CATALOG_URL).strip()
CACHE_DIR = CONFIG_DIR / "presentation-templates"
MAX_CATALOG_BYTES = 512 * 1024
MAX_TEMPLATE_BYTES = 1024 * 1024
CATALOG_TTL_SECONDS = 15 * 60
ALLOWED_STYLES = {"executive", "editorial", "signal", "minimal", "data", "academic", "blueprint", "coral", "mono"}

_catalog_lock = threading.Lock()
_catalog_cache: tuple[float, list[dict[str, Any]]] | None = None


def _fallback_catalog() -> list[dict[str, Any]]:
    items = [
        ("weekly", "项目周报", "进展、指标、风险、计划", "executive", "weekly.json", 781, "68db525df08b5e7732dd853792ede9702d29d80c7576601f7cadf92982534a5f"),
        ("monthly", "经营月报", "目标、趋势、归因、行动", "data", "monthly.json", 729, "bbad55fdfc8517be14389373af8a4362d3af91ea06f776bc5833e3c11a1a689f"),
        ("performance", "述职汇报", "职责、业绩、复盘、规划", "minimal", "performance.json", 799, "ae93dd5a34d90744a05b417adf8ec337461ab858b478adb2e96be1c5614cd5ea"),
        ("project", "项目汇报", "背景、方案、里程碑、风险", "blueprint", "project.json", 792, "0d29aaca3374ee4003a380850e99a2897f906237605c2296c9ae6206990ea5e7"),
        ("training", "培训课件", "目标、知识点、练习、总结", "academic", "training.json", 775, "370572e4b9ee948981da37c3c6b7660386f3c8e2d011b958d168f171f4ee8039"),
    ]
    return [{"id": item[0], "name": item[1], "detail": item[2], "style": item[3], "version": "1.0.0", "download_url": item[4], "size": item[5], "sha256": item[6]} for item in items]


def _safe_id(value: Any) -> str:
    template_id = str(value or "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", template_id):
        raise ValueError("模板 ID 不合法")
    return template_id


def _is_allowed_url(url: str, base_url: str) -> bool:
    target, base = urllib.parse.urlparse(url), urllib.parse.urlparse(base_url)
    if target.scheme not in {"https", "http"} or not target.hostname:
        return False
    if target.scheme == "http" and target.hostname not in {"127.0.0.1", "localhost", "::1"}:
        return False
    return target.hostname == base.hostname and target.port == base.port


def _fetch_json(url: str, byte_limit: int) -> tuple[dict[str, Any], bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "OmniBox-Template-Client/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=8) as response:
        content_type = response.headers.get("Content-Type", "").lower()
        if "json" not in content_type and not url.lower().endswith(".json"):
            raise ValueError("远程模板不是 JSON 文件")
        raw = response.read(byte_limit + 1)
    if len(raw) > byte_limit:
        raise ValueError("远程模板文件过大")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("远程模板 JSON 无法解析") from exc
    if not isinstance(payload, dict):
        raise ValueError("远程模板 JSON 顶层必须是对象")
    return payload, raw


def _normalize_catalog(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_items = payload.get("templates")
    if not isinstance(raw_items, list):
        raise ValueError("模板目录缺少 templates 数组")
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items[:100]:
        if not isinstance(raw, dict):
            continue
        template_id = _safe_id(raw.get("id"))
        if template_id in seen:
            continue
        seen.add(template_id)
        style = str(raw.get("style") or "executive")
        if style not in ALLOWED_STYLES:
            style = "executive"
        sha256 = str(raw.get("sha256") or "").lower()
        if sha256 and not re.fullmatch(r"[0-9a-f]{64}", sha256):
            raise ValueError(f"模板 {template_id} 的 SHA-256 不合法")
        items.append({
            "id": template_id,
            "name": re.sub(r"\s+", " ", str(raw.get("name") or template_id)).strip()[:60],
            "detail": re.sub(r"\s+", " ", str(raw.get("detail") or "")).strip()[:160],
            "style": style,
            "version": str(raw.get("version") or "1.0.0")[:30],
            "download_url": str(raw.get("download_url") or f"{template_id}.json")[:2_048],
            "sha256": sha256,
            "size": max(0, int(raw.get("size") or 0)),
        })
    return items


def _catalog(force_refresh: bool = False) -> tuple[list[dict[str, Any]], str, str]:
    global _catalog_cache
    with _catalog_lock:
        if not force_refresh and _catalog_cache and time.time() - _catalog_cache[0] < CATALOG_TTL_SECONDS:
            return _catalog_cache[1], "online", ""
        try:
            payload, _ = _fetch_json(CATALOG_URL, MAX_CATALOG_BYTES)
            items = _normalize_catalog(payload)
            if not items:
                raise ValueError("在线模板目录为空")
            _catalog_cache = (time.time(), items)
            return items, "online", ""
        except (OSError, ValueError, urllib.error.URLError) as exc:
            return _fallback_catalog(), "offline_catalog", f"在线目录暂不可用：{exc}"


def _cache_path(template_id: str) -> Path:
    return CACHE_DIR / f"{_safe_id(template_id)}.json"


def _read_cached(template_id: str) -> dict[str, Any] | None:
    try:
        data = json.loads(_cache_path(template_id).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _validate_template(payload: dict[str, Any], expected_id: str) -> dict[str, Any]:
    template_id = _safe_id(payload.get("id"))
    if template_id != expected_id:
        raise ValueError("模板内容与目录 ID 不一致")
    style = str(payload.get("style") or "executive")
    if style not in ALLOWED_STYLES:
        raise ValueError("模板使用了不支持的视觉主题")
    raw_deck = payload.get("deck")
    if not isinstance(raw_deck, dict) or not isinstance(raw_deck.get("slides"), list):
        raise ValueError("模板缺少演示文稿结构")
    slides = []
    for index, raw_slide in enumerate(raw_deck["slides"][:40]):
        if not isinstance(raw_slide, dict):
            continue
        body = raw_slide.get("body") if isinstance(raw_slide.get("body"), list) else []
        slides.append({
            "id": f"{template_id}-{index + 1}",
            "title": str(raw_slide.get("title") or f"第 {index + 1} 页")[:160],
            "body": [str(item)[:500] for item in body[:8]],
            "notes": str(raw_slide.get("notes") or "")[:4_000],
            "images": [],
        })
    if not slides:
        raise ValueError("模板没有有效页面")
    return {
        "id": template_id,
        "name": re.sub(r"\s+", " ", str(payload.get("name") or template_id)).strip()[:60],
        "version": str(payload.get("version") or "1.0.0")[:30],
        "style": style,
        "deck": {
            "title": str(raw_deck.get("title") or payload.get("name") or "未命名演示")[:120],
            "source_type": "online_template",
            "warnings": [],
            "slides": slides,
        },
    }


def _write_cached(template: dict[str, Any]) -> dict[str, Any]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        CACHE_DIR.chmod(0o700)
    except OSError:
        pass
    data = {**template, "downloaded_at": datetime.now(timezone.utc).isoformat()}
    target = _cache_path(template["id"])
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        temporary.chmod(0o600)
    except OSError:
        pass
    temporary.replace(target)
    return data


def _catalog_item_state(item: dict[str, Any]) -> dict[str, Any]:
    cached = _read_cached(item["id"])
    cached_version = str(cached.get("version") or "") if cached else ""
    return {
        **item,
        "download_url": None,
        "sha256": None,
        "cached": bool(cached),
        "cached_version": cached_version,
        "update_available": bool(cached and cached_version != item["version"]),
    }


@router.get("")
def template_catalog(refresh: bool = False) -> dict[str, Any]:
    items, source, warning = _catalog(refresh)
    return {"templates": [_catalog_item_state(item) for item in items], "source": source, "warning": warning}


@router.post("/{template_id}/download")
def download_template(template_id: str) -> dict[str, Any]:
    template_id = _safe_id(template_id)
    items, _, _ = _catalog(False)
    item = next((candidate for candidate in items if candidate["id"] == template_id), None)
    if not item:
        raise HTTPException(404, "在线模板不存在")
    target_url = urllib.parse.urljoin(CATALOG_URL, item["download_url"])
    if not _is_allowed_url(target_url, CATALOG_URL):
        raise HTTPException(400, "模板下载地址不在受信任目录域名下")
    try:
        payload, raw = _fetch_json(target_url, MAX_TEMPLATE_BYTES)
        if item.get("sha256") and hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise ValueError("模板 SHA-256 校验失败")
        cached = _write_cached(_validate_template(payload, template_id))
        return {"result": "模板已下载", "template": cached}
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise HTTPException(502, f"模板下载失败：{exc}") from exc


@router.get("/{template_id}/cached")
def cached_template(template_id: str) -> dict[str, Any]:
    cached = _read_cached(template_id)
    if not cached:
        raise HTTPException(404, "模板尚未下载")
    return {"template": cached}


@router.delete("/{template_id}/cached")
def delete_cached_template(template_id: str) -> dict[str, Any]:
    target = _cache_path(template_id)
    try:
        target.unlink()
    except FileNotFoundError:
        raise HTTPException(404, "模板尚未下载")
    except OSError as exc:
        raise HTTPException(500, f"删除模板缓存失败：{exc}") from exc
    return {"result": "模板缓存已删除"}
