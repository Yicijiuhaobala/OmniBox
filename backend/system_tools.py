from __future__ import annotations

import csv
import os
import platform
import plistlib
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from send2trash import send2trash


router = APIRouter(prefix="/api/system", tags=["system"])

PORT_INSPECTION_TTL_SECONDS = 60
STORAGE_SCAN_TTL_SECONDS = 10 * 60
MAX_STORAGE_CANDIDATES_PER_CATEGORY = 50_000
MAX_STORAGE_VISITED_FILES_PER_CATEGORY = 100_000
LARGE_FILE_MINIMUM_BYTES = 100 * 1024 * 1024
MAX_RESIDUAL_GROUPS = 200
MAX_RESIDUAL_RECORDS_PER_GROUP = 20_000
MAX_REVIEW_RECORDS_PER_PATH = 2_000

_state_lock = threading.Lock()
_port_inspections: dict[str, dict[str, Any]] = {}
_storage_scans: dict[str, dict[str, Any]] = {}
_residual_scans: dict[str, dict[str, Any]] = {}


class PortRequest(BaseModel):
    port: int = Field(ge=1, le=65535)


class PortKillRequest(PortRequest):
    inspection_id: str = Field(min_length=1, max_length=80)
    confirm: bool = False


class StorageCleanRequest(BaseModel):
    scan_id: str = Field(min_length=1, max_length=80)
    categories: list[str] = Field(min_length=1, max_length=10)
    confirm: bool = False


class ResidualCleanRequest(BaseModel):
    scan_id: str = Field(min_length=1, max_length=80)
    apps: list[str] = Field(min_length=1, max_length=100)
    confirm: bool = False


@dataclass(frozen=True)
class StorageCategory:
    id: str
    title: str
    description: str
    root: Path
    minimum_age_seconds: int
    recommended: bool
    risk: str = "normal"
    minimum_size_bytes: int = 0
    cleanup_mode: str = "delete"


@dataclass(frozen=True)
class ResidualLocation:
    id: str
    title: str
    root: Path
    suffix: str = ""
    strip_prefix: str = ""


def _purge_expired_state() -> None:
    now = time.time()
    with _state_lock:
        for store, ttl in (
            (_port_inspections, PORT_INSPECTION_TTL_SECONDS),
            (_storage_scans, STORAGE_SCAN_TTL_SECONDS),
            (_residual_scans, STORAGE_SCAN_TTL_SECONDS),
        ):
            expired = [key for key, value in store.items() if now - value["created_at"] > ttl]
            for key in expired:
                store.pop(key, None)


