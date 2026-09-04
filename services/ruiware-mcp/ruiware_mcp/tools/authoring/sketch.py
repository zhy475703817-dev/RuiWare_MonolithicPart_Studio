"""草图求解工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """执行确定性草图求解，不保存草稿。"""
    return tool_result(client.post("/sketches/solve", {
        "draft": arguments["draft"],
        "overrides": arguments.get("overrides", {}),
    }))
