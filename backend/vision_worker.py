from __future__ import annotations

import json
import sys
from pathlib import Path


COMPONENT_VERSION = "1.0.0"
PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 256 * 1024
SUPPORTED_IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def health() -> dict:
    return {
        "ok": True,
        "component": "vision-runtime",
        "version": COMPONENT_VERSION,
        "protocol": PROTOCOL_VERSION,
        "capabilities": ["ocr", "inpaint"],
    }


def run_ocr(payload: dict) -> dict:
    raw_files = payload.get("files")
    if not isinstance(raw_files, list) or not 1 <= len(raw_files) <= 30:
        raise ValueError("OCR 图片数量必须为 1 至 30 张")
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    items = []
    failures = []
    for raw_path in raw_files:
        path = Path(str(raw_path)).expanduser().resolve()
        if not path.is_file():
            failures.append({"source": str(path), "error": "文件不存在"})
            continue
        if path.suffix.lower() not in SUPPORTED_IMAGES:
            failures.append({"source": str(path), "error": "本地 OCR 暂不支持该格式"})
            continue
        try:
            result, elapsed = engine(str(path))
            lines = []
            blocks = []
            for block in result or []:
                box, text, score = block
                lines.append(str(text))
                blocks.append({"text": str(text), "confidence": round(float(score), 4), "box": box})
            elapsed_values = elapsed if isinstance(elapsed, (list, tuple)) else [elapsed]
            total_elapsed = sum(float(value) for value in elapsed_values if isinstance(value, (int, float)))
            items.append({
                "source": str(path),
                "text": "\n".join(lines),
                "blocks": blocks,
                "elapsed": round(total_elapsed, 3),
            })
        except Exception as exc:
            failures.append({"source": str(path), "error": str(exc)[:500]})
    return {"items": items, "failures": failures, "engine": "RapidOCR / ONNX Runtime"}


def run_inpaint(payload: dict) -> dict:
    source = Path(str(payload.get("source", ""))).expanduser().resolve()
    output = Path(str(payload.get("output", ""))).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() not in SUPPORTED_IMAGES:
        raise ValueError("选区修复源图片不存在或格式不受支持")
    if not output.parent.is_dir():
        raise ValueError("选区修复输出目录不存在")
    x = int(payload.get("x", 0))
    y = int(payload.get("y", 0))
    width = int(payload.get("width", 0))
    height = int(payload.get("height", 0))
    radius = int(payload.get("radius", 5))
    quality = int(payload.get("quality", 88))
    if x < 0 or y < 0 or width <= 0 or height <= 0 or not 1 <= radius <= 30 or not 1 <= quality <= 100:
        raise ValueError("选区修复参数无效")

    import cv2
    import numpy as np
    from PIL import Image

    with Image.open(source) as opened:
        image = opened.copy()
    right, bottom = x + width, y + height
    if right > image.width or bottom > image.height:
        raise ValueError(f"修复选区超出图片尺寸 {image.width}×{image.height}")
    rgb = image.convert("RGB")
    cv_source = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
    mask = np.zeros((image.height, image.width), dtype=np.uint8)
    mask[y:bottom, x:right] = 255
    repaired = cv2.inpaint(cv_source, mask, radius, cv2.INPAINT_TELEA)
    result = Image.fromarray(cv2.cvtColor(repaired, cv2.COLOR_BGR2RGB))
    if image.mode in {"RGBA", "LA"}:
        result.putalpha(image.convert("RGBA").getchannel("A"))
    suffix = output.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        result.convert("RGB").save(output, "JPEG", quality=quality, optimize=True, progressive=True)
    elif suffix == ".webp":
        result.save(output, "WEBP", quality=quality, lossless=True, method=6)
    elif suffix in {".tif", ".tiff"}:
        result.save(output, "TIFF", compression="tiff_deflate")
    elif suffix == ".bmp":
        result.convert("RGB").save(output, "BMP")
    else:
        result.save(output, "PNG", optimize=True)
    return {"output": str(output), "width": result.width, "height": result.height}


def execute(payload: dict) -> dict:
    action = payload.get("action")
    if action == "ocr":
        return run_ocr(payload)
    if action == "inpaint":
        return run_inpaint(payload)
    raise ValueError("视觉组件不支持该操作")


def main() -> int:
    if "--health" in sys.argv[1:]:
        print(json.dumps(health(), ensure_ascii=False))
        return 0
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        print(json.dumps({"ok": False, "error": "请求数据超过 256 KB"}, ensure_ascii=False))
        return 2
    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("请求必须是 JSON 对象")
        print(json.dumps({"ok": True, "result": execute(payload)}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:500]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
