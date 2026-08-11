from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

try:
    from .config_store import CONFIG_DIR
except ImportError:
    from config_store import CONFIG_DIR


COMPONENT_ID = "vision-runtime"
PROTOCOL_VERSION = 1
CATALOG_SCHEMA_VERSION = 1
MAX_CATALOG_BYTES = 256 * 1024
MAX_COMPONENT_BYTES = 220 * 1024 * 1024
CATALOG_CACHE_SECONDS = 10 * 60
DEFAULT_CATALOG_URL = (
    "https://github.com/Yicijiuhaobala/OmniBox/releases/download/"
    "vision-runtime-v1.0.0/catalog.json"
)


class VisionComponentError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int = 400, retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable

    def detail(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "root_cause_hint": self.message,
            "retry_instruction": "检查网络后重试；已下载但校验失败时请重新安装组件。",
            "stop_condition": "连续两次失败后停止重试，并检查磁盘空间、网络代理或组件目录权限。",
        }


def http_error(error: VisionComponentError) -> HTTPException:
    return HTTPException(error.status_code, error.detail())


def current_target() -> tuple[str, str]:
    system = "darwin" if sys.platform == "darwin" else "win32" if os.name == "nt" else "linux"
    machine = platform.machine().lower()
    architecture = "arm64" if machine in {"arm64", "aarch64"} else "x64" if machine in {"x86_64", "amd64"} else machine
    return system, architecture


def executable_name() -> str:
    return "omnibox-vision-runtime.exe" if os.name == "nt" else "omnibox-vision-runtime"


def safe_download_url(value: str) -> str:
    parsed = urlparse(value)
    loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise VisionComponentError("VISION_COMPONENT_URL_INVALID", "视觉组件只允许从 HTTPS 地址下载")
    if parsed.username or parsed.password or not parsed.hostname:
        raise VisionComponentError("VISION_COMPONENT_URL_INVALID", "视觉组件下载地址无效")
    return value