def _process_command(pid: int) -> tuple[str, str]:
    if os.name == "nt":
        process = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        try:
            row = next(csv.reader(process.stdout.splitlines()))
        except (StopIteration, csv.Error):
            return "未知进程", ""
        name = row[0] if row and not row[0].startswith("INFO:") else "未知进程"
        return name, name

    name_process = subprocess.run(
        ["ps", "-p", str(pid), "-o", "comm="],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    command_process = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    name = name_process.stdout.strip()
    command = command_process.stdout.strip()
    if not name and not command:
        return "未知进程", ""
    return Path(name or command.split(None, 1)[0]).name, command


def _windows_process_details(pid: int) -> tuple[str, str, bool]:
    process = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/V", "/FO", "CSV", "/NH"],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    try:
        row = next(csv.reader(process.stdout.splitlines()))
    except (StopIteration, csv.Error):
        return "未知进程", "未知", False
    if not row or row[0].startswith("INFO:"):
        return "未知进程", "未知", False
    user = row[6] if len(row) > 6 else "未知"
    current_user = os.getenv("USERNAME", "").strip().casefold()
    owner_name = user.rsplit("\\", 1)[-1].strip().casefold()
    return row[0], user, bool(current_user and owner_name == current_user)


def _parent_pid(pid: int) -> int | None:
    if os.name == "nt":
        return None
    process = subprocess.run(
        ["ps", "-p", str(pid), "-o", "ppid="],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    try:
        value = int(process.stdout.strip())
    except ValueError:
        return None
    return value if value > 0 else None


def _protected_pids() -> set[int]:
    protected = {os.getpid()}
    current = os.getpid()
    for _ in range(12):
        parent = _parent_pid(current)
        if parent is None or parent in protected:
            break
        protected.add(parent)
        if parent == 1:
            break
        current = parent
    return protected


def _parse_lsof_output(output: str) -> list[dict[str, Any]]:
    processes: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for raw_line in output.splitlines():
        if not raw_line:
            continue
        field, value = raw_line[0], raw_line[1:]
        if field == "p":
            if current:
                processes.append(current)
            try:
                current = {"pid": int(value)}
            except ValueError:
                current = None
        elif current is not None and field == "c":
            current["name"] = value
        elif current is not None and field == "u":
            try:
                current["uid"] = int(value)
            except ValueError:
                current["uid"] = None
        elif current is not None and field == "L":
            current["user"] = value
    if current:
        processes.append(current)
    return processes


def _inspect_posix_port(port: int) -> list[dict[str, Any]]:
    executable = shutil.which("lsof")
    if not executable:
        raise HTTPException(503, "系统缺少 lsof，暂时无法查询端口占用")
    process = subprocess.run(
        [executable, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-FpcuL"],
        capture_output=True,
        text=True,
        timeout=8,
        check=False,
    )
    if process.returncode not in {0, 1}:
        raise HTTPException(500, f"端口查询失败：{(process.stderr or 'lsof 执行失败').strip()[:300]}")
    return _parse_lsof_output(process.stdout)


def _inspect_windows_port(port: int) -> list[dict[str, Any]]:
    process = subprocess.run(
        ["netstat", "-ano", "-p", "TCP"],
        capture_output=True,
        text=True,
        timeout=8,
        check=False,
    )
    if process.returncode != 0:
        raise HTTPException(500, "端口查询失败：netstat 执行失败")
    pids: set[int] = set()
    for line in process.stdout.splitlines():
        columns = line.split()
        if len(columns) < 5 or columns[0].upper() != "TCP" or columns[-2].upper() != "LISTENING":
            continue
        try:
            local_port = int(columns[1].rsplit(":", 1)[1])
            pid = int(columns[-1])
        except (ValueError, IndexError):
            continue
        if local_port == port:
            pids.add(pid)
    results = []
    for pid in pids:
        name, user, same_user = _windows_process_details(pid)
        results.append({"pid": pid, "name": name, "user": user, "uid": None, "same_user": same_user})
    return results


def _inspect_port_processes(port: int) -> list[dict[str, Any]]:
    raw_processes = _inspect_windows_port(port) if os.name == "nt" else _inspect_posix_port(port)
    protected = _protected_pids()
    current_uid = os.getuid() if hasattr(os, "getuid") else None
    results = []
    for item in raw_processes:
        pid = item["pid"]
        fallback_name = item.get("name") or "未知进程"
        name, command = _process_command(pid)
        uid = item.get("uid")
        is_protected = pid in protected
        same_user = item.get("same_user", current_uid is None or uid is None or uid == current_uid)
        reason = "OmniBox 自身进程，禁止终止" if is_protected else ("进程不属于当前用户" if not same_user else "")
        results.append({
            "pid": pid,
            "name": name or fallback_name,
            "command": command,
            "user": item.get("user") or (str(uid) if uid is not None else "未知"),
            "killable": same_user and not is_protected,
            "protected_reason": reason,
            "signature": f"{pid}:{name or fallback_name}:{command}:{item.get('user', '')}",
        })
    return sorted(results, key=lambda item: item["pid"])


def _public_process(item: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key != "signature"}


def _port_inspection_response(port: int, processes: list[dict[str, Any]], inspection_id: str | None = None) -> dict[str, Any]:
    public_processes = [_public_process(item) for item in processes]
    return {
        "port": port,
        "occupied": bool(processes),
        "inspection_id": inspection_id,
        "processes": public_processes,
        "killable_count": sum(1 for item in processes if item["killable"]),
        "result": f"端口 {port} 被 {len(processes)} 个进程占用" if processes else f"端口 {port} 当前未被占用",
    }


@router.post("/ports/inspect")
def inspect_port(payload: PortRequest) -> dict[str, Any]:
    _purge_expired_state()
    processes = _inspect_port_processes(payload.port)
    inspection_id = uuid.uuid4().hex
    with _state_lock:
        _port_inspections[inspection_id] = {
            "created_at": time.time(),
            "port": payload.port,
            "processes": {item["pid"]: item["signature"] for item in processes},
        }
    return _port_inspection_response(payload.port, processes, inspection_id)


def _terminate_pid(pid: int, force: bool = False) -> None:
    if os.name == "nt":
        command = ["taskkill", "/PID", str(pid), "/T"]
        if force:
            command.append("/F")
        process = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
        if process.returncode != 0:
            raise OSError((process.stderr or process.stdout or "taskkill 执行失败").strip()[:300])
        return
    os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)


@router.post("/ports/kill")
def kill_port(payload: PortKillRequest) -> dict[str, Any]:
    if not payload.confirm:
        raise HTTPException(400, "终止进程前必须明确确认")
    _purge_expired_state()
    with _state_lock:
        inspection = _port_inspections.pop(payload.inspection_id, None)
    if not inspection or inspection["port"] != payload.port:
        raise HTTPException(409, "端口检查结果已过期，请重新查询后再终止")

    current = _inspect_port_processes(payload.port)
    expected = inspection["processes"]
    changed = [item for item in current if expected.get(item["pid"]) != item["signature"]]
    if changed:
        raise HTTPException(409, "端口占用进程已经变化，为避免误杀，请重新查询")
    targets = [item for item in current if item["killable"] and item["pid"] in expected]
    if current and not targets:
        raise HTTPException(403, "该端口仅由受保护进程占用，不能通过 OmniBox 终止")
    if not current:
        return {**_port_inspection_response(payload.port, []), "killed": [], "result": f"端口 {payload.port} 已经释放"}

    failures = []
    for item in targets:
        try:
            _terminate_pid(item["pid"])
        except OSError as exc:
            failures.append({"pid": item["pid"], "error": str(exc)})

    expected_targets = {item["pid"]: item["signature"] for item in targets}
    deadline = time.monotonic() + 2
    remaining = [
        item for item in _inspect_port_processes(payload.port)
        if expected_targets.get(item["pid"]) == item["signature"]
    ]
    while remaining and time.monotonic() < deadline:
        time.sleep(0.1)
        remaining = [
            item for item in _inspect_port_processes(payload.port)
            if expected_targets.get(item["pid"]) == item["signature"]
        ]
    for item in remaining:
        try:
            _terminate_pid(item["pid"], force=True)
        except OSError as exc:
            failures.append({"pid": item["pid"], "error": str(exc)})

    time.sleep(0.1)
    after = _inspect_port_processes(payload.port)
    killed = [item["pid"] for item in targets if not any(current_item["pid"] == item["pid"] for current_item in after)]
    response = _port_inspection_response(payload.port, after)
    response.update({
        "killed": killed,
        "failures": failures,
        "result": f"已终止 {len(killed)} 个进程，端口 {payload.port} 已释放" if not after else f"已终止 {len(killed)} 个进程，端口仍被占用",
    })
    return response


def _large_file_categories(home: Path) -> list[StorageCategory]:
    size_label = "100 MB"
    return [
        StorageCategory(
            "desktop_large_files", "桌面大文件",
            f"递归扫描桌面中不小于 {size_label} 的普通文件；仅手动选择，处理时移入系统废纸篓。",
            home / "Desktop", 0, False, "personal", LARGE_FILE_MINIMUM_BYTES, "trash",
        ),
        StorageCategory(
            "documents_large_files", "文档大文件",
            f"递归扫描文档目录中不小于 {size_label} 的普通文件；仅手动选择，处理时移入系统废纸篓。",
            home / "Documents", 0, False, "personal", LARGE_FILE_MINIMUM_BYTES, "trash",
        ),
        StorageCategory(
            "downloads_large_files", "下载目录大文件",
            f"递归扫描下载目录中不小于 {size_label} 的普通文件；仅手动选择，处理时移入系统废纸篓。",
            home / "Downloads", 0, False, "personal", LARGE_FILE_MINIMUM_BYTES, "trash",
        ),
    ]


def _storage_categories() -> list[StorageCategory]:
    home = Path.home()
    system = platform.system()
    day = 24 * 60 * 60
    if system == "Darwin":
        return [
            StorageCategory("temporary", "临时文件", "系统为当前用户创建、且超过 24 小时未修改的临时文件。", Path(tempfile.gettempdir()), day, True),
            StorageCategory("app_caches", "应用缓存", "用户 Library/Caches 中超过 7 天未修改的缓存文件；应用会按需重新生成。", home / "Library" / "Caches", 7 * day, False),
            StorageCategory("old_logs", "旧日志", "用户 Library/Logs 中超过 30 天未修改的日志文件。", home / "Library" / "Logs", 30 * day, True),
            StorageCategory("trash", "废纸篓", "当前用户废纸篓中的全部普通文件；清理后无法恢复。", home / ".Trash", 0, False, "high"),
        ] + _large_file_categories(home)
    if system == "Windows":
        local_app_data = Path(os.getenv("LOCALAPPDATA", str(home / "AppData" / "Local")))
        return [
            StorageCategory("temporary", "临时文件", "当前用户超过 24 小时未修改的临时文件。", Path(tempfile.gettempdir()), day, True),
            StorageCategory("app_caches", "应用缓存", "本地应用缓存中超过 7 天未修改的文件。", local_app_data / "Cache", 7 * day, False),
        ] + _large_file_categories(home)
    return [
        StorageCategory("temporary", "临时文件", "当前用户超过 24 小时未修改的临时文件。", Path(tempfile.gettempdir()), day, True),
        StorageCategory("app_caches", "应用缓存", "~/.cache 中超过 7 天未修改的缓存文件。", home / ".cache", 7 * day, False),
        StorageCategory("old_logs", "旧日志", "~/.local/state 中超过 30 天未修改的日志和状态文件。", home / ".local" / "state", 30 * day, True),
        StorageCategory("trash", "废纸篓", "当前用户废纸篓中的全部普通文件；清理后无法恢复。", home / ".local" / "share" / "Trash" / "files", 0, False, "high"),
    ] + _large_file_categories(home)


def _display_path(path: Path) -> str:
    try:
        return f"~/{path.relative_to(Path.home())}"
    except ValueError:
        return str(path)


def _path_is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=True))
        return True
    except (OSError, ValueError):
        return False


