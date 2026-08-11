from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import fund_learning, learning
from backend.main import app


def fake_ai_content(lesson_ref: str | None = None) -> dict:
    lesson = fund_learning.load_course()["modules"][0]["lessons"][0]
    lesson_ref = lesson_ref or lesson["id"]
    return {
        "content_id": f"fund_content_{uuid.uuid4().hex}",
        "lesson_ref": lesson_ref,
        "mode": "ai",
        "generated_at": learning.utc_now(),
        "ephemeral": True,
        "cache_ttl_minutes": 30,
        "knowledge_points": [
            {
                "id": "ai_point_1",
                "title": "教育边界",
                "explanation": "AI 临时讲解，不应写入本地数据库。",
                "why_it_matters": "这能帮助初学者判断一只基金是否适合自己的实际需求。",
                "action": "购买前先打开产品资料概要，核对投资范围和风险提示。",
                "source_id": "amac-education-guideline",
                "source_excerpt": "权威原文临时摘录，不应写入本地数据库。",
                "source_point_ids": ["source_point_1"],
                "kind": "ai_explanation",
            }
        ],
        "example": None,
        "misconceptions": [],
        "quiz": [
            {
                "id": "ai_quiz_1_12345678",
                "question": "哪一种说法符合基金知识教育的边界？",
                "options": {"a": "保证收益", "b": "说明风险与依据", "c": "推荐单一产品", "d": "承诺本金安全"},
                "answer": "b",
                "explanation": "临时解析一：知识教育不能承诺收益。",
                "concept_ref": lesson["concepts"][0],
            },
            {
                "id": "ai_quiz_2_12345678",
                "question": "信息不完整时，更合理的操作是什么？",
                "options": {"a": "直接买入", "b": "忽略风险", "c": "补充核实信息", "d": "相信口号"},
                "answer": "c",
                "explanation": "临时解析二：先补足关键信息再判断。",
                "concept_ref": lesson["concepts"][1],
            },
        ],
        "sources": [{"id": "amac-education-guideline", "title": "权威来源", "publisher": "基金业协会", "url": "https://investor.amac.org.cn/example", "fetched_at": learning.utc_now()}],
        "warnings": [],
    }


def attempt_payload(content: dict, submission_key: str = "fund-attempt-0001") -> dict:
    return {
        "submission_key": submission_key,
        "lesson_ref": content["lesson_ref"],
        "content_id": content["content_id"],
        "answers": {question["id"]: question["answer"] for question in content["quiz"]},
        "duration_ms": 12_000,
    }


class FundLearningApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "learning-user.db"
        self.previous_store = learning.store
        self.previous_service = fund_learning.service
        learning.store = learning.LearningStore(self.database_path)
        fund_learning.service = fund_learning.FundLearningService(learning.store)
        fund_learning.CONTENT_CACHE.clear()
        fund_learning.CONTENT_BY_ID.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        fund_learning.CONTENT_CACHE.clear()
        fund_learning.CONTENT_BY_ID.clear()
        learning.store = self.previous_store
        fund_learning.service = self.previous_service
        self.temporary_directory.cleanup()

    def test_local_course_contains_only_skeleton_and_authoritative_sources(self) -> None:
        course = fund_learning.load_course()
        lessons = [lesson for module in course["modules"] for lesson in module["lessons"]]
        self.assertEqual(course["version"], "1.0.0")
        self.assertEqual(len(course["modules"]), 5)
        self.assertEqual(len(lessons), 25)
        for lesson in lessons:
            self.assertTrue(lesson["objectives"])
            self.assertTrue(lesson["keywords"])
            self.assertTrue(lesson["source_ids"])
            self.assertTrue(lesson["learner_value"])
            self.assertTrue(lesson["check_action"])
            self.assertNotIn("sections", lesson)
            self.assertNotIn("quiz", lesson)
            self.assertNotIn("example", lesson)
        self.assertTrue(all(fund_learning.allowed_source_url(source["url"]) for source in course["sources"]))
        self.assertTrue(all(source.get("usage") for source in course["discovery_sources"]))

    def test_official_content_is_fetched_and_kept_only_in_memory(self) -> None:
        lesson = fund_learning.load_course()["modules"][0]["lessons"][0]

        async def fake_fetch(source: dict) -> dict:
            return {
                **source,
                "resolved_url": source["url"],
                "fetched_at": learning.utc_now(),
                "lines": [
                    "证券投资基金具有集合投资的特点，把分散资金交给专业机构进行投资管理。",
                    "基金是长期理财工具而不是储蓄，购买基金存在发生本金损失的风险。",
                    "基金不同于银行储蓄，买入基金后既可能获得收益，也可能承担投资损失。",
                ],
            }

        with patch.object(fund_learning, "fetch_source", side_effect=fake_fetch):
            response = self.client.post(
                f"/api/learning/fund/lessons/{lesson['id']}/content",
                json={"mode": "official", "refresh": True},
            )
        self.assertEqual(response.status_code, 200, response.text)
        content = response.json()["data"]["content"]
        self.assertEqual(content["mode"], "official")
        self.assertTrue(content["ephemeral"])
        self.assertGreaterEqual(len(content["knowledge_points"]), 3)
        self.assertEqual(content["quiz"], [])
        self.assertIn(content["content_id"], fund_learning.CONTENT_BY_ID)
        self.assertFalse(self.database_path.exists(), "读取在线正文不应创建或写入学习数据库")

    def test_ai_validation_requires_citations_and_hides_answers(self) -> None:
        lesson = fund_learning.load_course()["modules"][0]["lessons"][0]
        official = {
            "knowledge_points": [
                {"id": "source_point_1", "source_id": "amac-education-guideline", "source_excerpt": "这是足够长的权威原文摘录，用于支撑模型生成的课程讲解内容。"}
            ]
        }
        payload = {
            "knowledge_points": [
                {"title": f"知识点 {index}", "explanation": "这是一段只依据权威原文生成、长度足够的白话解释内容。", "why_it_matters": "它能帮助初学者把概念用于实际的基金选择判断。", "action": "现在打开产品资料概要，找到对应项目并核对具体说明。", "source_point_ids": ["source_point_1"]}
                for index in range(1, 4)
            ],
            "example": {"title": "边界示例", "good": "先核实信息与风险。", "bad": "直接相信收益承诺。"},
            "misconceptions": ["历史表现能够保证未来收益。"],
            "quiz": [
                {"question": "以下哪一种处理方式更加合理？", "options": {"a": "保证收益", "b": "核实风险", "c": "忽略依据", "d": "追逐热点"}, "answer": "b", "explanation": "应该基于来源核实事实和风险边界。", "concept_ref": lesson["concepts"][0]},
                {"question": "面对不完整信息应当怎样处理？", "options": {"a": "直接决定", "b": "相信口号", "c": "补充信息", "d": "忽略风险"}, "answer": "c", "explanation": "信息不完整时应先补充并核实关键信息。", "concept_ref": lesson["concepts"][1]},
            ],
        }
        generated = fund_learning.validate_ai_content(payload, lesson, official)
        content = fund_learning.store_ephemeral_content({
            "content_id": f"fund_content_{uuid.uuid4().hex}", "lesson_ref": lesson["id"], "mode": "ai",
            "generated_at": learning.utc_now(), "ephemeral": True, "cache_ttl_minutes": 30,
            **generated, "sources": [], "warnings": [],
        })
        public = fund_learning.public_content(content)
        self.assertNotIn("expires_monotonic", public)
        self.assertNotIn("answer", public["quiz"][0])
        self.assertNotIn("explanation", public["quiz"][0])
        self.assertEqual(public["knowledge_points"][0]["source_excerpt"], official["knowledge_points"][0]["source_excerpt"])

    def test_correct_ai_attempt_persists_progress_but_not_generated_content(self) -> None:
        content = fund_learning.store_ephemeral_content(fake_ai_content())
        initial = self.client.get("/api/learning/fund/progress")
        self.assertEqual(initial.status_code, 200, initial.text)
        self.assertEqual(initial.json()["data"]["completed_lessons"], 0)

        response = self.client.post("/api/learning/fund/attempts", json=attempt_payload(content))
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertFalse(data["idempotent"])
        self.assertEqual(data["attempt"]["score"], 1.0)
        self.assertEqual(data["progress"]["completed_lessons"], 1)

        database_bytes = self.database_path.read_bytes()
        for forbidden in (
            "AI 临时讲解，不应写入本地数据库。",
            "权威原文临时摘录，不应写入本地数据库。",
            "临时解析一：知识教育不能承诺收益。",
            "哪一种说法符合基金知识教育的边界？",
        ):
            self.assertNotIn(forbidden.encode("utf-8"), database_bytes)
        with sqlite3.connect(self.database_path) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM learning_evidence WHERE source_type = 'attempt'").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM concept_mastery WHERE concept_ref LIKE 'concept.fund.%'").fetchone()[0], 2)
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_attempt_idempotency_conflict_and_expired_content(self) -> None:
        content = fund_learning.store_ephemeral_content(fake_ai_content())
        payload = attempt_payload(content, "fund-same-key-0001")
        first = self.client.post("/api/learning/fund/attempts", json=payload)
        self.assertEqual(first.status_code, 200, first.text)
        attempt_id = first.json()["data"]["attempt"]["id"]

        duplicate = self.client.post("/api/learning/fund/attempts", json=payload)
        self.assertEqual(duplicate.status_code, 200, duplicate.text)
        self.assertTrue(duplicate.json()["data"]["idempotent"])
        self.assertEqual(duplicate.json()["data"]["attempt"]["id"], attempt_id)

        changed = {**payload, "answers": {**payload["answers"]}}
        first_question = next(iter(changed["answers"]))
        changed["answers"][first_question] = "a"
        conflict = self.client.post("/api/learning/fund/attempts", json=changed)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["detail"]["code"], "IDEMPOTENCY_CONFLICT")

        expired = fund_learning.store_ephemeral_content(fake_ai_content())
        expired["expires_monotonic"] = time.monotonic() - 1
        rejected = self.client.post("/api/learning/fund/attempts", json=attempt_payload(expired, "fund-expired-0001"))
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.json()["detail"]["code"], "FUND_CONTENT_EXPIRED")


if __name__ == "__main__":
    unittest.main()
