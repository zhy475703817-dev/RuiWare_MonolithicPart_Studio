"""草稿上下文读取工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """读取指定模板修订的完整工程上下文。"""
    draft_id = arguments.get("draftId", "")
    return tool_result(client.get(f"/template-drafts/{draft_id}"))
