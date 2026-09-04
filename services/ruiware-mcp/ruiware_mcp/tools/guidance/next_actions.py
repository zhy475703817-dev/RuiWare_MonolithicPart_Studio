"""下一步操作建议工具。"""

from __future__ import annotations

from typing import Any

from ...api_client import RuiWareApiClient
from ...core.responses import tool_result


STAGE_LABELS = {
    "templateInfo": "模板信息",
    "material": "材料",
    "baseSketch": "基础草图",
    "features": "特征规则",
    "variants": "参数与变体",
    "review": "CAD 审查",
    "admission": "发布准入",
}


def execute(client: RuiWareApiClient, arguments: dict[str, Any]) -> dict[str, Any]:
    """根据当前阶段状态返回下一步，不替 Agent 擅自修改数据。"""
    draft_id = arguments.get("draftId", "")
    draft = client.get(f"/template-drafts/{draft_id}")
    statuses = draft.get("stageStatus", {})
    for stage, label in STAGE_LABELS.items():
        if statuses.get(stage) == "complete":
            continue
        validation = client.get(f"/template-drafts/{draft_id}/stages/{stage}/validate")
        failed = [item for item in validation.get("checks", []) if not item.get("passed")]
        next_action = (
            {"tool": "ruiware_complete_stage", "stage": stage, "reason": f"{label}校验已通过后标记阶段完成。"}
            if validation.get("complete")
            else {"tool": "ruiware_get_parameter_help", "reason": f"先处理{label}中的失败校验项。"}
        )
        return tool_result({
            "draftId": draft_id,
            "currentStage": stage,
            "currentStageLabel": label,
            "savedStatus": statuses.get(stage, "unknown"),
            "validation": validation,
            "nextActions": [next_action],
            "blockingChecks": failed,
        })
    return tool_result({
        "draftId": draft_id,
        "currentStage": None,
        "currentStageLabel": "全部阶段已完成",
        "nextActions": [{"tool": "ruiware_get_latest_compile", "reason": "确认最终编译结果。"}],
    })