class VisionComponentManager:
    def __init__(self, data_dir: Path | None = None, catalog_url: str | None = None) -> None:
        self.root = (data_dir or CONFIG_DIR) / "components" / COMPONENT_ID
        self.metadata_path = self.root / "installed.json"
        self.catalog_url = catalog_url or os.getenv("OMNIBOX_VISION_CATALOG_URL") or DEFAULT_CATALOG_URL
        self.external_executable = os.getenv("OMNIBOX_VISION_EXECUTABLE", "").strip()
        self._install_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._progress = {"state": "idle", "downloaded_bytes": 0, "total_bytes": 0}
        self._catalog_cache: tuple[float, dict] | None = None

    def _set_progress(self, **values) -> None:
        with self._state_lock:
            self._progress = {**self._progress, **values}

    def _read_metadata(self) -> dict:
        try:
            value = json.loads(self.metadata_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}

    def _write_metadata(self, value: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        temporary = self.metadata_path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        if os.name != "nt":
            temporary.chmod(0o600)
        temporary.replace(self.metadata_path)

    def _installed_executable(self) -> tuple[Path | None, dict]:
        if self.external_executable:
            path = Path(self.external_executable).expanduser().resolve()
            return (path if path.is_file() else None), {"version": "development", "external": True}
        metadata = self._read_metadata()
        relative = metadata.get("executable")
        if not isinstance(relative, str) or not relative:
            return None, metadata
        path = (self.root / relative).resolve()
        try:
            path.relative_to(self.root.resolve())
        except ValueError:
            return None, {}
        expected_size = metadata.get("size")
        if not path.is_file() or not isinstance(expected_size, int) or path.stat().st_size != expected_size:
            return None, metadata
        return path, metadata

    def _fetch_catalog(self, refresh: bool = False) -> dict:
        now = time.monotonic()
        if not refresh and self._catalog_cache and now - self._catalog_cache[0] < CATALOG_CACHE_SECONDS:
            return self._catalog_cache[1]
        url = safe_download_url(self.catalog_url)
        try:
            response = httpx.get(url, follow_redirects=True, timeout=15)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise VisionComponentError("VISION_CATALOG_UNAVAILABLE", f"无法读取视觉组件目录：{exc}", status_code=502) from exc
        if len(response.content) > MAX_CATALOG_BYTES:
            raise VisionComponentError("VISION_CATALOG_TOO_LARGE", "视觉组件目录超过 256 KB", status_code=502)
        try:
            catalog = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise VisionComponentError("VISION_CATALOG_INVALID", "视觉组件目录不是有效 JSON", status_code=502) from exc
        if not isinstance(catalog, dict) or catalog.get("schema_version") != CATALOG_SCHEMA_VERSION or catalog.get("component") != COMPONENT_ID:
            raise VisionComponentError("VISION_CATALOG_INVALID", "视觉组件目录版本或组件标识无效", status_code=502)
        releases = catalog.get("releases")
        if not isinstance(releases, list) or len(releases) > 20:
            raise VisionComponentError("VISION_CATALOG_INVALID", "视觉组件目录缺少有效发布列表", status_code=502)
        self._catalog_cache = (now, catalog)
        return catalog

    def _release(self, refresh: bool = False) -> dict:
        system, architecture = current_target()
        catalog = self._fetch_catalog(refresh)
        release = next((item for item in catalog["releases"] if isinstance(item, dict) and item.get("platform") == system and item.get("arch") == architecture), None)
        if release is None:
            raise VisionComponentError("VISION_COMPONENT_UNSUPPORTED", f"暂不支持当前平台：{system}-{architecture}", status_code=404, retryable=False)
        version = release.get("version")
        sha256 = release.get("sha256")
        size = release.get("size")
        if not isinstance(version, str) or not re.fullmatch(r"[0-9A-Za-z._-]{1,40}", version):
            raise VisionComponentError("VISION_CATALOG_INVALID", "视觉组件版本无效", status_code=502)
        if not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256):
            raise VisionComponentError("VISION_CATALOG_INVALID", "视觉组件 SHA-256 无效", status_code=502)
        if not isinstance(size, int) or not 1 <= size <= MAX_COMPONENT_BYTES:
            raise VisionComponentError("VISION_CATALOG_INVALID", "视觉组件文件大小无效", status_code=502)
        url = safe_download_url(str(release.get("url", "")))
        return {**release, "url": url, "version": version, "sha256": sha256, "size": size}

    def status(self, refresh: bool = False) -> dict:
        executable, metadata = self._installed_executable()
        with self._state_lock:
            progress = dict(self._progress)
        warning = ""
        release = None
        try:
            release = self._release(refresh)
        except VisionComponentError as exc:
            warning = exc.message
        installed = executable is not None
        return {
            "component": COMPONENT_ID,
            "installed": installed,
            "version": metadata.get("version", "") if installed else "",
            "external": bool(metadata.get("external")) if installed else False,
            "capabilities": ["ocr", "inpaint"],
            "state": progress["state"],
            "downloaded_bytes": progress["downloaded_bytes"],
            "total_bytes": progress["total_bytes"] or (release or {}).get("size", 0),
            "available_version": (release or {}).get("version", ""),
            "update_available": bool(installed and release and metadata.get("sha256") != release["sha256"]),
            "catalog_available": release is not None,
            "warning": warning,
        }

    def _health_check(self, executable: Path) -> None:
        try:
            process = subprocess.run([str(executable), "--health"], capture_output=True, text=True, timeout=30, check=False)
            data = json.loads(process.stdout)
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
            raise VisionComponentError("VISION_COMPONENT_INVALID", f"视觉组件启动检查失败：{exc}", status_code=502) from exc
        if process.returncode != 0 or data.get("ok") is not True or data.get("protocol") != PROTOCOL_VERSION:
            raise VisionComponentError("VISION_COMPONENT_INVALID", "视觉组件协议检查失败", status_code=502)

    def install(self) -> dict:
        if self.external_executable:
            executable, _ = self._installed_executable()
            if executable is None:
                raise VisionComponentError("VISION_COMPONENT_MISSING", "开发模式视觉组件路径不存在", status_code=409)
            self._health_check(executable)
            return self.status()
        with self._install_lock:
            release = self._release(refresh=True)
            executable, metadata = self._installed_executable()
            if executable and metadata.get("sha256") == release["sha256"]:
                return self.status()
            self.root.mkdir(parents=True, exist_ok=True)
            if os.name != "nt":
                self.root.chmod(0o700)
            free_bytes = shutil.disk_usage(self.root).free
            if free_bytes < release["size"] * 2 + 100 * 1024 * 1024:
                raise VisionComponentError("VISION_COMPONENT_NO_SPACE", "磁盘空间不足，无法下载并校验视觉组件", status_code=507)
            staging = Path(tempfile.mkdtemp(prefix=".install-", dir=self.root))
            target = staging / executable_name()
            digest = hashlib.sha256()
            downloaded = 0
            self._set_progress(state="downloading", downloaded_bytes=0, total_bytes=release["size"])
            try:
                timeout = httpx.Timeout(connect=15, read=90, write=30, pool=15)
                with httpx.stream("GET", release["url"], follow_redirects=True, timeout=timeout) as response:
                    response.raise_for_status()
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > MAX_COMPONENT_BYTES:
                        raise VisionComponentError("VISION_COMPONENT_TOO_LARGE", "视觉组件下载文件超过 220 MB", status_code=502)
                    with target.open("wb") as stream:
                        for chunk in response.iter_bytes(1024 * 1024):
                            downloaded += len(chunk)
                            if downloaded > MAX_COMPONENT_BYTES or downloaded > release["size"]:
                                raise VisionComponentError("VISION_COMPONENT_SIZE_MISMATCH", "视觉组件下载大小与目录不一致", status_code=502)
                            stream.write(chunk)
                            digest.update(chunk)
                            self._set_progress(downloaded_bytes=downloaded)
                        stream.flush()
                        os.fsync(stream.fileno())
                if downloaded != release["size"] or digest.hexdigest() != release["sha256"]:
                    raise VisionComponentError("VISION_COMPONENT_CHECKSUM_MISMATCH", "视觉组件完整性校验失败，已拒绝安装", status_code=502)
                if os.name != "nt":
                    target.chmod(0o700)
                self._set_progress(state="verifying")
                self._health_check(target)
                final_dir = self.root / f"{release['version']}-{release['sha256'][:12]}"
                if final_dir.exists():
                    shutil.rmtree(final_dir)
                staging.replace(final_dir)
                installed_executable = final_dir / executable_name()
                self._write_metadata({
                    "component": COMPONENT_ID,
                    "version": release["version"],
                    "sha256": release["sha256"],
                    "size": release["size"],
                    "executable": str(installed_executable.relative_to(self.root)),
                    "installed_at": int(time.time()),
                })
                for child in self.root.iterdir():
                    if child.is_dir() and child != final_dir and not child.name.startswith(".install-"):
                        shutil.rmtree(child, ignore_errors=True)
                self._set_progress(state="ready", downloaded_bytes=downloaded)
                return self.status()
            except VisionComponentError:
                self._set_progress(state="failed")
                raise
            except (httpx.HTTPError, OSError, ValueError) as exc:
                self._set_progress(state="failed")
                raise VisionComponentError("VISION_COMPONENT_INSTALL_FAILED", f"视觉组件安装失败：{exc}", status_code=502) from exc
            finally:
                if staging.exists():
                    shutil.rmtree(staging, ignore_errors=True)

    def uninstall(self) -> dict:
        if self.external_executable:
            raise VisionComponentError("VISION_COMPONENT_EXTERNAL", "开发模式外部组件不能由应用删除", status_code=409, retryable=False)
        with self._install_lock:
            executable, _ = self._installed_executable()
            if self.metadata_path.exists():
                self.metadata_path.unlink()
            if executable:
                version_dir = executable.parent
                try:
                    version_dir.relative_to(self.root.resolve())
                    shutil.rmtree(version_dir, ignore_errors=True)
                except ValueError:
                    pass
            self._set_progress(state="idle", downloaded_bytes=0, total_bytes=0)
            return self.status()

    def run(self, payload: dict, timeout_seconds: int = 300) -> dict:
        executable, _ = self._installed_executable()
        if executable is None:
            raise VisionComponentError("VISION_COMPONENT_REQUIRED", "首次使用需要先下载本地视觉组件", status_code=409)
        try:
            process = subprocess.run(
                [str(executable)],
                input=json.dumps(payload, ensure_ascii=False),
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
            response = json.loads(process.stdout)
        except subprocess.TimeoutExpired as exc:
            raise VisionComponentError("VISION_COMPONENT_TIMEOUT", "本地视觉组件处理超时", status_code=504) from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise VisionComponentError("VISION_COMPONENT_RUN_FAILED", f"本地视觉组件启动失败：{exc}", status_code=502) from exc
        if process.returncode != 0 or response.get("ok") is not True:
            message = str(response.get("error") or process.stderr or "本地视觉组件处理失败")[:500]
            raise VisionComponentError("VISION_COMPONENT_RUN_FAILED", message, status_code=502)
        result = response.get("result")
        if not isinstance(result, dict):
            raise VisionComponentError("VISION_COMPONENT_RUN_FAILED", "本地视觉组件返回格式无效", status_code=502)
        return result


manager = VisionComponentManager()
