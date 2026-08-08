from __future__ import annotations

import base64
import binascii
import csv
import difflib
import hashlib
import html
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Literal
from urllib.parse import quote, unquote
from xml.dom import minidom

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/advanced", tags=["advanced-tools"])


class StructuredRequest(BaseModel):
    format: Literal["json", "yaml", "xml"]
    action: Literal["format", "minify", "validate", "tree", "schema"]
    input: str = Field(min_length=1, max_length=1_000_000)
    schema_text: str = Field(default="", max_length=500_000)


class CodecRequest(BaseModel):
    action: Literal[
        "base64_encode", "base64_decode", "url_encode", "url_decode",
        "jwt_decode", "hash", "hash_verify",
    ]
    input: str = Field(default="", max_length=1_000_000)
    algorithm: Literal["md5", "sha256", "sha512"] = "sha256"
    expected: str = Field(default="", max_length=256)


class TimeRequest(BaseModel):
    action: Literal["timestamp_to_date", "date_to_timestamp", "cron"]
    input: str = Field(min_length=1, max_length=200)
    timezone: str = Field(default="Asia/Shanghai", max_length=100)


class TextRequest(BaseModel):
    action: Literal["dedupe", "sort", "diff", "regex"]
    input: str = Field(default="", max_length=1_000_000)
    secondary: str = Field(default="", max_length=1_000_000)
    pattern: str = Field(default="", max_length=1_000)
    flags: list[Literal["i", "m", "s"]] = Field(default_factory=list)
    descending: bool = False


class ImageRequest(BaseModel):
    action: Literal["convert", "compress", "resize", "crop", "remove_exif", "inpaint", "images_to_pdf"]
    files: list[str] = Field(min_length=1, max_length=100)
    output_dir: str = ""
    target: Literal["png", "jpg", "webp", "svg"] = "png"
    width: int = Field(default=0, ge=0, le=30_000)
    height: int = Field(default=0, ge=0, le=30_000)
    x: int = Field(default=0, ge=0, le=100_000)
    y: int = Field(default=0, ge=0, le=100_000)
    quality: int = Field(default=88, ge=1, le=100)
    inpaint_radius: int = Field(default=5, ge=1, le=30)
    page_size: Literal["a4", "original"] = "a4"
    margin: int = Field(default=48, ge=0, le=300)


class ImageInfoRequest(BaseModel):
    files: list[str] = Field(min_length=1, max_length=100)


class WatermarkRequest(BaseModel):
    files: list[str] = Field(min_length=1, max_length=50)
    text: str = Field(min_length=1, max_length=120)
    output_dir: str = ""
    opacity: int = Field(default=24, ge=5, le=90)
    angle: int = Field(default=-25, ge=-80, le=80)
    font_size: int = Field(default=0, ge=0, le=300)
    spacing: int = Field(default=48, ge=0, le=500)
    color: str = Field(default="#D94A4A", pattern=r"^#[0-9A-Fa-f]{6}$")


class NetworkRequest(BaseModel):
    action: Literal["ip", "ping", "ports"]
    target: str = Field(default="", max_length=253)
    ports: str = Field(default="22,80,443,3000,5173,8000,8080", max_length=1_000)
    count: int = Field(default=4, ge=1, le=5)
    timeout: float = Field(default=0.5, ge=0.1, le=2.0)


def _json_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return str(value)


def _value_tree(value, name="root") -> dict:
    if isinstance(value, dict):
        return {
            "name": str(name), "type": "object", "count": len(value),
            "children": [_value_tree(item, key) for key, item in value.items()],
        }
    if isinstance(value, list):
        return {
            "name": str(name), "type": "array", "count": len(value),
            "children": [_value_tree(item, f"[{index}]") for index, item in enumerate(value)],
        }
    value_type = "null" if value is None else type(value).__name__
    return {"name": str(name), "type": value_type, "value": value}


def _xml_tree(element) -> dict:
    children = [_xml_tree(child) for child in list(element)]
    attributes = [
        {"name": f"@{key}", "type": "attribute", "value": value}
        for key, value in element.attrib.items()
    ]
    text = (element.text or "").strip()
    node = {"name": element.tag, "type": "element"}
    if attributes or children:
        node["children"] = attributes + children
        if text:
            node["children"].insert(len(attributes), {"name": "#text", "type": "text", "value": text})
        node["count"] = len(node["children"])
    elif text:
        node["value"] = text
    return node


