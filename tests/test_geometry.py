import math

import pytest

from cad_worker.geometry import _sketch_sweep, execute_plan
from template_core.lowering import lower_to_plan

from test_lowering import draft
from template_core.models import SweepPathGeometry, SweepPathSketch, TemplateDraft
from template_core.sketch_solver import solve_semantic_sketch
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.gp import gp_Pnt
from OCP.TopAbs import TopAbs_IN


def test_open_cascade_generates_valid_brep_and_preview(tmp_path) -> None:
    plan = lower_to_plan(draft(2), {"record": {"code": "Q345", "grade": "Q345"}})
    result = execute_plan(plan, tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None
    assert result.metrics.valid
    assert result.metrics.solidCount == 1
    assert {item.kind for item in result.artifacts} == {"step", "stl", "plan", "semanticMap", "diagnostics"}
    job_root = tmp_path / result.inputHash[:16]
    assert (job_root / "model.step").stat().st_size > 0
    assert (job_root / "preview.stl").stat().st_size > 0


def test_section_dimensions_change_authoritative_brep(tmp_path) -> None:
    small = TemplateDraft(name="small profile")
    large = TemplateDraft(name="large profile")
    next(item for item in small.parameterDefinitions if item.id == "sectionWidth").default = 80
    next(item for item in large.parameterDefinitions if item.id == "sectionWidth").default = 160
    small_result = execute_plan(lower_to_plan(small, {"record": {"code": "Q345"}}), tmp_path / "small")
    large_result = execute_plan(lower_to_plan(large, {"record": {"code": "Q345"}}), tmp_path / "large")
    assert small_result.success, small_result.diagnostics
    assert large_result.success, large_result.diagnostics
    assert small_result.inputHash != large_result.inputHash
    assert small_result.metrics is not None and large_result.metrics is not None
    assert abs(small_result.metrics.volume - large_result.metrics.volume) > 1


def test_multi_region_circle_hole_compiles_as_one_stable_solid(tmp_path) -> None:
    value = TemplateDraft(name="annular profile")
    value.sketch = value.sketch.model_validate({
        "profileMode":"multiRegion",
        "entities":[
            {"id":"circle.outer","role":"section.outer","geometryType":"circle","center":(0,0),"radius":50},
            {"id":"circle.inner","role":"section.inner","geometryType":"circle","center":(0,0),"radius":30}
        ],
        "constraints":[
            {"id":"outer.fixed","constraintType":"fixed","entityRefs":["circle.outer"]},
            {"id":"inner.fixed","constraintType":"fixed","entityRefs":["circle.inner"]},
            {"id":"circles.concentric","constraintType":"concentric","entityRefs":["circle.outer","circle.inner"]}
        ],
        "regions":[
            {"id":"region.outer","boundaryRefs":["circle.outer"],"operation":"add"},
            {"id":"region.inner","boundaryRefs":["circle.inner"],"operation":"subtract"}
        ]
    })
    plan = lower_to_plan(value, {"record":{"code":"Q345"}})
    result = execute_plan(plan, tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert result.metrics.volume == pytest.approx(math.pi * (50**2 - 30**2) * 1000, rel=1e-5)


def test_centerline_thinwall_compiles_as_one_stable_solid(tmp_path) -> None:
    value = TemplateDraft(name="centerline thin-wall profile")
    value.sketch = value.sketch.model_validate({
        "profileMode": "centerlineThinWall",
        "drivingParameters": ["thickness"],
        "entities": [
            {"id":"wall.left","role":"section.centerline.left","geometryType":"line","start":(-50,30),"end":(-50,-30),"parameterRefs":["thickness"]},
            {"id":"wall.base","role":"section.centerline.base","geometryType":"line","start":(-50,-30),"end":(50,-30),"parameterRefs":["thickness"]},
            {"id":"wall.right","role":"section.centerline.right","geometryType":"line","start":(50,-30),"end":(50,30),"parameterRefs":["thickness"]},
        ],
        "constraints": [
            {"id":"path.connected","constraintType":"coincident","entityRefs":["wall.left","wall.base","wall.right"]},
            {"id":"path.fixed","constraintType":"fixed","entityRefs":["wall.left","wall.base","wall.right"]},
        ],
        "regions": [],
    })
    value.geometryRecipe.operations[0].operator = "sketch.centerline_thinwall_extrude"
    value.geometryRecipe.operations[0].argumentExpressions = {"length":"length", "thickness":"thickness"}
    result = execute_plan(lower_to_plan(value, {"record":{"code":"Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert result.metrics.volume > 0


@pytest.mark.parametrize("plane", ["XZ", "YZ"])
def test_centerline_thinwall_respects_sketch_plane(tmp_path, plane) -> None:
    value = TemplateDraft(name=f"thin-wall {plane}")
    value.sketch.profileMode = "centerlineThinWall"
    value.sketch.plane = plane
    value.sketch.regions = []
    value.geometryRecipe.operations[0].operator = "sketch.centerline_thinwall_extrude"
    value.geometryRecipe.operations[0].argumentExpressions = {"length":"length", "thickness":"thickness"}
    result = execute_plan(lower_to_plan(value, {"record":{"code":"Q345"}}), tmp_path / plane)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1


def _compile_operator(tmp_path, operator: str, arguments: dict[str, object]):
    value = TemplateDraft(name=f"{operator} test")
    operation = value.geometryRecipe.operations[0]
    operation.operator = operator
    operation.arguments = {key: item for key, item in arguments.items() if isinstance(item, (str, int, float, bool))}
    operation.argumentExpressions = {}
    return execute_plan(lower_to_plan(value, {"record": {"code": "Q345"}}), tmp_path)


@pytest.mark.parametrize("plane", ["XY", "XZ", "YZ"])
def test_revolve_compiles_closed_profile_on_each_reference_plane(tmp_path, plane) -> None:
    value = TemplateDraft(name=f"{plane} revolve")
    value.sketch.plane = plane
    value.geometryRecipe.operations[0].operator = "solid.revolve"
    value.geometryRecipe.operations[0].argumentExpressions = {}
    value.geometryRecipe.operations[0].arguments = {
        "axisOriginU": -75,
        "axisOriginV": 0,
        "axisDirectionU": 0,
        "axisDirectionV": 1,
        "angleDegrees": 360,
    }
    result = execute_plan(lower_to_plan(value, {"record":{"code":"Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert result.metrics.volume > 0


def test_sweep_compiles_profile_along_straight_path(tmp_path) -> None:
    value = TemplateDraft(name="parameterized sweep")
    value.geometryRecipe.operations[0].operator = "solid.sweep"
    value.geometryRecipe.operations[0].argumentExpressions = {}
    value.geometryRecipe.operations[0].arguments = {"pathPoints": "0:0:0;0:0:length * 0.25"}
    result = execute_plan(lower_to_plan(value, {"record":{"code":"Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert result.metrics.volume == pytest.approx(100 * 50 * 250, rel=1e-4)


def test_sweep_supports_right_corner_polyline_and_hollow_regions(tmp_path) -> None:
    value = TemplateDraft(name="right-corner hollow sweep")
    value.sketch = value.sketch.model_validate({
        "profileMode":"multiRegion",
        "entities":[
            {"id":"circle.outer","role":"section.outer","geometryType":"circle","center":(0,0),"radius":20},
            {"id":"circle.inner","role":"section.inner","geometryType":"circle","center":(0,0),"radius":15},
        ],
        "constraints":[
            {"id":"outer.fixed","constraintType":"fixed","entityRefs":["circle.outer"]},
            {"id":"inner.fixed","constraintType":"fixed","entityRefs":["circle.inner"]},
            {"id":"circles.concentric","constraintType":"concentric","entityRefs":["circle.outer","circle.inner"]},
        ],
        "regions":[
            {"id":"region.outer","boundaryRefs":["circle.outer"],"operation":"add"},
            {"id":"region.inner","boundaryRefs":["circle.inner"],"operation":"subtract"},
        ],
    })
    value.geometryRecipe.operations[0].operator = "solid.sweep"
    value.geometryRecipe.operations[0].argumentExpressions = {}
    value.geometryRecipe.operations[0].arguments = {"pathPoints":"0:0:0;0:0:100;100:0:100"}
    result = execute_plan(lower_to_plan(value, {"record":{"code":"Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert result.metrics.volume > 0


def _configured_sketch_sweep(name: str, sketch_payload: dict, path_points: str = "0:0:0;0:0:100") -> TemplateDraft:
    value = TemplateDraft(name=name)
    value.sketch = value.sketch.model_validate(sketch_payload)
    value.geometryRecipe.operations[0].operator = "solid.sweep"
    value.geometryRecipe.operations[0].argumentExpressions = {}
    value.geometryRecipe.operations[0].arguments = {"pathPoints": path_points}
    value.geometryRecipe.operations[0].profileSketchId = "sketch.section.main"
    value.geometryRecipe.operations[0].pathSketchId = "path.main"
    value.geometryRecipe.operations[0].sourceRefs = ["sketch.section.main", "path.main"]
    value.geometryRecipe.paths = ["path.main"]
    path_rows = []
    try:
        path_rows = [
            tuple(float(component.strip()) for component in row.split(":"))
            for row in path_points.split(";") if row.strip()
        ]
    except ValueError:
        # Expression-based paths are still exercised through operation
        # arguments; only literal rows can be mirrored into the authored path.
        path_rows = []
    def path_uv(point):
        # The test paths use the XY editor convention: X and Z are authored
        # in the two-dimensional path sketch.
        return [point[0], point[2]]

    geometry = [
        {"id": f"path.{index + 1}", "geometryType": "line", "start": path_uv(start), "end": path_uv(end)}
        for index, (start, end) in enumerate(zip(path_rows, path_rows[1:]))
        if len(start) == 3 and len(end) == 3
    ]
    if not geometry:
        geometry = [{"id": "path.1", "geometryType": "line", "start": [0, 0], "end": [0, 100]}]
    value.sweepPath = SweepPathSketch.model_validate({
        "id": "path.main", "status": "confirmed",
        "geometry": geometry,
        "startEndpointRef": {"geometryId": geometry[0]["id"], "endpoint": "start"},
    })
    return value


def test_sweep_follows_rectangle_circle_and_hollow_profiles(tmp_path) -> None:
    rectangle = _configured_sketch_sweep("rectangle follow", {"profileMode": "closedRegion"})
    circle = _configured_sketch_sweep("circle follow", {
        "profileMode": "multiRegion",
        "entities": [{"id": "outer", "role": "section.outer", "geometryType": "circle", "center": [0, 0], "radius": 20}],
        "constraints": [{"id": "fixed", "constraintType": "fixed", "entityRefs": ["outer"]}],
        "regions": [{"id": "region.outer", "boundaryRefs": ["outer"], "operation": "add"}],
    })
    hollow = _configured_sketch_sweep("hollow follow", {
        "profileMode": "multiRegion",
        "entities": [
            {"id": "outer", "role": "section.outer", "geometryType": "circle", "center": [0, 0], "radius": 20},
            {"id": "inner", "role": "section.inner", "geometryType": "circle", "center": [0, 0], "radius": 10},
        ],
        "constraints": [
            {"id": "fixed.outer", "constraintType": "fixed", "entityRefs": ["outer"]},
            {"id": "fixed.inner", "constraintType": "fixed", "entityRefs": ["inner"]},
            {"id": "concentric", "constraintType": "concentric", "entityRefs": ["outer", "inner"]},
        ],
        "regions": [
            {"id": "region.outer", "boundaryRefs": ["outer"], "operation": "add"},
            {"id": "region.inner", "boundaryRefs": ["inner"], "operation": "subtract"},
        ],
    })
    for value in (rectangle, circle, hollow):
        result = execute_plan(lower_to_plan(value, {"record": {"code": "Q345"}}), tmp_path)
        assert result.success, result.diagnostics
        assert result.metrics and result.metrics.solidCount == 1 and result.metrics.volume > 0


def test_sweep_follows_two_segment_path_without_mutating_profile(tmp_path) -> None:
    value = _configured_sketch_sweep("corner follow", {"profileMode": "closedRegion"}, "0:0:0;0:0:100;100:0:100")
    before = value.sketch.model_dump_json()
    result = execute_plan(lower_to_plan(value, {"record": {"code": "Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert value.sketch.model_dump_json() == before


@pytest.mark.parametrize("orientation", ["followPath", "fixedWorld", "minimumTwist"])
def test_sweep_orientation_modes_generate_valid_brep(tmp_path, orientation) -> None:
    value = _configured_sketch_sweep(
        f"{orientation} orientation",
        {"profileMode": "closedRegion"},
        "0:0:0;0:0:100;100:0:100;100:0:200",
    )
    value.geometryRecipe.operations[0].orientationMode = orientation
    result = execute_plan(lower_to_plan(value, {"record": {"code": "Q345"}}), tmp_path / orientation)
    assert result.success, result.diagnostics
    assert result.metrics and result.metrics.valid and result.metrics.solidCount == 1


@pytest.mark.parametrize("orientation", ["followPath", "fixedWorld"])
def test_sweep_orientation_falls_back_from_invalid_pipeshell(tmp_path, orientation) -> None:
    """A sharp two-segment corner must not return PipeShell's invalid shape."""
    value = _configured_sketch_sweep(
        f"{orientation} corner fallback",
        {"profileMode": "closedRegion"},
        "0:0:0;0:0:600;300:0:600",
    )
    value.geometryRecipe.operations[0].orientationMode = orientation
    result = execute_plan(lower_to_plan(value, {"record": {"code": "Q345"}}), tmp_path / orientation)
    assert result.success, result.diagnostics
    assert result.metrics and result.metrics.valid and result.metrics.solidCount == 1


@pytest.mark.parametrize("orientation", ["followPath", "fixedWorld", "minimumTwist"])
def test_sweep_right_corner_does_not_use_smooth_overshoot(tmp_path, orientation) -> None:
    value = _configured_sketch_sweep(
        f"{orientation} strict corner",
        {"profileMode": "closedRegion"},
        "0:0:0;0:0:600;300:0:600",
    )
    value.geometryRecipe.operations[0].orientationMode = orientation
    result = execute_plan(lower_to_plan(value, {"record": {"code": "Q345"}}), tmp_path / orientation)
    assert result.success, result.diagnostics
    # A RightCorner sweep must fill the outside miter at the elbow.  The
    # overlap is intentional, so its volume is at least the straight-segment
    # union and never exceeds the full 900 mm centerline envelope by more
    # than one profile support width.
    expected_volume = {
        "followPath": 4_500_000.0,
        "fixedWorld": 4_500_000.0,
        "minimumTwist": 4_500_000.0,
    }[orientation]
    assert result.metrics and result.metrics.volume == pytest.approx(expected_volume, rel=1e-6)
    stl = next(item for item in result.artifacts if item.kind == "stl")
    stl_path = (tmp_path / orientation / result.inputHash[:16] / "preview.stl")
    vertices = []
    for line in stl_path.read_text(encoding="utf-8").splitlines():
        fields = line.strip().split()
        if len(fields) == 4 and fields[0] == "vertex":
            vertices.append(tuple(float(value) for value in fields[1:]))
    assert vertices
    assert min(point[0] for point in vertices) >= -50.1
    assert max(point[0] for point in vertices) <= 300.1


@pytest.mark.parametrize("orientation", ["followPath", "fixedWorld", "minimumTwist"])
def test_sweep_right_corner_fills_outer_miter_gap(orientation) -> None:
    """The outside elbow sample that was formerly a visible white notch is solid."""
    value = _configured_sketch_sweep(
        f"{orientation} miter fill",
        {"profileMode": "closedRegion"},
        "0:0:0;0:0:600;300:0:600",
    )
    value.geometryRecipe.operations[0].orientationMode = orientation
    plan = lower_to_plan(value, {"record": {"code": "Q345"}})
    operation = next(item for item in plan.operations if item.operator == "solid.sweep")
    shape = _sketch_sweep(operation.arguments)
    classifier = BRepClass3d_SolidClassifier(shape)
    # (-25, 0, 610) lies in the outside miter support.  Without the corner
    # overlap it is outside the union of the two independently swept prisms.
    classifier.Perform(gp_Pnt(-25.0, 0.0, 610.0), 1e-7)
    assert classifier.State() == TopAbs_IN


def test_sweep_rejects_zero_length_and_reverse_path(tmp_path) -> None:
    zero = _configured_sketch_sweep("zero segment", {"profileMode": "closedRegion"}, "0:0:0;0:0:0")
    zero.sweepPath.geometry[0].end = (0, 0)
    zero_result = execute_plan(lower_to_plan(zero, {"record": {"code": "Q345"}}), tmp_path / "zero")
    assert not zero_result.success
    assert any(item.code == "SWEEP_PATH_ZERO_LENGTH" for item in zero_result.diagnostics)

    reverse = _configured_sketch_sweep("reverse segment", {"profileMode": "closedRegion"}, "0:0:0;0:0:100;0:0:0")
    reverse.sweepPath.geometry = [
        SweepPathGeometry(id="path.1", geometryType="line", start=(0, 0), end=(0, 100)),
        SweepPathGeometry(id="path.2", geometryType="line", start=(0, 100), end=(0, 0)),
    ]
    reverse_result = execute_plan(lower_to_plan(reverse, {"record": {"code": "Q345"}}), tmp_path / "reverse")
    assert not reverse_result.success
    assert any(item.code in {"SWEEP_PATH_SELF_INTERSECTION", "SWEEP_PATH_DUPLICATE_SEGMENT", "SWEEP_PATH_DISCONNECTED"} for item in reverse_result.diagnostics)


@pytest.mark.parametrize("plane", ["XY", "XZ", "YZ"])
def test_loft_compiles_scaled_sections_on_each_reference_plane(tmp_path, plane) -> None:
    value = TemplateDraft(name="parameterized loft")
    value.sketch.plane = plane
    value.geometryRecipe.operations[0].operator = "solid.loft"
    value.geometryRecipe.operations[0].argumentExpressions = {}
    value.geometryRecipe.operations[0].arguments = {"stations": "0:1;length * 0.15:0.6;length * 0.3:1.25"}
    result = execute_plan(lower_to_plan(value, {"record":{"code":"Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert result.metrics.volume > 0


def test_loft_preserves_multi_region_hollow_topology(tmp_path) -> None:
    value = TemplateDraft(name="hollow loft")
    value.sketch = value.sketch.model_validate({
        "profileMode":"multiRegion",
        "entities":[
            {"id":"circle.outer","role":"section.outer","geometryType":"circle","center":(0,0),"radius":50},
            {"id":"circle.inner","role":"section.inner","geometryType":"circle","center":(0,0),"radius":30},
        ],
        "constraints":[
            {"id":"outer.fixed","constraintType":"fixed","entityRefs":["circle.outer"]},
            {"id":"inner.fixed","constraintType":"fixed","entityRefs":["circle.inner"]},
            {"id":"circles.concentric","constraintType":"concentric","entityRefs":["circle.outer","circle.inner"]},
        ],
        "regions":[
            {"id":"region.outer","boundaryRefs":["circle.outer"],"operation":"add"},
            {"id":"region.inner","boundaryRefs":["circle.inner"],"operation":"subtract"},
        ],
    })
    value.geometryRecipe.operations[0].operator = "solid.loft"
    value.geometryRecipe.operations[0].argumentExpressions = {}
    value.geometryRecipe.operations[0].arguments = {"stations":"0:1;200:0.6"}
    result = execute_plan(lower_to_plan(value, {"record":{"code":"Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert 0 < result.metrics.volume < math.pi * 50**2 * 200


def test_sheet_bend_compiles_single_continuous_solid(tmp_path) -> None:
    result = _compile_operator(tmp_path, "sheet.bend", {
        "length": 300,
        "width": 80,
        "thickness": 2,
        "bendPosition": 180,
        "bendAngleDegrees": 90,
        "insideRadius": 3,
        "kFactor": 0.42,
    })
    assert result.success, result.diagnostics
    assert result.metrics is not None and result.metrics.solidCount == 1
    assert result.metrics.volume == pytest.approx(300 * 80 * 2, rel=0.02)


def test_constraint_contract_rejects_wrong_selection_count_and_type() -> None:
    value = TemplateDraft(name="invalid constraint selection")
    value.sketch.constraints.append(
        value.sketch.constraints[0].model_validate({
            "id":"invalid.perpendicular",
            "constraintType":"perpendicular",
            "entityRefs":["edge.bottom"],
        })
    )
    value.sketch.constraints.append(
        value.sketch.constraints[0].model_validate({
            "id":"invalid.radius",
            "constraintType":"radius",
            "entityRefs":["edge.bottom"],
            "value":10,
        })
    )
    solution = solve_semantic_sketch(value)
    codes = {item["code"] for item in solution["diagnostics"]}
    assert "SKETCH_CONSTRAINT_SELECTION_INVALID" in codes
    assert "SKETCH_CONSTRAINT_ENTITY_TYPE_INVALID" in codes
