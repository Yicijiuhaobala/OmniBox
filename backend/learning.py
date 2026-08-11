from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

try:
    from .config_store import CONFIG_DIR
except ImportError:
    from config_store import CONFIG_DIR


APP_VERSION = "0.1.0"
PROFILE_ID = "local-default"
MIGRATION_NAME = "0001_learning_user_initial.sql"
MIGRATION_PLACEHOLDER = "DRAFT_REPLACE_WITH_SHA256"
LAB_REFS = (
    "lab.llm.tokenizer_visualizer",
    "lab.llm.attention_toy",
    "lab.llm.prompt_compare",
    "lab.llm.rag_debugger",
    "lab.llm.tool_calling",
    "lab.llm.eval_runner",
)
SENSITIVE_FIELD_NAMES = {
    "api_key", "app_key", "app_secret", "authorization", "password",
    "access_token", "refresh_token", "client_secret",
}
LAB_CONCEPTS = {
    "lab.llm.tokenizer_visualizer": ("llm.tokenization", "llm.bpe"),
    "lab.llm.attention_toy": ("llm.attention", "llm.softmax", "llm.masking"),
    "lab.llm.prompt_compare": ("llm.prompt_evaluation",),
    "lab.llm.rag_debugger": ("llm.rag", "llm.retrieval", "llm.bm25"),
    "lab.llm.tool_calling": ("llm.tool_calling", "llm.schema_validation"),
    "lab.llm.eval_runner": ("llm.evaluation", "llm.metrics"),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise LearningStoreError("INVALID_JSON", "数据包含不能持久化的 JSON 值") from exc


def migration_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "migrations" / MIGRATION_NAME
    return Path(__file__).resolve().parent.parent / "docs" / "database" / MIGRATION_NAME


def secret_paths(value: Any, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if str(key).lower() in SENSITIVE_FIELD_NAMES:
                found.append(child_path)
            found.extend(secret_paths(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(secret_paths(child, f"{path}[{index}]"))
    return found


class LearningStoreError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        retryable: bool = True,
        root_cause_hint: str | None = None,
        retry_instruction: str = "修正输入后重新尝试。",
        stop_condition: str = "相同错误连续出现两次时停止重试并检查本地学习库状态。",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.root_cause_hint = root_cause_hint or message
        self.retry_instruction = retry_instruction
        self.stop_condition = stop_condition

    def detail(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "root_cause_hint": self.root_cause_hint,
            "retry_instruction": self.retry_instruction,
            "stop_condition": self.stop_condition,
        }


class LabRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_key: str = Field(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")
    lab_ref: Literal[
        "lab.llm.tokenizer_visualizer",
        "lab.llm.attention_toy",
        "lab.llm.prompt_compare",
        "lab.llm.rag_debugger",
        "lab.llm.tool_calling",
        "lab.llm.eval_runner",
    ]
    lab_version: Literal["1.0.0"] = "1.0.0"
    prediction: str = Field(min_length=1, max_length=4_000)
    parameters: dict[str, Any]
    result: dict[str, Any]


class EvidenceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=8, max_length=100, pattern=r"^run_[a-f0-9]{32}$")
    conclusion: str = Field(min_length=20, max_length=10_000)


def response_envelope(summary: str, data: dict[str, Any], *, next_actions: list[str] | None = None) -> dict[str, Any]:
    return {
        "status": "success",
        "summary": summary,
        "next_actions": next_actions or [],
        "artifacts": [],
        "data": data,
    }


class LearningStore:
    def __init__(self, database_path: Path | None = None) -> None:
        self.database_path = database_path or CONFIG_DIR / "learning-user.db"
        self._initialization_lock = threading.Lock()
        self._initialized = False

    def _open(self) -> sqlite3.Connection:
        self._ensure_database()
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _ensure_database(self) -> None:
        if self._initialized:
            return
        with self._initialization_lock:
            if self._initialized:
                return
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
            if os.name != "nt":
                self.database_path.parent.chmod(0o700)

            source_path = migration_path()
            try:
                migration_template = source_path.read_text(encoding="utf-8")
            except OSError as exc:
                raise LearningStoreError(
                    "MIGRATION_NOT_FOUND",
                    "找不到学习库初始化迁移",
                    status_code=503,
                    retryable=False,
                    root_cause_hint=str(source_path),
                    retry_instruction="重新构建或安装包含 migrations 资源的 OmniBox。",
                    stop_condition="迁移文件缺失时不要继续写入学习数据。",
                ) from exc
            checksum = hashlib.sha256(migration_template.encode("utf-8")).hexdigest()
            migration_sql = migration_template.replace(MIGRATION_PLACEHOLDER, checksum)

            connection = sqlite3.connect(self.database_path, timeout=10)
            try:
                connection.row_factory = sqlite3.Row
                connection.execute("PRAGMA foreign_keys = ON")
                has_history = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
                ).fetchone()
                if not has_history:
                    existing_tables = connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    ).fetchall()
                    if existing_tables:
                        raise LearningStoreError(
                            "UNKNOWN_DATABASE_SCHEMA",
                            "学习库存在未知表结构，已停止自动迁移",
                            status_code=503,
                            retryable=False,
                            retry_instruction="备份 learning.db 后移走该文件，再重新启动 OmniBox。",
                            stop_condition="未备份旧数据库前不要删除或覆盖它。",
                        )
                    connection.executescript(migration_sql)

                user_version = connection.execute("PRAGMA user_version").fetchone()[0]
                migration = connection.execute(
                    "SELECT checksum FROM schema_migrations WHERE version = 1 AND name = 'learning_user_initial'"
                ).fetchone()
                if user_version != 1 or migration is None or migration["checksum"] != checksum:
                    raise LearningStoreError(
                        "MIGRATION_HISTORY_MISMATCH",
                        "学习库版本或迁移校验和不匹配，已停止写入",
                        status_code=503,
                        retryable=False,
                        retry_instruction="保留 learning.db 并使用匹配版本的 OmniBox 打开，或先导出后重建学习库。",
                        stop_condition="版本不匹配时不要手动修改 user_version 或迁移记录。",
                    )
                quick_check = connection.execute("PRAGMA quick_check").fetchone()[0]
                foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
                if quick_check != "ok" or foreign_key_errors:
                    raise LearningStoreError(
                        "DATABASE_INTEGRITY_FAILED",
                        "学习库完整性检查失败，已停止写入",
                        status_code=503,
                        retryable=False,
                        retry_instruction="备份 learning.db，并从最近的有效备份恢复。",
                        stop_condition="完整性检查恢复为 ok 前不要继续保存学习记录。",
                    )
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute("PRAGMA synchronous = NORMAL")
                connection.commit()
            finally:
                connection.close()

            if os.name != "nt":
                self.database_path.chmod(0o600)
            self._initialized = True

    @staticmethod
    def _ensure_profile(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            INSERT INTO learner_profiles(id, display_name, timezone, daily_minutes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (PROFILE_ID, "本机学习者", datetime.now().astimezone().tzname() or "UTC", 30),
        )

    @staticmethod
    def _validate_payload(payload: LabRunCreate) -> tuple[str, str, str, str]:
        result_status = payload.result.get("status")
        audit = payload.result.get("audit")
        if result_status not in {"success", "warning", "error"}:
            raise LearningStoreError("INVALID_RESULT", "运行结果缺少有效 status")
        if not isinstance(audit, dict) or audit.get("lab_ref") != payload.lab_ref:
            raise LearningStoreError("LAB_REF_MISMATCH", "运行结果中的 lab_ref 与保存请求不一致")
        if audit.get("contract_version") != "llm-lab-p0-1":
            raise LearningStoreError("CONTRACT_VERSION_MISMATCH", "仅支持 llm-lab-p0-1 运行结果")

        sensitive = secret_paths({"parameters": payload.parameters, "result": payload.result})
        if sensitive:
            raise LearningStoreError(
                "SENSITIVE_FIELD_REJECTED",
                f"学习库拒绝保存敏感字段：{sensitive[0]}",
                retryable=True,
                retry_instruction="移除 API Key、密码或 Token 字段后创建新的保存请求。",
                stop_condition="无法确认字段是否敏感时不要保存该运行。",
            )

        parameters_json = canonical_json(payload.parameters)
        prediction_json = canonical_json({"answer": payload.prediction})
        result_json = canonical_json(payload.result)
        if len(parameters_json.encode("utf-8")) > 256 * 1024:
            raise LearningStoreError("PARAMETERS_TOO_LARGE", "实验参数快照不能超过 256 KB")
        if len(result_json.encode("utf-8")) > 1024 * 1024:
            raise LearningStoreError("RESULT_TOO_LARGE", "实验结果快照不能超过 1 MB")
        payload_sha256 = hashlib.sha256(canonical_json(payload.model_dump()).encode("utf-8")).hexdigest()
        return parameters_json, prediction_json, result_json, payload_sha256

    def create_run(self, payload: LabRunCreate) -> tuple[dict[str, Any], bool]:
        parameters_json, prediction_json, result_json, payload_sha256 = self._validate_payload(payload)
        now = utc_now()
        run_id = f"run_{uuid.uuid4().hex}"
        database_status = "failed" if payload.result["status"] == "error" else "succeeded"
        metrics_json = canonical_json(payload.result.get("metrics") or {})
        environment_json = canonical_json(payload.result.get("audit") or {})
        output_refs_json = canonical_json(payload.result.get("artifacts") or [])

        with self._open() as connection:
            self._ensure_profile(connection)
            existing = connection.execute(
                "SELECT id, payload_sha256, status, created_at FROM lab_runs WHERE profile_id = ? AND submission_key = ?",
                (PROFILE_ID, payload.submission_key),
            ).fetchone()
            if existing:
                if existing["payload_sha256"] != payload_sha256:
                    raise LearningStoreError(
                        "IDEMPOTENCY_CONFLICT",
                        "相同 submission_key 已用于不同运行内容",
                        status_code=409,
                        retryable=True,
                        retry_instruction="为新的实验运行生成新的 submission_key。",
                    )
                return dict(existing), True

            connection.execute(
                """
                INSERT INTO lab_runs(
                    id, profile_id, submission_key, payload_sha256, session_id, project_id,
                    lab_ref, lab_version, status, retry_of_run_id, parameters_json,
                    prediction_json, result_json, secret_fields_json, input_refs_json,
                    output_refs_json, metrics_json, environment_json, log_path, conclusion,
                    queued_at, started_at, finished_at, created_at
                ) VALUES (
                    :id, :profile_id, :submission_key, :payload_sha256, NULL, NULL,
                    :lab_ref, :lab_version, :status, NULL, :parameters_json,
                    :prediction_json, :result_json, '[]', '[]',
                    :output_refs_json, :metrics_json, :environment_json, NULL, NULL,
                    :now, :now, :now, :now
                )
                """,
                {
                    "id": run_id,
                    "profile_id": PROFILE_ID,
                    "submission_key": payload.submission_key,
                    "payload_sha256": payload_sha256,
                    "lab_ref": payload.lab_ref,
                    "lab_version": payload.lab_version,
                    "status": database_status,
                    "parameters_json": parameters_json,
                    "prediction_json": prediction_json,
                    "result_json": result_json,
                    "output_refs_json": output_refs_json,
                    "metrics_json": metrics_json,
                    "environment_json": environment_json,
                    "now": now,
                },
            )
            return {"id": run_id, "status": database_status, "created_at": now}, False

    def list_runs(self, lab_ref: str, limit: int) -> list[dict[str, Any]]:
        with self._open() as connection:
            rows = connection.execute(
                """
                SELECT lr.id, lr.lab_ref, lr.lab_version, lr.status, lr.prediction_json,
                       lr.result_json, lr.created_at,
                       le.id AS evidence_id, le.quality AS evidence_quality,
                       le.validity AS evidence_validity, le.evidence_json
                FROM lab_runs lr
                LEFT JOIN learning_evidence le
                  ON le.source_type = 'lab_run' AND le.source_id = lr.id
                 AND le.evaluator = 'human' AND le.evaluation_version = 'learner-conclusion-v1'
                WHERE lr.profile_id = ? AND lr.lab_ref = ?
                ORDER BY lr.created_at DESC, lr.id DESC
                LIMIT ?
                """,
                (PROFILE_ID, lab_ref, limit),
            ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            run_result = json.loads(row["result_json"])
            evidence_json = json.loads(row["evidence_json"]) if row["evidence_json"] else None
            result.append({
                "id": row["id"],
                "lab_ref": row["lab_ref"],
                "lab_version": row["lab_version"],
                "status": row["status"],
                "summary": run_result.get("summary", ""),
                "prediction": json.loads(row["prediction_json"]).get("answer", ""),
                "created_at": row["created_at"],
                "evidence": None if row["evidence_id"] is None else {
                    "id": row["evidence_id"],
                    "quality": row["evidence_quality"],
                    "validity": row["evidence_validity"],
                    "conclusion": evidence_json.get("conclusion", ""),
                },
            })
        return result

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._open() as connection:
            row = connection.execute(
                "SELECT * FROM lab_runs WHERE id = ? AND profile_id = ?",
                (run_id, PROFILE_ID),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "lab_ref": row["lab_ref"],
            "lab_version": row["lab_version"],
            "status": row["status"],
            "parameters": json.loads(row["parameters_json"]),
            "prediction": json.loads(row["prediction_json"]).get("answer", ""),
            "result": json.loads(row["result_json"]),
            "created_at": row["created_at"],
        }

    def create_evidence(self, payload: EvidenceCreate) -> tuple[dict[str, Any], bool]:
        with self._open() as connection:
            run = connection.execute(
                "SELECT id, lab_ref, prediction_json, result_json, finished_at FROM lab_runs WHERE id = ? AND profile_id = ?",
                (payload.run_id, PROFILE_ID),
            ).fetchone()
            if run is None:
                raise LearningStoreError("RUN_NOT_FOUND", "找不到要关联的实验运行", status_code=404, retryable=False)
            existing = connection.execute(
                """
                SELECT id, evidence_json, quality, validity, occurred_at
                FROM learning_evidence
                WHERE source_type = 'lab_run' AND source_id = ?
                  AND evaluator = 'human' AND evaluation_version = 'learner-conclusion-v1'
                """,
                (payload.run_id,),
            ).fetchone()
            if existing:
                existing_payload = json.loads(existing["evidence_json"])
                if existing_payload.get("conclusion") != payload.conclusion:
                    raise LearningStoreError(
                        "EVIDENCE_ALREADY_EXISTS",
                        "该运行已经保存过不同的学习证据",
                        status_code=409,
                        retryable=False,
                        retry_instruction="保留原证据；如需订正，请在后续版本使用证据替代流程。",
                        stop_condition="不要覆盖或删除原始学习证据。",
                    )
                return dict(existing), True

            result = json.loads(run["result_json"])
            prediction = json.loads(run["prediction_json"]).get("answer", "")
            evidence_json = canonical_json({
                "lab_ref": run["lab_ref"],
                "prediction": prediction,
                "conclusion": payload.conclusion,
                "run_summary": result.get("summary", ""),
                "completion_rule": "prediction-run-conclusion-v1",
            })
            evidence_id = f"evidence_{uuid.uuid4().hex}"
            now = utc_now()
            connection.execute(
                """
                INSERT INTO learning_evidence(
                    id, profile_id, source_type, source_id, evaluator, quality,
                    validity, weight, evidence_json, content_version,
                    evaluation_version, occurred_at
                ) VALUES (?, ?, 'lab_run', ?, 'human', 'unscored', 'candidate', 0.5, ?, ?, ?, ?)
                """,
                (evidence_id, PROFILE_ID, payload.run_id, evidence_json, "1.0.0", "learner-conclusion-v1", now),
            )
            for index, concept_ref in enumerate(LAB_CONCEPTS.get(run["lab_ref"], ())):
                connection.execute(
                    "INSERT INTO evidence_concepts(evidence_id, concept_ref, role) VALUES (?, ?, ?)",
                    (evidence_id, concept_ref, "primary" if index == 0 else "supporting"),
                )
            return {
                "id": evidence_id,
                "source_id": payload.run_id,
                "quality": "unscored",
                "validity": "candidate",
                "occurred_at": now,
            }, False

    def status(self) -> dict[str, Any]:
        self._ensure_database()
        with self._open() as connection:
            user_version = connection.execute("PRAGMA user_version").fetchone()[0]
            run_count = connection.execute("SELECT COUNT(*) FROM lab_runs WHERE profile_id = ?", (PROFILE_ID,)).fetchone()[0]
            evidence_count = connection.execute("SELECT COUNT(*) FROM learning_evidence WHERE profile_id = ?", (PROFILE_ID,)).fetchone()[0]
        return {"schema_version": user_version, "run_count": run_count, "evidence_count": evidence_count, "database_file": self.database_path.name}


store = LearningStore()
router = APIRouter(prefix="/api/learning", tags=["learning"])


def http_error(error: LearningStoreError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail())


@router.get("/status")
def learning_status() -> dict[str, Any]:
    try:
        return response_envelope("学习库可用", store.status())
    except LearningStoreError as exc:
        raise http_error(exc) from exc


@router.post("/lab-runs")
def create_lab_run(payload: LabRunCreate) -> dict[str, Any]:
    try:
        run, idempotent = store.create_run(payload)
        return response_envelope(
            "运行记录已存在" if idempotent else "运行记录已保存到本机",
            {"run": run, "idempotent": idempotent},
            next_actions=["填写结论并保存学习证据。"],
        )
    except LearningStoreError as exc:
        raise http_error(exc) from exc


@router.get("/lab-runs")
def list_lab_runs(
    lab_ref: Literal[
        "lab.llm.tokenizer_visualizer",
        "lab.llm.attention_toy",
        "lab.llm.prompt_compare",
        "lab.llm.rag_debugger",
        "lab.llm.tool_calling",
        "lab.llm.eval_runner",
    ],
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    try:
        runs = store.list_runs(lab_ref, limit)
        return response_envelope(f"已读取 {len(runs)} 条最近运行", {"runs": runs})
    except LearningStoreError as exc:
        raise http_error(exc) from exc


@router.get("/lab-runs/{run_id}")
def get_lab_run(run_id: str) -> dict[str, Any]:
    if not run_id.startswith("run_") or len(run_id) != 36:
        raise HTTPException(status_code=400, detail="运行 ID 格式不正确")
    try:
        run = store.get_run(run_id)
        if run is None:
            raise LearningStoreError("RUN_NOT_FOUND", "找不到实验运行", status_code=404, retryable=False)
        return response_envelope("运行记录读取成功", {"run": run})
    except LearningStoreError as exc:
        raise http_error(exc) from exc


@router.post("/evidence")
def create_learning_evidence(payload: EvidenceCreate) -> dict[str, Any]:
    try:
        evidence, idempotent = store.create_evidence(payload)
        return response_envelope(
            "学习证据已存在" if idempotent else "学习证据已保存为候选证据",
            {"evidence": evidence, "idempotent": idempotent},
            next_actions=["在后续复习或评测中验证这条候选证据。"],
        )
    except LearningStoreError as exc:
        raise http_error(exc) from exc
