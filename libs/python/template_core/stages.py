from __future__ import annotations

from typing import Any

from .models import CompileResult, StageCheck, StageName, StageValidation, TemplateDraft
from .stage1 import template_info_fingerprint, validate_template_info
from .rules import RuleEvaluationError, evaluate_template, expression_names, parameter_evaluation_order
from .material import effective_thickness_domain, material_requirement_mismatches
from .sketch_solver import solve_semantic_sketch


STAGE_ORDER: tuple[StageName, ...] = ("templateInfo", "material", "baseSketch", "features", "variants", "review", "admission")


def _collect_expression_names(expressions: list[str]) -> tuple[set[str], bool]:
    names: set[str] = set()
    syntax_valid = True
    for expression in expressions:
        try:
            names |= expression_names(expression)
        except RuleEvaluationError:
            syntax_valid = False
    return names, syntax_valid


def _geometry_parameter_references(draft: TemplateDraft) -> tuple[set[str], bool]:
    expressions: list[str] = []
    for operation in draft.geometryRecipe.operations:
        expressions.extend([*operation.argumentExpressions.values(), operation.conditionExpression])
        for structured_name in ("pathPoints", "stations"):
            structured = operation.arguments.get(structured_name)
            if isinstance(structured, str):
                expressions.extend(
                    component.strip()
                    for row in structured.split(";")
                    for component in row.split(":")
                    if component.strip()
                )
    for face in draft.geometryRecipe.semanticFaces:
        expressions.extend([
            face.uStartExpression,
            face.uSpanExpression,
            face.vStartExpression,
            face.vSpanExpression,
        ])
    return _collect_expression_names(expressions)


def _validation(stage: StageName, checks: list[StageCheck]) -> StageValidation:
    blocking = [item for item in checks if item.severity == "error"]
    progress = round(sum(item.passed for item in blocking) / len(blocking) * 100) if blocking else 100
    return StageValidation(stage=stage, complete=all(item.passed for item in blocking), progress=progress, checks=checks)


