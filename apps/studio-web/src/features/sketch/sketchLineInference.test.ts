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
