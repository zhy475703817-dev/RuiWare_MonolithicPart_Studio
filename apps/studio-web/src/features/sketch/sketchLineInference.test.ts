import { describe, expect, it } from "vitest";

import type { Draft } from "../../types";
import {
  buildLineInferenceConstraint,
  layoutLineDimensionLabel,
  LINE_DIMENSION_HINT_PRESENTATION,
  linePreviewMetrics,
  resolveSketchLineInference,
} from "./sketchLineInference";
import type { SketchDrawPoint } from "./sketchObjectSnap";

type SketchEntity = Draft["sketch"]["entities"][number];

const anchor = (x = 0, y = 0): SketchDrawPoint => ({
  x,
  y,
  snapTarget: null,
});

const line = (
  id: string,
  start: [number, number],
  end: [number, number],
): SketchEntity => ({
  id,
  role: `参照 ${id}`,
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
  role: `圆弧 ${id}`,
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

describe("二维草图动态几何推断", () => {
  it("calculates preview length and horizontal-axis angle in sketch units", () => {
    expect(linePreviewMetrics({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({
      length: 5,
      angleDegrees: 53.13010235415598,
    });
  });

  it("recognizes and snaps horizontal and vertical directions", () => {
    const horizontal = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 2 },
      entities: [],
      worldToViewScale: 3,
    });
    const vertical = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 2, y: 20 },
      entities: [],
      worldToViewScale: 3,
    });

    expect(horizontal.inference?.kind).toBe("horizontal");
    expect(horizontal.point).toEqual([20, 0]);
    expect(vertical.inference?.kind).toBe("vertical");
    expect(vertical.point).toEqual([0, 20]);
  });

  it("recognizes parallel inference relative to an existing line", () => {
    const reference = line("edge.reference", [0, 0], [20, 10]);
    const result = resolveSketchLineInference({
      anchor: anchor(0, 5),
      pointer: { x: 20, y: 15.4 },
      entities: [reference],
      worldToViewScale: 2,
    });

    expect(result.inference).toMatchObject({
      kind: "parallel",
      referenceEntityId: reference.id,
      referenceLabel: reference.role,
    });
  });

  it("recognizes perpendicular inference relative to an existing line", () => {
    const reference = line("edge.reference", [0, 0], [20, 10]);
    const result = resolveSketchLineInference({
      anchor: anchor(10, 5),
      pointer: { x: 5.7, y: 14 },
      entities: [reference],
      worldToViewScale: 2,
    });

    expect(result.inference).toMatchObject({
      kind: "perpendicular",
      referenceEntityId: reference.id,
    });
  });

  it("snaps a line from an arc start to its analytic CCW tangent", () => {
    const reference = arc("arc.ccw", "ccw");
    const result = resolveSketchLineInference({
      anchor: {
        x: 10,
        y: 0,
        snapTarget: {
          kind: "arcEndpoint",
          entityId: reference.id,
          handle: "start",
          point: [10, 0],
          createsConstraint: true,
        },
      },
      pointer: { x: 10.5, y: 20 },
      entities: [reference],
      worldToViewScale: 1,
      tolerances: { enterViewPx: 1 },
    });

    expect(result.inference).toMatchObject({
      kind: "tangent",
      referenceEntityId: reference.id,
      referenceHandle: "start",
      referenceTangent: [0, 1],
    });
    expect(result.point[0]).toBe(10);
    expect(result.point[1]).toBeCloseTo(20.01, 2);
  });

  it("supports CW end tangents and a line drawn in reverse direction", () => {
    const reference = arc("arc.cw.major", "cw", true);
    const result = resolveSketchLineInference({
      anchor: {
        x: 0,
        y: 10,
        snapTarget: {
          kind: "arcEndpoint",
          entityId: reference.id,
          handle: "end",
          point: [0, 10],
          createsConstraint: true,
        },
      },
      pointer: { x: -20, y: 10.5 },
      entities: [reference],
      worldToViewScale: 1,
      tolerances: { enterViewPx: 1 },
    });

    expect(result.inference).toMatchObject({
      kind: "tangent",
      referenceHandle: "end",
      referenceTangent: [1, 0],
    });
    expect(result.point[0]).toBe(-20.01);
    expect(result.point[1]).toBe(10);
  });

  it("accepts a near-tangent direction within the seven-degree tolerance", () => {
    const reference = arc("arc.tolerance", "ccw");
    const radians = (6 * Math.PI) / 180;
    const result = resolveSketchLineInference({
      anchor: {
        x: 10,
        y: 0,
        snapTarget: {
          kind: "arcEndpoint",
          entityId: reference.id,
          handle: "start",
          point: [10, 0],
          createsConstraint: true,
        },
      },
      pointer: {
        x: 10 + 20 * Math.sin(radians),
        y: 20 * Math.cos(radians),
      },
      entities: [reference],
      worldToViewScale: 1,
      tolerances: { enterViewPx: 1 },
    });

    expect(result.inference?.kind).toBe("tangent");
    expect(result.inference?.angleErrorDegrees).toBeLessThanOrEqual(7);
  });

  it("does not latch a direction outside the tangent tolerance", () => {
    const reference = arc("arc.outside-tolerance", "ccw");
    const radians = (12 * Math.PI) / 180;
    const result = resolveSketchLineInference({
      anchor: {
        x: 10,
        y: 0,
        snapTarget: {
          kind: "arcEndpoint",
          entityId: reference.id,
          handle: "start",
          point: [10, 0],
          createsConstraint: true,
        },
      },
      pointer: {
        x: 10 + 20 * Math.sin(radians),
        y: 20 * Math.cos(radians),
      },
      entities: [reference],
      worldToViewScale: 1,
      tolerances: { enterViewPx: 1 },
    });

    expect(result.inference).toBeNull();
    expect(result.point[0]).toBeCloseTo(14.16, 2);
    expect(result.point[1]).toBeCloseTo(19.56, 2);
  });

  it("uses view-space thresholds consistently at different zoom scales", () => {
    const zoomedOut = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 3 },
      entities: [],
      worldToViewScale: 2,
    });
    const zoomedIn = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 0.6 },
      entities: [],
      worldToViewScale: 10,
    });

    expect(zoomedOut.inference?.deviationViewPx).toBe(6);
    expect(zoomedIn.inference?.deviationViewPx).toBe(6);
    expect(zoomedOut.inference?.kind).toBe("horizontal");
    expect(zoomedIn.inference?.kind).toBe("horizontal");
  });

  it("selects the nearest stable reference when multiple lines qualify", () => {
    const near = line("edge.near", [0, 0.5], [20, 10.5]);
    const far = line("edge.far", [0, 5], [20, 15]);
    const result = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 10.5 },
      entities: [far, near],
      worldToViewScale: 2,
    });

    expect(result.inference).toMatchObject({
      kind: "parallel",
      referenceEntityId: near.id,
    });
  });

  it("keeps a latched inference inside exit tolerance and clears it outside", () => {
    const entered = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 3 },
      entities: [],
      worldToViewScale: 2,
    });
    const retained = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 5 },
      entities: [],
      worldToViewScale: 2,
      previous: entered.inference,
    });
    const exited = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 6 },
      entities: [],
      worldToViewScale: 2,
      previous: retained.inference,
    });

    expect(retained.inference?.kind).toBe("horizontal");
    expect(exited.inference).toBeNull();
    expect(exited.point).toEqual([20, 6]);
  });

  it("gives precise object snap priority over directional inference", () => {
    const result = resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 1 },
      entities: [],
      worldToViewScale: 4,
      preciseSnap: {
        point: [19.25, 1.75],
        target: {
          kind: "lineEndpoint",
          entityId: "edge.existing",
          handle: "end",
          point: [19.25, 1.75],
          createsConstraint: true,
        },
      },
    });

    expect(result.point).toEqual([19.25, 1.75]);
    expect(result.inference).toBeNull();
  });

  it("does not mutate formal entities while resolving mouse movement", () => {
    const entities = [line("edge.reference", [0, 0], [20, 10])];
    const before = structuredClone(entities);

    resolveSketchLineInference({
      anchor: anchor(),
      pointer: { x: 20, y: 10.2 },
      entities,
      worldToViewScale: 2,
    });

    expect(entities).toEqual(before);
  });

  it("builds the matching automatic constraint without a permanent dimension", () => {
    const reference = line("edge.reference", [0, 0], [20, 10]);
    const preview = resolveSketchLineInference({
      anchor: anchor(0, 5),
      pointer: { x: 20, y: 15.2 },
      entities: [reference],
      selectedEntityIds: [reference.id],
      worldToViewScale: 2,
    });
    const created = line("edge.new", [0, 5], preview.point);
    const constraints = buildLineInferenceConstraint(
      created.id,
      preview.inference,
      [reference, created],
      [],
      () => "constraint.inference.1",
    );

    expect(created.end).toEqual(preview.point);
    expect(constraints).toEqual([
      expect.objectContaining({
        id: "constraint.inference.1",
        constraintType: "parallel",
        entityRefs: [created.id, reference.id],
      }),
    ]);
    expect(constraints.some((item) => item.constraintType === "distance")).toBe(
      false,
    );
  });

  it("does not create a permanent tangent constraint during drawing inference", () => {
    const reference = arc("arc.constraint", "ccw");
    const preview = resolveSketchLineInference({
      anchor: {
        x: 10,
        y: 0,
        snapTarget: {
          kind: "arcEndpoint",
          entityId: reference.id,
          handle: "start",
          point: [10, 0],
          createsConstraint: true,
        },
      },
      pointer: { x: 10, y: 20 },
      entities: [reference],
      worldToViewScale: 1,
    });
    const created = line("edge.tangent", [10, 0], preview.point);
    expect(preview.inference?.kind).toBe("tangent");
    expect(
      buildLineInferenceConstraint(
        created.id,
        preview.inference,
        [reference, created],
        [],
        () => "constraint.tangent",
      ),
    ).toEqual([]);
  });

  it("keeps dimension labels inside the canvas near an edge", () => {
    const layout = layoutLineDimensionLabel(
      { x: 440, y: 8 },
      { x: 459, y: 8 },
    );

    expect(layout.x).toBeGreaterThanOrEqual(6);
    expect(layout.x + 116).toBeLessThanOrEqual(454);
    expect(layout.y).toBeGreaterThanOrEqual(6);
    expect(layout.y + 34).toBeLessThanOrEqual(324);
  });

  it("uses a translucent background without fading dimension text", () => {
    expect(
      LINE_DIMENSION_HINT_PRESENTATION.backgroundOpacity,
    ).toBeGreaterThanOrEqual(0.1);
    expect(
      LINE_DIMENSION_HINT_PRESENTATION.backgroundOpacity,
    ).toBeLessThanOrEqual(0.2);
    expect(LINE_DIMENSION_HINT_PRESENTATION.textOpacity).toBe(1);
    expect(LINE_DIMENSION_HINT_PRESENTATION.pointerEvents).toBe("none");
  });
});
