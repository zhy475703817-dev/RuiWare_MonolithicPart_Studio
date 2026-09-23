"""生成面向工程人员的模板重建说明书，并保留完整技术附录。"""

from __future__ import annotations

import json
from typing import Any

from template_core.models import StageName, TemplateDraft
from template_core.sketch_solver import solve_semantic_sketch
from template_core.stages import STAGE_ORDER

from ..repository import Repository
from .context import STAGE_LABELS, validate_stage_with_context


STAGE_FRIENDLY_LABELS = {
    "templateInfo": "模板定义",
    "material": "材料",
    "baseSketch": "几何草图",
    "features": "制造规则",
    "variants": "参数契约",
    "review": "CAD 验证",
    "admission": "发布准入",
}

OPERATOR_LABELS = {
    "profile.open_profile_tube_extrude": "按开口截面拉伸",
    "sketch.region_extrude": "按草图区域拉伸",
    "sketch.centerline_thinwall_extrude": "按中心线生成薄壁实体",
    "sheet.blank_extrude": "按板材轮廓拉伸",
    "profile.rectangular_tube_extrude": "按矩形管截面拉伸",
    "solid.extrude": "实体拉伸",
    "solid.revolve": "实体旋转",
    "solid.sweep": "沿路径扫掠",
    "solid.loft": "截面放样",
    "sheet.bend": "板材折弯",
}

FEATURE_LABELS = {
    "circularHole": "圆孔",
    "slotHole": "长圆孔",
    "rectangularCut": "矩形切口",
    "polygonCut": "多边形切口",
    "booleanCut": "布尔切削",
}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _cell(value: Any) -> str:
    text = "-" if value is None or value == "" else str(value)
    return text.replace("|", "\\|").replace("\n", "<br>")


def _table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    lines = [f"| {' | '.join(headers)} |", f"| {' | '.join('---' for _ in headers)} |"]
    lines.extend(f"| {' | '.join(_cell(value) for value in row)} |" for row in rows)
    return lines


def _section(lines: list[str], title: str) -> None:
    lines.extend([f"## {title}", ""])


def _source(parameter: Any) -> str:
    source = parameter.sourceDefinition
    return _json(source.model_dump(mode="json") if source else None)


def _parameter_effects(draft: TemplateDraft, parameter_id: str) -> str:
    effects: list[str] = []
    if any(parameter_id in item.parameterRefs for item in draft.sketch.entities):
        effects.append("草图尺寸")
    if any(parameter_id in item.argumentExpressions.values() for item in draft.geometryRecipe.operations):
        effects.append("基础几何")
    if any(
        parameter_id in item.conditionExpression
        or parameter_id in item.countExpression
        or parameter_id in item.argumentExpressions.values()
        for item in draft.featureRules
    ):
        effects.append("制造规则")
    if any(parameter_id in item.overrides for item in draft.variants):
        effects.append("变体覆盖")
    return "、".join(effects) or "模板参数"


def _shape_description(draft: TemplateDraft) -> str:
    profile_labels = {
        "closedRegion": "闭合区域",
        "multiRegion": "多区域轮廓",
        "centerlineThinWall": "中心线薄壁轮廓",
    }
    profile = profile_labels.get(draft.sketch.profileMode, draft.sketch.profileMode)
    operation_names = [OPERATOR_LABELS.get(item.operator, item.operator) for item in draft.geometryRecipe.operations]
    operations = "、".join(operation_names) or "尚未配置几何操作"
    return f"当前模板使用{profile}草图，几何流程为：{operations}。"


def _validation_recommendation(stage: StageName, check_id: str) -> str:
    recommendations = {
        "sketch-degrees-of-freedom": "打开几何阶段，为未完全约束的图元补充尺寸或几何约束，直到三个工况的自由度都为 0。",
        "constraints-reviewed": "在几何阶段确认尺寸约束、连接关系和轮廓闭合状态。",
        "geometry-reviewed": "检查基础几何的生成方式和输入参数，确认后重新完成几何阶段。",
        "feature-count": "进入规则阶段，至少创建一条有效的制造特征规则，或确认该模板确实不需要加工特征。",
        "feature-review": "检查每条规则的特征类型、参数和语义面绑定，再确认规则集合。",
        "compile-success": "进入验证阶段查看 CAD 诊断，先修复几何或算子错误，再重新编译。",
        "brep-valid": "检查最终模型是否为有效实体，重点确认切削没有完全切穿或产生空实体。",
        "reviewer": "在发布页填写实际复核人的姓名或工号。",
        "change-note": "在发布页说明本次变更内容、适用范围和已知限制。",
        "workflow-prerequisites": f"先完成前置阶段：{STAGE_FRIENDLY_LABELS.get(stage, stage)}之前的阶段必须按顺序完成。",
    }
    return recommendations.get(check_id, "按照技术附录中的数据路径修正对应字段，然后重新执行本阶段检查。")


