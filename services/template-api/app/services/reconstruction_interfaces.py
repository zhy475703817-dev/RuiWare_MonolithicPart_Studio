from __future__ import annotations

from collections.abc import Callable
from typing import Any

from template_core.rules import evaluate_template


TableRenderer = Callable[[list[str], list[list[str]]], list[str]]

_FIELD_LABELS = {
    "id": "接口稳定 ID",
    "name": "接口名称",
    "description": "用途说明",
    "interfaceType": "接口类型",
    "declarationMode": "声明方式",
    "connectionMethod": "连接方式",
    "locationRole": "定位角色",
    "locatingRole": "定位角色",
    "geometryRefs": "几何基准",
    "sourceRuleId": "来源制造规则",
    "sourceFeatureRuleId": "来源制造规则",
    "parameterRefs": "关联参数",
    "compatibleTags": "兼容标签",
    "referenceFrame": "局部参考系",
    "region": "接口作用区域",
    "critical": "是否关键接口",
    "reviewed": "是否已复核",
    "engineerReviewed": "是否已工程复核",
}

_TYPE_LABELS = {
    "locating": "定位接口",
    "connecting": "连接接口",
    "supporting": "支承接口",
    "adjustable": "可调接口",
    "processDatum": "工艺基准接口",
}

_MODE_LABELS = {
    "staticGeometry": "固定几何声明",
    "featureDerived": "由制造特征自动派生",
}


def _model_data(item: Any) -> dict[str, Any]:
    if hasattr(item, "model_dump"):
        return item.model_dump(mode="json")
    if isinstance(item, dict):
        return item
    return vars(item)


def _display_value(value: Any) -> str:
    if value is None or value == "" or value == [] or value == {}:
        return "—"
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, list):
        return "、".join(_display_value(item) for item in value) or "—"
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            if item is None or item == "" or item == [] or item == {}:
                continue
            parts.append(f"{_FIELD_LABELS.get(key, key)}：{_display_value(item)}")
        return "；".join(parts) or "—"
    return str(value)


def _interface_type(data: dict[str, Any]) -> str:
    value = data.get("interfaceType")
    return _TYPE_LABELS.get(value, _display_value(value))


def _declaration_mode(data: dict[str, Any]) -> str:
    value = data.get("declarationMode")
    return _MODE_LABELS.get(value, _display_value(value))


def _source_description(data: dict[str, Any]) -> str:
    geometry_refs = data.get("geometryRefs")
    rule_id = data.get("sourceRuleId") or data.get("sourceFeatureRuleId")
    parts = []
    if geometry_refs:
        parts.append(f"几何基准：{_display_value(geometry_refs)}")
    if rule_id:
        parts.append(f"制造规则：{rule_id}")
    return "；".join(parts) or "—"


def _resolve_interfaces(draft: Any) -> tuple[list[Any], str]:
    try:
        evaluation = evaluate_template(
            getattr(draft, "parameterDefinitions", []),
            getattr(draft, "featureRules", []),
            interfaces=getattr(draft, "interfaces", []),
        )
        return list(evaluation.resolvedInterfaces), ""
    except Exception as exc:  # 说明书仍应可下载，同时明确记录无法展开的原因。
        return [], f"接口实例暂时无法解析：{exc}"


def _resolved_rows(items: list[Any]) -> list[list[str]]:
    rows = []
    for item in items:
        data = _model_data(item)
        rows.append(
            [
                _display_value(data.get("name")),
                _display_value(data.get("id")),
                _display_value(data.get("sourceInterfaceId")),
                _interface_type(data),
                _display_value(data.get("sourceFeatureId")),
                _display_value(data.get("geometryRef") or data.get("geometryRefs")),
                _display_value(data.get("referenceFrame")),
                _display_value(data.get("region")),
            ]
        )
    return rows