def _parse_structured(format_name: str, text: str):
    if format_name == "json":
        return json.loads(text)
    if format_name == "yaml":
        import yaml

        return yaml.safe_load(text)
    from defusedxml import ElementTree

    return ElementTree.fromstring(text)


@router.post("/structured")
def structured_tool(payload: StructuredRequest) -> dict:
    try:
        parsed = _parse_structured(payload.format, payload.input)
        if payload.action == "schema":
            if payload.format != "json":
                raise ValueError("JSON Schema 校验仅适用于 JSON 数据")
            if not payload.schema_text.strip():
                raise ValueError("请填写 JSON Schema")
            from jsonschema import Draft202012Validator

            schema = json.loads(payload.schema_text)
            Draft202012Validator.check_schema(schema)
            errors = []
            for error in sorted(Draft202012Validator(schema).iter_errors(parsed), key=lambda item: list(item.path)):
                path = ".".join(str(part) for part in error.absolute_path) or "$"
                errors.append({"path": path, "message": error.message})
            return {
                "valid": not errors,
                "result": "数据符合 JSON Schema" if not errors else f"发现 {len(errors)} 个 Schema 问题",
                "errors": errors,
            }
        if payload.action == "tree":
            tree = _xml_tree(parsed) if payload.format == "xml" else _value_tree(_json_value(parsed))
            return {"valid": True, "result": "结构解析成功", "tree": tree}
        if payload.action == "validate":
            return {"valid": True, "result": f"{payload.format.upper()} 语法正确"}
        if payload.format == "json":
            result = json.dumps(parsed, ensure_ascii=False, indent=2 if payload.action == "format" else None, separators=None if payload.action == "format" else (",", ":"))
        elif payload.format == "yaml":
            import yaml

            result = yaml.safe_dump(parsed, allow_unicode=True, sort_keys=False, default_flow_style=payload.action == "minify").strip()
        elif payload.action == "format":
            rough = minidom.parseString(payload.input.encode("utf-8")).toprettyxml(indent="  ", encoding=None)
            result = "\n".join(line for line in rough.splitlines() if line.strip())
        else:
            from xml.etree import ElementTree

            result = ElementTree.tostring(parsed, encoding="unicode", short_empty_elements=True)
        return {"valid": True, "result": result}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"处理失败：{exc}") from exc


def _decode_base64url(value: str) -> bytes:
    value += "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value.encode("ascii"))


@router.post("/codec")
def codec_tool(payload: CodecRequest) -> dict:
    try:
        if payload.action == "base64_encode":
            result = base64.b64encode(payload.input.encode("utf-8")).decode("ascii")
        elif payload.action == "base64_decode":
            result = base64.b64decode(payload.input.strip(), validate=True).decode("utf-8")
        elif payload.action == "url_encode":
            result = quote(payload.input, safe="")
        elif payload.action == "url_decode":
            result = unquote(payload.input)
        elif payload.action == "jwt_decode":
            parts = payload.input.strip().split(".")
            if len(parts) != 3:
                raise ValueError("JWT 应包含 header.payload.signature 三段")
            header = json.loads(_decode_base64url(parts[0]))
            body = json.loads(_decode_base64url(parts[1]))
            result = json.dumps({"header": header, "payload": body, "signature": parts[2]}, ensure_ascii=False, indent=2)
            return {"result": result, "decoded": {"header": header, "payload": body}, "warning": "仅解码，未校验签名"}
        else:
            digest = hashlib.new(payload.algorithm, payload.input.encode("utf-8")).hexdigest()
            if payload.action == "hash_verify":
                valid = digest.lower() == payload.expected.strip().lower()
                return {"result": digest, "valid": valid, "message": "校验一致" if valid else "校验不一致"}
            result = digest
        return {"result": result}
    except (ValueError, UnicodeDecodeError, binascii.Error, json.JSONDecodeError) as exc:
        raise HTTPException(400, f"处理失败：{exc}") from exc


def _timezone(name: str):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"未知时区：{name}") from exc


