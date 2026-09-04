"""结构化错误解释工具。"""

from __future__ import annotations

from typing import Any

from ...core.responses import tool_result


def execute(arguments: dict[str, Any]) -> dict[str, Any]:
    """根据错误中的 action、字段和可重试标记生成简明指导。"""
    error = arguments.get("error", {})
    if not isinstance(error, dict):
        error = {"message": str(error)}
    if isinstance(error.get("error"), dict):
        error = error["error"]
    advice = error.get("action") or "请检查当前输入和服务状态后重试。"
    if error.get("retryable"):
        advice = f"{advice} 该错误允许重试。"
    return tool_result({
        "code": error.get("code", "UNKNOWN_ERROR"),
        "message": error.get("message", "请求处理失败。"),
        "advice": advice,
        "fields": error.get("fields") or [],
        "retryable": bool(error.get("retryable")),
        "traceId": error.get("traceId", ""),
    })
