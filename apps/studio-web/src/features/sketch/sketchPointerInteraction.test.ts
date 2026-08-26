import { describe, expect, it } from "vitest";

import {
  endSketchPointerOperation,
  operationOwnsPointer,
  resolveSketchPointerIntent,
  SKETCH_POINTER_DRAG_THRESHOLD_PX,
  sketchPointerMovedPastThreshold,
  tryBeginSketchPointerOperation,
  type SketchPointerOperation,
} from "./sketchPointerInteraction";

describe("二维草图指针操作状态机", () => {
  it("prioritizes controls and entities over left-button canvas panning", () => {
    expect(resolveSketchPointerIntent(0, "control")).toBe("dragging-entity");
    expect(resolveSketchPointerIntent(0, "entity")).toBe("dragging-entity");
    expect(resolveSketchPointerIntent(0, "background")).toBe("panning-canvas");
    expect(resolveSketchPointerIntent(0, "other")).toBeNull();
  });

  it("keeps middle-button canvas panning available over any hit target", () => {
    expect(resolveSketchPointerIntent(1, "control")).toBe("panning-canvas");
    expect(resolveSketchPointerIntent(1, "entity")).toBe("panning-canvas");
    expect(resolveSketchPointerIntent(1, "background")).toBe(
      "panning-canvas",
    );
  });

  it("does not start unsupported pointer buttons", () => {
    expect(resolveSketchPointerIntent(2, "background")).toBeNull();
    expect(resolveSketchPointerIntent(2, "entity")).toBeNull();
  });

  it("allows only one entity-drag or canvas-pan operation at a time", () => {
    const drag: SketchPointerOperation = {
      kind: "dragging-entity",
      pointerId: 7,
      entityId: "edge.1",
    };
    const pan: SketchPointerOperation = {
      kind: "panning-canvas",
      pointerId: 7,
      button: 0,
    };

    expect(tryBeginSketchPointerOperation(null, drag)).toEqual(drag);
    expect(tryBeginSketchPointerOperation(drag, pan)).toBeNull();
    expect(tryBeginSketchPointerOperation(pan, drag)).toBeNull();
  });

  it("uses a stable screen-pixel threshold for click versus drag", () => {
    expect(SKETCH_POINTER_DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(3);
    expect(SKETCH_POINTER_DRAG_THRESHOLD_PX).toBeLessThanOrEqual(5);
    expect(
      sketchPointerMovedPastThreshold({ x: 10, y: 10 }, { x: 13, y: 10 }),
    ).toBe(false);
    expect(
      sketchPointerMovedPastThreshold({ x: 10, y: 10 }, { x: 14, y: 10 }),
    ).toBe(true);
  });

  it("keeps the original operation after the pointer leaves its initial target", () => {
    const drag: SketchPointerOperation = {
      kind: "dragging-entity",
      pointerId: 11,
      entityId: "edge.2",
    };

    expect(operationOwnsPointer(drag, 11)).toBe(true);
    expect(resolveSketchPointerIntent(0, "background")).toBe("panning-canvas");
    expect(drag.kind).toBe("dragging-entity");
  });

  it("clears only the operation owned by the ending pointer", () => {
    const pan: SketchPointerOperation = {
      kind: "panning-canvas",
      pointerId: 19,
      button: 0,
    };

    expect(endSketchPointerOperation(pan, 18)).toEqual(pan);
    expect(endSketchPointerOperation(pan, 19)).toBeNull();
    expect(endSketchPointerOperation(null, 19)).toBeNull();
  });
});