@router.post("/time")
def time_tool(payload: TimeRequest) -> dict:
    try:
        timezone = _timezone(payload.timezone)
        if payload.action == "timestamp_to_date":
            stamp = float(payload.input.strip())
            unit = "毫秒" if abs(stamp) > 10_000_000_000 else "秒"
            if unit == "毫秒":
                stamp /= 1000
            value = datetime.fromtimestamp(stamp, timezone)
            return {"result": value.isoformat(sep=" ", timespec="seconds"), "unit": unit, "timezone": payload.timezone}
        if payload.action == "date_to_timestamp":
            source = payload.input.strip().replace("Z", "+00:00")
            value = datetime.fromisoformat(source)
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone)
            stamp = value.timestamp()
            return {"result": str(int(stamp)), "milliseconds": str(int(stamp * 1000)), "timezone": payload.timezone}
        from croniter import croniter

        expression = payload.input.strip()
        if not croniter.is_valid(expression):
            raise ValueError("Cron 表达式无效，支持标准 5 段或含秒的 6 段格式")
        base = datetime.now(timezone)
        iterator = croniter(expression, base, ret_type=datetime, second_at_beginning=len(expression.split()) == 6)
        future = [iterator.get_next(datetime).isoformat(sep=" ", timespec="seconds") for _ in range(10)]
        return {"result": "Cron 表达式有效", "valid": True, "next": future, "timezone": payload.timezone}
    except Exception as exc:
        raise HTTPException(400, f"处理失败：{exc}") from exc


@router.post("/text")
def text_tool(payload: TextRequest) -> dict:
    try:
        if payload.action == "dedupe":
            result = "\n".join(dict.fromkeys(payload.input.splitlines()))
            return {"result": result}
        if payload.action == "sort":
            lines = sorted(payload.input.splitlines(), key=lambda item: item.casefold(), reverse=payload.descending)
            return {"result": "\n".join(lines)}
        if payload.action == "diff":
            lines = list(difflib.unified_diff(
                payload.input.splitlines(), payload.secondary.splitlines(),
                fromfile="原始文本", tofile="对比文本", lineterm="",
            ))
            return {"result": "\n".join(lines) if lines else "没有差异", "changed": bool(lines)}
        if not payload.pattern:
            raise ValueError("请输入正则表达式")
        import regex

        flags = 0
        if "i" in payload.flags:
            flags |= regex.IGNORECASE
        if "m" in payload.flags:
            flags |= regex.MULTILINE
        if "s" in payload.flags:
            flags |= regex.DOTALL
        compiled = regex.compile(payload.pattern, flags)
        matches = []
        for match in compiled.finditer(payload.input, timeout=0.5):
            matches.append({
                "start": match.start(), "end": match.end(), "text": match.group(0),
                "groups": [group for group in match.groups()],
            })
            if len(matches) >= 1_000:
                break
        return {"result": f"找到 {len(matches)} 处匹配", "matches": matches, "truncated": len(matches) >= 1_000}
    except TimeoutError as exc:
        raise HTTPException(408, "正则执行超过 500ms，可能存在灾难性回溯") from exc
    except Exception as exc:
        raise HTTPException(400, f"处理失败：{exc}") from exc


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
WATERMARK_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def _resolve_image_files(raw_files: list[str]) -> list[Path]:
    files = list(dict.fromkeys(Path(item).expanduser().resolve() for item in raw_files))
    for path in files:
        if not path.is_file():
            raise ValueError(f"文件不存在：{path}")
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            raise ValueError(f"不支持的图片格式：{path.suffix or '无扩展名'}")
    return files


def _output_directory(files: list[Path], raw_output_dir: str, label: str) -> Path:
    if raw_output_dir.strip():
        output_dir = Path(raw_output_dir).expanduser().resolve()
    else:
        output_dir = files[0].parent / "OmniBox 输出" / f"{datetime.now():%Y%m%d-%H%M%S}-{label}"
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise ValueError(f"无法为 {path.name} 生成不重复的文件名")


def _open_image(path: Path):
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = 100_000_000
    if path.suffix.lower() == ".svg":
        import resvg_py

        rendered = resvg_py.svg_to_bytes(svg_path=str(path))
        image = Image.open(BytesIO(rendered))
    else:
        image = Image.open(path)
    image.load()
    return ImageOps.exif_transpose(image)


