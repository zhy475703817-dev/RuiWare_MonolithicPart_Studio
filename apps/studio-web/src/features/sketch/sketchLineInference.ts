import type { Draft } from "../../types";
import { pointAngleDegrees } from "./sketchArc";
import {
  projectPointOntoLineSegment,
  type SketchDrawPoint,
  type SketchSnapHit,
} from "./sketchObjectSnap";

type SketchEntity = Draft["sketch"]["entities"][number];
type SketchConstraint = Draft["sketch"]["constraints"][number];

export type SketchLineInferenceKind =
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular";

export type SketchLineInference = {
  kind: SketchLineInferenceKind;
  point: [number, number];
  deviationViewPx: number;
  angleErrorDegrees: number;
  referenceEntityId: string | null;
  referenceLabel: string | null;
  referenceStart: [number, number] | null;
  referenceEnd: [number, number] | null;
  referenceNearestPoint: [number, number] | null;
};

export type SketchLineMetrics = {
  length: number;
  angleDegrees: number;
};

export type SketchLineInferenceTolerances = {
  enterViewPx: number;
  exitViewPx: number;
  referenceEnterViewPx: number;
  referenceExitViewPx: number;
};

export const DEFAULT_LINE_INFERENCE_TOLERANCES: SketchLineInferenceTolerances = {
  enterViewPx: 7,
  exitViewPx: 11,
  referenceEnterViewPx: 48,
  referenceExitViewPx: 64,
};

export const LINE_DIMENSION_HINT_PRESENTATION = {
  backgroundOpacity: 0.14,
  textOpacity: 1,
  pointerEvents: "none",
} as const;

type ResolveSketchLineInferenceOptions = {
  anchor: SketchDrawPoint;
  pointer: { x: number; y: number };
  entities: SketchEntity[];
  selectedEntityIds?: string[];
  worldToViewScale: number;
  preciseSnap?: SketchSnapHit | null;
  previous?: SketchLineInference | null;
  tolerances?: Partial<SketchLineInferenceTolerances>;
};

export type SketchLineInferenceResult = {
  point: [number, number];
  inference: SketchLineInference | null;
  metrics: SketchLineMetrics;
};

type RelationCandidate = {
  inference: SketchLineInference;
  referenceDistanceViewPx: number;
  selected: boolean;
};

const roundSketchCoordinate = (value: number) =>
  Math.round(value * 100) / 100;

const roundSketchPoint = (point: [number, number]): [number, number] => [
  roundSketchCoordinate(point[0]),
  roundSketchCoordinate(point[1]),
];

const validScale = (scale: number) =>
  Number.isFinite(scale) && scale > 0 ? scale : 1;

