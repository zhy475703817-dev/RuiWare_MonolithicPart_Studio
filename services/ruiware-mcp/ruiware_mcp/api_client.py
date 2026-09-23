from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import time
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
    def __init__(self, base_url: str | None = None, *, max_retries: int = 2, sleep_fn=time.sleep) -> None:
        self.base_url = (base_url or os.getenv("RUIWARE_API_URL") or "http://127.0.0.1:8010/api/v1").rstrip("/")
        self.max_retries = max(0, max_retries)
        self.sleep_fn = sleep_fn
        self.agent_token = os.getenv("RUIWARE_AGENT_TOKEN", "local-agent-token")
        self.session_id = os.getenv("RUIWARE_SESSION_ID")

    def get(self, path: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        return self._request("GET", path, params=params, headers=self._context_headers(None, headers), retry_safe=True)

    def post(self, path: str, payload: dict[str, Any] | None = None, *, headers: dict[str, str] | None = None, retry_safe: bool = False) -> Any:
        return self._request("POST", path, payload, headers=self._context_headers(payload, headers), retry_safe=retry_safe)

    def put(self, path: str, payload: dict[str, Any] | None = None, *, headers: dict[str, str] | None = None, retry_safe: bool = False) -> Any:
        return self._request("PUT", path, payload, headers=self._context_headers(payload, headers), retry_safe=retry_safe)

    @staticmethod
    def _context_headers(payload: dict[str, Any] | None, headers: dict[str, str] | None) -> dict[str, str]:
        protected = {"x-ruiware-actor", "x-ruiware-source", "x-ruiware-base-revision", "x-ruiware-confirmed", "x-ruiware-session", "x-ruiware-workspace"}
        result = {key: value for key, value in (headers or {}).items() if key.lower() not in protected}
        result["X-RuiWare-Actor"] = "agent"
        result["X-RuiWare-Source"] = "mcp"
        result["Authorization"] = f"Bearer {os.getenv('RUIWARE_AGENT_TOKEN', 'local-agent-token')}"
        result["X-RuiWare-Workspace"] = os.getenv("RUIWARE_WORKSPACE_ID", "ruiware-main")
        if os.getenv("RUIWARE_SESSION_ID"):
            result["X-RuiWare-Session"] = os.environ["RUIWARE_SESSION_ID"]
        if not isinstance(payload, dict):
            return result
        if "baseRevision" in payload:
            result["X-RuiWare-Base-Revision"] = str(payload["baseRevision"])
        if "confirmed" in payload:
            result["X-RuiWare-Confirmed"] = str(payload["confirmed"]).lower()
        if payload.get("sessionId"):
            result["X-RuiWare-Session"] = str(payload["sessionId"])
        return result

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None, retry_safe: bool = False) -> Any:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        if params:
            from urllib.parse import urlencode
            path = f"{path}?{urlencode(params)}"
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method,
            headers={**({"Content-Type": "application/json"} if data is not None else {}), **(headers or {})},
        )
        for attempt in range(self.max_retries + 1):
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
                api_error = RuiWareApiError(
                    str(detail.get("message") or f"RuiWare API {error.code}"),
                    status=error.code,
                    payload=detail,
                )
                if retry_safe and error.code >= 500 and attempt < self.max_retries:
                    self.sleep_fn(0.05 * (2 ** attempt))
                    continue
                raise api_error from error
            except urllib.error.URLError as error:
                if retry_safe and attempt < self.max_retries:
                    self.sleep_fn(0.05 * (2 ** attempt))
                    continue
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
        raise RuntimeError("unreachable")