def _protected_storage_roots() -> list[Path]:
    roots = [Path(__file__).resolve().parent]
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        roots.append(Path(meipass).resolve())
    return roots


def _scan_storage_category(category: StorageCategory) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    root = category.root.expanduser()
    base = {
        "id": category.id,
        "title": category.title,
        "description": category.description,
        "root": _display_path(root),
        "recommended": category.recommended,
        "risk": category.risk,
        "minimum_size_bytes": category.minimum_size_bytes,
        "cleanup_mode": category.cleanup_mode,
    }
    if not root.exists() or not root.is_dir():
        return {**base, "available": False, "size": 0, "file_count": 0, "samples": [], "truncated": False}, []

    cutoff = time.time() - category.minimum_age_seconds
    current_uid = os.getuid() if hasattr(os, "getuid") else None
    protected_roots = _protected_storage_roots()
    candidates: list[dict[str, Any]] = []
    samples: list[dict[str, Any]] = []
    total_size = 0
    truncated = False
    visited_files = 0

    def on_error(_error: OSError) -> None:
        return

    for current_root, dirs, files in os.walk(root, topdown=True, followlinks=False, onerror=on_error):
        current_path = Path(current_root)
        dirs[:] = [
            name for name in dirs
            if not (current_path / name).is_symlink()
            and not any(_path_is_within(current_path / name, protected) for protected in protected_roots if protected.exists())
        ]
        for name in files:
            path = current_path / name
            visited_files += 1
            if visited_files > MAX_STORAGE_VISITED_FILES_PER_CATEGORY or len(candidates) >= MAX_STORAGE_CANDIDATES_PER_CATEGORY:
                truncated = True
                break
            try:
                item_stat = path.lstat()
            except OSError:
                continue
            if not stat.S_ISREG(item_stat.st_mode) or stat.S_ISLNK(item_stat.st_mode):
                continue
            if current_uid is not None and item_stat.st_uid != current_uid:
                continue
            if item_stat.st_size < category.minimum_size_bytes:
                continue
            if category.minimum_age_seconds and item_stat.st_mtime > cutoff:
                continue
            record = {
                "path": str(path),
                "size": item_stat.st_size,
                "device": item_stat.st_dev,
                "inode": item_stat.st_ino,
                "mtime_ns": item_stat.st_mtime_ns,
            }
            candidates.append(record)
            total_size += item_stat.st_size
            samples.append({"path": _display_path(path), "size": item_stat.st_size})
            samples.sort(key=lambda item: item["size"], reverse=True)
            del samples[5:]
        if truncated:
            break

    return {
        **base,
        "available": True,
        "size": total_size,
        "file_count": len(candidates),
        "samples": samples,
        "truncated": truncated,
    }, candidates


