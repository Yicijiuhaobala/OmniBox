from __future__ import annotations

import os
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend import learning
from backend.main import app


def run_payload(submission_key: str = "test-run-0001") -> dict:
    return {
        "submission_key": submission_key,
        "lab_ref": "lab.llm.tokenizer_visualizer",
        "lab_version": "1.0.0",
        "prediction": "我预测教学 BPE 合并后 Token 数会少于字符数。",
        "parameters": {
            "text": "low lower",
            "tokenizer_id": "omb-grapheme-bpe-v1",
            "normalization": "NFC",
            "show_merge_trace": True,
        },
        "result": {
            "status": "warning",
            "summary": "已生成 3 个教学 Token",
            "next_actions": ["检查 Token 数与字符数。"],
            "artifacts": [],
            "data": {"counts": {"utf8_bytes": 9, "code_points": 9, "graphemes": 9, "tokens": 3}},
            "metrics": {"tokens": 3},
            "warnings": ["教学 Tokenizer 不代表真实模型。"],
            "error": None,
            "audit": {
                "contract_version": "llm-lab-p0-1",
                "lab_ref": "lab.llm.tokenizer_visualizer",
                "lab_version": "1.0.0",
                "implementation": "test",
                "policy_version": "llm-lab-policy-1",
            },
        },
    }


class LearningApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "learning.db"
        learning.store = learning.LearningStore(self.database_path)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        self.temporary_directory.cleanup()

    def test_status_initializes_full_migration_and_permissions(self) -> None:
        response = self.client.get("/api/learning/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["schema_version"], 1)
        with sqlite3.connect(self.database_path) as connection:
            self.assertEqual(connection.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn("lab_runs", tables)
        self.assertIn("learning_evidence", tables)
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.database_path.stat().st_mode), 0o600)

    def test_loopback_development_origins_are_allowed(self) -> None:
        response = self.client.options(
            "/api/learning/status",
            headers={
                "Origin": "http://127.0.0.1:5174",
                "Access-Control-Request-Method": "GET",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:5174")

    def test_run_and_evidence_are_idempotent_and_listed(self) -> None:
        payload = run_payload()
        created = self.client.post("/api/learning/lab-runs", json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        run_id = created.json()["data"]["run"]["id"]
        self.assertFalse(created.json()["data"]["idempotent"])

        duplicate = self.client.post("/api/learning/lab-runs", json=payload)
        self.assertEqual(duplicate.status_code, 200)
        self.assertTrue(duplicate.json()["data"]["idempotent"])
        self.assertEqual(duplicate.json()["data"]["run"]["id"], run_id)

        evidence_payload = {
            "run_id": run_id,
            "conclusion": "字符数是 9，而教学 BPE Token 数是 3，因为固定合并规则把多个字符组合成了词片段。",
        }
        evidence = self.client.post("/api/learning/evidence", json=evidence_payload)
        self.assertEqual(evidence.status_code, 200, evidence.text)
        self.assertEqual(evidence.json()["data"]["evidence"]["validity"], "candidate")
        self.assertFalse(evidence.json()["data"]["idempotent"])
        duplicate_evidence = self.client.post("/api/learning/evidence", json=evidence_payload)
        self.assertEqual(duplicate_evidence.status_code, 200)
        self.assertTrue(duplicate_evidence.json()["data"]["idempotent"])

        recent = self.client.get("/api/learning/lab-runs", params={"lab_ref": payload["lab_ref"], "limit": 10})
        self.assertEqual(recent.status_code, 200)
        listed = recent.json()["data"]["runs"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], run_id)
        self.assertEqual(listed[0]["evidence"]["validity"], "candidate")
        self.assertEqual(listed[0]["evidence"]["conclusion"], evidence_payload["conclusion"])

        detail = self.client.get(f"/api/learning/lab-runs/{run_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["data"]["run"]["result"]["summary"], "已生成 3 个教学 Token")

    def test_idempotency_conflict_and_sensitive_field_rejection(self) -> None:
        payload = run_payload("same-key-0001")
        self.assertEqual(self.client.post("/api/learning/lab-runs", json=payload).status_code, 200)
        changed = run_payload("same-key-0001")
        changed["parameters"]["text"] = "changed"
        conflict = self.client.post("/api/learning/lab-runs", json=changed)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["detail"]["code"], "IDEMPOTENCY_CONFLICT")

        sensitive = run_payload("sensitive-0001")
        sensitive["parameters"]["api_key"] = "must-not-persist"
        rejected = self.client.post("/api/learning/lab-runs", json=sensitive)
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.json()["detail"]["code"], "SENSITIVE_FIELD_REJECTED")
        self.assertNotIn("must-not-persist", self.database_path.read_bytes().decode("utf-8", errors="ignore"))

    def test_different_evidence_cannot_overwrite_immutable_candidate(self) -> None:
        created = self.client.post("/api/learning/lab-runs", json=run_payload("evidence-conflict-0001"))
        run_id = created.json()["data"]["run"]["id"]
        first = {
            "run_id": run_id,
            "conclusion": "第一次结论包含 Token 数和字符数的差异，并说明这是固定教学 BPE 规则造成的。",
        }
        self.assertEqual(self.client.post("/api/learning/evidence", json=first).status_code, 200)
        second = {**first, "conclusion": "第二次结论试图覆盖第一次已经保存的不可变学习证据，因此必须被拒绝。"}
        conflict = self.client.post("/api/learning/evidence", json=second)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["detail"]["code"], "EVIDENCE_ALREADY_EXISTS")


if __name__ == "__main__":
    unittest.main()
