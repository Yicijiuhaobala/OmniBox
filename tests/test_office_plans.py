import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import office_plans


class OfficePlanTests(unittest.TestCase):
    def test_plan_is_saved_reused_and_deleted_without_file_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            plans_path = Path(directory) / "office-plans.json"
            with patch.object(office_plans, "PLANS_PATH", plans_path):
                saved = office_plans.save_office_plan(office_plans.OfficePlanInput(
                    name="月报清理",
                    action="excel_clean",
                    options={"trim_text": True, "other_file": "/private/other.xlsx"},
                ))
                plan = saved["plan"]
                self.assertTrue(plans_path.exists())
                self.assertTrue(plan["options"]["trim_text"])
                self.assertNotIn("other_file", plan["options"])
                self.assertEqual(office_plans.list_office_plans()["plans"][0]["name"], "月报清理")
                deleted = office_plans.delete_office_plan(plan["id"])
                self.assertEqual(deleted["plans"], [])


if __name__ == "__main__":
    unittest.main()
