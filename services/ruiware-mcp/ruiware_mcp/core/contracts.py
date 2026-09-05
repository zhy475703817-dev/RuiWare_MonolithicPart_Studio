"""MCP 对外接口的兼容基线。

这里记录已经对外提供的工具名称、必填参数和读写属性。内部代码可以继续
拆分，但这些契约变化必须显式评估，避免已有 Agent 调用突然失效。
"""

from __future__ import annotations


MCP_PROTOCOL_VERSION = "2025-06-18"

SERVER_INFO = {
    "name": "ruiware-mcp",
    "version": "0.1.0",
}


TOOL_CONTRACTS = {
    "ruiware_get_draft_context": {
        "required": ("draftId",),
        "read_only": True,
    },
    "ruiware_get_attachment": {
        "required": ("draftId", "attachmentId"),
        "read_only": True,
    },
    "ruiware_solve_sketch": {
        "required": ("draft",),
        "read_only": True,
    },
    "ruiware_preview_proposal": {
        "required": ("draftId", "proposal"),
        "read_only": True,
    },
    "ruiware_submit_proposal": {
        "required": ("draftId", "proposal"),
        "read_only": False,
    },
    "ruiware_get_validation_result": {
        "required": ("draftId", "stage"),
        "read_only": True,
    },
    "ruiware_compile_draft": {"required": ("draftId",), "read_only": False},
    "ruiware_get_latest_compile": {"required": ("draftId",), "read_only": True},
    "ruiware_check_brep": {"required": ("draftId",), "read_only": True},
    "ruiware_get_compile_artifacts": {"required": ("draftId",), "read_only": True},
    "ruiware_evaluate_draft": {"required": ("draftId",), "read_only": True},
    "ruiware_get_next_actions": {"required": ("draftId",), "read_only": True},
    "ruiware_get_parameter_help": {"required": ("draftId", "parameterId"), "read_only": True},
    "ruiware_get_parameter_contract": {"required": ("draftId",), "read_only": True},
    "ruiware_validate_parameter_values": {"required": ("draftId", "values"), "read_only": True},
    "ruiware_preview_parameter_changes": {"required": ("draftId", "baseRevision", "changes"), "read_only": True},
    "ruiware_apply_parameter_changes": {"required": ("draftId", "baseRevision", "changes", "confirmed"), "read_only": False},
    "ruiware_explain_error": {"required": ("error",), "read_only": True},
    "ruiware_complete_stage": {"required": ("draftId", "stage"), "read_only": False},
    "ruiware_get_current_draft_status": {"required": (), "read_only": True},
}