def _flatten_for_jpeg(image):
    from PIL import Image

    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def _save_raster(image, output: Path, target: str, quality: int = 88, lossless: bool = False) -> None:
    if target == "jpg":
        _flatten_for_jpeg(image).save(output, "JPEG", quality=quality, optimize=True)
    elif target == "webp":
        image.save(output, "WEBP", quality=quality, lossless=lossless, method=6)
    else:
        image.save(output, "PNG", optimize=True, compress_level=9)


def _raster_to_svg(source: Path, output: Path) -> None:
    image = _open_image(source)
    buffer = BytesIO()
    image.save(buffer, "PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    width, height = image.size
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}"><image width="{width}" height="{height}" '
        f'href="data:image/png;base64,{encoded}"/></svg>'
    )
    output.write_text(svg, encoding="utf-8")


def _strip_jpeg_exif(source: Path, output: Path) -> None:
    data = source.read_bytes()
    if not data.startswith(b"\xff\xd8"):
        raise ValueError("不是有效的 JPEG 文件")
    result = bytearray(data[:2])
    position = 2
    while position < len(data):
        if data[position] != 0xFF:
            result.extend(data[position:])
            break
        marker_start = position
        while position < len(data) and data[position] == 0xFF:
            position += 1
        if position >= len(data):
            break
        marker = data[position]
        position += 1
        if marker == 0xDA:
            result.extend(data[marker_start:])
            break
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            result.extend(data[marker_start:position])
            continue
        if position + 2 > len(data):
            raise ValueError("JPEG 数据不完整")
        length = int.from_bytes(data[position:position + 2], "big")
        segment_end = position + length
        if segment_end > len(data) or length < 2:
            raise ValueError("JPEG 数据不完整")
        segment = data[position + 2:segment_end]
        is_exif = marker == 0xE1 and segment.startswith(b"Exif\x00\x00")
        is_comment = marker == 0xFE
        if not is_exif and not is_comment:
            result.extend(data[marker_start:segment_end])
        position = segment_end
    output.write_bytes(bytes(result))


def _same_format_suffix(path: Path) -> str:
    suffix = path.suffix.lower()
    return ".jpg" if suffix == ".jpeg" else suffix


