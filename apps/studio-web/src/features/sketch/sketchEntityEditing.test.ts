import { describe, expect, it } from "vitest";

import type { Draft } from "../../types";
import { pointOnCircle } from "./sketchArc";
import {
  editSketchEntitiesAtHandle,
  findSketchRectangleGroup,
  getSketchEntityControls,
  MIN_SKETCH_ENTITY_SIZE,
  sketchEntityEditHint,
  sketchEntityGeometryIsFinite,
  translateSketchEntities,
  type SketchEntityEditTarget,
} from "./sketchEntityEditing";

type SketchEntity = Draft["sketch"]["entities"][number];

const entity = (patch: Partial<SketchEntity>): SketchEntity => ({
  id: "entity.1",
  role: "section.generic",
  geometryType: "line",
  parameterRefs: [],
  construction: false,
  start: null,
  end: null,
  center: null,
  radius: null,
  startAngle: null,
  endAngle: null,
  largeArc: null,
  points: [],
  ...patch,
});

const rectangle = (base = "rectangle.test") => {
  const corners: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
  ];
  return corners.map((start, index) =>
    entity({
      id: `${base}.${index + 1}`,
      role: `section.rectangle.edge.${index + 1}`,
      start,
      end: corners[(index + 1) % corners.length],
    }),
  );
};

const circle = () =>
  entity({
    id: "circle.1",
    role: "section.circle",
    geometryType: "circle",
    center: [2, 3],
    radius: 5,
  });

const arc = (
  startAngle = 350,
  endAngle = 10,
  largeArc = false,
) => {
  const center: [number, number] = [1, 2];
  const radius = 5;
  return entity({
    id: "arc.1",
    role: "section.arc",
    geometryType: "arc",
    center,
    radius,
    startAngle,
    endAngle,
    largeArc,
    start: pointOnCircle(center, radius, startAngle),
    end: pointOnCircle(center, radius, endAngle),
  });
};

const target = (
  controls: ReturnType<typeof getSketchEntityControls>,
  kind: ReturnType<typeof getSketchEntityControls>[number]["kind"],
  index = 0,
) => {
  const matching = controls.filter((control) => control.kind === kind)[index];
  expect(matching?.editTarget).toBeTruthy();
  return matching.editTarget as SketchEntityEditTarget;
};

const expectClosed = (entities: SketchEntity[]) => {
  entities.forEach((item, index) => {
    expect(item.end).toEqual(entities[(index + 1) % entities.length].start);
  });
};

describe("二维草图图元控制点", () => {
  it("shows no controls for an unselected entity", () => {
    expect(getSketchEntityControls([circle()], [])).toEqual([]);
  });

  it("shows four corners and four edge handles for a selected rectangle", () => {
    const entities = rectangle();
    const controls = getSketchEntityControls(
      entities,
      entities.map((item) => item.id),
    );
    expect(controls.filter((control) => control.kind === "corner")).toHaveLength(4);
    expect(controls.filter((control) => control.kind === "edge")).toHaveLength(4);
  });

  it("does not expose rectangle handles for only one selected edge", () => {
    const entities = rectangle();
    expect(getSketchEntityControls(entities, [entities[0].id])).toEqual([]);
  });

  it("shows center and radius controls for a selected circle", () => {
    expect(getSketchEntityControls([circle()], ["circle.1"]).map((item) => item.kind))
      .toEqual(["center", "radius"]);
  });

  it("shows center, endpoints and radius controls for a selected arc", () => {
    expect(getSketchEntityControls([arc()], ["arc.1"]).map((item) => item.kind))
      .toEqual(["center", "start", "end", "radius"]);
  });
});

