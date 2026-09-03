"""MCP JSON-RPC 协议层。

协议层只负责 MCP 请求和响应的封装与分发，具体工具仍由业务应用提供。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from .contracts import MCP_PROTOCOL_VERSION, SERVER_INFO
from .responses import api_error_result, invalid_tool_result
from ..api_client import RuiWareApiError


ToolCaller = Callable[[str, dict[str, Any]], dict[str, Any]]


class McpProtocolHandler:
    """处理 MCP 生命周期、工具列表和工具调用请求。"""

    def __init__(self, tool_caller: ToolCaller, tools: list[dict[str, Any]]) -> None:
        self.tool_caller = tool_caller
        self.tools = tools

    def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        """将一条已解析的 JSON-RPC 请求转换为 MCP 响应。"""
        method = request.get("method")
        request_id = request.get("id")
        if method == "notifications/initialized":
            return None
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": SERVER_INFO,
                },
            }
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": self.tools}}
        if method == "tools/call":
            try:
                result = self.tool_caller(
                    request["params"]["name"],
                    request["params"].get("arguments", {}),
                )
            except RuiWareApiError as error:
                result = api_error_result(error)
            except (KeyError, ValueError) as error:
                result = invalid_tool_result(error)
            return {"jsonrpc": "2.0", "id": request_id, "result": result}
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


def parse_error_response(error: json.JSONDecodeError) -> dict[str, Any]:
    """生成 JSON-RPC 请求解析失败的响应。"""
    return {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": -32700, "message": str(error)},
    }