export function linePreviewMetrics(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SketchLineMetrics {
  return {
    length: Math.hypot(end.x - start.x, end.y - start.y),
    angleDegrees: pointAngleDegrees(
      [start.x, start.y],
      [end.x, end.y],
    ),
  };
}

const inferenceResult = (
  anchor: SketchDrawPoint,
  point: [number, number],
  inference: SketchLineInference | null,
): SketchLineInferenceResult => ({
  point,
  inference,
  metrics: linePreviewMetrics(anchor, { x: point[0], y: point[1] }),
});

const entityDirection = (entity: SketchEntity) => {
  if (entity.geometryType !== "line" || !entity.start || !entity.end) {
    return null;
  }
  const dx = entity.end[0] - entity.start[0];
  const dy = entity.end[1] - entity.start[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  return { x: dx / length, y: dy / length };
};

const angleErrorDegrees = (
  dx: number,
  dy: number,
  ux: number,
  uy: number,
) => {
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return 90;
  const cosine = Math.min(
    1,
    Math.max(-1, Math.abs((dx * ux + dy * uy) / length)),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
};

const axisInference = (
  kind: "horizontal" | "vertical",
  anchor: SketchDrawPoint,
  pointer: { x: number; y: number },
  scale: number,
): SketchLineInference => {
  const point = roundSketchPoint(
    kind === "horizontal"
      ? [pointer.x, anchor.y]
      : [anchor.x, pointer.y],
  );
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  return {
    kind,
    point,
    deviationViewPx:
      Math.abs(kind === "horizontal" ? dy : dx) * scale,
    angleErrorDegrees: angleErrorDegrees(
      dx,
      dy,
      kind === "horizontal" ? 1 : 0,
      kind === "horizontal" ? 0 : 1,
    ),
    referenceEntityId: null,
    referenceLabel: null,
    referenceStart: null,
    referenceEnd: null,
    referenceNearestPoint: null,
  };
};

const relationCandidate = (
  kind: "parallel" | "perpendicular",
  anchor: SketchDrawPoint,
  pointer: { x: number; y: number },
  entity: SketchEntity,
  scale: number,
  selected: boolean,
): RelationCandidate | null => {
  const direction = entityDirection(entity);
  if (!direction || !entity.start || !entity.end) return null;
  const ux = kind === "parallel" ? direction.x : -direction.y;
  const uy = kind === "parallel" ? direction.y : direction.x;
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const signedLength = dx * ux + dy * uy;
  const point = roundSketchPoint([
    anchor.x + signedLength * ux,
    anchor.y + signedLength * uy,
  ]);
  const nearest = projectPointOntoLineSegment(
    pointer,
    entity.start,
    entity.end,
  );
  if (!nearest) return null;
  return {
    selected,
    referenceDistanceViewPx: nearest.distance * scale,
    inference: {
      kind,
      point,
      deviationViewPx: Math.abs(dx * uy - dy * ux) * scale,
      angleErrorDegrees: angleErrorDegrees(dx, dy, ux, uy),
      referenceEntityId: entity.id,
      referenceLabel: entity.role || entity.id,
      referenceStart: [entity.start[0], entity.start[1]],
      referenceEnd: [entity.end[0], entity.end[1]],
      referenceNearestPoint: nearest.point,
    },
  };
};

const relationStillActive = (
  candidate: RelationCandidate | null,
  tolerances: SketchLineInferenceTolerances,
) =>
  !!candidate &&
  candidate.inference.deviationViewPx <= tolerances.exitViewPx &&
  (candidate.selected ||
    candidate.referenceDistanceViewPx <= tolerances.referenceExitViewPx);

export function resolveSketchLineInference({
  anchor,
  pointer,
  entities,
  selectedEntityIds = [],
  worldToViewScale,
  preciseSnap = null,
  previous = null,
  tolerances: toleranceOverrides,
}: ResolveSketchLineInferenceOptions): SketchLineInferenceResult {
  const scale = validScale(worldToViewScale);
  const tolerances = {
    ...DEFAULT_LINE_INFERENCE_TOLERANCES,
    ...toleranceOverrides,
  };
  if (preciseSnap?.target) {
    return inferenceResult(anchor, preciseSnap.point, null);
  }
  const freePoint = roundSketchPoint(
    preciseSnap?.point || [pointer.x, pointer.y],
  );
  const segmentLengthViewPx =
    Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) * scale;
  if (segmentLengthViewPx < 2) {
    return inferenceResult(anchor, freePoint, null);
  }

  if (previous?.kind === "horizontal" || previous?.kind === "vertical") {
    const latched = axisInference(previous.kind, anchor, pointer, scale);
    if (latched.deviationViewPx <= tolerances.exitViewPx) {
      return inferenceResult(anchor, latched.point, latched);
    }
  }

  const axes = (["horizontal", "vertical"] as const)
    .map((kind) => axisInference(kind, anchor, pointer, scale))
    .filter(
      (inference) =>
        inference.deviationViewPx <= tolerances.enterViewPx,
    )
    .sort(
      (left, right) =>
        left.deviationViewPx - right.deviationViewPx ||
        left.kind.localeCompare(right.kind),
    );
  if (axes[0]) return inferenceResult(anchor, axes[0].point, axes[0]);

  const selected = new Set(selectedEntityIds);
  if (
    (previous?.kind === "parallel" || previous?.kind === "perpendicular") &&
    previous.referenceEntityId
  ) {
    const entity = entities.find(
      (item) => item.id === previous.referenceEntityId,
    );
    const latched = entity
      ? relationCandidate(
          previous.kind,
          anchor,
          pointer,
          entity,
          scale,
          selected.has(entity.id),
        )
      : null;
    if (relationStillActive(latched, tolerances)) {
      return inferenceResult(
        anchor,
        latched!.inference.point,
        latched!.inference,
      );
    }
  }

  const candidates: RelationCandidate[] = [];
  for (const entity of entities) {
    for (const kind of ["parallel", "perpendicular"] as const) {
      const candidate = relationCandidate(
        kind,
        anchor,
        pointer,
        entity,
        scale,
        selected.has(entity.id),
      );
      if (
        !candidate ||
        candidate.inference.deviationViewPx > tolerances.enterViewPx ||
        (!candidate.selected &&
          candidate.referenceDistanceViewPx >
            tolerances.referenceEnterViewPx)
      ) {
        continue;
      }
      candidates.push(candidate);
    }
  }
  candidates.sort(
    (left, right) =>
      left.referenceDistanceViewPx - right.referenceDistanceViewPx ||
      left.inference.angleErrorDegrees -
        right.inference.angleErrorDegrees ||
      left.inference.deviationViewPx - right.inference.deviationViewPx ||
      (left.inference.referenceEntityId || "").localeCompare(
        right.inference.referenceEntityId || "",
      ) ||
      left.inference.kind.localeCompare(right.inference.kind),
  );
  const best = candidates[0]?.inference || null;
  return inferenceResult(anchor, best?.point || freePoint, best);
}

export function buildLineInferenceConstraint(
  lineId: string,
  inference: SketchLineInference | null | undefined,
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  createId: () => string,
): SketchConstraint[] {
  if (!inference) return [];
  const relation =
    inference.kind === "parallel" || inference.kind === "perpendicular";
  const referenceId = relation ? inference.referenceEntityId : null;
  if (
    relation &&
    (!referenceId ||
      referenceId === lineId ||
      !entities.some((entity) => entity.id === referenceId))
  ) {
    return [];
  }
  const entityRefs = referenceId ? [lineId, referenceId] : [lineId];
  const alreadyExists = constraints.some(
    (constraint) =>
      constraint.constraintType === inference.kind &&
      constraint.entityRefs.length === entityRefs.length &&
      entityRefs.every((id) => constraint.entityRefs.includes(id)),
  );
  if (alreadyExists) return [];
  const labels: Record<SketchLineInferenceKind, string> = {
    horizontal: "水平",
    vertical: "竖直",
    parallel: "平行",
    perpendicular: "垂直",
  };
  return [
    {
      id: createId(),
      label: referenceId
        ? `自动推断 · ${labels[inference.kind]} · ${inference.referenceLabel || referenceId}`
        : `自动推断 · ${labels[inference.kind]}`,
      constraintType: inference.kind,
      entityRefs,
      expression: null,
      parameterId: null,
      value: null,
      driverMode: null,
      enabled: true,
      driving: true,
    },
  ];
}

export function layoutLineDimensionLabel(
  start: { x: number; y: number },
  end: { x: number; y: number },
  viewport = { width: 460, height: 330 },
  label = { width: 116, height: 34 },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const candidateY = midpoint.y + ny * 18;
  if (candidateY < 6 || candidateY + label.height > viewport.height - 6) {
    nx *= -1;
    ny *= -1;
  }
  return {
    x: Math.max(
      6,
      Math.min(
        viewport.width - label.width - 6,
        midpoint.x + nx * 18 - label.width / 2,
      ),
    ),
    y: Math.max(
      6,
      Math.min(
        viewport.height - label.height - 6,
        midpoint.y + ny * 18 - label.height / 2,
      ),
    ),
  };
}