describe("矩形控制点编辑", () => {
  it("recognizes the existing four-line rectangle representation", () => {
    const group = findSketchRectangleGroup(rectangle(), "rectangle.test.2");
    expect(group).toMatchObject({ width: 10, height: 5 });
    expect(group?.entityIds).toEqual([
      "rectangle.test.1",
      "rectangle.test.2",
      "rectangle.test.3",
      "rectangle.test.4",
    ]);
  });

  it("recognizes a generic four-line orthogonal loop without rectangle ids", () => {
    const ids = ["edge.bottom", "edge.right", "edge.top", "edge.left"];
    const generic = rectangle("generic.loop").map((item, index) => ({
      ...item,
      id: ids[index],
      role: `section.${ids[index]}`,
    }));
    const group = findSketchRectangleGroup(generic, "edge.right");
    expect(group).toMatchObject({ width: 10, height: 5 });
    expect(group?.entityIds).toEqual([
      "edge.right",
      "edge.top",
      "edge.left",
      "edge.bottom",
    ]);
    const controls = getSketchEntityControls(generic, group!.entityIds);
    expect(controls).toHaveLength(8);
    const edited = editSketchEntitiesAtHandle(
      generic,
      target(controls, "edge", 0),
      [13, 2.5],
    );
    expect(edited).toMatchObject({ width: 13, height: 5 });
    expectClosed(findSketchRectangleGroup(edited!.entities, "edge.right")!.entities);
  });

  it("changes width and height from a corner while keeping the opposite corner", () => {
    const before = rectangle();
    const controls = getSketchEntityControls(before, before.map((item) => item.id));
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "corner", 0),
      [-3, -2],
    );
    expect(result).toMatchObject({ width: 13, height: 7 });
    const group = findSketchRectangleGroup(result!.entities, before[0].id)!;
    expect(group.corners[2]).toEqual([10, 5]);
    expectClosed(group.entities);
  });

  it("changes only width from a vertical edge midpoint", () => {
    const before = rectangle();
    const controls = getSketchEntityControls(before, before.map((item) => item.id));
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "edge", 1),
      [14, 2.5],
    );
    expect(result).toMatchObject({ width: 14, height: 5 });
    const group = findSketchRectangleGroup(result!.entities, before[0].id)!;
    expect(group.corners[0]).toEqual([0, 0]);
    expect(group.corners[3]).toEqual([0, 5]);
    expectClosed(group.entities);
  });

  it("changes only height from a horizontal edge midpoint", () => {
    const before = rectangle();
    const controls = getSketchEntityControls(before, before.map((item) => item.id));
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "edge", 0),
      [5, -3],
    );
    expect(result).toMatchObject({ width: 10, height: 8 });
    expectClosed(
      findSketchRectangleGroup(result!.entities, before[0].id)!.entities,
    );
  });

  it("clamps a handle before it can cross the opposite side", () => {
    const before = rectangle();
    const controls = getSketchEntityControls(before, before.map((item) => item.id));
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "corner", 0),
      [20, 20],
    );
    expect(result!.width).toBeCloseTo(MIN_SKETCH_ENTITY_SIZE);
    expect(result!.height).toBeCloseTo(MIN_SKETCH_ENTITY_SIZE);
    expect(sketchEntityGeometryIsFinite(result!.entities)).toBe(true);
  });

  it("reports live width and height in sketch units", () => {
    const before = rectangle();
    const controls = getSketchEntityControls(before, before.map((item) => item.id));
    const handle = target(controls, "corner", 0);
    expect(sketchEntityEditHint(before, handle)?.lines).toEqual([
      "W 10.00 mm",
      "H 5.00 mm",
    ]);
  });
});

