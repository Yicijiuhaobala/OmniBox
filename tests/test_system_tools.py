import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend import system_tools


def process(pid: int, signature: str, *, killable: bool = True) -> dict:
    return {
        "pid": pid,
        "name": "demo-server",
        "command": "demo-server --listen",
        "user": "tester",
        "killable": killable,
        "protected_reason": "" if killable else "受保护",
        "signature": signature,
    }


class SystemToolsTests(unittest.TestCase):
    def setUp(self):
        with system_tools._state_lock:
            system_tools._port_inspections.clear()
            system_tools._storage_scans.clear()
            system_tools._residual_scans.clear()

    def test_parse_lsof_output_supports_multiple_processes(self):
        output = "p101\ncdemo-a\nu501\nLalice\np202\ncdemo-b\nu502\nLbob\n"
        self.assertEqual(
            system_tools._parse_lsof_output(output),
            [
                {"pid": 101, "name": "demo-a", "uid": 501, "user": "alice"},
                {"pid": 202, "name": "demo-b", "uid": 502, "user": "bob"},
            ],
        )

    @patch("backend.system_tools.os.getenv", return_value="Alice")
    @patch("backend.system_tools.subprocess.run")
    def test_windows_process_owner_must_match_current_user(self, run_mock, _getenv_mock):
        run_mock.return_value = SimpleNamespace(
            stdout='"demo.exe","321","Console","1","1,024 K","Running","WORKSTATION\\Alice","0:00:01","N/A"\n',
            stderr="",
            returncode=0,
        )
        self.assertEqual(
            system_tools._windows_process_details(321),
            ("demo.exe", "WORKSTATION\\Alice", True),
        )

    @patch("backend.system_tools._terminate_pid")
    @patch("backend.system_tools._inspect_port_processes")
    def test_port_kill_rejects_changed_process(self, inspect_mock, terminate_mock):
        inspect_mock.side_effect = [
            [process(1234, "old-signature")],
            [process(1234, "new-signature")],
        ]
        inspection = system_tools.inspect_port(system_tools.PortRequest(port=8123))

        with self.assertRaises(HTTPException) as caught:
            system_tools.kill_port(system_tools.PortKillRequest(
                port=8123,
                inspection_id=inspection["inspection_id"],
                confirm=True,
            ))

        self.assertEqual(caught.exception.status_code, 409)
        terminate_mock.assert_not_called()

    @patch("backend.system_tools._terminate_pid")
    @patch("backend.system_tools._inspect_port_processes")
    def test_port_kill_refuses_protected_process(self, inspect_mock, terminate_mock):
        protected = process(4321, "protected-signature", killable=False)
        inspect_mock.side_effect = [[protected], [protected]]
        inspection = system_tools.inspect_port(system_tools.PortRequest(port=8000))

        with self.assertRaises(HTTPException) as caught:
            system_tools.kill_port(system_tools.PortKillRequest(
                port=8000,
                inspection_id=inspection["inspection_id"],
                confirm=True,
            ))

        self.assertEqual(caught.exception.status_code, 403)
        terminate_mock.assert_not_called()

    @patch("backend.system_tools.time.sleep")
    @patch("backend.system_tools._terminate_pid")
    @patch("backend.system_tools._inspect_port_processes")
    def test_port_kill_does_not_force_reused_pid(self, inspect_mock, terminate_mock, _sleep_mock):
        old = process(2468, "old-signature")
        reused = process(2468, "reused-signature")
        inspect_mock.side_effect = [[old], [old], [reused], [reused]]
        inspection = system_tools.inspect_port(system_tools.PortRequest(port=8246))

        result = system_tools.kill_port(system_tools.PortKillRequest(
            port=8246,
            inspection_id=inspection["inspection_id"],
            confirm=True,
        ))

        terminate_mock.assert_called_once_with(2468)
        self.assertTrue(result["occupied"])
        self.assertEqual(result["killed"], [])

    def test_storage_clean_deletes_unchanged_scanned_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / "old.cache"
            candidate.write_bytes(b"cache-data")
            old_time = time.time() - 48 * 60 * 60
            os.utime(candidate, (old_time, old_time))
            category = system_tools.StorageCategory(
                "test_cache", "测试缓存", "测试", root, 24 * 60 * 60, True,
            )
            with patch("backend.system_tools._storage_categories", return_value=[category]):
                scan = system_tools.scan_storage()
                result = system_tools.clean_storage(system_tools.StorageCleanRequest(
                    scan_id=scan["scan_id"], categories=["test_cache"], confirm=True,
                ))

            self.assertFalse(candidate.exists())
            self.assertEqual(result["deleted_files"], 1)
            self.assertEqual(result["freed_bytes"], len(b"cache-data"))

    def test_storage_clean_skips_file_replaced_after_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / "replace-me.cache"
            candidate.write_bytes(b"old")
            category = system_tools.StorageCategory(
                "test_cache", "测试缓存", "测试", root, 0, True,
            )
            with patch("backend.system_tools._storage_categories", return_value=[category]):
                scan = system_tools.scan_storage()
                candidate.unlink()
                candidate.write_bytes(b"new content must survive")
                result = system_tools.clean_storage(system_tools.StorageCleanRequest(
                    scan_id=scan["scan_id"], categories=["test_cache"], confirm=True,
                ))

            self.assertTrue(candidate.exists())
            self.assertEqual(candidate.read_bytes(), b"new content must survive")
            self.assertEqual(result["deleted_files"], 0)
            self.assertEqual(result["skipped_files"], 1)

    def test_large_file_scan_only_includes_files_at_or_above_threshold(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            small = root / "small.bin"
            large = root / "large.bin"
            with small.open("wb") as stream:
                stream.truncate(system_tools.LARGE_FILE_MINIMUM_BYTES - 1)
            with large.open("wb") as stream:
                stream.truncate(system_tools.LARGE_FILE_MINIMUM_BYTES)
            category = system_tools.StorageCategory(
                "test_large", "测试大文件", "测试", root, 0, False,
                "personal", system_tools.LARGE_FILE_MINIMUM_BYTES, "trash",
            )

            public, candidates = system_tools._scan_storage_category(category)

            self.assertEqual(public["file_count"], 1)
            self.assertEqual(public["cleanup_mode"], "trash")
            self.assertEqual(Path(candidates[0]["path"]), large)

    def test_personal_large_file_clean_moves_file_to_trash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trash_root = root / "Trash"
            source_root = root / "Documents"
            trash_root.mkdir(); source_root.mkdir()
            candidate = source_root / "archive.bin"
            with candidate.open("wb") as stream:
                stream.truncate(system_tools.LARGE_FILE_MINIMUM_BYTES)
            category = system_tools.StorageCategory(
                "documents_large_files", "文档大文件", "测试", source_root, 0, False,
                "personal", system_tools.LARGE_FILE_MINIMUM_BYTES, "trash",
            )

            def move_to_test_trash(path):
                shutil.move(str(path), trash_root / path.name)

            with patch("backend.system_tools._storage_categories", return_value=[category]):
                scan = system_tools.scan_storage()
                with patch("backend.system_tools._send_to_trash", side_effect=move_to_test_trash):
                    result = system_tools.clean_storage(system_tools.StorageCleanRequest(
                        scan_id=scan["scan_id"], categories=[category.id], confirm=True,
                    ))

            self.assertFalse(candidate.exists())
            self.assertTrue((trash_root / candidate.name).exists())
            self.assertEqual(result["deleted_files"], 0)
            self.assertEqual(result["trashed_files"], 1)
            self.assertEqual(result["freed_bytes"], 0)
            self.assertEqual(result["trashed_bytes"], system_tools.LARGE_FILE_MINIMUM_BYTES)

    def test_macos_residual_discovery_requires_missing_registered_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache_root = root / "Caches"
            preferences_root = root / "Preferences"
            cache_root.mkdir()
            preferences_root.mkdir()
            (cache_root / "com.example.removed").mkdir()
            (preferences_root / "com.example.removed.plist").write_text("old")
            (cache_root / "com.example.installed").mkdir()
            locations = [
                system_tools.ResidualLocation("caches", "缓存", cache_root),
                system_tools.ResidualLocation("preferences", "偏好设置", preferences_root, suffix=".plist"),
            ]
            with patch("backend.system_tools._residual_locations", return_value=locations), \
                    patch("backend.system_tools._macos_installed_apps", return_value={"com.example.installed": "Installed"}), \
                    patch("backend.system_tools._macos_launchservices_dump", return_value=""), \
                    patch("backend.system_tools._macos_bundle_exists", return_value=False):
                groups, _count = system_tools._discover_macos_residuals()

            self.assertIn("com.example.removed", groups)
            self.assertEqual(len(groups["com.example.removed"]["locations"]), 2)
            self.assertNotIn("com.example.installed", groups)

    def test_residual_clean_moves_unchanged_high_confidence_paths_to_trash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache_root = root / "Caches"
            preferences_root = root / "Preferences"
            trash_root = root / "Trash"
            cache_root.mkdir(); preferences_root.mkdir(); trash_root.mkdir()
            cache_path = cache_root / "com.example.removed"
            preference_path = preferences_root / "com.example.removed.plist"
            cache_path.mkdir(); (cache_path / "cache.db").write_bytes(b"cache")
            preference_path.write_bytes(b"plist")
            locations = [
                {"location": system_tools.ResidualLocation("caches", "缓存", cache_root), "path": cache_path},
                {"location": system_tools.ResidualLocation("preferences", "偏好设置", preferences_root, suffix=".plist"), "path": preference_path},
            ]
            discovered = {"com.example.removed": {"id": "com.example.removed", "name": "Removed", "locations": locations, "exact_identifier": True}}
            moved = []

            def move_to_test_trash(path):
                destination = trash_root / f"{len(moved)}-{path.name}"
                moved.append(destination)
                shutil.move(str(path), destination)

            with patch("backend.system_tools._discover_residuals", return_value=(discovered, 1, "Darwin")):
                scan = system_tools.scan_app_residuals()
            with patch("backend.system_tools._send_to_trash", side_effect=move_to_test_trash):
                result = system_tools.clean_app_residuals(system_tools.ResidualCleanRequest(
                    scan_id=scan["scan_id"], apps=["com.example.removed"], confirm=True,
                ))

            self.assertTrue(scan["groups"][0]["recommended"])
            self.assertEqual(result["moved_count"], 2)
            self.assertFalse(cache_path.exists())
            self.assertFalse(preference_path.exists())
            self.assertTrue(all(path.exists() for path in moved))

    def test_residual_clean_skips_path_changed_after_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache_root = root / "Caches"
            cache_root.mkdir()
            cache_path = cache_root / "com.example.removed"
            cache_path.mkdir(); candidate = cache_path / "cache.db"; candidate.write_bytes(b"old")
            location = system_tools.ResidualLocation("caches", "缓存", cache_root)
            discovered = {"com.example.removed": {
                "id": "com.example.removed", "name": "Removed",
                "locations": [{"location": location, "path": cache_path}], "exact_identifier": True,
            }}
            with patch("backend.system_tools._discover_residuals", return_value=(discovered, 1, "Darwin")):
                scan = system_tools.scan_app_residuals()
            candidate.write_bytes(b"changed after scan")
            with patch("backend.system_tools._send_to_trash") as trash_mock:
                result = system_tools.clean_app_residuals(system_tools.ResidualCleanRequest(
                    scan_id=scan["scan_id"], apps=["com.example.removed"], confirm=True,
                ))

            trash_mock.assert_not_called()
            self.assertEqual(result["moved_count"], 0)
            self.assertEqual(len(result["skipped_paths"]), 1)
            self.assertTrue(candidate.exists())


if __name__ == "__main__":
    unittest.main()
