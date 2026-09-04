from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class RuiWareApiError(RuntimeError):
    """携带 API 结构化错误信息的本地 RuiWare API 异常。"""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.payload = payload or {
            "code": "MCP_API_ERROR",
            "message": message,
            "action": "请检查 API 服务状态后重试。",
            "fields": [],
            "traceId": "",
            "retryable": True,
        }


class RuiWareApiClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("RUIWARE_API_URL") or "http://127.0.0.1:8010/api/v1").rstrip("/")

    def get(self, path: str) -> Any:
        return self._request("GET", path)

    def post(self, path: str, payload: dict[str, Any]) -> Any:
        return self._request("POST", path, payload)

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            try:
                response_payload = json.loads(body)
            except json.JSONDecodeError:
                response_payload = {}
            detail = response_payload.get("error") or response_payload.get("detail")
            if not isinstance(detail, dict) or "code" not in detail:
                detail = {
                    "code": f"HTTP_{error.code}",
                    "message": detail if isinstance(detail, str) else body or error.reason,
                    "action": "请检查请求参数或服务状态后重试。",
                    "fields": [],
                    "traceId": "",
                    "retryable": error.code >= 500,
                }
            raise RuiWareApiError(
                str(detail.get("message") or f"RuiWare API {error.code}"),
                status=error.code,
                payload=detail,
            ) from error
        except urllib.error.URLError as error:
            raise RuiWareApiError(
                f"无法连接 RuiWare API（{self.base_url}）：{error.reason}",
                payload={
                    "code": "MCP_API_UNAVAILABLE",
                    "message": f"无法连接 RuiWare API（{self.base_url}）。",
                    "action": "请启动模板 API 后重试。",
                    "fields": [],
                    "traceId": "",
                    "retryable": True,
                },
            ) from error
