from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.vision_component import VisionComponentError, VisionComponentManager, current_target, safe_download_url


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args) -> None:
        return


class LocalComponentServer:
    def __init__(self, directory: Path) -> None:
        handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(directory), **kwargs)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_port}"

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


@unittest.skipIf(os.name == "nt", "测试组件使用 Unix 可执行脚本")
class VisionComponentManagerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.asset = self.directory / "vision-runtime"
        self.asset.write_text(
            "#!/usr/bin/env python3\n"
            "import json, sys\n"
            "if '--health' in sys.argv:\n"
            " print(json.dumps({'ok': True, 'component': 'vision-runtime', 'version': 'test', 'protocol': 1}))\n"
            "else:\n"
            " payload=json.loads(sys.stdin.read()); print(json.dumps({'ok': True, 'result': {'action': payload.get('action')}}))\n",
            encoding="utf-8",
        )
        self.asset.chmod(0o700)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_catalog(self, base_url: str, sha256: str | None = None) -> Path:
        system, architecture = current_target()
        data = self.asset.read_bytes()
        catalog = {
            "schema_version": 1,
            "component": "vision-runtime",
            "releases": [{
                "platform": system,
                "arch": architecture,
                "version": "1.0.0-test",
                "url": f"{base_url}/{self.asset.name}",
                "sha256": sha256 or hashlib.sha256(data).hexdigest(),
                "size": len(data),
                "capabilities": ["ocr", "inpaint"],
            }],
        }
        path = self.directory / "catalog.json"
        path.write_text(json.dumps(catalog), encoding="utf-8")
        return path

    def test_download_verify_run_and_uninstall(self) -> None:
        with LocalComponentServer(self.directory) as base_url:
            catalog = self._write_catalog(base_url)
            manager = VisionComponentManager(self.directory / "data", f"{base_url}/{catalog.name}")
            initial = manager.status(refresh=True)
            self.assertFalse(initial["installed"])
            self.assertTrue(initial["catalog_available"])
            installed = manager.install()
            self.assertTrue(installed["installed"])
            self.assertEqual(installed["version"], "1.0.0-test")
            self.assertEqual(manager.run({"action": "ocr"}), {"action": "ocr"})
            removed = manager.uninstall()
            self.assertFalse(removed["installed"])

    def test_checksum_mismatch_is_rejected_without_installing(self) -> None:
        with LocalComponentServer(self.directory) as base_url:
            catalog = self._write_catalog(base_url, "0" * 64)
            manager = VisionComponentManager(self.directory / "data", f"{base_url}/{catalog.name}")
            with self.assertRaises(VisionComponentError) as raised:
                manager.install()
            self.assertEqual(raised.exception.code, "VISION_COMPONENT_CHECKSUM_MISMATCH")
            self.assertFalse(manager.status()["installed"])

    def test_rejects_non_https_remote_url(self) -> None:
        with self.assertRaises(VisionComponentError):
            safe_download_url("http://example.com/vision-runtime")
        self.assertEqual(safe_download_url("http://127.0.0.1:8001/vision-runtime"), "http://127.0.0.1:8001/vision-runtime")


if __name__ == "__main__":
    unittest.main()