def validate_material(draft: TemplateDraft, sample_contexts: list[dict[str, Any]] | None = None) -> StageValidation:
    requirements = draft.materialRequirements
    requirement_complete = bool(requirements and all(item.supplyForm and item.reviewed for item in requirements))
    requires_specific = any(item.selectionMode == "specificRecord" for item in requirements)
    specific_resolved = not requires_specific or all(item.specificBindingId for item in requirements if item.selectionMode == "specificRecord")
    contexts = sample_contexts or []
    samples_resolved = len(contexts) == len(draft.materialValidationSamples)
    thickness = requirements[0].thickness if requirements else None
    thickness_domain = effective_thickness_domain(requirements[0]) if requirements else {"values": [], "minimum": None, "maximum": None, "empty": False}
    boundary_matrix_required = bool(thickness and (len(thickness_domain["values"]) > 1 or (thickness_domain["minimum"] is not None and thickness_domain["maximum"] is not None and thickness_domain["minimum"] != thickness_domain["maximum"])))
    required_roles = {"nominal", "minimum", "maximum"} if boundary_matrix_required else {"nominal"}
    samples_by_role = {item.role: item for item in draft.materialValidationSamples}
    required_samples_complete = required_roles <= set(samples_by_role) and all(samples_by_role[role].reviewed for role in required_roles)
    mismatches = [reason for context in contexts for reason in context.get("mismatches", [])]
    contexts_by_sample = {item.get("sampleId"): item for item in contexts}
    boundary_mismatches: list[str] = []
    if thickness:
        lower = thickness_domain["minimum"]
        upper = thickness_domain["maximum"]
        for role, expected, label in (("minimum", lower, "最小"), ("maximum", upper, "最大")):
            sample = samples_by_role.get(role)
            context = contexts_by_sample.get(sample.id) if sample else None
            actual = context.get("material", {}).get("thickness") if context else None
            if sample and expected is not None and (actual is None or abs(float(actual) - float(expected)) > 1e-9):
                boundary_mismatches.append(f"{label}边界样例厚度应为 {expected} mm，当前为 {actual if actual is not None else '未定义'}")
    if requires_specific:
        specific_ids = {item.specificBindingId for item in requirements if item.selectionMode == "specificRecord"}
        if any(sample.bindingId not in specific_ids for sample in draft.materialValidationSamples):
            mismatches.append("验证样例不是模板指定的唯一材料记录")
    drifted = any(bool(context.get("provenance", {}).get("drifted")) for context in contexts)
    thickness_parameter = next((item for item in draft.parameterDefinitions if thickness and item.id == thickness.parameterId), None)
    parameter_source = thickness_parameter.sourceDefinition if thickness_parameter else None
    parameter_bound = bool(thickness_parameter and parameter_source and parameter_source.type == "materialProperty" and parameter_source.reference == "material.thickness")
    parameter_covers_domain = bool(thickness_parameter)
    if thickness_parameter:
        lower, upper = thickness_domain["minimum"], thickness_domain["maximum"]
        if lower is not None and thickness_parameter.minimum is not None and lower < thickness_parameter.minimum:
            parameter_covers_domain = False
        if upper is not None and thickness_parameter.maximum is not None and upper > thickness_parameter.maximum:
            parameter_covers_domain = False
        if thickness_domain["values"] and thickness_parameter.allowedValues and not set(thickness_domain["values"]) <= {float(value) for value in thickness_parameter.allowedValues if isinstance(value, (int, float)) and not isinstance(value, bool)}:
            parameter_covers_domain = False
    blank_preparation_ok = draft.blank.preparationMode == "sameAsSupply" or any(item != "none" for item in draft.blank.preparationProcesses)
    declared_parameters = {item.id for item in draft.parameterDefinitions}
    blank_expressions_valid = True
    blank_expression_unknown: set[str] = set()
    for expression in (draft.blank.lengthExpression, draft.blank.widthExpression, draft.blank.thicknessExpression):
        try:
            blank_expression_unknown |= expression_names(expression) - declared_parameters
        except RuleEvaluationError:
            blank_expressions_valid = False
    checks = [
        StageCheck(id="material-requirement", label="材料需求已定义", passed=requirement_complete, severity="error", path="materialRequirements", message="请定义材料类别、厚度约束并人工确认。"),
        StageCheck(id="thickness-domain", label="有效厚度域可求解", passed=not thickness_domain["empty"], severity="error", path="materialRequirements.0.thickness", message="允许厚度值与厚度上下限没有交集，请调整厚度约束。"),
        StageCheck(id="thickness-parameter-binding", label="厚度参数由材料驱动", passed=parameter_bound, severity="error", path="parameterDefinitions", message="厚度驱动参数必须存在，并引用 material.thickness。"),
        StageCheck(id="thickness-parameter-domain", label="参数契约覆盖有效厚度域", passed=parameter_covers_domain, severity="error", path="parameterDefinitions", message="厚度参数自身的允许值或上下限排除了材料有效厚度域，请统一参数契约。"),
        StageCheck(id="specific-material", label="指定材料记录已解析", passed=specific_resolved, severity="error", path="materialRequirements", message="选择具体材料模式时必须绑定材料记录。"),
        StageCheck(id="validation-samples", label="必需材料样例已确认", passed=required_samples_complete and samples_resolved, severity="error", path="materialValidationSamples", message=f"请添加并确认：{'、'.join(sorted(required_roles))}材料样例。"),
        StageCheck(id="sample-compatibility", label="验证样例满足材料要求", passed=not mismatches, severity="error", path="materialValidationSamples", message=f"样例与材料要求不匹配：{'；'.join(sorted(set(mismatches))) or '无'}。"),
        StageCheck(id="boundary-sample-thickness", label="材料样例覆盖厚度边界", passed=not boundary_mismatches, severity="error", path="materialValidationSamples", message="；".join(boundary_mismatches) or "最小与最大材料样例已覆盖厚度边界。"),
        StageCheck(id="blank-form", label="制造起始毛坯已定义", passed=bool(draft.blank.form), severity="error", path="blank.form", message="请选择制造过程开始时的毛坯形态。"),
        StageCheck(id="blank-preparation", label="毛坯准备关系完整", passed=blank_preparation_ok, severity="error", path="blank.preparationProcesses", message="选择独立毛坯时必须定义至少一道准备工序。"),
        StageCheck(id="blank-expressions", label="毛坯尺寸表达式有效", passed=blank_expressions_valid and not blank_expression_unknown, severity="error", path="blank", message=f"毛坯尺寸只能引用已声明参数：{', '.join(sorted(blank_expression_unknown)) or '请检查表达式语法'}。"),
        StageCheck(id="route", label="制造路线已定义", passed=bool(draft.blank.manufacturingRoute), severity="error", path="blank.manufacturingRoute", message="请选择主要制造路线。"),
        StageCheck(id="material-drift", label="材料来源无漂移", passed=not drifted, severity="warning", path="materialValidationSamples", message="引用样例材料已变化；发布前应重新确认或改为冻结快照。"),
    ]
    return _validation("material", checks)


