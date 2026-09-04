"""参数说明工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """从当前草稿上下文中提取参数契约和变体覆盖。"""
    draft_id = arguments.get("draftId", "")
    parameter_id = arguments["parameterId"]
    variant_id = arguments.get("variantId", "nominal")
    draft = client.get(f"/template-drafts/{draft_id}")
    parameter = next((item for item in draft.get("parameterDefinitions", []) if item.get("id") == parameter_id), None)
    if parameter is None:
        return tool_result({"draftId": draft_id, "parameterId": parameter_id, "found": False, "message": "未找到指定参数。"})
    variant = next((item for item in draft.get("variants", []) if item.get("id") == variant_id), None)
    return tool_result({
        "draftId": draft_id,
        "parameterId": parameter_id,
        "found": True,
        "parameter": parameter,
        "variantId": variant_id,
        "variantOverride": (variant or {}).get("overrides", {}).get(parameter_id) if variant else None,
    })
