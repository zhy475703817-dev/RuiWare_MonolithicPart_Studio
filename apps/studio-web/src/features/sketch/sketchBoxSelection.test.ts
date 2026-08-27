import { describe, expect, it } from "vitest";

import type { SketchPrimitive } from "../../types";
import { pointOnCircle } from "./sketchArc";
import {
  isSketchPrimitiveInSelectionBox,
  normalizeSketchSelectionBox,
  selectSketchPrimitives,
  sketchSelectionBoxHasArea,
  type SketchSelectionBox,
} from "./sketchBoxSelection";

const point = (id: string, x: number, y: number): SketchPrimitive => ({
  id,
  role: "section.point",
  type: "point",
  construction: false,
  start: { x, y },
});

const line = (
  id: string,
  start: [number, number],
  end: [number, number],
): SketchPrimitive => ({
  id,
  role: "section.edge",
  type: "line",
  construction: false,
  start: { x: start[0], y: start[1] },
  end: { x: end[0], y: end[1] },
});

const circle = (id: string, center: [number, number], radius: number): SketchPrimitive => ({
  id,
  role: "section.circle",
  type: "circle",
  construction: false,
  center: { x: center[0], y: center[1] },
  radius,
});

const arc = (id: string): SketchPrimitive => ({
  id,
  role: "section.arc",
  type: "arc",
  construction: false,
  center: { x: 0, y: 0 },
  radius: 10,
  start: (() => {
    const [x, y] = pointOnCircle([0, 0], 10, 0);
    return { x, y };
  })(),
  end: (() => {
    const [x, y] = pointOnCircle([0, 0], 10, 180);
    return { x, y };
  })(),
  startAngle: 0,
  endAngle: 180,
  largeArc: false,
});

const box = (start: [number, number], end: [number, number]): SketchSelectionBox =>
  normalizeSketchSelectionBox(
    { x: start[0], y: start[1] },
    { x: end[0], y: end[1] },
  );

describe("二维草图右键框选几何判断", () => {
  it("normalizes reverse drag coordinates and preserves zero-size boxes", () => {
    expect(box([10, 8], [-2, -4])).toEqual({
      minimumX: -2,
      maximumX: 10,
      minimumY: -4,
      maximumY: 8,
    });
    expect(box([3, 3], [3, 3])).toEqual({
      minimumX: 3,
      maximumX: 3,
      minimumY: 3,
      maximumY: 3,
    });
    expect(sketchSelectionBoxHasArea(box([0, 0], [3, 3]))).toBe(true);
    expect(sketchSelectionBoxHasArea(box([0, 0], [0, 3]))).toBe(false);
    expect(sketchSelectionBoxHasArea(box([0, 0], [3, 0]))).toBe(false);
    expect(
      isSketchPrimitiveInSelectionBox(point("on-line-box", 3, 3), box([3, 3], [3, 3]), "contain"),
    ).toBe(false);
  });

  it("uses complete geometry bounds for left-to-right containment", () => {
    const selection = box([-2, -2], [12, 12]);
    expect(isSketchPrimitiveInSelectionBox(point("p", 2, 3), selection, "contain")).toBe(true);
    expect(isSketchPrimitiveInSelectionBox(line("inside", [0, 0], [10, 10]), selection, "contain")).toBe(true);
    expect(isSketchPrimitiveInSelectionBox(line("partial", [-4, 0], [4, 0]), selection, "contain")).toBe(false);
    expect(isSketchPrimitiveInSelectionBox(circle("circle", [5, 5], 4), selection, "contain")).toBe(true);
    expect(isSketchPrimitiveInSelectionBox(arc("arc"), selection, "contain")).toBe(false);
  });

  it("selects crossing lines and arcs on right-to-left drag", () => {
    const selection = box([8, -2], [12, 2]);
    expect(isSketchPrimitiveInSelectionBox(line("cross", [5, 0], [12, 0]), selection, "cross")).toBe(true);
    expect(isSketchPrimitiveInSelectionBox(line("outside", [3, 3], [5, 5]), selection, "cross")).toBe(false);
    expect(isSketchPrimitiveInSelectionBox(arc("arc"), selection, "cross")).toBe(true);
  });

  it("handles circle boundary contact without using only the center", () => {
    expect(isSketchPrimitiveInSelectionBox(circle("touch", [5, 0], 3), box([0, -3], [2, 3]), "cross")).toBe(true);
    expect(isSketchPrimitiveInSelectionBox(circle("center-only", [0, 0], 10), box([-1, -1], [1, 1]), "cross")).toBe(false);
  });

  it("returns stable ids and supports batch selection", () => {
    const primitives = [
      point("point", 1, 1),
      line("line", [2, 2], [4, 4]),
      circle("circle", [30, 30], 2),
    ];
    expect(selectSketchPrimitives(primitives, box([0, 0], [5, 5]), "contain")).toEqual([
      "point",
      "line",
    ]);
  });
});
