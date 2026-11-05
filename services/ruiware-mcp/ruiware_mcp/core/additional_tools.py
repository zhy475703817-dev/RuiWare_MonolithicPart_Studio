"""后三阶段新增 MCP 工具描述。"""

from __future__ import annotations


ADDITIONAL_TOOLS = [
    {
        "name": "ruiware_get_audit_log",
        "description": "读取模板操作审计记录，包括操作者、工具、版本和结果；不修改平台数据。",
        "inputSchema": {"type": "object", "properties": {"draftId": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 500}}},
    },
    {
        "name": "ruiware_rollback_draft",
        "description": "在用户确认且修订未变化时将模板恢复到历史修订，并生成新的可追溯 revision。",
        "inputSchema": {"type": "object", "required": ["draftId", "targetRevision", "baseRevision", "confirmed"], "properties": {"draftId": {"type": "string"}, "targetRevision": {"type": "integer", "minimum": 1}, "baseRevision": {"type": "integer", "minimum": 1}, "confirmed": {"type": "boolean"}}},
    },
    {
        "name": "create_template",
        "description": "经用户确认后，按名称幂等创建空白模板并将其选为 GUI 当前零部件。",
        "inputSchema": {"type": "object", "required": ["name", "confirmed"], "properties": {"name": {"type": "string"}, "confirmed": {"type": "boolean"}}},
    },
    {
        "name": "ruiware_get_current_draft_status",
        "description": "读取 GUI 当前选中的零部件工程状态，包括阶段校验、最近编译和发布版本；未选中时不会按更新时间猜测。",
        "inputSchema": {"type": "object", "properties": {"includeDetails": {"type": "boolean", "default": False}}},
    },
    {
        "name": "ruiware_compile_draft",
        "description": "经用户确认且修订未变化时执行 CAD 编译，并返回 B-Rep 检查结果和导出产物。",
        "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "confirmed"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer", "minimum": 1}, "confirmed": {"type": "boolean"}}},
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
        "name": "ruiware_get_parameter_contract",
        "description": "批量读取当前模板的参数定义、类型、单位、范围、来源和变体；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}}},
    },
    {
        "name": "ruiware_validate_parameter_values",
        "description": "校验一批参数值的类型、单位、范围并运行规则求值；不保存修改。",
        "inputSchema": {"type": "object", "required": ["draftId", "values"], "properties": {"draftId": {"type": "string"}, "values": {"type": "object"}, "units": {"type": "object"}}},
    },
    {
        "name": "ruiware_preview_parameter_changes",
        "description": "预览参数修改、求值结果和受影响的下游阶段校验；不保存修改。",
        "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "changes"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer"}, "changes": {"type": "array"}}},
    },
    {
        "name": "ruiware_apply_parameter_changes",
        "description": "仅在用户确认参数预览后写入参数并生成新修订；要求 baseRevision 和 confirmed=true。",
        "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "changes", "confirmed"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer"}, "changes": {"type": "array"}, "confirmed": {"type": "boolean"}}},
    },
    {
        "name": "ruiware_explain_error",
        "description": "把结构化 API 或 CAD 错误转换为 Agent 可直接向用户解释的处理建议；不访问或修改平台数据。",
        "inputSchema": {"type": "object", "required": ["error"], "properties": {"error": {"type": "object"}}},
    },
    {
        "name": "ruiware_complete_stage",
        "description": "在确定性校验通过后将指定阶段标记为完成；会修改草稿状态，仅在用户明确确认后调用。",
        "inputSchema": {"type": "object", "required": ["draftId", "stage", "baseRevision", "confirmed"], "properties": {"draftId": {"type": "string"}, "stage": {"type": "string", "enum": ["templateInfo", "material", "baseSketch", "features", "variants", "review", "admission"]}, "baseRevision": {"type": "integer", "minimum": 1}, "confirmed": {"type": "boolean"}}},
    },
    {"name": "ruiware_preview_sketch_edit", "description": "预览草图图元、约束、区域和设置修改，返回求解结果与几何阶段校验；不保存修改。", "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "changes"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer"}, "changes": {"type": "object"}}}},
    {"name": "ruiware_apply_sketch_edit", "description": "在用户确认且修订未变化时写入草图修改，并重新求解和校验。", "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "changes", "confirmed"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer"}, "changes": {"type": "object"}, "confirmed": {"type": "boolean"}}}},
    {"name": "ruiware_preview_material_binding", "description": "预览材料匹配、绑定方式和壁厚参数影响；不保存修改。", "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "sourceRecordId"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer"}, "sourceRecordId": {"type": "string"}, "mode": {"enum": ["reference", "copy"]}, "role": {"enum": ["minimum", "nominal", "maximum", "special"]}}}},
    {"name": "ruiware_apply_material_binding", "description": "在用户确认且修订未变化时绑定材料，更新壁厚参数并重新校验几何。", "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "sourceRecordId", "confirmed"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer"}, "sourceRecordId": {"type": "string"}, "mode": {"enum": ["reference", "copy"]}, "role": {"enum": ["minimum", "nominal", "maximum", "special"]}, "confirmed": {"type": "boolean"}}}},
    {"name": "ruiware_search_materials", "description": "按关键词和材料要求查询并匹配材料库记录；不修改平台数据。", "inputSchema": {"type": "object", "properties": {"search": {"type": "string"}, "limit": {"type": "integer"}, "requirement": {"type": "object"}}}},
    {"name": "ruiware_plan_task", "description": "根据目标生成当前模板的可执行任务计划；不修改平台数据。", "inputSchema": {"type": "object", "required": ["draftId", "task"], "properties": {"draftId": {"type": "string"}, "task": {"enum": ["completeCurrentStage", "fixCurrentErrors", "prepareCadCompile", "checkPublishReadiness"]}}}},
    {"name": "ruiware_execute_task", "description": "执行已预览并确认的目标任务；要求 baseRevision 和 confirmed=true。修复任务通过 input 指定参数、草图或材料修复。", "inputSchema": {"type": "object", "required": ["draftId", "task", "baseRevision", "confirmed"], "properties": {"draftId": {"type": "string"}, "task": {"enum": ["completeCurrentStage", "fixCurrentErrors", "prepareCadCompile", "checkPublishReadiness"]}, "baseRevision": {"type": "integer"}, "confirmed": {"type": "boolean"}, "input": {"type": "object"}}}},
    {"name": "ruiware_publish_template", "description": "发布已通过准入校验和 CAD 编译的模板；要求用户确认且草稿修订未变化。发现旧版本候选时，先展示比较结果并由用户选择新增或替换，再携带 duplicateDecision 重试。", "inputSchema": {"type": "object", "required": ["draftId", "baseRevision", "confirmed"], "properties": {"draftId": {"type": "string"}, "baseRevision": {"type": "integer", "minimum": 1}, "confirmed": {"type": "boolean"}, "duplicateDecision": {"type": "object", "required": ["action", "reviewToken"], "properties": {"action": {"enum": ["add", "replace"]}, "reviewToken": {"type": "string", "minLength": 64, "maxLength": 64}, "publicationIds": {"type": "array", "items": {"type": "string"}}}}}}},
]
