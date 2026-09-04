import { describe, expect, it } from "vitest";

import type { Draft } from "../../types";
import {
  arcEndpointTangent,
  buildLineSnapCoincidentConstraints,
  endpointSnapToleranceMm,
  resolveSketchSnap,
  sketchDrawPointFromSnap,
} from "./sketchObjectSnap";

type SketchEntity = Draft["sketch"]["entities"][number];

const line = (
  id: string,
  start: [number, number],
  end: [number, number],
): SketchEntity => ({
  id,
  role: id,
  geometryType: "line",
  parameterRefs: [],
  construction: false,
  start,
  end,
  center: null,
  radius: null,
  startAngle: null,
  endAngle: null,
  points: [],
});

const arc = (
  id: string,
  sweepDirection: "ccw" | "cw",
  largeArc = false,
): SketchEntity => ({
  id,
  role: id,
  geometryType: "arc",
  parameterRefs: [],
  construction: false,
  start: [10, 0],
  end: [0, 10],
  center: [0, 0],
  radius: 10,
  startAngle: 0,
  endAngle: 90,
  largeArc,
  sweepDirection,
  points: [],
});

describe("二维草图端点吸附", () => {
  it("returns the existing endpoint without losing coordinate precision", () => {
    const existing = line("edge.existing", [1.234567, 2.345678], [20, 2]);

    const hit = resolveSketchSnap(
      { x: 1.5, y: 2.5 },
      [existing],
      { enabled: true, toleranceMm: 1, kinds: ["lineEndpoint"] },
    );

    expect(hit.target).toMatchObject({
      kind: "lineEndpoint",
      entityId: existing.id,
      handle: "start",
    });
    expect(sketchDrawPointFromSnap(hit)).toMatchObject({
      x: existing.start![0],
      y: existing.start![1],
    });
  });

  it("creates a coincident constraint for the snapped endpoint", () => {
    const existing = line("edge.existing", [0, 0], [10, 0]);
    const hit = resolveSketchSnap(
      { x: 10.4, y: 0.2 },
      [existing],
      { enabled: true, toleranceMm: 1, kinds: ["lineEndpoint"] },
    );
    const created = line("edge.new", [10, 0], [20, 8]);

    const constraints = buildLineSnapCoincidentConstraints(
      created.id,
      hit.target,
      null,
      [existing, created],
      [],
      () => "constraint.snap.1",
    );

    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({
      id: "constraint.snap.1",
      constraintType: "coincident",
      entityRefs: [created.id, existing.id],
      endpointRefs: ["start", "end"],
      enabled: true,
      driving: true,
    });
  });

  it("returns the unsnapped pointer when endpoint snapping is disabled", () => {
    const existing = line("edge.existing", [0, 0], [10, 0]);

    const hit = resolveSketchSnap(
      { x: 10.4, y: 0.2 },
      [existing],
      { enabled: false, toleranceMm: 1, kinds: ["lineEndpoint"] },
    );

    expect(hit).toEqual({ point: [10.4, 0.2], target: null });
  });

  it("snaps a drawing point to the interior of a line without a constraint target", () => {
    const existing = line("edge.existing", [0, 0], [10, 0]);
    const hit = resolveSketchSnap(
      { x: 5, y: 0.4 },
      [existing],
      { enabled: true, toleranceMm: 2, lineToleranceMm: 2, kinds: ["lineNearest"] },
    );

    expect(hit).toMatchObject({ point: [5, 0], target: { kind: "lineNearest", createsConstraint: false } });
  });

  it("snaps to an existing point without creating a relation", () => {
    const existing: SketchEntity = {
      id: "point.existing",
      role: "point.existing",
      geometryType: "point",
      parameterRefs: [],
      construction: true,
      start: [4, 6],
      end: null,
      center: null,
      radius: null,
      startAngle: null,
      endAngle: null,
      points: [],
    };
    const hit = resolveSketchSnap(
      { x: 4.3, y: 5.8 },
      [existing],
      { enabled: true, toleranceMm: 1, kinds: ["point"] },
    );

    expect(hit).toMatchObject({ point: [4, 6], target: { kind: "point", createsConstraint: false } });
  });

  it("snaps to a circle circumference without treating it as an endpoint", () => {
    const circle: SketchEntity = {
      id: "circle.existing",
      role: "circle.existing",
      geometryType: "circle",
      parameterRefs: [],
      construction: false,
      start: null,
      end: null,
      center: [0, 0],
      radius: 10,
      startAngle: null,
      endAngle: null,
      points: [],
    };
    const hit = resolveSketchSnap(
      { x: 10, y: 0.4 },
      [circle],
      { enabled: true, toleranceMm: 2, lineToleranceMm: 2, kinds: ["circleNearest"] },
    );

    expect(hit.target).toMatchObject({ kind: "circleNearest", entityId: circle.id, createsConstraint: false });
    expect(Math.hypot(hit.point[0], hit.point[1])).toBeCloseTo(10, 2);
  });

  it("restricts arc free-snap to the selected arc span", () => {
    const arc: SketchEntity = {
      id: "arc.existing",
      role: "arc.existing",
      geometryType: "arc",
      parameterRefs: [],
      construction: false,
      start: [10, 0],
      end: [0, 10],
      center: [0, 0],
      radius: 10,
      startAngle: 0,
      endAngle: 90,
      largeArc: false,
      points: [],
    };
    const hit = resolveSketchSnap(
      { x: 7.1, y: 7.1 },
      [arc],
      { enabled: true, toleranceMm: 1, lineToleranceMm: 1, kinds: ["arcNearest"] },
    );

    expect(hit.target).toMatchObject({ kind: "arcNearest", entityId: arc.id, createsConstraint: false });
    expect(hit.point[0]).toBeGreaterThan(0);
    expect(hit.point[1]).toBeGreaterThan(0);
  });

  it("resolves exact CCW tangents at both arc endpoints", () => {
    const existing = arc("arc.ccw", "ccw");
    expect(arcEndpointTangent(existing, "start")).toMatchObject({
      point: [10, 0],
      tangent: [0, 1],
      sweepDirection: "ccw",
    });
    expect(arcEndpointTangent(existing, "end")).toMatchObject({
      point: [0, 10],
      tangent: [-1, 0],
      sweepDirection: "ccw",
    });
  });

  it("resolves exact CW tangents, including major arcs", () => {
    const existing = arc("arc.cw.major", "cw", true);
    expect(arcEndpointTangent(existing, "start")).toMatchObject({
      point: [10, 0],
      tangent: [0, -1],
      sweepDirection: "cw",
    });
    expect(arcEndpointTangent(existing, "end")).toMatchObject({
      point: [0, 10],
      tangent: [1, 0],
      sweepDirection: "cw",
    });
  });

  it("keeps a stable view-space radius across zoom levels", () => {
    expect(endpointSnapToleranceMm(2)).toBe(5);
    expect(endpointSnapToleranceMm(20)).toBe(0.5);
    expect(endpointSnapToleranceMm(0)).toBe(2);
  });
});
