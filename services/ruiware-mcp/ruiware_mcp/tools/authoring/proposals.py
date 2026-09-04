"""工程提案预览和提交工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def preview(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """预览提案差异，不保存模板。"""
    draft_id = arguments.get("draftId", "")
    return tool_result(client.post(f"/template-drafts/{draft_id}/proposals/preview", {
        "proposal": arguments["proposal"],
        "selectedCommandIds": arguments.get("selectedCommandIds"),
    }))


def submit(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """提交已经由用户确认的提案。"""
    draft_id = arguments.get("draftId", "")
    return tool_result(client.post(f"/template-drafts/{draft_id}/proposals/apply", {
        "proposal": arguments["proposal"],
        "selectedCommandIds": arguments.get("selectedCommandIds"),
    }))