def validate_base_sketch(draft: TemplateDraft) -> StageValidation:
    required, expression_syntax_valid = _geometry_parameter_references(draft)
    known_parameters = {item.id for item in draft.parameterDefinitions}
    expressions_valid = expression_syntax_valid and required <= known_parameters
    missing = required - known_parameters
    source_ok = (
        draft.sketch.acquisitionMethod not in {"imported", "reused"}
        or bool(draft.sketch.sourceAttachmentId or draft.sketch.sourceProfileId)
    )
    conversion_ok = draft.sketch.acquisitionMethod not in {"imported", "reused"} or draft.sketch.conversionReviewed
    entity_ids = {item.id for item in draft.sketch.entities}
    semantic_entities_ok = bool(entity_ids) and all(item.role and set(item.parameterRefs) <= known_parameters for item in draft.sketch.entities)
    constraints_ok = bool(draft.sketch.constraints) and all(set(item.entityRefs) <= entity_ids for item in draft.sketch.constraints)
    regions_ok = (
        (
            bool(draft.sketch.regions)
            and all(item.closed and set(item.boundaryRefs) <= entity_ids for item in draft.sketch.regions)
        )
        or bool([item for item in draft.sketch.entities if not item.construction])
        if draft.sketch.profileMode == "centerlineThinWall"
        else bool(draft.sketch.regions) and all(item.closed and set(item.boundaryRefs) <= entity_ids for item in draft.sketch.regions)
    )
    sketch_solution = solve_semantic_sketch(draft)
    supported_operators = {
        "sketch.region_extrude", "sketch.centerline_thinwall_extrude",
        "sheet.blank_extrude", "profile.rectangular_tube_extrude",
        "solid.revolve", "solid.sweep", "solid.loft", "sheet.bend",
    }
    operators_supported = all(
        operation.operator in supported_operators
        for operation in draft.geometryRecipe.operations
    )
    operator_inputs_ok = True
    operator_input_messages: list[str] = []
    for operation in draft.geometryRecipe.operations:
        keys = set(operation.arguments) | set(operation.argumentExpressions)
        required_keys = {
            "solid.revolve": {"angleDegrees"},
            "solid.sweep": {"pathPoints"},
            "solid.loft": {"stations"},
            "sheet.bend": {"length", "width", "thickness", "bendPosition", "bendAngleDegrees", "insideRadius", "kFactor"},
        }.get(operation.operator, set())
        missing_keys = required_keys - keys
        if missing_keys:
            operator_inputs_ok = False
            operator_input_messages.append(f"{operation.id} 缺少 {', '.join(sorted(missing_keys))}")
    checks = [
        StageCheck(id="driving-parameters", label="几何驱动参数完整", passed=expressions_valid, severity="error", path="geometryRecipe.operations", message=f"几何配方表达式无效，或引用了未声明参数：{', '.join(sorted(missing)) or '请检查表达式语法'}。草图驱动参数只需包含轮廓自身使用的参数。"),
        StageCheck(id="semantic-entities", label="语义图元契约完整", passed=semantic_entities_ok, severity="error", path="sketch.entities", message="请为草图图元定义稳定语义名称，并只引用已声明参数。"),
        StageCheck(id="semantic-constraints", label="草图约束引用有效", passed=constraints_ok, severity="error", path="sketch.constraints", message="草图必须包含有效约束，且约束只能引用已有语义图元。"),
        StageCheck(id="semantic-regions", label="截面材料区域已定义", passed=regions_ok, severity="error", path="sketch.regions", message="闭合轮廓模式需定义材料区域；中心线薄壁模式需定义连续的直线／圆弧路径。"),
        StageCheck(id="sketch-solver", label="语义草图可求解", passed=sketch_solution["valid"], severity="error", path="sketch", message="；".join(item["message"] for item in sketch_solution["diagnostics"] if item["severity"] == "error") or "最小、标称和最大草图工况均可求解。"),
        StageCheck(id="sketch-degrees-of-freedom", label="语义草图完全约束", passed=sketch_solution["fullyConstrained"], severity="error", path="sketch.constraints", message=f"当前剩余自由度：{sketch_solution['degreesOfFreedom']}；请补齐语义段或约束。"),
        StageCheck(id="constraints-reviewed", label="约束已人工确认", passed=draft.sketch.constraintsReviewed, severity="error", path="sketch.constraintsReviewed", message="请确认截面尺寸、相切与闭合关系。"),
        StageCheck(id="sketch-source", label="草图来源可追溯", passed=source_ok, severity="error", path="sketch.sourceAttachmentId", message="导入转换必须关联来源附件；受控复用必须关联来源截面。"),
        StageCheck(id="sketch-conversion", label="来源转换已复核", passed=conversion_ok, severity="error", path="sketch.conversionReviewed", message="导入或复用的轮廓必须完成语义转换并人工复核。"),
        StageCheck(id="geometry-recipe", label="基础几何配方已建立", passed=bool(draft.geometryRecipe.operations), severity="error", path="geometryRecipe.operations", message="基础几何必须至少包含一个拉伸、旋转、扫掠、放样、钣金或派生操作。"),
        StageCheck(id="geometry-operators-supported", label="几何算子均已实现", passed=operators_supported, severity="error", path="geometryRecipe.operations", message="当前配方包含CAD内核尚未实现的算子。"),
        StageCheck(id="geometry-operator-inputs", label="几何算子输入完整", passed=operator_inputs_ok, severity="error", path="geometryRecipe.operations", message="；".join(operator_input_messages) or "算子输入完整。"),
        StageCheck(id="geometry-reviewed", label="基础几何配方已确认", passed=draft.geometryRecipe.reviewed, severity="error", path="geometryRecipe.reviewed", message="请人工确认基础几何的构造方式和语义输出。"),
    ]
    return _validation("baseSketch", checks)


