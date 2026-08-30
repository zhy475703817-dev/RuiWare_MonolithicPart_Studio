import pytest
import json
from pathlib import Path
from fastapi.testclient import TestClient

from cad_worker.geometry import execute_plan
from template_core.lowering import lower_to_plan
from template_core.metamodel import FeatureRule, ParameterDefinition, ParameterSource, PartInterface
from template_core.models import SemanticSketchConstraint, SemanticSketchEntity, TemplateDraft
from template_core.rules import RuleEvaluationError, evaluate_expression, evaluate_template, expression_names, parameter_evaluation_order
from template_core.stages import validate_stage
from template_core.sketch_solver import solve_semantic_sketch


def omega_rule_draft(length: float = 2400) -> TemplateDraft:
    return TemplateDraft.model_validate({
        "name": "Ω型立柱规则模板",
        "featureRulesReviewed": True,
        "parameterDefinitions": [
            {"id": "length", "label": "长度", "default": length, "minimum": 1000, "maximum": 6000},
            {"id": "width", "label": "截面宽度", "default": 90, "minimum": 80, "maximum": 120},
            {"id": "depth", "label": "截面深度", "default": 70, "minimum": 60, "maximum": 100},
            {"id": "lip", "label": "返边", "default": 20, "minimum": 10, "maximum": 30},
            {"id": "thickness", "label": "壁厚", "default": 2, "minimum": 1.5, "maximum": 3},
            {"id": "endMargin", "label": "端距", "default": 100, "minimum": 80, "maximum": 200},
            {"id": "maxPitch", "label": "最大孔距", "default": 300, "minimum": 200, "maximum": 500},
            {
                "id": "holeCount", "label": "孔数量", "valueType": "integer", "unit": "count",
                "default": 8, "minimum": 2, "maximum": 50, "source": "formula",
                "sourceDefinition": {"type": "formula", "expression": "max(2, floor((length - 2 * endMargin) / maxPitch) + 1)"},
            },
        ],
        "featureRules": [{
            "id": "upright.mainHoleRow", "name": "主孔列", "featureType": "circularHole",
            "countExpression": "holeCount",
            "arguments": {"x": 0, "diameter": 12},
            "argumentExpressions": {"z": "endMargin"},
            "placement": {"mode": "equalSpan", "axis": "v", "startMarginExpression": "endMargin", "endMarginExpression": "endMargin"},
        }],
    })


def test_safe_expression_accepts_engineering_math_and_rejects_code() -> None:
    assert evaluate_expression("max(2, floor((length - 2 * margin) / pitch) + 1)", {"length": 2400, "margin": 100, "pitch": 300}) == 8
    assert evaluate_expression("10 if length > 1000 else 4", {"length": 2400}) == 10
    with pytest.raises(RuleEvaluationError):
        evaluate_expression("__import__('os').system('echo unsafe')", {})
    with pytest.raises(RuleEvaluationError):
        evaluate_expression("[x for x in range(100)]", {})


def test_parameter_labels_recover_legacy_utf8_mojibake() -> None:
    legacy = "长度".encode("utf-8").decode("latin1")
    parameter = ParameterDefinition(id="length", label=legacy, displayName=legacy, default=100, minimum=1, maximum=1000)
    assert parameter.label == "长度"
    assert parameter.displayName == "长度"


def test_parameter_default_matches_declared_value_type() -> None:
    enabled = ParameterDefinition(id="enabled", label="启用", valueType="boolean", default="false", minimum=0, maximum=1)
    assert enabled.default is False
    assert enabled.minimum is None and enabled.maximum is None

    finish = ParameterDefinition(id="finish", label="表面", valueType="enum", default="powder", allowedValues=["paint", "powder"])
    assert finish.default == "powder"
    assert finish.allowedValues == ["paint", "powder"]

    note = ParameterDefinition(id="note", label="备注", valueType="string", default=42)
    assert note.default == "42"
    with pytest.raises(ValueError, match="boolean"):
        ParameterDefinition(id="invalid", label="无效", valueType="boolean", default="maybe")


