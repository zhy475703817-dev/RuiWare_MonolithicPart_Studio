"""MCP 工具调用的统一返回体。"""

from __future__ import annotations

import json
from typing import Any

from ..api_client import RuiWareApiError


def tool_result(value: Any) -> dict[str, Any]:
    """将业务结果包装成 MCP text content。"""
    return {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False, indent=2)}]}


def api_error_result(error: RuiWareApiError) -> dict[str, Any]:
    """将 RuiWare API 异常转换成 Agent 可识别的结构化错误。"""
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "error": error.payload,
                "status": error.status,
            }, ensure_ascii=False, indent=2),
        }],
        "isError": True,
    }


def invalid_tool_result(error: Exception) -> dict[str, Any]:
    """生成工具名称或输入参数错误的统一结果。"""
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "error": {
                    "code": "MCP_TOOL_INVALID",
                    "message": str(error),
                    "action": "请检查工具名称和输入参数。",
                    "fields": [],
                    "traceId": "",
                    "retryable": False,
                },
            }, ensure_ascii=False, indent=2),
        }],
        "isError": True,
    }
