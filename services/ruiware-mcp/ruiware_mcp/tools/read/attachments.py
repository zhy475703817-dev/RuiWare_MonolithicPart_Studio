"""模板附件读取工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient, RuiWareApiError
from ...core.responses import tool_result


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """读取属于指定模板修订的附件元数据。"""
    draft_id = arguments.get("draftId", "")
    draft = client.get(f"/template-drafts/{draft_id}")
    attachment = next(
        (item for item in draft.get("attachments", []) if item.get("id") == arguments.get("attachmentId")),
        None,
    )
    if attachment is None:
        raise RuiWareApiError("指定附件不属于该模板。")
    return tool_result(attachment)