def test_part_interface_declares_single_part_geometry() -> None:
    locating = PartInterface(id="upright.bottom.primary", name="主定位", interfaceType="locating", geometryRefs=["part.face.front"])
    assert locating.locatingType == "planeContact"
    assert locating.role == "primary"


def test_feature_derived_interface_tracks_resolved_feature_count() -> None:
    short = omega_rule_draft(2400)
    long = omega_rule_draft(3600)
    interface = PartInterface(
        id="upright.connection.holeRow",
        name="连接孔接口",
        declarationMode="featureDerived",
        sourceFeatureRuleId="upright.mainHoleRow",
        interfaceType="connecting",
    )
    short.interfaces = [interface]
    long.interfaces = [interface]

    short_evaluation = evaluate_template(short.parameterDefinitions, short.featureRules, interfaces=short.interfaces)
    long_evaluation = evaluate_template(long.parameterDefinitions, long.featureRules, interfaces=long.interfaces)

    assert short_evaluation.success
    assert len(short_evaluation.resolvedInterfaces) == 8
    assert len(long_evaluation.resolvedInterfaces) == 12
    assert short_evaluation.resolvedInterfaces[0].id == "upright.connection.holeRow.part_face_front.001"
    assert short_evaluation.resolvedInterfaces[0].sourceFeatureId == "upright.mainHoleRow.part_face_front.001"


def test_feature_derived_interface_requires_existing_feature_rule() -> None:
    draft = omega_rule_draft()
    draft.interfaces = [PartInterface(
        id="upright.connection.missing",
        name="缺失来源",
        declarationMode="featureDerived",
        sourceFeatureRuleId="missing.rule",
        interfaceType="connecting",
    )]
    evaluation = evaluate_template(draft.parameterDefinitions, draft.featureRules, interfaces=draft.interfaces)
    assert not evaluation.success
    assert any(item.code == "INTERFACE_RULE_EVALUATION_FAILED" for item in evaluation.diagnostics)


def test_dependency_graph_is_deterministic_and_rejects_cycles() -> None:
    definitions = [
        ParameterDefinition(id="a", label="A", default=2, minimum=0, maximum=10),
        ParameterDefinition(id="b", label="B", default=4, minimum=0, maximum=20, sourceDefinition=ParameterSource(type="formula", expression="a * 2")),
        ParameterDefinition(id="c", label="C", default=5, minimum=0, maximum=30, sourceDefinition=ParameterSource(type="formula", expression="b + 1")),
    ]
    assert parameter_evaluation_order(definitions) == ["a", "b", "c"]
    evaluation = evaluate_template(definitions, [])
    assert evaluation.success
    assert evaluation.values == {"a": 2.0, "b": 4.0, "c": 5.0}

    definitions[0].sourceDefinition = ParameterSource(type="formula", expression="c + 1")
    with pytest.raises(RuleEvaluationError, match="cyclic"):
        parameter_evaluation_order(definitions)


def test_material_property_and_lookup_parameter_sources() -> None:
    definitions = [
        ParameterDefinition(
            id="thickness", label="板厚", default=2, minimum=1, maximum=5,
            sourceDefinition=ParameterSource(type="materialProperty", reference="material.thickness"),
        ),
        ParameterDefinition(
            id="bendRadius", label="折弯半径", default=3, minimum=1, maximum=20,
            sourceDefinition=ParameterSource(type="lookup", reference="thickness", lookupTable={"2.0": 3, "3.0": 4.5}),
        ),
    ]
    evaluation = evaluate_template(definitions, [], external_context={"material": {"thickness": 2}})
    assert evaluation.success
    assert evaluation.values == {"thickness": 2.0, "bendRadius": 3.0}


