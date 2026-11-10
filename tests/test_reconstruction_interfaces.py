from types import SimpleNamespace

from template_core.metamodel import PartInterface


def _table(headers: list[str], rows: list[list[str]]) -> list[str]:
    return [" | ".join(headers), *[" | ".join(row) for row in rows]]


def test_interface_document_lines_include_declaration_and_resolved_instances() -> None:
    from app.services.reconstruction_interfaces import (
        build_interface_guide_lines,
        build_interface_reference_lines,
    )

    draft = SimpleNamespace(
        interfaces=[
            PartInterface(
                id="upright.bottom.primary",
                name="主定位接口",
                interfaceType="locating",
                geometryRefs=["part.face.front"],
            )
        ],
        parameterDefinitions=[],
        featureRules=[],
    )

    reference_text = "\n".join(build_interface_reference_lines(draft, _table))
    guide_text = "\n".join(build_interface_guide_lines(draft, _table))

    assert "主定位接口" in reference_text
    assert "upright.bottom.primary" in reference_text
    assert "参数求值后的实际接口" in reference_text
    assert "part.face.front" in reference_text
    assert "当前定义 1 个对外接口" in guide_text
    assert "几何基准" in guide_text
