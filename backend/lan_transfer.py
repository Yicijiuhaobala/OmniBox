from __future__ import annotations

import atexit
import base64
import ipaddress
import io
import os
import secrets
import socket
import stat
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import qrcode
import uvicorn
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/lan-transfer", tags=["lan-transfer"])

MAX_SHARED_FILES = 100
MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024
MAX_UPLOAD_FILES = 500
MIN_SESSION_MINUTES = 1
MAX_SESSION_MINUTES = 120
LAN_IPV4_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "100.64.0.0/10",
    "169.254.0.0/16",
))


class StartTransferRequest(BaseModel):
    shared_files: list[str] = Field(default_factory=list, max_length=MAX_SHARED_FILES)
    receive_directory: str = Field(default="", max_length=4_096)
    expires_in_minutes: int = Field(default=10, ge=MIN_SESSION_MINUTES, le=MAX_SESSION_MINUTES)


@dataclass(frozen=True)
class SharedFile:
    id: str
    path: Path
    name: str
    size: int
    device: int
    inode: int
    mtime_ns: int


@dataclass
class TransferSession:
    token: str
    port: int
    url: str
    urls: list[str]
    qr_data_url: str
    receive_directory: Path
    shared_files: dict[str, SharedFile]
    created_at: float
    expires_at: float
    uploaded_files: list[dict[str, Any]] = field(default_factory=list)
    connected_devices: dict[str, float] = field(default_factory=dict)
    bytes_uploaded: int = 0
    bytes_downloaded: int = 0
    download_count: int = 0


def _is_private_client(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        return False
    if address.is_loopback:
        return True
    return address.version == 4 and any(address in network for network in LAN_IPV4_NETWORKS)


def _lan_ipv4_addresses() -> list[str]:
    addresses: set[str] = set()
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
            addresses.add(item[4][0])
    except OSError:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("10.255.255.255", 9))
        addresses.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass

    usable = []
    for value in addresses:
        try:
            address = ipaddress.ip_address(value)
        except ValueError:
            continue
        if address.version == 4 and not address.is_loopback and any(address in network for network in LAN_IPV4_NETWORKS):
            usable.append(value)
    return sorted(usable, key=lambda value: (ipaddress.ip_address(value).is_link_local, value))


def _qr_data_url(value: str) -> str:
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=7, border=2)
    qr.add_data(value)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#17212a", back_color="#ffffff")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(output.getvalue()).decode('ascii')}"


def _safe_filename(value: str) -> str:
    name = Path(value.replace("\\", "/")).name.strip()
    if not name or name in {".", ".."} or any(ord(character) < 32 for character in name):
        raise HTTPException(400, "文件名无效")
    return name[:240]


def _reserve_destination(directory: Path, name: str) -> Path:
    original = directory / name
    stem = original.stem
    suffix = original.suffix
    for number in range(10_000):
        candidate = original if number == 0 else directory / f"{stem} ({number}){suffix}"
        try:
            descriptor = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            continue
        os.close(descriptor)
        return candidate
    raise HTTPException(409, "同名文件过多，请整理接收目录后重试")


def _shared_file_unchanged(item: SharedFile) -> bool:
    try:
        item_stat = item.path.lstat()
    except OSError:
        return False
    return (
        stat.S_ISREG(item_stat.st_mode)
        and not stat.S_ISLNK(item_stat.st_mode)
        and item_stat.st_dev == item.device
        and item_stat.st_ino == item.inode
        and item_stat.st_mtime_ns == item.mtime_ns
        and item_stat.st_size == item.size
    )


