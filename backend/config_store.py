from __future__ import annotations

import json
import os
from pathlib import Path


CONFIG_DIR = Path(os.getenv("APPDATA") or Path.home() / ".omnibox")
CONFIG_PATH = CONFIG_DIR / "settings.json"


def read_config() -> dict:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def write_config(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        CONFIG_DIR.chmod(0o700)

    temporary_path = CONFIG_PATH.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if os.name != "nt":
        temporary_path.chmod(0o600)
    temporary_path.replace(CONFIG_PATH)


def get_secret(field: str) -> str:
    value = read_config().get(field, "")
    return value if isinstance(value, str) else ""