def _disk_usage() -> dict[str, int]:
    home = Path.home()
    usage = shutil.disk_usage(home.anchor or home)
    return {"total": usage.total, "used": usage.used, "free": usage.free}


@router.post("/storage/scan")
def scan_storage() -> dict[str, Any]:
    _purge_expired_state()
    scan_id = uuid.uuid4().hex
    public_categories = []
    stored_categories: dict[str, Any] = {}
    for category in _storage_categories():
        public, candidates = _scan_storage_category(category)
        public_categories.append(public)
        stored_categories[category.id] = {"definition": category, "candidates": candidates}
    with _state_lock:
        _storage_scans.clear()
        _storage_scans[scan_id] = {"created_at": time.time(), "categories": stored_categories}
    return {
        "scan_id": scan_id,
        "disk": _disk_usage(),
        "categories": public_categories,
        "total_cleanable": sum(item["size"] for item in public_categories),
        "result": f"扫描完成，发现 {sum(item['file_count'] for item in public_categories):,} 个可清理文件",
    }


def _candidate_unchanged(path: Path, record: dict[str, Any]) -> bool:
    try:
        item_stat = path.lstat()
    except OSError:
        return False
    return (
        stat.S_ISREG(item_stat.st_mode)
        and not stat.S_ISLNK(item_stat.st_mode)
        and item_stat.st_dev == record["device"]
        and item_stat.st_ino == record["inode"]
        and item_stat.st_mtime_ns == record["mtime_ns"]
        and item_stat.st_size == record["size"]
    )


def _remove_empty_parents(parents: set[Path], root: Path) -> None:
    resolved_root = root.resolve(strict=True)
    for parent in sorted(parents, key=lambda item: len(item.parts), reverse=True):
        try:
            resolved_parent = parent.resolve(strict=True)
            if resolved_parent == resolved_root or resolved_root not in resolved_parent.parents:
                continue
            parent.rmdir()
        except OSError:
            continue


