from __future__ import annotations

from backend.app.schemas import (
    CandidateAction,
    MaintenanceAction,
    Priority,
    WarningLevel,
)


def decide_maintenance(
    *,
    failure_risk: float,
    warning_level: WarningLevel,
    maintenance_window_available: bool,
    personnel_available: bool,
) -> tuple[MaintenanceAction, Priority, str, bool, list[CandidateAction]]:
    maintenance_available = maintenance_window_available and personnel_available
    candidates = [
        CandidateAction(
            action=MaintenanceAction.MONITOR,
            available=True,
            explanation="保持监测并等待新的状态数据。",
        ),
        CandidateAction(
            action=MaintenanceAction.INSPECT,
            available=personnel_available,
            explanation="安排检查以确认异常是否持续，并补充维护决策证据。",
        ),
        CandidateAction(
            action=MaintenanceAction.MAINTAIN,
            available=maintenance_available,
            explanation="在人员和维护窗口均可用时安排维护。",
        ),
    ]

    high_risk = failure_risk >= 0.75 or warning_level == WarningLevel.HIGH
    medium_risk = failure_risk >= 0.45 or warning_level == WarningLevel.MEDIUM

    if high_risk and maintenance_available:
        return (
            MaintenanceAction.MAINTAIN,
            Priority.HIGH,
            "风险达到高等级，且人员与维护窗口均可用，建议安排维护。",
            False,
            candidates,
        )
    if high_risk:
        action = MaintenanceAction.INSPECT if personnel_available else MaintenanceAction.MONITOR
        return (
            action,
            Priority.HIGH,
            "风险达到高等级，但当前维护条件不完整；先执行可用动作，并在条件变化后重新规划。",
            True,
            candidates,
        )
    if medium_risk and personnel_available:
        return (
            MaintenanceAction.INSPECT,
            Priority.MEDIUM,
            "风险达到中等级，建议安排检查并继续跟踪趋势。",
            False,
            candidates,
        )
    if medium_risk:
        return (
            MaintenanceAction.MONITOR,
            Priority.MEDIUM,
            "风险达到中等级，但当前无可用人员；继续监测并等待检查资源。",
            True,
            candidates,
        )
    return (
        MaintenanceAction.MONITOR,
        Priority.LOW,
        "当前风险未达到检查或维护阈值，继续监测。",
        False,
        candidates,
    )
