import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import presentation_templates


class PresentationTemplateTests(unittest.TestCase):
    def _payload(self):
        return {
            "id": "weekly",
            "name": "项目周报",
            "version": "1.0.0",
            "style": "executive",
            "deck": {"title": "项目周报", "slides": [{"title": "进展", "body": ["完成开发"]}]},
        }

    def test_download_is_validated_hashed_and_cached_on_demand(self):
        payload = self._payload()
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        item = {
            "id": "weekly", "name": "项目周报", "detail": "周报", "style": "executive",
            "version": "1.0.0", "download_url": "weekly.json", "size": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(presentation_templates, "CACHE_DIR", Path(directory)), \
                 patch.object(presentation_templates, "CATALOG_URL", "http://127.0.0.1:9876/catalog.json"), \
                 patch.object(presentation_templates, "_catalog", return_value=([item], "online", "")), \
                 patch.object(presentation_templates, "_fetch_json", return_value=(payload, raw)):
                result = presentation_templates.download_template("weekly")
                self.assertEqual(result["template"]["deck"]["slides"][0]["body"], ["完成开发"])
                self.assertTrue((Path(directory) / "weekly.json").exists())
                cached = presentation_templates.cached_template("weekly")
                self.assertEqual(cached["template"]["version"], "1.0.0")
                presentation_templates.delete_cached_template("weekly")
                self.assertFalse((Path(directory) / "weekly.json").exists())

    def test_remote_template_cannot_change_id_or_add_images(self):
        payload = self._payload()
        payload["id"] = "project"
        with self.assertRaises(ValueError):
            presentation_templates._validate_template(payload, "weekly")
        payload["id"] = "weekly"
        payload["deck"]["slides"][0]["images"] = [{"data_url": "https://example.com/tracker.png"}]
        cleaned = presentation_templates._validate_template(payload, "weekly")
        self.assertEqual(cleaned["deck"]["slides"][0]["images"], [])

    def test_download_must_stay_on_catalog_origin(self):
        self.assertTrue(presentation_templates._is_allowed_url("https://raw.githubusercontent.com/a/template.json", "https://raw.githubusercontent.com/a/catalog.json"))
        self.assertFalse(presentation_templates._is_allowed_url("https://example.com/template.json", "https://raw.githubusercontent.com/a/catalog.json"))
        self.assertFalse(presentation_templates._is_allowed_url("http://example.com/template.json", "http://example.com/catalog.json"))


if __name__ == "__main__":
    unittest.main()