def validate_features(draft: TemplateDraft) -> StageValidation:
    evaluation = evaluate_template(
        draft.parameterDefinitions, draft.featureRules,
        semantic_faces=draft.geometryRecipe.semanticFaces,
        interfaces=draft.interfaces,
    )
    rule_ok = not any(item.severity == "error" for item in evaluation.diagnostics)
    checks = [
        StageCheck(id="feature-review", label="制造特征规则已确认", passed=draft.featureRulesReviewed, severity="error", path="featureRulesReviewed", message="即使零件没有制造特征，也需确认规则集合为空。"),
        StageCheck(id="feature-count", label="制造特征规则已建立", passed=len(draft.featureRules) > 0, severity="warning", path="featureRules", message="当前为无制造特征零件。"),
        StageCheck(id="feature-rules", label="制造特征规则可求值", passed=rule_ok, severity="error", path="featureRules", message="特征数量、条件或坐标表达式无法安全求值。"),
        StageCheck(id="resolved-rule-set", label="规则解析结果已检查", passed=not draft.featureRules or len(evaluation.features) > 0, severity="warning", path="featureRules", message="当前标称参数下，特征规则生成了空集合。"),
    ]
    return _validation("features", checks)


def validate_variants(draft: TemplateDraft) -> StageValidation:
    ids = [item.id for item in draft.parameterDefinitions]
    parameter_ids = set(ids)
    variant_ids = [item.id for item in draft.variants]
    override_keys = {key for item in draft.variants for key in item.overrides}
    try:
        parameter_evaluation_order(draft.parameterDefinitions)
        dependency_ok = True
    except RuleEvaluationError:
        dependency_ok = False
    sources_complete = all(item.sourceDefinition is not None for item in draft.parameterDefinitions)
    contract_ready = all(
        not item.declaredInRuleStage or item.contractReady
        for item in draft.parameterDefinitions
    )
    geometry_references, geometry_expressions_valid = _geometry_parameter_references(draft)
    geometry_contract_ok = geometry_expressions_valid and geometry_references <= parameter_ids
    semantic_face_ids = {item.id for item in draft.geometryRecipe.semanticFaces}
    feature_rule_ids = {item.id for item in draft.featureRules}
    invalid_variant_overrides: list[str] = []
    for variant in draft.variants:
        if variant.expected != "valid":
            continue
        evaluation = evaluate_template(draft.parameterDefinitions, [], overrides=variant.overrides)
        if any(item.severity == "error" for item in evaluation.diagnostics):
            invalid_variant_overrides.append(variant.id)
    interface_parameter_refs = {
        parameter_id
        for item in draft.interfaces
        for parameter_id in item.parameterRefs
    }
    interface_geometry_refs = {
        geometry_id
        for item in draft.interfaces
        for geometry_id in [
            *item.geometryRefs,
            *( [item.referenceFrame.originRef] if item.referenceFrame.originRef else [] ),
        ]
    }
    interface_parameters_ok = interface_parameter_refs <= parameter_ids
    interface_geometry_ok = interface_geometry_refs <= semantic_face_ids
    interface_rule_sources_ok = all(
        item.declarationMode != "featureDerived"
        or bool(item.sourceFeatureRuleId and item.sourceFeatureRuleId in feature_rule_ids)
        for item in draft.interfaces
    )
    checks = [
        StageCheck(id="geometry-parameter-contract", label="几何参数契约完整", passed=geometry_contract_ok, severity="error", path="parameterDefinitions", message=f"几何配方与语义面只能引用已声明参数：{', '.join(sorted(geometry_references - parameter_ids)) or '请检查表达式语法'}。"),
        StageCheck(id="parameter-ids", label="参数标识唯一", passed=len(ids) == len(set(ids)), severity="error", path="parameterDefinitions", message="参数标识不能重复。"),
        StageCheck(id="nominal-variant", label="标称实例已定义", passed="nominal" in variant_ids, severity="error", path="variants", message="必须保留 nominal 标称实例。"),
        StageCheck(id="variant-ids", label="变体标识唯一", passed=len(variant_ids) == len(set(variant_ids)), severity="error", path="variants", message="变体标识不能重复。"),
        StageCheck(id="override-keys", label="变体覆盖参数有效", passed=override_keys <= parameter_ids, severity="error", path="variants", message="变体只能覆盖已声明参数。"),
        StageCheck(id="variant-overrides-evaluable", label="有效变体参数可求值", passed=not invalid_variant_overrides, severity="error", path="variants", message=f"以下有效变体的参数覆盖无法通过类型、范围或依赖检查：{', '.join(invalid_variant_overrides) or '无'}。"),
        StageCheck(id="interface-parameter-refs", label="接口参数引用有效", passed=interface_parameters_ok, severity="error", path="interfaces", message=f"接口只能引用已声明参数：{', '.join(sorted(interface_parameter_refs - parameter_ids)) or '无缺失参数'}。"),
        StageCheck(id="interface-geometry-refs", label="接口几何引用有效", passed=interface_geometry_ok, severity="error", path="interfaces", message=f"接口只能引用已声明语义面：{', '.join(sorted(interface_geometry_refs - semantic_face_ids)) or '无缺失语义面'}。"),
        StageCheck(id="interface-rule-sources", label="特征派生接口来源有效", passed=interface_rule_sources_ok, severity="error", path="interfaces", message="特征派生接口必须选择已有制造特征规则。"),
        StageCheck(id="parameter-sources", label="参数来源完整", passed=sources_complete, severity="error", path="parameterDefinitions", message="每个参数必须声明用户输入、材料属性、公式、查表或外部配置来源。"),
        StageCheck(id="parameter-contract-ready", label="规则预声明参数已补全契约", passed=contract_ready, severity="error", path="parameterDefinitions", message="规则页预声明的参数需要在契约页补全后，才能进入试算、验证与发布。"),
        StageCheck(id="parameter-dependency", label="参数依赖图有效", passed=dependency_ok, severity="error", path="parameterDefinitions", message="参数存在未知依赖或循环依赖。"),
    ]
    return _validation("variants", checks)


