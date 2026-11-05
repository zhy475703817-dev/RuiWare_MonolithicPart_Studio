import copy
import io
import json
import zipfile

import pytest

from app.services import package_similarity as similarity


def definitions():
    return {
        "manifest.json": {"id": "new", "name": "Ω 立柱", "version": 3},
        "constraints.json": {"entities": [{"id": "edge.a", "start": [0, 0], "end": [10, 0]}], "constraints": [], "regions": []},
        "geometry-recipe.json": {"operations": [{"id": "a", "operator": "solid.extrude"}, {"id": "b", "operator": "solid.cut"}], "semanticFaces": []},
        "sweep-path.json": {"geometry": [], "constraints": []},
        "parameters.json": {"definitions": [{"id": "length", "unit": "mm", "default": 100, "minimum": 10, "maximum": 200, "sourceDefinition": {"expression": "width * 2"}}]},
        "parameter-dependencies.json": {"sources": {"length": {"expression": "width * 2"}}},
        "feature-rules.json": {"rules": []},
        "variants.json": {"variants": []},
        "interfaces.json": {"coordinateSystem": "rightHanded", "interfaces": []},
        "classification.json": {"manufacturing": {"primaryProcessId": "extrusion"}},
        "material-requirements.json": {"requirements": [{"id": "main", "allowedGrades": ["Q235"]}]},
    }


def package(documents, reverse=False):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name in sorted(documents, reverse=reverse):
            archive.writestr(name, json.dumps(documents[name], ensure_ascii=False))
    return output.getvalue()


def test_exact_bytes_are_duplicate():
    content = package(definitions())
    assert similarity.compare_packages(content, content)["level"] == "exact"


def test_omega_same_definitions_ignore_release_metadata_and_zip_order():
    old = definitions()
    new = copy.deepcopy(old)
    new["manifest.json"] = {"id": "another", "name": "另一名称", "version": 99, "createdAt": "later"}
    new["outputs.json"] = {"url": "/different", "inputHash": "different"}
    new["constraints.json"]["sourceHash"] = "generated"
    result = similarity.compare_packages(package(new, True), package(old))
    assert result["level"] == "high"
    assert result["score"] == 1
    assert result["differences"] == []
    assert similarity.package_fingerprint(package(new, True)) == similarity.package_fingerprint(package(old))


def test_operation_order_is_meaningful():
    old = definitions()
    new = copy.deepcopy(old)
    new["geometry-recipe.json"]["operations"].reverse()
    result = similarity.compare_packages(package(new), package(old))
    assert result["scores"]["geometry"] < .95
    assert result["level"] != "high"
    assert any("operations" in diff["path"] for diff in result["differences"])


@pytest.mark.parametrize("field,value", [("default", 150), ("unit", "m"), ("sourceDefinition", {"expression": "width * 3"})])
def test_parameter_behavior_changes_are_reported(field, value):
    old = definitions()
    new = copy.deepcopy(old)
    new["parameters.json"]["definitions"][0][field] = value
    result = similarity.compare_packages(package(new), package(old))
    assert result["scores"]["parameters"] < 1
    assert any(field in item["path"] for item in result["differences"])


def test_missing_definition_files_cannot_be_strong_candidates():
    result = similarity.compare_packages(package({"manifest.json": {"name": "Ω 立柱"}}), package(definitions()))
    assert result["level"] == "none"
    assert result["scores"]["geometry"] == 0


def test_same_name_with_different_geometry_and_behavior_is_not_a_duplicate():
    old = definitions()
    new = definitions()
    new["constraints.json"] = {"entities": [{"id": "circle", "geometryType": "circle", "radius": 80}]}
    new["geometry-recipe.json"] = {"operations": [{"id": "revolve", "operator": "solid.revolve"}]}
    new["parameters.json"] = {"definitions": [{"id": "radius", "unit": "inch", "default": 4}]}
    new["parameter-dependencies.json"] = {"sources": {"radius": None}}
    assert similarity.compare_packages(package(new), package(old))["level"] == "none"


@pytest.mark.parametrize("field", ["lookupTable", "overrides", "arguments", "argumentExpressions", "requiredProperties", "sources"])
def test_behavioral_map_keys_are_not_treated_as_release_metadata(field):
    old, new = definitions(), definitions()
    def install(documents, value):
        if field == "lookupTable":
            parent = documents["parameters.json"]["definitions"][0]["sourceDefinition"]
        elif field == "overrides":
            documents["variants.json"]["variants"] = [{"id": "nominal"}]
            parent = documents["variants.json"]["variants"][0]
        elif field in {"arguments", "argumentExpressions"}:
            parent = documents["geometry-recipe.json"]["operations"][0]
        elif field == "requiredProperties":
            parent = documents["material-requirements.json"]["requirements"][0]
        else:
            parent = documents["parameter-dependencies.json"]
        parent[field] = {"name": value, "version": value}
    install(old, 10)
    install(new, 20)
    result = similarity.compare_packages(package(new), package(old))
    assert result["score"] < 1
    assert result["differenceCount"] >= 2
    assert similarity.package_fingerprint(package(new)) != similarity.package_fingerprint(package(old))


@pytest.mark.parametrize("scores,expected", [
    ({"geometry": .95, "parameters": .90, "features": 1, "manufacturing": 1}, "high"),
    ({"geometry": .94, "parameters": 1, "features": 1, "manufacturing": 1}, "suspected"),
    ({"geometry": .95, "parameters": .89, "features": 1, "manufacturing": 1}, "suspected"),
    ({"geometry": 1, "parameters": 1, "features": 0, "manufacturing": 0}, "suspected"),
    ({"geometry": .7, "parameters": .7, "features": .7, "manufacturing": .7}, "none"),
])
def test_threshold_boundaries(scores, expected):
    assert similarity.classify_similarity(scores) == expected