def _collect_validations(repository: Repository, draft: TemplateDraft) -> dict[StageName, Any]:
    return {stage: validate_stage_with_context(repository, stage, draft) for stage in STAGE_ORDER}


def _build_technical_appendix(
    draft: TemplateDraft,
    solution: dict[str, Any],
    validations: dict[StageName, Any],
) -> list[str]:
    lines: list[str] = [
        "## 技术附录",
        "",
        "本部分保留机器复现和工程排错所需的原始表达式和稳定 ID、数据路径和校验结果。正文没有展开的细节，都可以在这里查找。",
        "",
        "### 技术附录 A：参数原始定义",
        "",
    ]
    lines.extend(_table(
        ["参数 ID", "名称", "类型", "单位", "默认值", "最小值", "最大值", "来源"],
        [[item.id, item.label, item.valueType, item.unit, item.default, item.minimum, item.maximum, _source(item)] for item in draft.parameterDefinitions],
    ))
    lines.extend(["", "### 技术附录 B：草图、约束与求解结果", ""])
    lines.append(f"草图平面：`{draft.sketch.plane}`；轮廓模式：`{draft.sketch.profileMode}`；获取方式：`{draft.sketch.acquisitionMethod}`")
    lines.extend(["", "#### 草图图元", ""])
    lines.extend(_table(
        ["图元 ID", "语义角色", "类型", "参数引用", "起点", "终点/中心", "半径"],
        [[item.id, item.role, item.geometryType, ", ".join(item.parameterRefs), _json(item.start), _json(item.end or item.center), item.radius] for item in draft.sketch.entities],
    ))
    lines.extend(["", "#### 草图约束", ""])
    lines.extend(_table(
        ["约束 ID", "类型", "图元引用", "参数 ID", "表达式", "启用/驱动"],
        [[item.id, item.constraintType, ", ".join(item.entityRefs), item.parameterId, item.expression, f"{item.enabled}/{item.driving}"] for item in draft.sketch.constraints],
    ))
    lines.extend(["", "#### 草图区域", ""])
    lines.extend(_table(
        ["区域 ID", "边界图元", "闭合", "角色", "操作"],
        [[item.id, ", ".join(item.boundaryRefs), "是" if item.closed else "否", item.role, item.operation] for item in draft.sketch.regions],
    ))
    lines.extend(["", "#### 求解工况", ""])
    lines.extend(_table(
        ["工况", "自由度", "可求解", "拓扑签名"],
        [[item["case"], item["degreesOfFreedom"], "是" if item["valid"] else "否", item["topologySignature"]] for item in solution["cases"]],
    ))
    lines.extend(["", "### 技术附录 C：几何配方和算子", ""])
    lines.append(f"构造模式：`{draft.geometryRecipe.constructionMode}`；配方已确认：`{'是' if draft.geometryRecipe.reviewed else '否'}`")
    lines.extend(["", "#### 几何操作", ""])
    lines.extend(_table(
        ["操作 ID", "算子", "来源引用", "输入", "输入表达式", "条件"],
        [[item.id, item.operator, ", ".join(item.sourceRefs), _json(item.arguments), _json(item.argumentExpressions), item.conditionExpression] for item in draft.geometryRecipe.operations],
    ))
    lines.extend(["", f"扫掠路径：`{_json(draft.sweepPath.model_dump(mode='json') if draft.sweepPath else None)}`", "", "#### 语义面定位器", ""])
    lines.extend(_table(
        ["语义面 ID", "来源操作", "定位器", "U 范围", "V 范围"],
        [[item.id, item.sourceOperationId, _json(item.locator.model_dump(mode="json") if item.locator else None), f"{item.uStartExpression} + {item.uSpanExpression}", f"{item.vStartExpression} + {item.vSpanExpression}"] for item in draft.geometryRecipe.semanticFaces],
    ))
    lines.extend(["", "### 技术附录 D：制造特征规则", ""])
    lines.extend(_table(
        ["规则 ID", "名称", "特征类型", "数量表达式", "条件表达式", "参数", "语义面绑定"],
        [[item.id, item.name, item.featureType, item.countExpression, item.conditionExpression, _json(item.argumentExpressions or item.arguments), ", ".join(binding.semanticFaceId for binding in item.faceBindings)] for item in draft.featureRules],
    ))
    lines.extend(["", "### 技术附录 E：变体、接口、材料和发布状态", ""])
    lines.extend(_table(["变体 ID", "名称", "参数覆盖"], [[item.id, item.name, _json(item.overrides)] for item in draft.variants]))
    lines.extend(["", "#### 接口", ""])
    lines.extend(_table(["接口 ID", "名称", "类型", "参数/来源"], [[item.id, item.name, item.interfaceType, _json(item.model_dump(mode="json"))] for item in draft.interfaces]))
    lines.extend(["", "#### 材料、毛坯和阶段状态", ""])
    lines.append(f"材料要求：`{_json([item.model_dump(mode='json') for item in draft.materialRequirements])}`")
    lines.append(f"毛坯：`{_json(draft.blank.model_dump(mode='json'))}`")
    lines.append(f"发布策略：`{_json(draft.admission.model_dump(mode='json'))}`")
    lines.append(f"阶段状态：`{_json(draft.stageStatus.model_dump(mode='json'))}`")
    lines.extend(["", "### 技术附录 F：阶段校验原始结果", ""])
    for stage, validation in validations.items():
        lines.extend([f"#### {STAGE_LABELS[stage]} (`{stage}`)", ""])
        lines.extend(_table(
            ["检查项 ID", "结果", "数据路径", "说明"],
            [[item.id, "通过" if item.passed else "失败", f"`{item.path}`", item.message] for item in validation.checks],
        ))
        lines.append("")
    return lines


