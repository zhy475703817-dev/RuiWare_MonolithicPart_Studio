import sqlite3

from app.repository import Repository
from template_core.material import RuiWareMaterialLibrary, checksum, effective_thickness_domain
from template_core.material import material_requirement_mismatches
from template_core.metamodel import MaterialRequirement
from template_core.models import MaterialValidationSample, TemplateDraft
from template_core.stages import validate_material
from app.repository import Repository
from app.services.operations import search_materials


def test_ruiware_library_is_read_only_and_normalized(tmp_path) -> None:
    path = tmp_path / "materials.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE materials (
                id INTEGER PRIMARY KEY, code TEXT, name TEXT, type TEXT, category_group TEXT,
                data_kind TEXT, length TEXT, width TEXT, height TEXT, thickness TEXT, grade TEXT,
                color TEXT, drawing_color TEXT, price TEXT, surface TEXT, standard TEXT,
                stock_qty REAL, available_qty REAL, supplier TEXT, status TEXT,
                updated_at TEXT, remark TEXT
            )
            """
        )
        connection.execute(
            "INSERT INTO materials VALUES (1,'COIL-01','冷轧卷材','卷材','','raw','6000','1250',NULL,'1.5','Q345',NULL,NULL,NULL,'镀锌','GB/T 2518',10,8,'A','已发布','2026-08-01','')"
        )
    library = RuiWareMaterialLibrary(path)
    record = library.get("1")
    assert record["thickness"] == 1.5
    assert record["grade"] == "Q345"
    assert record["supplyForms"] == ["coil"]
    assert library.list("卷材")[0]["code"] == "COIL-01"
    assert checksum(record) == checksum(dict(reversed(list(record.items()))))


def test_reference_tracks_source_but_copy_keeps_snapshot(tmp_path) -> None:
    source = tmp_path / "materials.db"
    with sqlite3.connect(source) as connection:
        connection.execute(
            """
            CREATE TABLE materials (
                id INTEGER PRIMARY KEY, code TEXT, name TEXT, type TEXT, category_group TEXT,
                data_kind TEXT, length TEXT, width TEXT, height TEXT, thickness TEXT, grade TEXT,
                color TEXT, drawing_color TEXT, price TEXT, surface TEXT, standard TEXT,
                stock_qty REAL, available_qty REAL, supplier TEXT, status TEXT,
                updated_at TEXT, remark TEXT
            )
            """
        )
        connection.execute(
            "INSERT INTO materials VALUES (1,'SHEET-01','钢板','板材','','raw','6000','1500',NULL,'2','Q235',NULL,NULL,NULL,'黑件','GB/T 700',10,8,'A','已发布','2026-08-01','')"
        )
    library = RuiWareMaterialLibrary(source)
    repository = Repository(tmp_path / "local.db", library)
    reference = repository.create_binding("1", "reference")
    copied = repository.create_binding("1", "copy")

    with sqlite3.connect(source) as connection:
        connection.execute("UPDATE materials SET grade='Q345', updated_at='2026-08-11' WHERE id=1")

    referenced_material, reference_provenance = repository.resolve_binding(reference.id)
    copied_material, copy_provenance = repository.resolve_binding(copied.id)
    assert referenced_material["grade"] == "Q345"
    assert reference_provenance["drifted"] is True
    assert copied_material["grade"] == "Q235"
    assert copy_provenance["drifted"] is False


def test_material_family_matching_and_boundary_matrix_are_enforced() -> None:
    requirement = MaterialRequirement(selectionMode="family", supplyForm="coil", allowedGrades=["Q345"], thickness={"allowedValues":[1.5,2.0,2.5]}, reviewed=True)
    material = {"type":"卷材","name":"冷轧卷材","grade":"Q345","thickness":2.0,"standard":None,"surface":None}
    assert material_requirement_mismatches(requirement, material) == []
    assert "牌号不在材料族范围内" in material_requirement_mismatches(requirement, {**material,"grade":"Q235"})
    draft = TemplateDraft(name="材料矩阵测试", materialRequirements=[requirement], materialValidationSamples=[
        MaterialValidationSample(id="material.nominal", role="nominal", name="标称", bindingId="b1", bindingMode="copy", materialCode="M1", materialName="样例", materialThickness=2, reviewed=True),
    ])
    result = validate_material(draft, [{"sampleId":"material.nominal","material":material,"provenance":{"drifted":False},"mismatches":[]}])
    assert not result.complete
    assert "validation-samples" in {item.id for item in result.checks if not item.passed}


def test_ruiware_business_types_map_to_supply_forms_and_decimal_ranges() -> None:
    coil_requirement = MaterialRequirement(supplyForm="coil", thickness={"minimum":1.2,"maximum":2.5})
    strip_steel = {"type":"带钢","name":"Q355带钢","grade":"Q355","thickness":1.55}
    assert material_requirement_mismatches(coil_requirement, strip_steel) == []
    assert "厚度小于允许下限" in material_requirement_mismatches(coil_requirement, {**strip_steel,"thickness":1.15})
    profile_requirement = MaterialRequirement(supplyForm="openProfile")
    omega = {"type":"Ω钢","name":"Ω型立柱原料","thickness":2.0}
    assert material_requirement_mismatches(profile_requirement, omega) == []


def test_boundary_samples_must_use_boundary_thicknesses() -> None:
    requirement = MaterialRequirement(supplyForm="coil", thickness={"minimum":1.2,"maximum":2.5}, reviewed=True)
    samples = [
        MaterialValidationSample(id="material.minimum", role="minimum", name="最小", bindingId="b1", bindingMode="copy", materialCode="M1", materialName="下界", materialThickness=1.5, reviewed=True),
        MaterialValidationSample(id="material.nominal", role="nominal", name="标称", bindingId="b2", bindingMode="copy", materialCode="M2", materialName="标称", materialThickness=2.0, reviewed=True),
        MaterialValidationSample(id="material.maximum", role="maximum", name="最大", bindingId="b3", bindingMode="copy", materialCode="M3", materialName="上界", materialThickness=2.5, reviewed=True),
    ]
    draft = TemplateDraft(name="边界厚度测试", materialRequirements=[requirement], materialValidationSamples=samples)
    contexts = [{"sampleId":item.id,"material":{"type":"带钢","thickness":item.materialThickness},"provenance":{"drifted":False},"mismatches":[]} for item in samples]
    result = validate_material(draft, contexts)
    boundary_check = next(item for item in result.checks if item.id == "boundary-sample-thickness")
    assert not boundary_check.passed
    assert "1.2 mm" in boundary_check.message


def test_effective_thickness_domain_is_the_intersection() -> None:
    requirement = MaterialRequirement(thickness={"allowedValues":[1.2,1.5,2.0,2.5],"minimum":1.4,"maximum":2.1})
    assert effective_thickness_domain(requirement) == {
        "kind":"discrete","declaredValues":[1.2,1.5,2.0,2.5],"values":[1.5,2.0],
        "minimum":1.5,"maximum":2.0,"empty":False,
    }
    empty = MaterialRequirement(thickness={"allowedValues":[1.0,3.0],"minimum":1.5,"maximum":2.5})
    assert effective_thickness_domain(empty)["empty"] is True


def test_draft_synchronizes_material_thickness_parameter_contract() -> None:
    requirement = MaterialRequirement(thickness={"allowedValues":[1.5,2.0,2.5],"maximum":2.0})
    draft = TemplateDraft(name="厚度同步", materialRequirements=[requirement])
    parameter = next(item for item in draft.parameterDefinitions if item.id == "thickness")
    assert parameter.allowedValues == [1.5,2.0]
    assert parameter.minimum == 1.5 and parameter.maximum == 2.0
    assert parameter.sourceDefinition.reference == "material.thickness"


def test_material_search_matches_multiple_fields_and_tokens(tmp_path) -> None:
    path = tmp_path / "materials.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE materials (
                id INTEGER PRIMARY KEY, code TEXT, name TEXT, type TEXT, category_group TEXT,
                data_kind TEXT, length TEXT, width TEXT, height TEXT, thickness TEXT, grade TEXT,
                color TEXT, drawing_color TEXT, price TEXT, surface TEXT, standard TEXT,
                stock_qty REAL, available_qty REAL, supplier TEXT, status TEXT,
                updated_at TEXT, remark TEXT
            )
            """
        )
        connection.execute(
            "INSERT INTO materials VALUES (1,'OMEGA-01','Ω型立柱原料','型材','openProfile','raw','6000','120',NULL,'2.0','Q355B','灰','蓝',NULL,'镀锌','GB/T 6728',10,8,'华北钢厂','已发布','2026-08-01','立柱材料')"
        )
    library = RuiWareMaterialLibrary(path)
    repository = Repository(tmp_path / "local.db", library)

    rows = library.list("Q355B 镀锌")
    assert rows and rows[0]["code"] == "OMEGA-01"
    assert library.list("6728")[0]["code"] == "OMEGA-01"

    requirement = MaterialRequirement(supplyForm="openProfile", thickness={"minimum": 1.5, "maximum": 2.5}, reviewed=True)
    result = search_materials(library, repository, "Q355B 镀锌", 100, requirement=requirement)
    assert result[0]["requirementMatch"]["compatible"] is True
