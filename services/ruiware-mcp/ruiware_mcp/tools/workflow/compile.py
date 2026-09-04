"""CAD 编译和编译结果读取工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """执行模板 CAD 编译并记录结果。"""
    draft_id = arguments.get("draftId", "")
    return tool_result(client.post(f"/template-drafts/{draft_id}/compile", {}))


def latest(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """读取最近一次编译结果。"""
    draft_id = arguments.get("draftId", "")
    return tool_result(client.get(f"/template-drafts/{draft_id}/compile-runs/latest"))


def brep(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """从最近一次编译结果提取 B-Rep 检查摘要。"""
    draft_id = arguments.get("draftId", "")
    result = client.get(f"/template-drafts/{draft_id}/compile-runs/latest")
    if not result:
        return tool_result({"draftId": draft_id, "available": False, "message": "尚无 CAD 编译记录。"})
    return tool_result({
        "draftId": draft_id,
        "available": True,
        "success": result.get("success", False),
        "metrics": result.get("metrics"),
        "diagnostics": result.get("diagnostics", []),
    })


def artifacts(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """读取最近一次成功编译的导出产物地址。"""
    draft_id = arguments.get("draftId", "")
    result = client.get(f"/template-drafts/{draft_id}/compile-runs/latest")
    if not result:
        return tool_result({"draftId": draft_id, "available": False, "artifacts": []})
    return tool_result({
        "draftId": draft_id,
        "available": bool(result.get("success")),
        "inputHash": result.get("inputHash"),
        "artifacts": result.get("artifacts", []) if result.get("success") else [],
        "diagnostics": result.get("diagnostics", []),
    })