def build_reconstruction_guide(repository: Repository, draft: TemplateDraft) -> str:
    """从当前模板修订生成先易读、后完整的工程复现说明书。"""
    solution = solve_semantic_sketch(draft)
    validations = _collect_validations(repository, draft)
    route = draft.blank.manufacturingRoute or "尚未确定"
    description = draft.description.strip() or "当前模板尚未填写用途说明。"
    design_intent = draft.designIntent.strip() or "当前模板尚未填写设计意图。"
    lines = [
        f"# {draft.name}",
        "",
        f"> {draft.name} · {draft.code or draft.id} · 当前修订 R{draft.revision}",
        "",
        "> 这是一份面向工程人员的模板复现手册。请先阅读正文；需要精确排错时，再查看文末技术附录。",
        "",
    ]

    _section(lines, "1. 这个模板是做什么的")
    lines.extend([description, "", f"设计意图：{design_intent}", ""])
    lines.extend(_table(
        ["项目", "当前内容"],
        [["制造方式", route], ["截面和几何流程", _shape_description(draft)], ["单位", "毫米（mm）"], ["当前状态", "已发布" if draft.lifecycleStatus == "published" else "编辑中"]],
    ))
    lines.append("")

    _section(lines, "2. 零件结构和生成逻辑")
    lines.extend([
        "这个模板的生成逻辑可以理解为：先建立截面草图，再根据几何配方生成主体，最后按照制造规则增加孔、槽或其他加工特征。",
        "",
        f"草图位于 `{draft.sketch.plane}` 平面，轮廓类型为 `{draft.sketch.profileMode}`。当前共配置 {len(draft.geometryRecipe.operations)} 个基础几何操作和 {len(draft.featureRules)} 条制造规则。",
        "",
    ])
    if draft.geometryRecipe.operations:
        lines.extend(["生成顺序：", ""])
        for index, operation in enumerate(draft.geometryRecipe.operations, start=1):
            lines.append(f"{index}. {OPERATOR_LABELS.get(operation.operator, operation.operator)}，使用 {', '.join(operation.sourceRefs) or '当前草图'} 作为输入。")
        lines.append("")

    _section(lines, "3. 参数填写指南")
    lines.extend(["参数是用户控制零件尺寸和行为的入口。优先填写带有明确单位的参数；修改后，应重新执行受影响阶段的检查。", ""])
    lines.extend(_table(
        ["参数名称", "填写值", "单位", "建议范围", "这个参数控制什么", "修改后影响"],
        [[item.label or item.id, item.default, item.unit or "-", f"{item.minimum or '-'} ～ {item.maximum or '-'}", f"控制 {item.label or item.id} 的尺寸或行为。", _parameter_effects(draft, item.id)] for item in draft.parameterDefinitions],
    ))
    lines.extend(["", "参数填写注意：", "", "- 数值必须使用文档规定的单位；没有单位时不要直接猜测单位。", "- 如果参数由材料属性驱动，不要在参数区强行覆盖，应先确认材料样例。", "- 修改长度、宽度、厚度等关键尺寸后，应重新检查草图自由度、几何生成和 CAD 编译。", ""])

    _section(lines, "4. 材料和制造方式")
    lines.extend([f"主要制造路线：{route}。", ""])
    if draft.materialRequirements:
        for item in draft.materialRequirements:
            thickness = item.thickness
            lines.append(f"- 材料要求：{', '.join(item.familyTags) or '按材料类别选择'}；供货形态为 {item.supplyForm}；选择模式为 {item.selectionMode}。")
            lines.append(f"  厚度由参数 `{thickness.parameterId}` 驱动，允许范围为 {thickness.minimum or '-'} ～ {thickness.maximum or '-'}，允许值为 {', '.join(map(str, thickness.allowedValues)) or '按上下限判断'}。")
    else:
        lines.append("当前模板还没有填写材料要求。")
    lines.extend(["", f"毛坯尺寸关系：长度使用 `{draft.blank.lengthExpression}`，宽度使用 `{draft.blank.widthExpression}`，厚度使用 `{draft.blank.thicknessExpression}`。", ""])

    _section(lines, "5. 草图绘制步骤")
    lines.extend([
        f"1. 在 `{draft.sketch.plane}` 平面创建草图。",
        f"2. 按模板截面轮廓绘制 {len(draft.sketch.entities)} 个图元；当前包含 {sum(item.geometryType == 'line' for item in draft.sketch.entities)} 条直线和 {sum(item.geometryType == 'arc' for item in draft.sketch.entities)} 段圆弧。",
        f"3. 按草图中的尺寸和几何关系添加 {len(draft.sketch.constraints)} 个约束。",
        f"4. 确认轮廓区域数量为 {len(draft.sketch.regions)}，需要闭合的区域必须保持闭合。",
        "5. 分别检查最小、标称和最大工况，三个工况都应可求解，且自由度应为 0。",
        "",
        "草图不是只要画出外形就可以。后续几何和加工规则依赖稳定的图元、区域和约束关系，因此建议先完成约束，再进入下一阶段。",
        "",
    ])

    _section(lines, "6. 几何生成步骤")
    lines.extend(["按以下顺序复现几何：", ""])
    for index, operation in enumerate(draft.geometryRecipe.operations, start=1):
        lines.append(f"{index}. 使用“{OPERATOR_LABELS.get(operation.operator, operation.operator)}”生成基础实体。输入来源为 {', '.join(operation.sourceRefs) or '当前草图'}。")
    if not draft.geometryRecipe.operations:
        lines.append("当前模板尚未配置几何生成操作。")
    lines.extend(["", "完成后检查生成结果是否为有效实体，并确认语义面仍能被后续加工规则找到。", ""])

    _section(lines, "7. 自动规则")
    if draft.featureRules:
        for rule in draft.featureRules:
            feature = FEATURE_LABELS.get(rule.featureType, rule.featureType)
            lines.extend([f"### {rule.name or rule.id}", "", f"作用：自动生成{feature}。", f"触发条件：{rule.conditionExpression or '始终执行'}。", f"生成数量：{rule.countExpression or '由规则默认值决定'}。", f"参数：{', '.join(rule.argumentExpressions.keys()) or '使用规则默认参数'}。", f"加工区域：{', '.join(binding.semanticFaceId for binding in rule.faceBindings) or '未指定语义面'}。", ""])
    else:
        lines.extend(["当前模板没有配置自动加工规则。", ""])

    _section(lines, "8. 变体和接口")
    if draft.variants:
        lines.extend([f"模板包含 {len(draft.variants)} 个变体。变体通过覆盖部分参数，生成同一零件的不同规格。", ""])
        lines.extend(_table(["变体名称", "覆盖参数"], [[item.name or item.id, ", ".join(item.overrides) or "无"] for item in draft.variants]))
    else:
        lines.append("当前模板没有额外变体，仅使用 nominal 基准实例。")
    lines.extend(["", f"当前定义 {len(draft.interfaces)} 个对外接口。接口用于让其他模板或实例引用本零件的参数、几何面或规则结果。", ""])

    _section(lines, "9. 完整复现流程")
    lines.extend(["1. 创建模板，填写名称、用途、设计意图、制造方式和材料要求。", "2. 按第 3 节建立参数，并保持参数的单位、范围和默认值一致。", "3. 按第 5 节建立草图，添加尺寸和几何约束，确认三个工况自由度为 0。", "4. 按第 6 节配置基础几何，确认生成实体和语义面。", "5. 按第 7 节建立加工规则，确认规则的触发条件、参数和作用区域。", "6. 建立变体和接口，执行规则求值和 CAD 编译。", "7. 按下一节处理所有失败检查项，完成验证后填写复核人和版本说明。", ""])

    _section(lines, "10. 常见错误排查")
    failures = [(stage, item) for stage, validation in validations.items() for item in validation.checks if not item.passed and item.severity == "error"]
    if not failures:
        lines.extend(["当前没有未通过的阻断性检查项，可以继续进行发布。", ""])
    else:
        for stage, item in failures:
            lines.extend([f"### {STAGE_FRIENDLY_LABELS.get(stage, stage)}：{item.label}", "", f"现象：{item.message}", f"处理：{_validation_recommendation(stage, item.id)}", f"技术定位：`{item.path}`（检查项 `{item.id}`）", ""])

    lines.extend(_build_technical_appendix(draft, solution, validations))
    return "\n".join(lines).rstrip() + "\n"