def build_interface_reference_lines(draft: Any, table: TableRenderer) -> list[str]:
    interfaces = list(getattr(draft, "interfaces", []))
    if not interfaces:
        return ["当前零部件未定义对外接口。"]

    summary_rows = []
    detail_lines: list[str] = []
    for item in interfaces:
        data = _model_data(item)
        summary_rows.append(
            [
                _display_value(data.get("name")),
                _display_value(data.get("id")),
                _interface_type(data),
                _declaration_mode(data),
                _source_description(data),
                _display_value(data.get("parameterRefs")),
                _display_value(data.get("critical")),
                _display_value(data.get("reviewed") or data.get("engineerReviewed")),
            ]
        )
        detail_lines.extend(["", f"#### {_display_value(data.get('name'))}", ""])
        detail_lines.extend(
            table(
                ["定义项", "内容"],
                [
                    [_FIELD_LABELS.get(key, key), _display_value(value)]
                    for key, value in data.items()
                    if value is not None and value != "" and value != [] and value != {}
                ],
            )
        )

    lines = table(
        ["接口名称", "稳定 ID", "接口类型", "声明方式", "几何/规则来源", "关联参数", "关键", "已复核"],
        summary_rows,
    )
    lines.extend(["", "### 接口定义明细"])
    lines.extend(detail_lines)

    resolved, error = _resolve_interfaces(draft)
    lines.extend(["", "### 参数求值后的实际接口", ""])
    if error:
        lines.append(error)
    elif resolved:
        lines.append(f"根据当前参数和制造规则，共展开 {len(resolved)} 个实际接口实例。")
        lines.append("")
        lines.extend(
            table(
                ["实例名称", "实例 ID", "来源接口", "类型", "来源特征", "几何基准", "局部参考系", "作用区域"],
                _resolved_rows(resolved),
            )
        )
    else:
        lines.append("当前参数下没有展开出实际接口实例。")
    return lines


def build_interface_guide_lines(draft: Any, table: TableRenderer) -> list[str]:
    interfaces = list(getattr(draft, "interfaces", []))
    lines = [
        "",
        f"当前定义 {len(interfaces)} 个对外接口。接口用于说明本零件如何定位、连接、支承、调整或作为工艺基准。",
        "",
    ]
    if not interfaces:
        lines.append("当前零部件没有需要复核的接口定义。")
        return lines

    for index, item in enumerate(interfaces, start=1):
        data = _model_data(item)
        lines.extend(
            [
                f"### {index}. {_display_value(data.get('name'))}",
                "",
                f"- 用途：{_interface_type(data)}。",
                f"- 生成方式：{_declaration_mode(data)}。",
                f"- 几何或规则来源：{_source_description(data)}。",
                f"- 关联参数：{_display_value(data.get('parameterRefs'))}。",
                f"- 局部参考系：{_display_value(data.get('referenceFrame'))}。",
                f"- 接口作用区域：{_display_value(data.get('region'))}。",
                f"- 兼容标签：{_display_value(data.get('compatibleTags'))}。",
                f"- 质量状态：关键接口={_display_value(data.get('critical'))}，工程复核={_display_value(data.get('reviewed') or data.get('engineerReviewed'))}。",
                f"- 稳定 ID：{_display_value(data.get('id'))}。",
                "",
            ]
        )

    resolved, error = _resolve_interfaces(draft)
    lines.extend(["### 当前参数下的实际接口", ""])
    if error:
        lines.append(error)
    elif resolved:
        lines.append(f"当前参数共生成 {len(resolved)} 个实际接口，排查装配或定位问题时可按下表逐项核对。")
        lines.append("")
        lines.extend(
            table(
                ["实际接口", "来源定义", "来源特征", "几何基准", "局部参考系", "作用区域"],
                [
                    [row[0], row[2], row[4], row[5], row[6], row[7]]
                    for row in _resolved_rows(resolved)
                ],
            )
        )
    else:
        lines.append("当前参数下没有生成实际接口。")
    lines.append("")
    return lines