describe("圆和圆弧控制点编辑", () => {
  it("changes only a circle radius using center-to-pointer distance", () => {
    const before = [circle()];
    const controls = getSketchEntityControls(before, ["circle.1"]);
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "radius"),
      [5, 7],
    )!;
    expect(result.radius).toBe(5);
    expect(result.entities[0].center).toEqual([2, 3]);
    expect(before[0].radius).toBe(5);
  });

  it("prevents a circle from reaching zero radius", () => {
    const before = [circle()];
    const controls = getSketchEntityControls(before, ["circle.1"]);
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "radius"),
      [2, 3],
    )!;
    expect(result.radius).toBe(MIN_SKETCH_ENTITY_SIZE);
  });

  it("changes an arc radius while preserving center and endpoint angles", () => {
    const before = [arc(20, 140)];
    const controls = getSketchEntityControls(before, ["arc.1"]);
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "radius"),
      [1, 12],
    )!;
    expect(result.radius).toBe(10);
    expect(result.entities[0]).toMatchObject({
      center: [1, 2],
      startAngle: 20,
      endAngle: 140,
    });
  });

  it("moves an arc start handle on the fixed-radius circle", () => {
    const before = [arc(350, 10)];
    const controls = getSketchEntityControls(before, ["arc.1"]);
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "start"),
      pointOnCircle([1, 2], 5, 340),
    )!;
    expect(result.entities[0]).toMatchObject({
      radius: 5,
      startAngle: 340,
      endAngle: 10,
      largeArc: false,
    });
    expect(result.sweepDegrees).toBe(30);
  });

  it("moves an arc end handle correctly across zero degrees", () => {
    const before = [arc(350, 10)];
    const controls = getSketchEntityControls(before, ["arc.1"]);
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "end"),
      pointOnCircle([1, 2], 5, 30),
    )!;
    expect(result.entities[0].endAngle).toBe(30);
    expect(result.sweepDegrees).toBe(40);
  });

  it("preserves clockwise arc direction while editing its range", () => {
    const before = [arc(10, 350)];
    const controls = getSketchEntityControls(before, ["arc.1"]);
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "start"),
      pointOnCircle([1, 2], 5, 30),
    )!;
    expect(result.sweepDegrees).toBe(-40);
    expect(result.entities[0].largeArc).toBe(false);
  });

  it("does not allow arc endpoints to collapse into an invalid range", () => {
    const before = [arc(350, 10)];
    const controls = getSketchEntityControls(before, ["arc.1"]);
    const result = editSketchEntitiesAtHandle(
      before,
      target(controls, "end"),
      pointOnCircle([1, 2], 5, 350),
    )!;
    expect(Math.abs(result.sweepDegrees!)).toBeGreaterThanOrEqual(0.1);
    expect(sketchEntityGeometryIsFinite(result.entities)).toBe(true);
  });
});

describe("整体移动和几何安全", () => {
  it("moves a circle center without changing its radius", () => {
    const moved = translateSketchEntities([circle()], ["circle.1"], [4, -2]);
    expect(moved[0].center).toEqual([6, 1]);
    expect(moved[0].radius).toBe(5);
  });

  it("moves an arc without changing radius or angular range", () => {
    const before = arc(350, 10);
    const moved = translateSketchEntities([before], [before.id], [-3, 4])[0];
    expect(moved.center).toEqual([-2, 6]);
    expect(moved).toMatchObject({ radius: 5, startAngle: 350, endAngle: 10 });
  });

  it("does not move entities outside the requested rigid group", () => {
    const before = [circle(), arc()];
    const moved = translateSketchEntities(before, ["circle.1"], [1, 1]);
    expect(moved[1]).toEqual(before[1]);
  });

  it("rejects zero, negative, NaN and infinite geometry", () => {
    expect(sketchEntityGeometryIsFinite([circle()])).toBe(true);
    expect(sketchEntityGeometryIsFinite([entity({ geometryType: "circle", center: [0, 0], radius: 0 })])).toBe(false);
    expect(sketchEntityGeometryIsFinite([entity({ geometryType: "circle", center: [0, 0], radius: -1 })])).toBe(false);
    expect(sketchEntityGeometryIsFinite([entity({ start: [Number.NaN, 0] })])).toBe(false);
    expect(sketchEntityGeometryIsFinite([entity({ end: [Number.POSITIVE_INFINITY, 0] })])).toBe(false);
  });
});
