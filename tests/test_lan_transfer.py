import json
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest.mock import patch

from backend import lan_transfer


class LanTransferTests(unittest.TestCase):
    def setUp(self):
        lan_transfer.manager.stop()

    def tearDown(self):
        lan_transfer.manager.stop()

    def test_client_filter_only_accepts_local_addresses(self):
        self.assertTrue(lan_transfer._is_private_client("127.0.0.1"))
        self.assertTrue(lan_transfer._is_private_client("192.168.1.23"))
        self.assertTrue(lan_transfer._is_private_client("10.0.0.8"))
        self.assertTrue(lan_transfer._is_private_client("100.125.168.63"))
        self.assertTrue(lan_transfer._is_private_client("169.254.10.2"))
        self.assertFalse(lan_transfer._is_private_client("198.18.0.1"))
        self.assertFalse(lan_transfer._is_private_client("8.8.8.8"))
        self.assertFalse(lan_transfer._is_private_client("not-an-ip"))

    def test_end_to_end_upload_and_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receive_directory = root / "receive"
            receive_directory.mkdir()
            shared_file = root / "shared.txt"
            shared_file.write_bytes(b"download-from-computer")

            with patch("backend.lan_transfer._lan_ipv4_addresses", return_value=["127.0.0.1"]):
                status = lan_transfer.manager.start(lan_transfer.StartTransferRequest(
                    shared_files=[str(shared_file)],
                    receive_directory=str(receive_directory),
                    expires_in_minutes=1,
                ))

            self.assertTrue(status["active"])
            self.assertTrue(status["qr_data_url"].startswith("data:image/png;base64,"))
            with urllib.request.urlopen(status["url"], timeout=5) as response:
                page = response.read().decode("utf-8")
            self.assertIn("OmniBox 局域网快传", page)
            self.assertIn("不经过互联网", page)

            upload_name = "phone photo.bin"
            upload_body = b"original-phone-file"
            upload_request = urllib.request.Request(
                f"{status['url']}/upload?{urllib.parse.urlencode({'name': upload_name})}",
                data=upload_body,
                method="POST",
            )
            with urllib.request.urlopen(upload_request, timeout=5) as response:
                upload_result = json.load(response)
            self.assertEqual(upload_result["size"], len(upload_body))
            self.assertEqual((receive_directory / upload_name).read_bytes(), upload_body)

            second_upload_body = b"another-original-file"
            second_upload_request = urllib.request.Request(
                f"{status['url']}/upload?{urllib.parse.urlencode({'name': upload_name})}",
                data=second_upload_body,
                method="POST",
            )
            with urllib.request.urlopen(second_upload_request, timeout=5) as response:
                second_upload_result = json.load(response)
            self.assertEqual(second_upload_result["name"], "phone photo (1).bin")
            self.assertEqual((receive_directory / upload_name).read_bytes(), upload_body)
            self.assertEqual((receive_directory / "phone photo (1).bin").read_bytes(), second_upload_body)

            file_id = status["shared_files"][0]["id"]
            with urllib.request.urlopen(f"{status['url']}/download/{file_id}", timeout=5) as response:
                downloaded = response.read()
            self.assertEqual(downloaded, shared_file.read_bytes())

            final_status = lan_transfer.manager.status()
            self.assertEqual(len(final_status["uploaded_files"]), 2)
            self.assertEqual(final_status["bytes_uploaded"], len(upload_body) + len(second_upload_body))
            self.assertEqual(final_status["download_count"], 1)
            self.assertEqual(final_status["bytes_downloaded"], shared_file.stat().st_size)

            lan_transfer.manager.stop()
            with self.assertRaises(urllib.error.URLError):
                urllib.request.urlopen(status["url"], timeout=1)

    def test_changed_shared_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "shared.txt"
            source.write_text("before")
            item_stat = source.stat()
            item = lan_transfer.SharedFile(
                "file", source, source.name, item_stat.st_size,
                item_stat.st_dev, item_stat.st_ino, item_stat.st_mtime_ns,
            )
            source.write_text("changed after sharing")
            self.assertFalse(lan_transfer._shared_file_unchanged(item))


if __name__ == "__main__":
    unittest.main()