def _images_to_pdf(files: list[Path], payload: ImageRequest, output_dir: Path) -> tuple[Path, str]:
    from PIL import Image
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    buffers = []
    try:
        for source in files:
            image = _open_image(source).convert("RGB")
            page = image
            if payload.page_size == "a4":
                landscape = image.width > image.height
                page_width, page_height = ((1754, 1240) if landscape else (1240, 1754))
                available_width = max(1, page_width - payload.margin * 2)
                available_height = max(1, page_height - payload.margin * 2)
                scale = min(available_width / image.width, available_height / image.height)
                rendered_size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
                rendered = image.resize(rendered_size, Image.Resampling.LANCZOS)
                page = Image.new("RGB", (page_width, page_height), "white")
                page.paste(rendered, ((page_width - rendered.width) // 2, (page_height - rendered.height) // 2))
                rendered.close()

            buffer = BytesIO()
            page.save(buffer, "PDF", resolution=150)
            buffer.seek(0)
            writer.add_page(PdfReader(buffer).pages[0])
            buffers.append(buffer)
            if page is not image:
                page.close()
            image.close()

        if not writer.pages:
            raise ValueError("没有可写入 PDF 的图片")
        output = _unique_path(output_dir / "照片合并.pdf")
        writer.add_metadata({"/Title": "OmniBox 照片合并", "/Creator": "OmniBox"})
        with output.open("wb") as stream:
            writer.write(stream)
        return output, f"已按选择顺序合并 {len(writer.pages)} 页（{'A4 自适应' if payload.page_size == 'a4' else '原图尺寸'}）"
    finally:
        for buffer in buffers:
            buffer.close()


def _inpaint_region(image, payload: ImageRequest):
    if not payload.width or not payload.height:
        raise ValueError("选区宽度和高度必须大于 0")
    right, bottom = payload.x + payload.width, payload.y + payload.height
    if right > image.width or bottom > image.height:
        raise ValueError(f"修复选区超出图片尺寸 {image.width}×{image.height}")

    import cv2
    import numpy as np
    from PIL import Image

    rgb = image.convert("RGB")
    source = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
    mask = np.zeros((image.height, image.width), dtype=np.uint8)
    mask[payload.y:bottom, payload.x:right] = 255
    repaired = cv2.inpaint(source, mask, payload.inpaint_radius, cv2.INPAINT_TELEA)
    result = Image.fromarray(cv2.cvtColor(repaired, cv2.COLOR_BGR2RGB))
    if image.mode in {"RGBA", "LA"}:
        result.putalpha(image.convert("RGBA").getchannel("A"))
    return result


def _process_image(source: Path, payload: ImageRequest, output_dir: Path) -> tuple[Path, str]:
    suffix = source.suffix.lower()
    if payload.action == "convert":
        output = _unique_path(output_dir / f"{source.stem}.{payload.target}")
        if payload.target == "svg":
            if suffix == ".svg":
                shutil.copy2(source, output)
                return output, "SVG 副本"
            _raster_to_svg(source, output)
            return output, "SVG 内嵌位图"
        image = _open_image(source)
        _save_raster(image, output, payload.target, payload.quality)
        return output, f"转换为 {payload.target.upper()}"

    output_suffix = ".png" if suffix == ".svg" else _same_format_suffix(source)
    action_label = {
        "compress": "压缩", "resize": "缩放", "crop": "裁剪",
        "remove_exif": "无EXIF", "inpaint": "选区修复",
    }[payload.action]
    output = _unique_path(output_dir / f"{source.stem}-{action_label}{output_suffix}")

    if payload.action == "compress" and suffix in {".jpg", ".jpeg"}:
        _strip_jpeg_exif(source, output)
        return output, "无损移除 EXIF/注释，保留 JPEG 图像数据"

    image = _open_image(source)
    target = output_suffix.lstrip(".")
    if payload.action == "resize":
        if not payload.width and not payload.height:
            raise ValueError("缩放时至少填写宽度或高度")
        width, height = image.size
        new_width = payload.width or max(1, round(width * payload.height / height))
        new_height = payload.height or max(1, round(height * payload.width / width))
        from PIL import Image

        image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        _save_raster(image, output, target, payload.quality, lossless=target == "webp")
        return output, f"{width}×{height} → {new_width}×{new_height}"
    if payload.action == "crop":
        if not payload.width or not payload.height:
            raise ValueError("裁剪宽度和高度必须大于 0")
        right, bottom = payload.x + payload.width, payload.y + payload.height
        if right > image.width or bottom > image.height:
            raise ValueError(f"裁剪区域超出图片尺寸 {image.width}×{image.height}")
        image = image.crop((payload.x, payload.y, right, bottom))
        _save_raster(image, output, target, payload.quality, lossless=target == "webp")
        return output, f"裁剪为 {payload.width}×{payload.height}"
    if payload.action == "remove_exif":
        if suffix in {".jpg", ".jpeg"}:
            _strip_jpeg_exif(source, output)
            return output, "已无损移除 EXIF"
        _save_raster(image, output, target, payload.quality, lossless=target == "webp")
        return output, "已移除元数据"
    if payload.action == "inpaint":
        if suffix == ".svg":
            raise ValueError("SVG 暂不支持选区修复，请先转换为 PNG")
        image = _inpaint_region(image, payload)
        _save_raster(image, output, target, payload.quality, lossless=target == "webp")
        return output, f"已修复选区 X={payload.x}、Y={payload.y}、{payload.width}×{payload.height}"
    _save_raster(image, output, target, payload.quality, lossless=True)
    return output, "PNG/WebP 无损重新压缩"


@router.post("/image-info")
def image_info(payload: ImageInfoRequest) -> dict:
    try:
        items = []
        for source in _resolve_image_files(payload.files):
            image = _open_image(source)
            try:
                items.append({
                    "path": str(source), "width": image.width, "height": image.height,
                    "mode": image.mode, "bytes": source.stat().st_size,
                })
            finally:
                image.close()
        return {"items": items}
    except Exception as exc:
        raise HTTPException(400, f"读取图片信息失败：{exc}") from exc


@router.post("/image")
def image_tool(payload: ImageRequest) -> dict:
    try:
        files = _resolve_image_files(payload.files)
        output_dir = _output_directory(files, payload.output_dir, "图片")
        if payload.action == "images_to_pdf":
            output, note = _images_to_pdf(files, payload, output_dir)
            return {
                "result": f"已将 {len(files)} 张照片合并为 PDF",
                "items": [{
                    "source": str(files[0]), "output": str(output),
                    "before": sum(item.stat().st_size for item in files),
                    "after": output.stat().st_size, "saved": 0, "note": note,
                }],
                "failures": [], "output_dir": str(output_dir), "pdf": str(output),
            }
        items = []
        failures = []
        for source in files:
            try:
                before = source.stat().st_size
                output, note = _process_image(source, payload, output_dir)
                after = output.stat().st_size
                items.append({
                    "source": str(source), "output": str(output), "before": before,
                    "after": after, "saved": before - after, "note": note,
                })
            except Exception as exc:
                failures.append({"source": str(source), "error": str(exc)})
        if not items:
            raise ValueError(failures[0]["error"] if failures else "没有可处理的图片")
        return {
            "result": f"已处理 {len(items)} 张图片" + (f"，{len(failures)} 张失败" if failures else ""),
            "items": items, "failures": failures, "output_dir": str(output_dir),
        }
    except Exception as exc:
        raise HTTPException(400, f"图片处理失败：{exc}") from exc


def _watermark_font(size: int):
    from PIL import ImageFont

    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _apply_repeated_watermark(source: Path, output: Path, payload: WatermarkRequest) -> None:
    from PIL import Image, ImageColor, ImageDraw, ImageOps

    with _open_image(source) as opened:
        base = ImageOps.exif_transpose(opened).convert("RGBA")
    font_size = payload.font_size or max(18, min(96, round(min(base.size) / 12)))
    font = _watermark_font(font_size)
    alpha = round(255 * payload.opacity / 100)
    red, green, blue = ImageColor.getrgb(payload.color)

    measure = Image.new("RGBA", (1, 1))
    bounds = ImageDraw.Draw(measure).textbbox((0, 0), payload.text, font=font, stroke_width=max(1, font_size // 32))
    text_width = max(1, bounds[2] - bounds[0])
    text_height = max(1, bounds[3] - bounds[1])
    padding = max(12, font_size // 2)
    label = Image.new("RGBA", (text_width + padding * 2, text_height + padding * 2), (0, 0, 0, 0))
    label_draw = ImageDraw.Draw(label)
    label_draw.text(
        (padding - bounds[0], padding - bounds[1]),
        payload.text,
        font=font,
        fill=(red, green, blue, alpha),
        stroke_width=max(1, font_size // 32),
        stroke_fill=(255, 255, 255, min(alpha, 90)),
    )
    rotated = label.rotate(payload.angle, expand=True, resample=Image.Resampling.BICUBIC)

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    step_x = max(1, rotated.width + payload.spacing)
    step_y = max(1, rotated.height + payload.spacing)
    row = 0
    for y in range(-rotated.height, base.height + rotated.height, step_y):
        offset = -(step_x // 2) if row % 2 else 0
        for x in range(-rotated.width + offset, base.width + rotated.width, step_x):
            overlay.alpha_composite(rotated, (x, y))
        row += 1
    watermarked = Image.alpha_composite(base, overlay)
    suffix = output.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        _flatten_for_jpeg(watermarked).save(output, "JPEG", quality=95, optimize=True)
    elif suffix == ".webp":
        watermarked.save(output, "WEBP", quality=95, method=6)
    else:
        watermarked.save(output, "PNG", optimize=True, compress_level=9)


@router.post("/watermark")
def watermark_tool(payload: WatermarkRequest) -> dict:
    try:
        files = list(dict.fromkeys(Path(item).expanduser().resolve() for item in payload.files))
        for path in files:
            if not path.is_file():
                raise ValueError(f"文件不存在：{path}")
            if path.suffix.lower() not in WATERMARK_SUFFIXES:
                raise ValueError(f"水印仅支持 PNG、JPG、WebP：{path.name}")
        output_dir = _output_directory(files, payload.output_dir, "证件水印")
        items, failures = [], []
        for source in files:
            try:
                suffix = ".jpg" if source.suffix.lower() == ".jpeg" else source.suffix.lower()
                output = _unique_path(output_dir / f"{source.stem}-防盗用水印{suffix}")
                _apply_repeated_watermark(source, output, payload)
                items.append({"source": str(source), "output": str(output), "note": "已铺满水印并清除原图元数据"})
            except Exception as exc:
                failures.append({"source": str(source), "error": str(exc)})
        if not items:
            raise ValueError(failures[0]["error"] if failures else "没有可处理的图片")
        return {
            "result": f"已为 {len(items)} 张图片添加防盗用水印" + (f"，{len(failures)} 张失败" if failures else ""),
            "items": items,
            "failures": failures,
            "output_dir": str(output_dir),
            "local_only": True,
        }
    except Exception as exc:
        raise HTTPException(400, f"证件水印处理失败：{exc}") from exc


def _normalize_host(value: str) -> str:
    host = value.strip()
    if not host:
        raise ValueError("请输入 IP 地址或主机名")
    if "://" in host or "/" in host or host.startswith("-"):
        raise ValueError("请只输入 IP 地址或主机名，不要包含协议和路径")
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        ascii_host = host.encode("idna").decode("ascii")
        if len(ascii_host) > 253 or not all(re.fullmatch(r"[A-Za-z0-9-]{1,63}", label) and not label.startswith("-") and not label.endswith("-") for label in ascii_host.rstrip(".").split(".")):
            raise ValueError("主机名格式不正确")
        return ascii_host


def _parse_ports(expression: str) -> list[int]:
    ports = set()
    for part in expression.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            if start > end:
                raise ValueError(f"端口范围顺序错误：{part}")
            ports.update(range(start, end + 1))
        else:
            ports.add(int(part))
    if not ports or any(port < 1 or port > 65535 for port in ports):
        raise ValueError("端口必须在 1–65535 之间")
    if len(ports) > 100:
        raise ValueError("单次最多扫描 100 个端口")
    return sorted(ports)


def _check_port(host: str, port: int, timeout: float) -> tuple[int, bool]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return port, True
    except OSError:
        return port, False


@router.post("/network")
def network_tool(payload: NetworkRequest) -> dict:
    try:
        if payload.action == "ip":
            if payload.target.strip():
                address = ipaddress.ip_address(payload.target.strip())
                if not address.is_global:
                    return {
                        "result": "这是非公网 IP，不查询外部归属地服务",
                        "info": {"ip": str(address), "type": "私有/保留地址", "version": f"IPv{address.version}"},
                    }
                target = str(address)
            else:
                target = ""
            response = httpx.get(f"https://ipwho.is/{target}", params={"lang": "zh"}, timeout=10)
            response.raise_for_status()
            data = response.json()
            if not data.get("success", True):
                raise ValueError(data.get("message", "IP 查询失败"))
            connection = data.get("connection") or {}
            info = {
                "ip": data.get("ip"), "type": data.get("type"), "continent": data.get("continent"),
                "country": data.get("country"), "region": data.get("region"), "city": data.get("city"),
                "postal": data.get("postal"), "latitude": data.get("latitude"), "longitude": data.get("longitude"),
                "isp": connection.get("isp"), "organization": connection.get("org"), "asn": connection.get("asn"),
                "timezone": (data.get("timezone") or {}).get("id"),
            }
            return {"result": json.dumps(info, ensure_ascii=False, indent=2), "info": info, "online": True}

        host = _normalize_host(payload.target)
        if payload.action == "ping":
            if sys.platform == "win32":
                command = ["ping", "-n", str(payload.count), "-w", "2000", host]
            else:
                command = ["ping", "-c", str(payload.count), "-W", "2000", host]
            process = subprocess.run(command, capture_output=True, text=True, timeout=15, check=False)
            output = (process.stdout or process.stderr).strip()
            return {"result": output, "reachable": process.returncode == 0, "exit_code": process.returncode}

        ports = _parse_ports(payload.ports)
        resolved = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)[0][4][0]
        open_ports = []
        with ThreadPoolExecutor(max_workers=min(32, len(ports))) as executor:
            futures = [executor.submit(_check_port, resolved, port, payload.timeout) for port in ports]
            for future in as_completed(futures):
                port, is_open = future.result()
                if is_open:
                    try:
                        service = socket.getservbyport(port)
                    except OSError:
                        service = ""
                    open_ports.append({"port": port, "service": service})
        open_ports.sort(key=lambda item: item["port"])
        return {
            "result": f"已扫描 {len(ports)} 个端口，发现 {len(open_ports)} 个开放端口",
            "host": host, "resolved_ip": resolved, "scanned": ports, "open": open_ports,
        }
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"IP 归属地服务暂时不可用：{exc}") from exc
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(400, f"网络工具执行失败：{exc}") from exc