def validate_review(draft: TemplateDraft, compile_result: CompileResult | None, expected_hash: str | None) -> StageValidation:
    result_ok = bool(compile_result and compile_result.success)
    hash_ok = bool(result_ok and expected_hash and compile_result and compile_result.inputHash == expected_hash)
    metrics_ok = bool(result_ok and compile_result and compile_result.metrics and compile_result.metrics.valid and compile_result.metrics.solidCount == 1)
    checks = [
        StageCheck(id="compile-success", label="真实CAD编译成功", passed=result_ok, severity="error", path="compile", message="请运行 OpenCascade 编译并修复全部错误。"),
        StageCheck(id="current-input", label="审查结果对应当前输入", passed=hash_ok, severity="error", path="compile.inputHash", message="上游定义已变化，请重新编译。"),
        StageCheck(id="brep-valid", label="B-Rep 拓扑有效", passed=metrics_ok, severity="error", path="compile.metrics", message="要求有效单实体且体积为正。"),
    ]
    return _validation("review", checks)


def validate_admission(draft: TemplateDraft, review: StageValidation) -> StageValidation:
    upstream = all(getattr(draft.stageStatus, stage) == "complete" for stage in STAGE_ORDER[:-1])
    checks = [
        StageCheck(id="upstream-complete", label="前置阶段全部完成", passed=upstream, severity="error", path="stageStatus", message="模板信息至三维审查必须全部完成。"),
        StageCheck(id="review-current", label="当前几何通过审查", passed=review.complete, severity="error", path="review", message="当前输入必须有成功的CAD审查结果。"),
        StageCheck(id="reviewer", label="发布复核人已指定", passed=len(draft.admission.reviewer.strip()) >= 2, severity="error", path="admission.reviewer", message="请填写发布复核人。"),
        StageCheck(id="change-note", label="版本说明完整", passed=len(draft.admission.changeNote.strip()) >= 5, severity="error", path="admission.changeNote", message="请填写本版本的变更与适用范围。"),
    ]
    return _validation("admission", checks)


