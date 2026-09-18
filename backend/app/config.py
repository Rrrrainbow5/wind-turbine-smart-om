from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def database_path() -> Path:
    configured = os.getenv("WINDCARE_DB_PATH")
    return Path(configured).expanduser().resolve() if configured else PROJECT_ROOT / "windcare.db"


def allowed_origins() -> list[str]:
    configured = os.getenv("WINDCARE_ALLOWED_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173"]