@router.post("/storage/clean")
def clean_storage(payload: StorageCleanRequest) -> dict[str, Any]:
    if not payload.confirm:
        raise HTTPException(400, "清理存储空间前必须明确确认")
    _purge_expired_state()
    with _state_lock:
        scan = _storage_scans.pop(payload.scan_id, None)
    if not scan:
        raise HTTPException(409, "扫描结果已过期或已经使用，请重新扫描")
    selected = list(dict.fromkeys(payload.categories))
    unknown = [category_id for category_id in selected if category_id not in scan["categories"]]
    if unknown:
        raise HTTPException(400, f"未知清理类别：{unknown[0]}")

    deleted_files = 0
    trashed_files = 0
    freed_bytes = 0
    trashed_bytes = 0
    skipped_files = 0
    failures = []
    category_results = []
    for category_id in selected:
        stored = scan["categories"][category_id]
        definition: StorageCategory = stored["definition"]
        root = definition.root.expanduser()
        category_deleted = 0
        category_trashed = 0
        category_freed = 0
        category_trashed_bytes = 0
        parents: set[Path] = set()
        for record in stored["candidates"]:
            path = Path(record["path"])
            if not root.exists() or not _path_is_within(path, root) or not _candidate_unchanged(path, record):
                skipped_files += 1
                continue
            try:
                if definition.cleanup_mode == "trash":
                    _send_to_trash(path)
                    trashed_files += 1
                    category_trashed += 1
                    trashed_bytes += record["size"]
                    category_trashed_bytes += record["size"]
                else:
                    path.unlink()
                    parents.add(path.parent)
                    deleted_files += 1
                    category_deleted += 1
                    freed_bytes += record["size"]
                    category_freed += record["size"]
            except OSError as exc:
                if len(failures) < 30:
                    failures.append({"path": _display_path(path), "error": str(exc)})
        if definition.cleanup_mode == "delete" and root.exists():
            _remove_empty_parents(parents, root)
        category_results.append({
            "id": category_id,
            "deleted_files": category_deleted,
            "trashed_files": category_trashed,
            "freed_bytes": category_freed,
            "trashed_bytes": category_trashed_bytes,
        })

    return {
        "deleted_files": deleted_files,
        "trashed_files": trashed_files,
        "freed_bytes": freed_bytes,
        "trashed_bytes": trashed_bytes,
        "skipped_files": skipped_files,
        "failures": failures,
        "categories": category_results,
        "disk": _disk_usage(),
        "result": (
            f"已永久清理 {deleted_files:,} 个文件，预计释放 {freed_bytes:,} 字节；"
            f"另将 {trashed_files:,} 个个人大文件移到系统废纸篓"
        ),
    }


_BUNDLE_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$")
_PROTECTED_BUNDLE_PREFIXES = ("com.apple.", "com.omnibox.")
_MAC_BUNDLE_PREFIXES = ("com.", "org.", "net.", "io.", "dev.", "app.", "ai.", "cn.", "tv.")


def _macos_installed_apps() -> dict[str, str]:
    apps: dict[str, str] = {}
    roots = [
        Path("/Applications"),
        Path("/System/Applications"),
        Path("/System/Library/CoreServices"),
        Path.home() / "Applications",
    ]
    for root in roots:
        if not root.exists():
            continue
        for current_root, dirs, _files in os.walk(root, topdown=True):
            app_dirs = [name for name in dirs if name.lower().endswith(".app")]
            dirs[:] = [name for name in dirs if name not in app_dirs]
            for name in app_dirs:
                app_path = Path(current_root) / name
                info_path = app_path / "Contents" / "Info.plist"
                try:
                    with info_path.open("rb") as stream:
                        info = plistlib.load(stream)
                except (OSError, plistlib.InvalidFileException):
                    continue
                bundle_id = str(info.get("CFBundleIdentifier") or "").strip()
                display_name = str(info.get("CFBundleDisplayName") or info.get("CFBundleName") or app_path.stem).strip()
                if bundle_id:
                    apps[bundle_id] = display_name
    apps["com.omnibox.desktop"] = "OmniBox"
    return apps