MOBILE_PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>OmniBox 局域网快传</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#17212a;background:#eef3f6;color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:24px 14px 48px}.shell{width:min(680px,100%);margin:auto}.brand{display:flex;align-items:center;gap:12px;margin:8px 4px 20px}.logo{width:43px;height:43px;display:grid;place-items:center;color:#fff;border-radius:13px;background:#356f99;font-size:21px;font-weight:800}.brand h1{font-size:20px;margin:0}.brand p{color:#687984;font-size:12px;margin:4px 0 0}.local{margin-left:auto;color:#327253;border:1px solid #b8d9c7;border-radius:999px;background:#f3fbf6;padding:5px 9px;font-size:11px}.card{border:1px solid #d5e0e6;border-radius:15px;background:#fff;box-shadow:0 8px 28px rgba(32,62,80,.06);padding:17px;margin-bottom:13px}.card h2{font-size:15px;margin:0 0 5px}.card>p,.hint{color:#71808a;font-size:12px;line-height:1.55;margin:0 0 14px}.upload{position:relative;display:grid;place-items:center;gap:7px;min-height:150px;text-align:center;border:1.5px dashed #9eb9ca;border-radius:12px;background:#f7fafc;padding:20px}.upload input{position:absolute;inset:0;width:100%;height:100%;opacity:0}.upload strong{font-size:14px}.upload span{color:#758791;font-size:11px}.button{width:100%;min-height:43px;color:#fff;border:0;border-radius:10px;background:#397ca8;padding:0 15px;font-size:13px;font-weight:700}.button:disabled{opacity:.5}.files{display:grid;gap:8px}.file{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;border:1px solid #e0e7eb;border-radius:10px;background:#fafcfd;padding:11px}.file strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.file small{color:#7a8992;font-size:11px}.file a{color:#2f719c;text-decoration:none;border:1px solid #bcd0dc;border-radius:8px;padding:7px 10px;font-size:12px}.progress{height:6px;overflow:hidden;border-radius:99px;background:#e2e9ed;margin-top:8px}.progress i{display:block;width:0;height:100%;background:#3d8db4}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:13px}.stats div{text-align:center;border:1px solid #d9e3e8;border-radius:11px;background:#fff;padding:12px 5px}.stats strong{display:block;font-size:15px}.stats span{color:#75848d;font-size:10px}.message{display:none;color:#376a50;border:1px solid #bcd9c8;border-radius:9px;background:#f2faf5;padding:10px;margin-top:11px;font-size:12px}.message.error{color:#9b4f48;border-color:#e5c2bd;background:#fff6f5}.empty{color:#84919a;text-align:center;padding:20px;font-size:12px}@media(max-width:480px){body{padding-top:16px}.local{display:none}.stats{grid-template-columns:1fr}.card{padding:14px}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="brand"><div class="logo">O</div><div><h1>OmniBox 局域网快传</h1><p>设备直连 · 原文件传输 · 不经过互联网</p></div><span class="local">仅局域网</span></header>
    <div class="stats"><div><strong id="remain">--</strong><span>剩余有效时间</span></div><div><strong id="uploads">0</strong><span>已上传文件</span></div><div><strong id="downloads">0</strong><span>已下载次数</span></div></div>
    <section class="card"><h2>上传到电脑</h2><p>选择手机中的照片或文件，保持原始画质上传。</p><label class="upload"><input id="picker" type="file" multiple><strong>点这里选择文件</strong><span>可一次选择多个文件，单文件最大 20 GB</span></label><div id="queue" class="files" style="margin-top:10px"></div><button id="uploadButton" class="button" disabled>开始上传</button><div id="message" class="message"></div></section>
    <section class="card"><h2>从电脑下载</h2><p>这里只显示电脑端明确选择分享的文件。</p><div id="downloadsList" class="files"><div class="empty">正在读取文件列表…</div></div></section>
    <p class="hint">关闭电脑端分享或倒计时结束后，本页面会立即失效。同一 Wi-Fi 若启用了设备隔离，可能无法访问。</p>
  </main>
  <script>
    const base=location.pathname.replace(/\/$/,'');let selected=[];
    const format=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';
    const message=(text,error=false)=>{const el=document.getElementById('message');el.textContent=text;el.className='message'+(error?' error':'');el.style.display='block'};
    async function refresh(){try{const response=await fetch(base+'/status',{cache:'no-store'});if(!response.ok)throw new Error('分享已停止或链接已过期');const data=await response.json();const seconds=Math.max(0,Math.floor(data.expires_at-Date.now()/1000));document.getElementById('remain').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');document.getElementById('uploads').textContent=data.uploaded_files.length;document.getElementById('downloads').textContent=data.download_count;const list=document.getElementById('downloadsList');list.innerHTML=data.shared_files.length?data.shared_files.map(file=>`<div class="file"><div><strong></strong><small>${format(file.size)}</small></div><a>下载</a></div>`).join(''):'<div class="empty">电脑端暂未选择分享文件</div>';data.shared_files.forEach((file,index)=>{const row=list.children[index];row.querySelector('strong').textContent=file.name;row.querySelector('a').href=base+'/download/'+encodeURIComponent(file.id)});}catch(error){document.getElementById('remain').textContent='已停止';message(error.message,true)}}
    function renderQueue(){const queue=document.getElementById('queue');queue.innerHTML='';selected.forEach((file,index)=>{const row=document.createElement('div');row.className='file';const info=document.createElement('div');const name=document.createElement('strong');name.textContent=file.name;const size=document.createElement('small');size.textContent=format(file.size);info.append(name,size);const state=document.createElement('small');state.id='state-'+index;state.textContent='等待';row.append(info,state);queue.append(row)});document.getElementById('uploadButton').disabled=!selected.length}
    document.getElementById('picker').addEventListener('change',event=>{selected=[...event.target.files];renderQueue()});
    document.getElementById('uploadButton').addEventListener('click',async()=>{const button=document.getElementById('uploadButton');button.disabled=true;for(let index=0;index<selected.length;index++){const file=selected[index];const state=document.getElementById('state-'+index);state.textContent='上传中 0%';try{await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',base+'/upload?name='+encodeURIComponent(file.name));xhr.upload.onprogress=event=>{if(event.lengthComputable)state.textContent='上传中 '+Math.round(event.loaded/event.total*100)+'%'};xhr.onload=()=>xhr.status<300?resolve():reject(new Error(xhr.responseText||'上传失败'));xhr.onerror=()=>reject(new Error('网络连接中断'));xhr.send(file)});state.textContent='已完成';}catch(error){state.textContent='失败';message(file.name+'：'+error.message,true)}}selected=[];document.getElementById('picker').value='';button.disabled=true;message('上传任务已完成');refresh()});
    refresh();setInterval(refresh,2000);
  </script>
</body>
</html>"""


class LanTransferManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._session: TransferSession | None = None
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None
        self._timer: threading.Timer | None = None

    def _resolve_receive_directory(self, value: str) -> Path:
        directory = Path(value).expanduser() if value.strip() else Path.home() / "Downloads" / "OmniBox 快传"
        try:
            directory.mkdir(parents=True, exist_ok=True)
            resolved = directory.resolve(strict=True)
            item_stat = resolved.stat()
        except OSError as exc:
            raise HTTPException(400, f"接收目录不可用：{exc}") from exc
        if not resolved.is_dir() or (hasattr(os, "getuid") and item_stat.st_uid != os.getuid()):
            raise HTTPException(400, "接收目录必须属于当前用户")
        return resolved

    def _resolve_shared_files(self, values: list[str]) -> dict[str, SharedFile]:
        files: dict[str, SharedFile] = {}
        seen: set[Path] = set()
        for value in values:
            source = Path(value).expanduser()
            try:
                if source.is_symlink():
                    raise OSError("不允许分享符号链接")
                resolved = source.resolve(strict=True)
                item_stat = resolved.lstat()
            except OSError as exc:
                raise HTTPException(400, f"分享文件不可用：{source.name or value}") from exc
            if resolved in seen:
                continue
            if not stat.S_ISREG(item_stat.st_mode) or (hasattr(os, "getuid") and item_stat.st_uid != os.getuid()):
                raise HTTPException(400, f"只能分享当前用户拥有的普通文件：{resolved.name}")
            seen.add(resolved)
            file_id = secrets.token_urlsafe(9)
            files[file_id] = SharedFile(file_id, resolved, resolved.name, item_stat.st_size, item_stat.st_dev, item_stat.st_ino, item_stat.st_mtime_ns)
        return files

    def start(self, payload: StartTransferRequest) -> dict[str, Any]:
        self.stop()
        receive_directory = self._resolve_receive_directory(payload.receive_directory)
        shared_files = self._resolve_shared_files(payload.shared_files)
        addresses = _lan_ipv4_addresses()
        if not addresses:
            raise HTTPException(503, "没有找到可用的局域网 IPv4 地址，请先连接 Wi-Fi 或有线网络")

        share_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        share_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            share_socket.bind(("0.0.0.0", 0))
            share_socket.listen(128)
            share_socket.set_inheritable(True)
        except OSError as exc:
            share_socket.close()
            raise HTTPException(503, f"无法启动局域网服务：{exc}") from exc

        port = int(share_socket.getsockname()[1])
        token = secrets.token_urlsafe(32)
        urls = [f"http://{address}:{port}/t/{token}" for address in addresses]
        created_at = time.time()
        session = TransferSession(
            token=token,
            port=port,
            url=urls[0],
            urls=urls,
            qr_data_url=_qr_data_url(urls[0]),
            receive_directory=receive_directory,
            shared_files=shared_files,
            created_at=created_at,
            expires_at=created_at + payload.expires_in_minutes * 60,
        )
        config = uvicorn.Config(share_app, host="0.0.0.0", port=port, log_level="warning", access_log=False)
        server = uvicorn.Server(config)
        thread = threading.Thread(target=server.run, kwargs={"sockets": [share_socket]}, name="omnibox-lan-transfer", daemon=True)
        timer = threading.Timer(payload.expires_in_minutes * 60, self._stop_token, args=(token,))
        timer.daemon = True
        with self._lock:
            self._session = session
            self._server = server
            self._thread = thread
            self._timer = timer
        thread.start()
        timer.start()
        deadline = time.time() + 4
        while not server.started and thread.is_alive() and time.time() < deadline:
            time.sleep(0.02)
        if not server.started:
            self.stop()
            raise HTTPException(503, "局域网服务启动超时，请检查系统防火墙")
        return self.status(include_qr=True)

    def _stop_token(self, token: str) -> None:
        with self._lock:
            matches = bool(self._session and secrets.compare_digest(self._session.token, token))
        if matches:
            self.stop()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            server = self._server
            thread = self._thread
            timer = self._timer
            self._session = None
            self._server = None
            self._thread = None
            self._timer = None
        if timer:
            timer.cancel()
        if server:
            server.should_exit = True
        if thread and thread is not threading.current_thread():
            thread.join(timeout=4)
        return {"active": False, "result": "局域网快传已停止"}

    def _active_session(self) -> TransferSession | None:
        with self._lock:
            session = self._session
        if session and session.expires_at <= time.time():
            self.stop()
            return None
        return session

    def require(self, token: str, client_host: str) -> TransferSession:
        if not _is_private_client(client_host):
            raise HTTPException(403, "仅允许局域网设备访问")
        session = self._active_session()
        if not session or not secrets.compare_digest(session.token, token):
            raise HTTPException(404, "分享已停止或链接已过期")
        with self._lock:
            session.connected_devices[client_host] = time.time()
        return session

    def status(self, include_qr: bool = False) -> dict[str, Any]:
        session = self._active_session()
        if not session:
            return {"active": False}
        with self._lock:
            result = {
                "active": True,
                "url": session.url,
                "urls": session.urls,
                "port": session.port,
                "receive_directory": str(session.receive_directory),
                "created_at": session.created_at,
                "expires_at": session.expires_at,
                "shared_files": [{"id": item.id, "name": item.name, "size": item.size} for item in session.shared_files.values()],
                "uploaded_files": list(session.uploaded_files),
                "connected_devices": [{"ip": ip, "last_seen": seen} for ip, seen in session.connected_devices.items()],
                "bytes_uploaded": session.bytes_uploaded,
                "bytes_downloaded": session.bytes_downloaded,
                "download_count": session.download_count,
            }
            if include_qr:
                result["qr_data_url"] = session.qr_data_url
            return result


manager = LanTransferManager()
share_app = FastAPI(title="OmniBox LAN Transfer", docs_url=None, redoc_url=None, openapi_url=None)


@share_app.middleware("http")
async def protect_lan(request: Request, call_next):
    client_host = request.client.host if request.client else ""
    if not _is_private_client(client_host):
        return JSONResponse({"detail": "仅允许局域网设备访问"}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:"
    return response


@share_app.get("/t/{token}", response_class=HTMLResponse)
def mobile_page(token: str, request: Request):
    manager.require(token, request.client.host if request.client else "")
    return HTMLResponse(MOBILE_PAGE)


@share_app.get("/t/{token}/status")
def mobile_status(token: str, request: Request):
    manager.require(token, request.client.host if request.client else "")
    return manager.status(include_qr=False)


@share_app.post("/t/{token}/upload")
async def upload_file(token: str, request: Request, name: str = Query(min_length=1, max_length=500)):
    session = manager.require(token, request.client.host if request.client else "")
    with manager._lock:
        if len(session.uploaded_files) >= MAX_UPLOAD_FILES:
            raise HTTPException(429, "本次分享接收的文件数量已达上限")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            raise HTTPException(400, "Content-Length 无效") from exc
        if declared_size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "单个文件不能超过 20 GB")
    safe_name = _safe_filename(name)
    temporary = session.receive_directory / f".omnibox-upload-{uuid.uuid4().hex}.part"
    destination: Path | None = None
    written = 0
    try:
        with temporary.open("xb") as output:
            async for chunk in request.stream():
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "单个文件不能超过 20 GB")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        destination = _reserve_destination(session.receive_directory, safe_name)
        try:
            temporary.replace(destination)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    assert destination is not None
    with manager._lock:
        session.uploaded_files.append({"name": destination.name, "size": written, "received_at": time.time()})
        session.bytes_uploaded += written
    return {"ok": True, "name": destination.name, "size": written}


@share_app.get("/t/{token}/download/{file_id}")
def download_file(token: str, file_id: str, request: Request):
    session = manager.require(token, request.client.host if request.client else "")
    item = session.shared_files.get(file_id)
    if not item or not _shared_file_unchanged(item):
        raise HTTPException(409, "文件已移动或发生变化，请在电脑端重新开始分享")
    with manager._lock:
        session.download_count += 1
        session.bytes_downloaded += item.size
    return FileResponse(item.path, filename=item.name, media_type="application/octet-stream")


@router.get("/status")
def transfer_status() -> dict[str, Any]:
    return manager.status(include_qr=True)


@router.post("/start")
def start_transfer(payload: StartTransferRequest) -> dict[str, Any]:
    return manager.start(payload)


@router.post("/stop")
def stop_transfer() -> dict[str, Any]:
    return manager.stop()


atexit.register(manager.stop)
