"""阶段状态推进工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def complete(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """让 API 在校验通过后正式完成一个阶段。"""
    draft_id = arguments.get("draftId", "")
    stage = arguments["stage"]
    return tool_result(client.post(f"/template-drafts/{draft_id}/stages/{stage}/complete", {}))
