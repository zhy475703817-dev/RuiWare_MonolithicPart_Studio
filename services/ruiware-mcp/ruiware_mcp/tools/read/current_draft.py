"""当前工作区零部件状态读取工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


STAGES = (
    "templateInfo",
    "material",
    "baseSketch",
    "features",
    "variants",
    "review",
    "admission",
)


def execute(client: RuiWareApiClient, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """读取 GUI 当前选中的零部件及其阶段、编译和发布状态。"""
    selection = client.get("/workspace/current-draft")
    draft_id = selection.get("draftId")
    if not draft_id or not selection.get("draft"):
        return tool_result({
            "selected": False,
            "draftId": None,
            "message": "当前工作区尚未选中零部件，无法返回工程状态。",
            "nextAction": "请先在 GUI 零部件列表中选中一个零部件。",
        })

    draft = selection["draft"]
    validations = {
        stage: client.get(f"/template-drafts/{draft_id}/stages/{stage}/validate")
        for stage in STAGES
    }
    latest_compile = client.get(f"/template-drafts/{draft_id}/compile-runs/latest")
    versions = client.get(f"/template-drafts/{draft_id}/versions")
    return tool_result({
        "selected": True,
        "selectionSource": "gui_workspace",
        "draftId": draft_id,
        "draft": draft,
        "stageStatus": draft.get("stageStatus", {}),
        "stageValidations": validations,
        "latestCompile": latest_compile,
        "publishedVersions": versions,
    })
