"""后三阶段新增 MCP 工具描述。"""

from __future__ import annotations


ADDITIONAL_TOOLS = [
    {
        "name": "ruiware_get_current_draft_status",
        "description": "读取 GUI 当前选中的零部件工程状态，包括阶段校验、最近编译和发布版本；未选中时不会按更新时间猜测。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "ruiware_compile_draft",
        "description": "执行指定模板的 CAD 编译并返回 B-Rep 检查结果和导出产物；会产生编译记录，但不修改模板定义。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}}},
    },
    {
        "name": "ruiware_get_latest_compile",
        "description": "读取指定模板最近一次 CAD 编译结果；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}}},
    },
    {
        "name": "ruiware_check_brep",
        "description": "根据最近一次 CAD 编译结果读取 B-Rep 有效性、实体数量、体积和诊断；不执行修改。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}}},
    },
    {
        "name": "ruiware_get_compile_artifacts",
        "description": "读取最近一次成功编译产生的 STEP、STL、语义映射和诊断文件地址；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}}},
    },
    {
        "name": "ruiware_evaluate_draft",
        "description": "使用指定参数和上下文试算当前模板规则；不保存修改。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}, "overrides": {"type": "object"}, "material": {"type": "object"}, "product": {"type": "object"}, "component": {"type": "object"}, "projectZone": {"type": "object"}}},
    },
    {
        "name": "ruiware_get_next_actions",
        "description": "分析当前草稿阶段状态和校验结果，返回 Agent 可执行的下一步建议；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}}},
    },
    {
        "name": "ruiware_get_parameter_help",
        "description": "读取指定参数的含义、范围、默认值、来源和当前变体覆盖；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId", "parameterId"], "properties": {"draftId": {"type": "string"}, "parameterId": {"type": "string"}, "variantId": {"type": "string"}}},
    },
    {
        "name": "ruiware_explain_error",
        "description": "把结构化 API 或 CAD 错误转换为 Agent 可直接向用户解释的处理建议；不访问或修改平台数据。",
        "inputSchema": {"type": "object", "required": ["error"], "properties": {"error": {"type": "object"}}},
    },
    {
        "name": "ruiware_complete_stage",
        "description": "在确定性校验通过后将指定阶段标记为完成；会修改草稿状态，仅在用户明确确认后调用。",
        "inputSchema": {"type": "object", "required": ["draftId", "stage"], "properties": {"draftId": {"type": "string"}, "stage": {"type": "string", "enum": ["templateInfo", "material", "baseSketch", "features", "variants", "review", "admission"]}}},
    },
]
