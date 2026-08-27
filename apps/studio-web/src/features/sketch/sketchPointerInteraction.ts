export const SKETCH_POINTER_DRAG_THRESHOLD_PX = 4;

export type SketchPointerHit = "control" | "entity" | "background" | "other";

export type SketchPointerOperation =
  | {
      kind: "dragging-entity";
      pointerId: number;
      entityId: string;
    }
  | {
      kind: "editing-handle";
      pointerId: number;
      entityId: string;
      handleId: string;
    }
  | {
      kind: "panning-canvas";
      pointerId: number;
      button: 0 | 1;
    }
  | {
      kind: "box-selecting";
      pointerId: number;
      button: 2;
    };

export function resolveSketchPointerIntent(
  button: number,
  hit: SketchPointerHit,
): SketchPointerOperation["kind"] | null {
  if (button === 1) return "panning-canvas";
  if (button === 2) return "box-selecting";
  if (button !== 0) return null;
  if (hit === "control") return "editing-handle";
  if (hit === "entity") return "dragging-entity";
  if (hit === "background") return "panning-canvas";
  return null;
}

export function tryBeginSketchPointerOperation(
  active: SketchPointerOperation | null,
  requested: SketchPointerOperation,
): SketchPointerOperation | null {
  return active ? null : requested;
}

export function sketchPointerMovedPastThreshold(
  origin: { x: number; y: number },
  current: { x: number; y: number },
  thresholdPx = SKETCH_POINTER_DRAG_THRESHOLD_PX,
) {
  return Math.hypot(current.x - origin.x, current.y - origin.y) >= thresholdPx;
}

export function operationOwnsPointer(
  operation: SketchPointerOperation | null,
  pointerId: number,
) {
  return operation?.pointerId === pointerId;
}

export function endSketchPointerOperation(
  operation: SketchPointerOperation | null,
  pointerId: number,
) {
  return operationOwnsPointer(operation, pointerId) ? null : operation;
}
