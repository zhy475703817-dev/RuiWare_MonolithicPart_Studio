"""发布模板工具。"""
from __future__ import annotations
from typing import Any
from ...api_client import RuiWareApiClient
from ...core.responses import tool_result

def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    draft_id = arguments.get("draftId", "")
    payload = {
        "baseRevision": arguments["baseRevision"],
        "confirmed": arguments["confirmed"],
    }
    if arguments.get("duplicateDecision") is not None:
        payload["duplicateDecision"] = arguments["duplicateDecision"]
    return tool_result(client.post(f"/template-drafts/{draft_id}/publish", payload))
