from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS turbines (
    turbine_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    wind_farm TEXT NOT NULL,
    operational_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    data_origin TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS components (
    component_id TEXT PRIMARY KEY,
    turbine_id TEXT NOT NULL REFERENCES turbines(turbine_id),
    display_name TEXT NOT NULL,
    mapping_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
    data_origin TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turbine_id TEXT NOT NULL REFERENCES turbines(turbine_id),
    component_id TEXT NOT NULL REFERENCES components(component_id),
    observed_at TEXT NOT NULL,
    health_index REAL NOT NULL CHECK (health_index >= 0 AND health_index <= 100),
    anomaly_score REAL NOT NULL CHECK (anomaly_score >= 0 AND anomaly_score <= 1),
    failure_risk REAL NOT NULL CHECK (failure_risk >= 0 AND failure_risk <= 1),
    warning_level TEXT NOT NULL,
    model_version TEXT NOT NULL,
    data_origin TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_results_component_time
ON ai_results(component_id, observed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS maintenance_plans (
    plan_id TEXT PRIMARY KEY,
    turbine_id TEXT NOT NULL REFERENCES turbines(turbine_id),
    component_id TEXT NOT NULL REFERENCES components(component_id),
    action TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    rationale TEXT NOT NULL,
    requires_replan INTEGER NOT NULL DEFAULT 0,
    decision_origin TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maintenance_records (
    record_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES maintenance_plans(plan_id),
    executed_at TEXT NOT NULL,
    outcome TEXT NOT NULL,
    data_origin TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retest_records (
    retest_id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES maintenance_records(record_id),
    observed_at TEXT NOT NULL,
    health_index REAL NOT NULL CHECK (health_index >= 0 AND health_index <= 100),
    failure_risk REAL NOT NULL CHECK (failure_risk >= 0 AND failure_risk <= 1),
    conclusion TEXT NOT NULL,
    data_origin TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    def execute(self, sql: str, parameters: Iterable[Any] = ()) -> int:
        with self.connect() as connection:
            cursor = connection.execute(sql, tuple(parameters))
            connection.commit()
            return cursor.lastrowid

    def fetch_one(self, sql: str, parameters: Iterable[Any] = ()) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(sql, tuple(parameters)).fetchone()
            return dict(row) if row else None

    def fetch_all(self, sql: str, parameters: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(sql, tuple(parameters)).fetchall()
            return [dict(row) for row in rows]