def _macos_launchservices_dump() -> str:
    executable = Path("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
    if not executable.exists():
        return ""
    try:
        process = subprocess.run(
            [str(executable), "-dump"],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return process.stdout


def _macos_bundle_exists(identifier: str) -> bool:
    executable = shutil.which("mdfind")
    if not executable:
        return False
    try:
        process = subprocess.run(
            [executable, f"kMDItemCFBundleIdentifier == '{identifier}'"],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return any(Path(line).exists() for line in process.stdout.splitlines() if line.strip())


def _windows_installed_apps() -> dict[str, str]:
    try:
        import winreg
    except ImportError:
        return {}
    apps: dict[str, str] = {}
    roots = [
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    views = [0, getattr(winreg, "KEY_WOW64_32KEY", 0), getattr(winreg, "KEY_WOW64_64KEY", 0)]
    for hive, path in roots:
        for view in views:
            try:
                key = winreg.OpenKey(hive, path, 0, winreg.KEY_READ | view)
            except OSError:
                continue
            with key:
                for index in range(winreg.QueryInfoKey(key)[0]):
                    try:
                        child_name = winreg.EnumKey(key, index)
                        child = winreg.OpenKey(key, child_name)
                        with child:
                            display_name = str(winreg.QueryValueEx(child, "DisplayName")[0]).strip()
                    except OSError:
                        continue
                    if display_name:
                        apps[child_name] = display_name
    return apps


def _linux_installed_apps() -> dict[str, str]:
    apps: dict[str, str] = {}
    roots = [Path("/usr/share/applications"), Path.home() / ".local" / "share" / "applications"]
    for root in roots:
        if not root.exists():
            continue
        for path in root.glob("*.desktop"):
            name = path.stem
            try:
                for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    if line.startswith("Name="):
                        name = line.split("=", 1)[1].strip() or name
                        break
            except OSError:
                continue
            apps[path.stem] = name
    return apps


def _residual_locations() -> list[ResidualLocation]:
    home = Path.home()
    system = platform.system()
    if system == "Darwin":
        library = home / "Library"
        return [
            ResidualLocation("caches", "缓存", library / "Caches"),
            ResidualLocation("preferences", "偏好设置", library / "Preferences", suffix=".plist"),
            ResidualLocation("application_support", "应用支持", library / "Application Support"),
            ResidualLocation("logs", "日志", library / "Logs"),
            ResidualLocation("saved_state", "保存状态", library / "Saved Application State", suffix=".savedState"),
            ResidualLocation("webkit", "WebKit 数据", library / "WebKit"),
            ResidualLocation("http_storage", "HTTP 存储", library / "HTTPStorages"),
            ResidualLocation("containers", "沙盒容器", library / "Containers"),
            ResidualLocation("group_containers", "共享容器", library / "Group Containers", strip_prefix="group."),
        ]
    if system == "Windows":
        local = Path(os.getenv("LOCALAPPDATA", str(home / "AppData" / "Local")))
        roaming = Path(os.getenv("APPDATA", str(home / "AppData" / "Roaming")))
        program_data = Path(os.getenv("PROGRAMDATA", "C:/ProgramData"))
        return [
            ResidualLocation("local_appdata", "Local AppData", local),
            ResidualLocation("roaming_appdata", "Roaming AppData", roaming),
            ResidualLocation("program_data", "ProgramData", program_data),
        ]
    return [
        ResidualLocation("config", "配置", home / ".config"),
        ResidualLocation("cache", "缓存", home / ".cache"),
        ResidualLocation("local_share", "应用数据", home / ".local" / "share"),
    ]


def _normalize_app_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def _identifier_from_residual(path: Path, location: ResidualLocation) -> str | None:
    name = path.name
    if location.id == "http_storage" and name.endswith(".binarycookies"):
        name = name[:-len(".binarycookies")]
    if location.suffix:
        if not name.endswith(location.suffix):
            return None
        name = name[:-len(location.suffix)]
    if location.strip_prefix and name.startswith(location.strip_prefix):
        name = name[len(location.strip_prefix):]
    if location.id == "group_containers" and re.match(r"^[A-Z0-9]{10}\.", name):
        name = name.split(".", 1)[1]
    return name if _BUNDLE_IDENTIFIER_PATTERN.fullmatch(name) else None


def _matches_installed_bundle(identifier: str, installed_ids: set[str]) -> bool:
    return any(
        identifier == installed
        or identifier.startswith(f"{installed}.")
        or installed.startswith(f"{identifier}.")
        for installed in installed_ids
    )


def _discover_macos_residuals() -> tuple[dict[str, dict[str, Any]], int]:
    installed = _macos_installed_apps()
    launchservices_dump = _macos_launchservices_dump()
    for match in re.finditer(r"^identifier:\s+([^\s]+)\s*$", launchservices_dump, flags=re.MULTILINE):
        installed.setdefault(match.group(1), match.group(1))
    installed_ids = set(installed)
    groups: dict[str, dict[str, Any]] = {}
    for location in _residual_locations():
        if not location.root.exists():
            continue
        try:
            children = list(location.root.iterdir())
        except OSError:
            continue
        for path in children:
            if path.is_symlink():
                continue
            identifier = _identifier_from_residual(path, location)
            if not identifier or not identifier.startswith(_MAC_BUNDLE_PREFIXES):
                continue
            if identifier.startswith(_PROTECTED_BUNDLE_PREFIXES) or identifier in {item.rstrip(".") for item in _PROTECTED_BUNDLE_PREFIXES}:
                continue
            if _matches_installed_bundle(identifier, installed_ids) or identifier in launchservices_dump:
                continue
            group = groups.setdefault(identifier, {
                "id": identifier,
                "name": identifier.rsplit(".", 1)[-1].replace("-", " ").title(),
                "locations": [],
                "exact_identifier": True,
            })
            group["locations"].append({"location": location, "path": path})
    for identifier, group in list(groups.items()):
        distinct_locations = len({entry["location"].id for entry in group["locations"]})
        if distinct_locations >= 2 and _macos_bundle_exists(identifier):
            groups.pop(identifier, None)
    return groups, len(installed)


_WINDOWS_RESIDUAL_EXCLUSIONS = {
    "microsoft", "windows", "packages", "temp", "temporaryinternetfiles", "connecteddevicesplatform",
    "crashdumps", "d3dscache", "history", "inetcache", "internetexplorer", "low", "recent",
}


def _discover_named_residuals(system: str) -> tuple[dict[str, dict[str, Any]], int]:
    installed = _windows_installed_apps() if system == "Windows" else _linux_installed_apps()
    installed_names = {_normalize_app_name(name) for name in installed.values() if _normalize_app_name(name)}
    installed_names.update(_normalize_app_name(key) for key in installed if _normalize_app_name(key))
    groups: dict[str, dict[str, Any]] = {}
    for location in _residual_locations():
        if not location.root.exists():
            continue
        try:
            children = list(location.root.iterdir())
        except OSError:
            continue
        for path in children:
            if path.is_symlink() or not path.is_dir():
                continue
            normalized = _normalize_app_name(path.name)
            if len(normalized) < 3 or normalized in _WINDOWS_RESIDUAL_EXCLUSIONS:
                continue
            if any(normalized == item or normalized in item or item in normalized for item in installed_names if len(item) >= 3):
                continue
            group_id = f"{system.casefold()}:{normalized}"
            group = groups.setdefault(group_id, {
                "id": group_id,
                "name": path.name,
                "locations": [],
                "exact_identifier": False,
            })
            group["locations"].append({"location": location, "path": path})
    return groups, len(installed)


def _discover_residuals() -> tuple[dict[str, dict[str, Any]], int, str]:
    system = platform.system()
    if system == "Darwin":
        groups, installed_count = _discover_macos_residuals()
    else:
        groups, installed_count = _discover_named_residuals(system)
    return groups, installed_count, system


def _residual_record(path: Path) -> dict[str, Any] | None:
    try:
        item_stat = path.lstat()
    except OSError:
        return None
    if stat.S_ISREG(item_stat.st_mode):
        kind = "file"
    elif stat.S_ISDIR(item_stat.st_mode):
        kind = "directory"
    elif stat.S_ISLNK(item_stat.st_mode):
        kind = "symlink"
    else:
        kind = "other"
    return {
        "path": str(path),
        "kind": kind,
        "size": item_stat.st_size if kind == "file" else 0,
        "device": item_stat.st_dev,
        "inode": item_stat.st_ino,
        "mtime_ns": item_stat.st_mtime_ns,
        "owned": not hasattr(os, "getuid") or item_stat.st_uid == os.getuid(),
    }


def _snapshot_residual_path(path: Path, allowed_root: Path, max_records: int = MAX_RESIDUAL_RECORDS_PER_GROUP) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    complete = True
    truncated = False

    def add_record(item: Path) -> bool:
        nonlocal complete, truncated
        if len(records) >= max_records:
            truncated = True
            return False
        record = _residual_record(item)
        if record is None:
            complete = False
            return True
        records.append(record)
        if not record["owned"]:
            complete = False
        return True

    if not add_record(path):
        complete = False
    root_record = records[0] if records else None
    if root_record and root_record["kind"] == "directory":
        def on_error(_error: OSError) -> None:
            nonlocal complete
            complete = False

        for current_root, dirs, files in os.walk(path, topdown=True, followlinks=False, onerror=on_error):
            current_path = Path(current_root)
            next_dirs = []
            for name in dirs:
                child = current_path / name
                if not add_record(child):
                    break
                if not child.is_symlink():
                    next_dirs.append(name)
            else:
                dirs[:] = next_dirs
                for name in files:
                    if not add_record(current_path / name):
                        break
                if not truncated:
                    continue
            dirs[:] = []
            truncated = True
            break

    return {
        "path": str(path),
        "allowed_root": str(allowed_root),
        "records": records,
        "size": sum(record["size"] for record in records),
        "file_count": sum(1 for record in records if record["kind"] == "file"),
        "complete": complete and not truncated and bool(records),
        "truncated": truncated,
    }


def _residual_snapshot_unchanged(snapshot: dict[str, Any]) -> bool:
    path = Path(snapshot["path"])
    allowed_root = Path(snapshot["allowed_root"])
    if not path.exists() or path == allowed_root or not _path_is_within(path, allowed_root):
        return False
    current = _snapshot_residual_path(path, allowed_root)
    if not current["complete"] or len(current["records"]) != len(snapshot["records"]):
        return False
    original_records = {record["path"]: record for record in snapshot["records"]}
    for record in current["records"]:
        original = original_records.get(record["path"])
        if not original:
            return False
        if any(record[key] != original[key] for key in ("kind", "size", "device", "inode", "mtime_ns", "owned")):
            return False
    return True


def _send_to_trash(path: Path) -> None:
    send2trash(str(path))


@router.post("/residuals/scan")
def scan_app_residuals() -> dict[str, Any]:
    _purge_expired_state()
    raw_groups, installed_count, system = _discover_residuals()
    ordered = sorted(
        raw_groups.values(),
        key=lambda item: (-len({entry["location"].id for entry in item["locations"]}), item["id"]),
    )[:MAX_RESIDUAL_GROUPS]
    scan_id = uuid.uuid4().hex
    public_groups = []
    stored_groups: dict[str, Any] = {}
    for group in ordered:
        distinct_locations = len({entry["location"].id for entry in group["locations"]})
        confidence = "high" if system == "Darwin" and group["exact_identifier"] and distinct_locations >= 2 else "review"
        max_records = MAX_RESIDUAL_RECORDS_PER_GROUP if confidence == "high" else MAX_REVIEW_RECORDS_PER_PATH
        snapshots = [
            _snapshot_residual_path(entry["path"], entry["location"].root, max_records=max_records)
            for entry in group["locations"]
        ]
        cleanable = all(snapshot["complete"] for snapshot in snapshots)
        total_size = sum(snapshot["size"] for snapshot in snapshots)
        total_files = sum(snapshot["file_count"] for snapshot in snapshots)
        reason = (
            f"未发现对应应用，并在 {distinct_locations} 个标准目录中精确匹配到同一 Bundle ID"
            if confidence == "high"
            else "未匹配到已安装应用，但仅有单点或名称级证据，需要人工确认"
        )
        public = {
            "id": group["id"],
            "name": group["name"],
            "confidence": confidence,
            "recommended": confidence == "high" and cleanable,
            "cleanable": cleanable,
            "reason": reason,
            "size": total_size,
            "file_count": total_files,
            "paths": [
                {
                    "category": entry["location"].title,
                    "path": _display_path(entry["path"]),
                    "size": snapshot["size"],
                    "file_count": snapshot["file_count"],
                    "truncated": snapshot["truncated"],
                }
                for entry, snapshot in zip(group["locations"], snapshots)
            ],
        }
        public_groups.append(public)
        stored_groups[group["id"]] = {"public": public, "snapshots": snapshots}

    with _state_lock:
        _residual_scans.clear()
        _residual_scans[scan_id] = {"created_at": time.time(), "groups": stored_groups}
    return {
        "scan_id": scan_id,
        "platform": system,
        "installed_apps_count": installed_count,
        "groups": public_groups,
        "total_size": sum(group["size"] for group in public_groups),
        "high_confidence_size": sum(group["size"] for group in public_groups if group["confidence"] == "high"),
        "result": f"扫描完成，发现 {len(public_groups)} 组可能的应用残余",
    }


@router.post("/residuals/clean")
def clean_app_residuals(payload: ResidualCleanRequest) -> dict[str, Any]:
    if not payload.confirm:
        raise HTTPException(400, "移动应用残余到废纸篓前必须明确确认")
    _purge_expired_state()
    with _state_lock:
        scan = _residual_scans.pop(payload.scan_id, None)
    if not scan:
        raise HTTPException(409, "扫描结果已过期或已经使用，请重新扫描")
    selected = list(dict.fromkeys(payload.apps))
    unknown = [app_id for app_id in selected if app_id not in scan["groups"]]
    if unknown:
        raise HTTPException(400, f"未知应用残余：{unknown[0]}")

    moved_paths = []
    skipped_paths = []
    failures = []
    freed_bytes = 0
    for app_id in selected:
        group = scan["groups"][app_id]
        if not group["public"]["cleanable"]:
            skipped_paths.extend(path["path"] for path in group["public"]["paths"])
            continue
        for snapshot in group["snapshots"]:
            path = Path(snapshot["path"])
            if not _residual_snapshot_unchanged(snapshot):
                skipped_paths.append(_display_path(path))
                continue
            try:
                _send_to_trash(path)
                moved_paths.append(_display_path(path))
                freed_bytes += snapshot["size"]
            except OSError as exc:
                failures.append({"path": _display_path(path), "error": str(exc)})

    return {
        "moved_paths": moved_paths,
        "moved_count": len(moved_paths),
        "skipped_paths": skipped_paths,
        "failures": failures[:30],
        "freed_bytes": freed_bytes,
        "disk": _disk_usage(),
        "result": f"已将 {len(moved_paths)} 个残余项目移到系统废纸篓，预计释放 {freed_bytes:,} 字节",
    }