def validate_stage(stage: StageName, draft: TemplateDraft, *, code_unique: bool = True, material_samples: list[dict[str, Any]] | None = None, compile_result: CompileResult | None = None, expected_hash: str | None = None) -> StageValidation:
    if stage == "templateInfo":
        return validate_template_info(draft, code_unique=code_unique)
    if stage == "material":
        return validate_material(draft, material_samples)
    if stage == "baseSketch":
        return validate_base_sketch(draft)
    if stage == "features":
        return validate_features(draft)
    if stage == "variants":
        return validate_variants(draft)
    review = validate_review(draft, compile_result, expected_hash)
    return review if stage == "review" else validate_admission(draft, review)


def stage_fingerprint(stage: StageName, draft: TemplateDraft) -> tuple:
    if stage == "templateInfo":
        return template_info_fingerprint(draft)
    if stage == "material":
        return (tuple(item.model_dump_json() for item in draft.materialRequirements), tuple(item.model_dump_json() for item in draft.materialValidationSamples), draft.blank.model_dump_json())
    if stage == "baseSketch":
        return (draft.geometryPrototypeId, draft.sketch.model_dump_json(), draft.geometryRecipe.model_dump_json(), tuple(item.model_dump_json() for item in draft.parameterDefinitions))
    if stage == "features":
        return (draft.featureRulesReviewed, tuple(item.model_dump_json() for item in draft.featureRules))
    if stage == "variants":
        return tuple(item.model_dump_json() for item in draft.parameterDefinitions + draft.variants + draft.interfaces)
    if stage == "admission":
        return (draft.admission.model_dump_json(),)
    return ()