def test_upstream_parameter_sources_use_context_then_fallback_then_default() -> None:
    definitions = [
        ParameterDefinition(
            id="componentSpan", label="组件跨度", default=1200, minimum=500, maximum=3000,
            sourceDefinition=ParameterSource(type="componentConfig", reference="component.span", fallback=1100),
            scope="component", exposed=False,
        ),
        ParameterDefinition(
            id="productLevels", label="产品层数", valueType="integer", unit="count", default=4, minimum=1, maximum=12,
            sourceDefinition=ParameterSource(type="productConfig", reference="product.levels"),
            scope="product", exposed=False,
        ),
    ]
    supplied = evaluate_template(
        definitions,
        [],
        external_context={"component": {"span": 1800}, "product": {"levels": 6}},
    )
    assert supplied.values == {"componentSpan": 1800.0, "productLevels": 6}

    missing = evaluate_template(definitions, [], external_context={})
    assert missing.success
    assert missing.values == {"componentSpan": 1100.0, "productLevels": 4}

    overridden = evaluate_template(definitions, [], overrides={"componentSpan": 2000})
    assert overridden.values["componentSpan"] == 2000.0


def test_omega_length_changes_resolved_hole_count_and_static_topology(tmp_path) -> None:
    short = omega_rule_draft(2400)
    long = omega_rule_draft(3600)
    short_eval = evaluate_template(short.parameterDefinitions, short.featureRules)
    long_eval = evaluate_template(long.parameterDefinitions, long.featureRules)
    assert len(short_eval.features) == 8
    assert len(long_eval.features) == 12
    assert short_eval.features[0].id == "upright.mainHoleRow.part_face_front.001"
    assert short_eval.features[-1].arguments["z"] == 2300

    short_plan = lower_to_plan(short, {"record": {"code": "Q345", "thickness": 2}})
    long_plan = lower_to_plan(long, {"record": {"code": "Q345", "thickness": 2}})
    assert len(short_plan.operations) == 9
    assert len(long_plan.operations) == 13
    assert short_plan.inputHash != long_plan.inputHash
    result = execute_plan(short_plan, tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics.operationCount == 9


def test_rule_limits_feature_count_and_reports_invalid_coordinates() -> None:
    draft = omega_rule_draft()
    draft.featureRules[0].countExpression = "100"
    draft.featureRules[0].maximumCount = 20
    plan = lower_to_plan(draft, {"record": {"code": "Q345"}})
    assert any(item.code == "FEATURE_RULE_EVALUATION_FAILED" for item in plan.diagnostics)

    draft = omega_rule_draft()
    draft.featureRules[0].argumentExpressions["x"] = "width"
    plan = lower_to_plan(draft, {"record": {"code": "Q345"}})
    assert any(item.code == "RESOLVED_FEATURE_OUTSIDE_BODY" for item in plan.diagnostics)


def test_face_hosted_polygonal_cutout_and_multiple_face_cuts_compile(tmp_path) -> None:
    draft = TemplateDraft(
        name="多面异形切口",
        featureRulesReviewed=True,
        featureRules=[
            FeatureRule(
                id="cutout.front.trapezoid",
                name="前面梯形切口",
                featureType="polygonalCutout",
                faceBindings=[{"semanticFaceId": "part.face.front"}],
                countExpression="1",
                polygonVertices=[
                    {"uExpression": "-12", "vExpression": "length / 2 - 10"},
                    {"uExpression": "12", "vExpression": "length / 2 - 10"},
                    {"uExpression": "8", "vExpression": "length / 2 + 10"},
                    {"uExpression": "-8", "vExpression": "length / 2 + 10"},
                ],
            ),
            FeatureRule(
                id="hole.left.service",
                name="左面服务孔",
                featureType="circularHole",
                faceBindings=[{"semanticFaceId": "part.face.left"}],
                countExpression="1",
                arguments={"x": 0, "z": 250, "diameter": 10},
            ),
        ],
    )
    evaluation = evaluate_template(draft.parameterDefinitions, draft.featureRules, semantic_faces=draft.geometryRecipe.semanticFaces)
    assert evaluation.success
    assert evaluation.features[0].hostFace == "negativeY"
    assert evaluation.features[0].polygonVertices == [(-12.0, 490.0), (12.0, 490.0), (8.0, 510.0), (-8.0, 510.0)]
    assert evaluation.features[1].hostFace == "negativeX"

    plan = lower_to_plan(draft, {"record": {"code": "Q345", "thickness": 2}})
    assert not [item for item in plan.diagnostics if item.severity == "error"]
    assert [item.operator for item in plan.operations[1:]] == [
        "machining.polygonal_through_cutout", "machining.circular_through_hole",
    ]
    result = execute_plan(plan, tmp_path)
    assert result.success, result.diagnostics


def test_polygon_rule_rejects_self_intersecting_contour() -> None:
    rule = FeatureRule(
        id="cutout.invalid.bowtie",
        name="自交切口",
        featureType="polygonalCutout",
        countExpression="1",
        polygonVertices=[
            {"uExpression": "0", "vExpression": "0"},
            {"uExpression": "10", "vExpression": "10"},
            {"uExpression": "0", "vExpression": "10"},
            {"uExpression": "10", "vExpression": "0"},
        ],
    )
    result = evaluate_template([], [rule])
    assert not result.success
    assert result.diagnostics[0].code == "FEATURE_RULE_EVALUATION_FAILED"


def test_feature_placement_modes_resolve_local_uv_coordinates() -> None:
    def rule(rule_id: str, placement: dict, count: str = "3", z: float = 0) -> FeatureRule:
        return FeatureRule(
            id=rule_id,
            name=rule_id,
            featureType="circularHole",
            countExpression=count,
            arguments={"x": 0, "z": z, "diameter": 10},
            placement=placement,
        )

    evaluation = evaluate_template([ParameterDefinition(id="length", label="长度", default=1000, minimum=1, maximum=10000)], [
        rule("linear", {"mode": "linearArray", "axis": "v", "pitchExpression": "50", "startMarginExpression": "10"}, z=10),
        rule("symmetric", {"mode": "symmetric", "axis": "v", "pitchExpression": "20"}, z=100),
        rule("span", {"mode": "equalSpan", "axis": "v", "startMarginExpression": "5", "endMarginExpression": "5"}, z=5),
        rule("pitch", {"mode": "maxPitch", "axis": "v", "startMarginExpression": "0", "endMarginExpression": "0", "maximumPitchExpression": "300"}, count="not_used"),
        rule("one", {"mode": "single", "axis": "v"}, count="not_used", z=42),
    ])
    assert evaluation.success, evaluation.diagnostics
    by_rule: dict[str, list[float]] = {}
    for feature in evaluation.features:
        by_rule.setdefault(feature.sourceRuleId, []).append(float(feature.arguments["z"]))
    assert by_rule == {
        "linear": [10.0, 60.0, 110.0],
        "one": [42.0],
        "pitch": [0.0, 250.0, 500.0, 750.0, 1000.0],
        "span": [5.0, 500.0, 995.0],
        "symmetric": [80.0, 100.0, 120.0],
    }


def test_removed_legacy_fields_are_rejected() -> None:
    with pytest.raises(Exception):
        TemplateDraft.model_validate({"schemaVersion": "2.0", "name": "旧模板", "partType": "plate", "parameters": {}, "features": {}})


def test_geometry_parameter_contract_is_not_tied_to_profile_dimensions() -> None:
    draft = TemplateDraft(name="通用草图参数契约", sketch={"constraintsReviewed": True}, geometryRecipe={"reviewed": True})
    result = validate_stage("baseSketch", draft)
    assert next(item for item in result.checks if item.id == "sketch-solver").passed
    assert next(item for item in result.checks if item.id == "sketch-degrees-of-freedom").passed
    assert validate_stage("variants", draft).complete


def test_default_semantic_faces_reference_existing_parameters() -> None:
    draft = TemplateDraft(name="默认语义面参数契约")
    parameter_ids = {item.id for item in draft.parameterDefinitions}
    references = set()
    for face in draft.geometryRecipe.semanticFaces:
        for expression in [face.uStartExpression, face.uSpanExpression, face.vStartExpression, face.vSpanExpression]:
            references |= expression_names(expression)
    assert references <= parameter_ids
    assert next(item for item in validate_stage("variants", draft).checks if item.id == "geometry-parameter-contract").passed


def test_semantic_face_expressions_are_checked_as_geometry_parameters() -> None:
    draft = TemplateDraft(name="语义面缺参测试", geometryRecipe={"reviewed": True})
    draft.geometryRecipe.semanticFaces[0].uSpanExpression = "unknownWidth"

    base = validate_stage("baseSketch", draft)
    variants = validate_stage("variants", draft)

    assert not next(item for item in base.checks if item.id == "driving-parameters").passed
    assert not next(item for item in variants.checks if item.id == "geometry-parameter-contract").passed


def test_interface_parameter_and_geometry_refs_are_checked() -> None:
    draft = TemplateDraft.model_validate({
        "name": "接口引用缺失测试",
        "interfaces": [{
            "id": "interface.bad",
            "name": "缺失接口引用",
            "geometryRefs": ["part.face.missing"],
            "referenceFrame": {"originRef": "part.face.alsoMissing", "axis": "z"},
            "parameterRefs": ["missingParameter"],
        }],
    })
    result = validate_stage("variants", draft)

    assert not next(item for item in result.checks if item.id == "interface-parameter-refs").passed
    assert not next(item for item in result.checks if item.id == "interface-geometry-refs").passed


def test_valid_variant_overrides_must_match_parameter_contract() -> None:
    draft = TemplateDraft.model_validate({
        "name": "变体覆盖值测试",
        "variants": [
            {"id": "nominal", "name": "标称实例", "overrides": {}},
            {"id": "bad.length", "name": "错误长度", "overrides": {"length": "not-a-number"}, "expected": "valid"},
        ],
    })
    result = validate_stage("variants", draft)

    check = next(item for item in result.checks if item.id == "variant-overrides-evaluable")
    assert not check.passed
    assert "bad.length" in check.message


def test_feature_expressions_reject_parameter_display_names() -> None:
    draft = TemplateDraft.model_validate({
        "name": "规则显示名称误用测试",
        "featureRulesReviewed": True,
        "parameterDefinitions": [
            {"id": "holePitch", "label": "孔距", "displayName": "孔氏", "default": 100, "minimum": 10, "maximum": 500},
        ],
        "featureRules": [{
            "id": "holes.main",
            "name": "孔列",
            "featureType": "circularHole",
            "countExpression": "1",
            "arguments": {"x": 0, "diameter": 12},
            "argumentExpressions": {"z": "孔氏 / 2"},
        }],
    })
    result = validate_stage("features", draft)
    check = next(item for item in result.checks if item.id == "feature-expressions-id-only")
    assert not check.passed
    assert "孔氏" in check.message
    assert "holePitch" in check.message


def test_parameter_source_expressions_reject_parameter_display_names() -> None:
    draft = TemplateDraft.model_validate({
        "name": "契约显示名称误用测试",
        "parameterDefinitions": [
            {"id": "holePitch", "label": "孔距", "displayName": "孔距", "default": 100, "minimum": 10, "maximum": 500},
            {"id": "holeCount", "label": "孔数", "default": 2, "minimum": 1, "maximum": 20, "sourceDefinition": {"type": "formula", "expression": "孔距 / 2"}},
        ],
        "variants": [{"id": "nominal", "name": "标称实例", "overrides": {}}],
    })
    result = validate_stage("variants", draft)
    check = next(item for item in result.checks if item.id == "parameter-source-expressions-id-only")
    assert not check.passed
    assert "孔距" in check.message
    assert "holePitch" in check.message


def test_import_is_only_a_semantic_sketch_acquisition_method() -> None:
    draft = TemplateDraft(name="导入转换测试", sketch={
        "acquisitionMethod":"imported", "sourceAttachmentId":"asset-dxf", "sourceHash":"a" * 64,
        "importUnit":"mm", "importScale":1, "conversionReviewed":True, "constraintsReviewed":True,
    }, geometryRecipe={"reviewed":True})
    assert draft.sketch.model == "semanticProfile"
    assert draft.sketch.entities and draft.sketch.constraints and draft.sketch.regions
    result = validate_stage("baseSketch", draft)
    assert next(item for item in result.checks if item.id == "sketch-source").passed
    assert next(item for item in result.checks if item.id == "sketch-conversion").passed


def test_generic_sketch_solver_handles_cases_constraints_and_failures() -> None:
    draft = TemplateDraft(name="通用二维求解器")
    result = solve_semantic_sketch(draft)
    assert result["valid"] and result["fullyConstrained"] and result["degreesOfFreedom"] == 0
    assert [case["case"] for case in result["cases"]] == ["minimum", "nominal", "maximum"]
    assert len(result["cases"][1]["segments"]) == 4
    assert result["cases"][0]["regions"][0]["area"] == pytest.approx(100)
    assert result["cases"][2]["regions"][0]["area"] == pytest.approx(1_000_000)
    draft.sketch.constraints = [item for item in draft.sketch.constraints if item.id != "constraint.origin"]
    under_constrained = solve_semantic_sketch(draft)
    assert not under_constrained["fullyConstrained"]
    assert under_constrained["degreesOfFreedom"] > 0
    invalid_draft = TemplateDraft(name="自交失效")
    invalid_draft.sketch.entities[2].end = (50, -25)
    invalid_draft.sketch.constraints = []
    invalid = solve_semantic_sketch(invalid_draft)
    assert not invalid["valid"]
    assert any(item["code"] in {"SKETCH_REGION_OPEN", "SKETCH_SELF_INTERSECTION"} for item in invalid["diagnostics"])


def test_construction_geometry_is_excluded_from_dof_but_remains_constraint_driven() -> None:
    draft = TemplateDraft(name="构造图元自由度")
    draft.sketch.entities.append(
        SemanticSketchEntity(
            id="construction.axis",
            role="参考中心线",
            geometryType="line",
            construction=True,
            start=(0, 0),
            end=(10, 10),
        )
    )
    draft.sketch.constraints.append(
        SemanticSketchConstraint(
            id="construction.axis.horizontal",
            constraintType="horizontal",
            entityRefs=["construction.axis"],
        )
    )

    solved = solve_semantic_sketch(draft)

    # The reference line is solved (its diagonal input is corrected to a
    # horizontal line), but its free movement is not reported as profile DOF.
    assert solved["fullyConstrained"]
    assert solved["degreesOfFreedom"] == 0
    nominal = next(item for item in solved["cases"] if item["case"] == "nominal")
    axis = next(item for item in nominal["primitives"] if item["id"] == "construction.axis")
    assert axis["end"]["y"] == pytest.approx(axis["start"]["y"])


def test_sketch_solver_uses_parameter_dependency_evaluation() -> None:
    draft = TemplateDraft(name="参数来源求解")
    height = next(item for item in draft.parameterDefinitions if item.id == "sectionHeight")
    height.sourceDefinition.type = "formula"
    height.sourceDefinition.expression = "2 * sectionWidth"
    height.sourceDefinition.dependencies = ["sectionWidth"]
    solved = solve_semantic_sketch(draft, {"sectionWidth": 30})
    nominal = next(item for item in solved["cases"] if item["case"] == "nominal")
    assert nominal["values"]["sectionHeight"] == 60


def test_evaluation_api_previews_parameter_override_and_rule_output(tmp_path, monkeypatch) -> None:
    import app.main as main
    from app.repository import Repository
    from template_core.material import RuiWareMaterialLibrary

    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "unused.db"))
    monkeypatch.setattr(main, "repository", repository)
    saved = repository.save_draft(omega_rule_draft())
    client = TestClient(main.app)
    response = client.post(
        f"/api/v1/template-drafts/{saved.id}/evaluate",
        json={"overrides": {"length": 3600}},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["values"]["holeCount"] == 12
    assert len(result["features"]) == 12
    assert result["features"][0]["sourceRuleId"] == "upright.mainHoleRow"


def test_generic_unified_example_is_valid_and_compiles(tmp_path) -> None:
    example_path = Path(__file__).parents[1] / "examples" / "generic-parametric-profile-3.0.json"
    draft = TemplateDraft.model_validate(json.loads(example_path.read_text(encoding="utf-8")))
    plan = lower_to_plan(draft, {"record": {"code": "COIL-Q355-2", "thickness": 2, "grade": "Q355"}})
    assert not [item for item in plan.diagnostics if item.severity == "error"]
    assert len(plan.operations) == 1
    result = execute_plan(plan, tmp_path)
    assert result.success, result.diagnostics
