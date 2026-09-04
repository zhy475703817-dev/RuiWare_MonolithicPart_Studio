"""模板规则试算工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """在不保存模板的前提下试算规则。"""
    draft_id = arguments.get("draftId", "")
    payload = {
        "overrides": arguments.get("overrides", {}),
        "material": arguments.get("material", {}),
        "product": arguments.get("product", {}),
        "component": arguments.get("component", {}),
        "projectZone": arguments.get("projectZone", {}),
    }
    return tool_result(client.post(f"/template-drafts/{draft_id}/evaluate", payload))
