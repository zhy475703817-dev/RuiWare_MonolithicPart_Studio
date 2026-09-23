import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ruiware-mcp"))

from ruiware_mcp.api_client import RuiWareApiClient, RuiWareApiError


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


def test_get_retries_connection_failure_twice(monkeypatch):
    calls = []

    def opener(request, timeout):
        calls.append(request.full_url)
        if len(calls) < 3:
            raise urllib.error.URLError("offline")
        return _Response({"ok": True})

    monkeypatch.setattr("urllib.request.urlopen", opener)
    client = RuiWareApiClient("http://api", sleep_fn=lambda _: None)

    assert client.get("/health") == {"ok": True}
    assert len(calls) == 3


def test_get_retries_503_but_not_409(monkeypatch):
    calls = []
    error_503 = urllib.error.HTTPError("http://api/health", 503, "busy", {}, io.BytesIO(b'{"error":{"code":"TEMP","retryable":true}}'))

    def opener(request, timeout):
        calls.append(request.full_url)
        if len(calls) < 2:
            raise error_503
        return _Response({"ok": True})

    monkeypatch.setattr("urllib.request.urlopen", opener)
    client = RuiWareApiClient("http://api", sleep_fn=lambda _: None)
    assert client.get("/health") == {"ok": True}
    assert len(calls) == 2

    conflict_calls = []

    def conflict_opener(request, timeout):
        conflict_calls.append(request.full_url)
        raise urllib.error.HTTPError("http://api/health", 409, "conflict", {}, io.BytesIO(b'{"error":{"code":"DRAFT_REVISION_CONFLICT"}}'))

    monkeypatch.setattr("urllib.request.urlopen", conflict_opener)
    with pytest.raises(RuiWareApiError):
        client.get("/health")
    assert len(conflict_calls) == 1


def test_post_does_not_retry_without_explicit_retry_safe(monkeypatch):
    calls = []

    def opener(request, timeout):
        calls.append(request.full_url)
        raise urllib.error.URLError("offline")

    monkeypatch.setattr("urllib.request.urlopen", opener)
    client = RuiWareApiClient("http://api", sleep_fn=lambda _: None)

    with pytest.raises(RuiWareApiError):
        client.post("/template-drafts/draft-1/rollback", {})
    assert len(calls) == 1


def test_mcp_write_payload_gets_agent_context_headers(monkeypatch):
    seen = []

    def opener(request, timeout):
        seen.append(dict(request.headers))
        return _Response({"ok": True})

    monkeypatch.setattr("urllib.request.urlopen", opener)
    RuiWareApiClient("http://api", sleep_fn=lambda _: None).post(
        "/template-drafts/draft-1/parameters/apply",
        {"baseRevision": 3, "confirmed": True},
    )

    assert seen[0]["X-ruiware-actor"] == "agent"
    assert seen[0]["X-ruiware-source"] == "mcp"
    assert seen[0]["X-ruiware-base-revision"] == "3"


def test_all_mcp_mutations_get_agent_identity_even_without_guard_fields(monkeypatch):
    seen = []

    def opener(request, timeout):
        seen.append((request.method, dict(request.headers)))
        return _Response({"ok": True})

    monkeypatch.setattr("urllib.request.urlopen", opener)
    client = RuiWareApiClient("http://api", sleep_fn=lambda _: None)

    client.post("/template-drafts/draft-1/compile", {}, headers={"X-Request-Id": "request-1"})
    client.put("/workspace/current-draft", {"draftId": "draft-1"})

    assert seen[0][1]["X-ruiware-actor"] == "agent"
    assert seen[0][1]["X-ruiware-source"] == "mcp"
    assert seen[0][1]["X-request-id"] == "request-1"
    assert seen[1][1]["X-ruiware-actor"] == "agent"
    assert seen[1][1]["X-ruiware-source"] == "mcp"


def test_mcp_get_sends_shared_workspace_header(monkeypatch):
    seen = []

    def opener(request, timeout):
        seen.append(dict(request.headers))
        return _Response({"selected": False})

    monkeypatch.setattr("urllib.request.urlopen", opener)
    monkeypatch.setenv("RUIWARE_WORKSPACE_ID", "ruiware-main")

    RuiWareApiClient("http://api", sleep_fn=lambda _: None).get(
        "/workspace/current-draft/engineering-status",
    )

    assert seen[0]["X-ruiware-workspace"] == "ruiware-main"
