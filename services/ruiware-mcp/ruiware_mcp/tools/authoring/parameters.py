"""参数辅助工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def get_contract(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    draft_id = arguments.get("draftId", "")
    return tool_result(client.get(f"/template-drafts/{draft_id}/parameters"))


def validate(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    draft_id = arguments.get("draftId", "")
    return tool_result(client.post(f"/template-drafts/{draft_id}/parameters/validate", {
        "values": arguments.get("values", {}),
        "units": arguments.get("units", {}),
    }))


def preview(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    draft_id = arguments.get("draftId", "")
    return tool_result(client.post(f"/template-drafts/{draft_id}/parameters/preview", {
        "baseRevision": arguments["baseRevision"],
        "changes": arguments.get("changes", []),
    }))


def apply(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    draft_id = arguments.get("draftId", "")
    return tool_result(client.post(f"/template-drafts/{draft_id}/parameters/apply", {
        "baseRevision": arguments["baseRevision"],
        "changes": arguments.get("changes", []),
        "confirmed": arguments.get("confirmed", False),
    }))
