"""本机协作模式的最小身份与会话边界。"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from contextvars import ContextVar
from dataclasses import dataclass

from fastapi import HTTPException, Request


SESSION_COOKIE = "ruiware_session"
AGENT_TOKEN = os.getenv("RUIWARE_AGENT_TOKEN", "local-agent-token")
AGENT_OWNER_ID = os.getenv("RUIWARE_AGENT_OWNER_ID", "local-dev-user")
GUI_OWNER_ID = os.getenv("RUIWARE_GUI_OWNER_ID", "local-dev-user")
SESSION_SECRET = os.getenv("RUIWARE_SESSION_SECRET", "local-development-session-secret")
_current_owner: ContextVar[str | None] = ContextVar("current_owner", default=None)
_current_workspace: ContextVar[str | None] = ContextVar("current_workspace", default=None)
_current_principal: ContextVar[Principal | None] = ContextVar("current_principal", default=None)


@dataclass(frozen=True)
class Principal:
    actor: str
    source: str
    session_id: str
    owner_id: str


def current_owner_id() -> str | None:
    return _current_owner.get()


def current_workspace_id() -> str | None:
    return _current_workspace.get()


def current_principal() -> Principal | None:
    return _current_principal.get()


def _signed_session(session_id: str) -> str:
    signature = hmac.new(SESSION_SECRET.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    return f"{session_id}.{signature}"


def _valid_session(value: str | None) -> str | None:
    if not value or "." not in value:
        return None
    session_id, signature = value.rsplit(".", 1)
    if not session_id or not hmac.compare_digest(_signed_session(session_id), value):
        return None
    return session_id


def _workspace_id(value: str | None) -> str | None:
    if value and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value):
        return value
    return None


def signed_session(session_id: str) -> str:
    return _signed_session(session_id)


def authenticate(request: Request) -> tuple[Principal, bool]:
    """从服务端可验证的凭据生成身份；不信任 actor/source 请求头。"""
    authorization = request.headers.get("Authorization", "")
    actor_header = request.headers.get("X-RuiWare-Actor")
    if authorization:
        if authorization != f"Bearer {AGENT_TOKEN}":
            raise HTTPException(status_code=401, detail={"code": "AUTHENTICATION_REQUIRED"})
        session_id = _workspace_id(request.headers.get("X-RuiWare-Session"))
        session_id = session_id or f"agent-{hashlib.sha256(AGENT_TOKEN.encode()).hexdigest()[:16]}"
        return Principal("agent", "mcp", session_id, AGENT_OWNER_ID), False
    if actor_header == "agent" or request.headers.get("X-RuiWare-Source") == "mcp":
        raise HTTPException(status_code=401, detail={"code": "AUTHENTICATION_REQUIRED"})
    session_id = _valid_session(request.cookies.get(SESSION_COOKIE))
    created = session_id is None
    session_id = session_id or secrets.token_urlsafe(18)
    return Principal("gui", "gui", session_id, GUI_OWNER_ID), created


def bind_request(request: Request) -> tuple[Principal, bool, object]:
    principal, created = authenticate(request)
    request.state.principal = principal
    principal_token = _current_principal.set(principal)
    workspace_id = _workspace_id(request.headers.get("X-RuiWare-Workspace")) or principal.session_id
    workspace_token = _current_workspace.set(workspace_id)
    token = _current_owner.set(principal.owner_id)
    return principal, created, (token, workspace_token, principal_token)


def release_request(token: object) -> None:
    owner_token, workspace_token, principal_token = token  # type: ignore[misc]
    _current_owner.reset(owner_token)
    _current_workspace.reset(workspace_token)
    _current_principal.reset(principal_token)
