from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from .config_store import CONFIG_DIR
except ImportError:
    from config_store import CONFIG_DIR


router = APIRouter(prefix="/api/office/plans", tags=["office-plans"])
PLANS_PATH = CONFIG_DIR / "office-plans.json"
ALLOWED_ACTIONS = {
    "excel_clean", "excel_split", "excel_merge_sheets", "excel_compare",
    "word_clean", "word_replace", "word_extract", "ai_process",
}
MAX_PLANS = 30


class OfficePlanInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    action: str = Field(max_length=40)
    instruction: str = Field(default="", max_length=4_000)
    options: dict[str, Any] = Field(default_factory=dict)


def _read_plans() -> list[dict[str, Any]]:
    try:
        data = json.loads(PLANS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def _write_plans(plans: list[dict[str, Any]]) -> None:
    PLANS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if PLANS_PATH.parent.exists() and hasattr(PLANS_PATH.parent, "chmod"):
        try:
            PLANS_PATH.parent.chmod(0o700)
        except OSError:
            pass
    temporary = PLANS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(plans, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        temporary.chmod(0o600)
    except OSError:
        pass
    temporary.replace(PLANS_PATH)


def _clean_options(options: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for raw_key, value in list(options.items())[:40]:
        key = str(raw_key)
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", key) or key in {"other_file", "file", "output_dir"}:
            continue
        if isinstance(value, bool):
            output[key] = value
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            output[key] = value
        elif isinstance(value, str):
            output[key] = value[:1_000]
    return output


@router.get("")
def list_office_plans() -> dict[str, Any]:
    return {"plans": _read_plans()}


@router.post("")
def save_office_plan(payload: OfficePlanInput) -> dict[str, Any]:
    if payload.action not in ALLOWED_ACTIONS:
        raise HTTPException(400, "该操作暂不支持保存为方案")
    plans = _read_plans()
    name = re.sub(r"\s+", " ", payload.name).strip()
    existing = next((item for item in plans if item.get("name") == name), None)
    plan = {
        "id": existing.get("id") if existing else uuid.uuid4().hex,
        "name": name,
        "action": payload.action,
        "instruction": payload.instruction.strip(),
        "options": _clean_options(payload.options),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    plans = [item for item in plans if item.get("id") != plan["id"]]
    plans.insert(0, plan)
    _write_plans(plans[:MAX_PLANS])
    return {"result": "方案已保存", "plan": plan, "plans": plans[:MAX_PLANS]}


@router.delete("/{plan_id}")
def delete_office_plan(plan_id: str) -> dict[str, Any]:
    plans = _read_plans()
    remaining = [item for item in plans if item.get("id") != plan_id]
    if len(remaining) == len(plans):
        raise HTTPException(404, "方案不存在")
    _write_plans(remaining)
    return {"result": "方案已删除", "plans": remaining}
