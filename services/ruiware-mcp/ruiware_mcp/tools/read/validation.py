"""模板阶段校验读取工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """读取指定模板阶段的确定性校验结果。"""
    draft_id = arguments.get("draftId", "")
    stage = arguments["stage"]
    return tool_result(client.get(f"/template-drafts/{draft_id}/stages/{stage}/validate"))
