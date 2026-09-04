import type { Draft, ParameterDefinition } from "../../../../types";
import {
  cloneSketchEntities,
  dimensionTypeSet,
  endpointChanged,
  normalizeSketchTopology,
} from "../../../sketch/sketchAuthoringCore";
import {
  DEFAULT_SKETCH_SNAP_OPTIONS,
  endpointSnapToleranceMm,
  isEndpointSnapKind,
  resolveSketchSnap,
  type SketchSnapKind,
} from "../../../sketch/sketchObjectSnap";
import type { SketchSelectionMode } from "../../../sketch/sketchBoxSelection";
import { roundSketchPoint } from "../../../sketch/sketchNumberNormalization";
import {
  commitCompletedGeometryEdit,
  commitLocalEntityFixedDimensions,
  commitSharedParameterUpdate,
} from "../../../sketch/sketchGeometryCommit";
import { DIMENSION_CONSTRAINTS } from "../../../authoring/authoringUtils";
export const uid = (prefix: string) => `${prefix}.${Date.now().toString(36)}`;
export type SketchTool =
  | "select"
  | "point"
  | "line"
  | "polyline"
  | "rectangle"
  | "circle"
  | "arc";
export type SketchViewCommand =
  | { id: number; type: "zoomIn" | "zoomOut" | "fit" }
  | null;
export type SketchPolylineCommand =
  | { id: number; type: "finish" | "cancel" }
  | null;
export type SketchBoxSelectSession = {
  pointerId: number;
  originClientX: number;
  originClientY: number;
  currentClientX: number;
  currentClientY: number;
  originView: { x: number; y: number };
  currentView: { x: number; y: number };
  originWorld: { x: number; y: number };
  currentWorld: { x: number; y: number };
  mode: SketchSelectionMode;
  hasMoved: boolean;
  additive: boolean;
  subtractive: boolean;
};
export type SketchEditConflict = {
  entityId: string;
  touchedEntityIds: string[];
  beforeEntities: Draft["sketch"]["entities"];
  afterEntities: Draft["sketch"]["entities"];
  reasons: string[];
  /** Weaker geometric constraints that would be released on accept. */
  softConstraints: {
    id: string;
    label: string;
    constraintType: string;
  }[];
  /** Strong topology constraints (coincident) — listed for clarity, never auto-released. */
  strongConstraints: {
    id: string;
    label: string;
    constraintType: string;
  }[];
  sharedParameterIds: string[];
};

export const STRONG_CONSTRAINT_TYPES = new Set(["coincident", "closed"]);
export const WEAK_CONSTRAINT_TYPES = new Set([
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "tangent",
  "equal",
  "fixed",
]);
export const WEAK_CONSTRAINT_LABELS: Record<string, string> = {
  horizontal: "沿水平轴",
  vertical: "沿竖直轴",
  parallel: "平行",
  perpendicular: "垂直",
  tangent: "相切",
  equal: "相等",
  fixed: "固定",
};

export const entityDirection = (
  entity: Draft["sketch"]["entities"][number] | undefined,
): [number, number] | null => {
  if (!entity?.start || !entity.end) return null;
  const dx = entity.end[0] - entity.start[0],
    dy = entity.end[1] - entity.start[1],
    length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  return [dx / length, dy / length];
};

export const softConstraintViolated = (
  constraint: Draft["sketch"]["constraints"][number],
  entities: Draft["sketch"]["entities"],
  beforeEntities: Draft["sketch"]["entities"],
  tolerance = 0.35,
) => {
  const refs = constraint.entityRefs
    .map((id) => entities.find((item) => item.id === id))
    .filter(Boolean) as Draft["sketch"]["entities"];
  if (!refs.length) return false;
  const kind = constraint.constraintType;
  if (kind === "horizontal") {
    return refs.some(
      (item) =>
        !!item.start &&
        !!item.end &&
        Math.abs(item.end[1] - item.start[1]) > tolerance,
    );
  }
  if (kind === "vertical") {
    return refs.some(
      (item) =>
        !!item.start &&
        !!item.end &&
        Math.abs(item.end[0] - item.start[0]) > tolerance,
    );
  }
  if (kind === "parallel" && refs.length > 1) {
    const reference = entityDirection(refs[0]);
    if (!reference) return false;
    return refs.slice(1).some((item) => {
      const current = entityDirection(item);
      if (!current) return false;
      return Math.abs(reference[0] * current[1] - reference[1] * current[0]) > 0.02;
    });
  }
  if (kind === "perpendicular" && refs.length > 1) {
    const reference = entityDirection(refs[0]);
    if (!reference) return false;
    return refs.slice(1).some((item) => {
      const current = entityDirection(item);
      if (!current) return false;
      return Math.abs(reference[0] * current[0] + reference[1] * current[1]) > 0.02;
    });
  }
  if (kind === "tangent" && refs.length > 1) {
    const line = refs.find((item) => item.geometryType === "line");
    const curve = refs.find(
      (item) => item.geometryType === "arc" || item.geometryType === "circle",
    );
    if (!line?.start || !line.end || !curve?.center || curve.radius == null) {
      return false;
    }
    const direction = entityDirection(line);
    if (!direction) return false;
    const distanceToCenter = Math.abs(
      (curve.center[0] - line.start[0]) * direction[1] -
        (curve.center[1] - line.start[1]) * direction[0],
    );
    return Math.abs(distanceToCenter - Math.abs(curve.radius)) > tolerance;
  }
  if (kind === "equal" && refs.length > 1) {
    const measure = (item: Draft["sketch"]["entities"][number]) => {
      if (item.geometryType === "circle" || item.geometryType === "arc")
        return Math.abs(item.radius || 0);
      if (item.start && item.end)
        return Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]);
      return null;
    };
    const reference = measure(refs[0]);
    if (reference == null) return false;
    return refs.slice(1).some((item) => {
      const current = measure(item);
      return current != null && Math.abs(current - reference) > tolerance;
    });
  }
  if (kind === "fixed") {
    return constraint.entityRefs.some((id) => {
      const before = beforeEntities.find((item) => item.id === id);
      const after = entities.find((item) => item.id === id);
      if (!before || !after) return false;
      return (
        JSON.stringify({
          start: before.start,
          end: before.end,
          center: before.center,
        }) !==
        JSON.stringify({
          start: after.start,
          end: after.end,
          center: after.center,
        })
      );
    });
  }
  return false;
};

export const analyzeLocalSketchEdit = (
  sketch: Draft["sketch"],
  entityId: string,
  beforeEntities: Draft["sketch"]["entities"],
  afterEntities: Draft["sketch"]["entities"],
  touchedEntityIds: string[] = [entityId],
): SketchEditConflict | null => {
  const normalized = normalizeSketchTopology(sketch);
  const dimensions = dimensionTypeSet();
  const touched = new Set(touchedEntityIds);
  const reasons: string[] = [];
  const softConstraints = normalized.constraints
    .filter(
      (item) =>
        item.enabled &&
        item.driving &&
        WEAK_CONSTRAINT_TYPES.has(item.constraintType) &&
        item.entityRefs.some((ref) => touched.has(ref)) &&
        softConstraintViolated(item, afterEntities, beforeEntities),
    )
    .map((item) => ({
      id: item.id,
      label: item.label || item.id,
      constraintType: item.constraintType,
    }));
  const strongConstraints = normalized.constraints
    .filter(
      (item) =>
        item.enabled &&
        STRONG_CONSTRAINT_TYPES.has(item.constraintType) &&
        item.entityRefs.some((ref) => touched.has(ref)),
    )
    .map((item) => ({
      id: item.id,
      label: item.label || item.id,
      constraintType: item.constraintType,
    }));
  if (softConstraints.length) {
    reasons.push(
      softConstraints
        .map(
          (item) =>
            item.label ||
            WEAK_CONSTRAINT_LABELS[item.constraintType] ||
            item.constraintType,
        )
        .join("、"),
    );
  }
  if (strongConstraints.length) {
    reasons.push("重合／首尾相连将保留");
  }
  const localDimensions = normalized.constraints.filter(
    (item) =>
      item.enabled &&
      item.driving &&
      dimensions.has(item.constraintType) &&
      item.entityRefs.includes(entityId) &&
      item.driverMode !== "unset",
  );
  const sharedParameterIds = [
    ...new Set(
      localDimensions
        .map((item) => item.parameterId)
        .filter((id): id is string => !!id)
        .filter((parameterId) =>
          normalized.constraints.some(
            (item) =>
              item.parameterId === parameterId &&
              !item.entityRefs.includes(entityId),
          ) ||
          sketch.entities.some(
            (item) =>
              item.id !== entityId && item.parameterRefs.includes(parameterId),
          ),
        ),
    ),
  ];
  if (sharedParameterIds.length) {
    reasons.push(`共享参数：${sharedParameterIds.join("、")}`);
  }
  // Soft-constraint notice alone is enough when strong joints only need reassurance
  // and there is an actual soft violation or shared-parameter decision.
  if (!softConstraints.length && !sharedParameterIds.length) return null;
  return {
    entityId,
    touchedEntityIds: [...touched],
    beforeEntities,
    afterEntities,
    reasons: [...new Set(reasons)],
    softConstraints,
    strongConstraints,
    sharedParameterIds,
  };
};

export type EndpointHandle = "start" | "end";

export type EndpointConnectionCandidate = {
  sourceEntityId: string;
  sourceHandle: EndpointHandle;
  targetEntityId: string;
  targetHandle: EndpointHandle | null;
  targetKind: "endpoint" | "line" | "object";
  snapKind: SketchSnapKind;
  sourcePoint: [number, number];
  targetPoint: [number, number];
  distancePx: number;
};

export const endpointPoint = (
  entity: Draft["sketch"]["entities"][number],
  handle: EndpointHandle,
): [number, number] | null => {
  const point = entity[handle];
  return point ? [point[0], point[1]] : null;
};

export const hasCoincidentEndpointConstraint = (
  constraints: Draft["sketch"]["constraints"],
  left: { entityId: string; handle: EndpointHandle },
  right: { entityId: string; handle: EndpointHandle },
) => constraints.some((constraint) => {
  if (constraint.constraintType !== "coincident" || constraint.entityRefs.length < 2) return false;
  const handles = constraint.endpointRefs || [];
  if (constraint.entityRefs.length === 2 && handles.length >= 2) {
    const a = { entityId: constraint.entityRefs[0], handle: handles[0] };
    const b = { entityId: constraint.entityRefs[1], handle: handles[1] };
    return (a.entityId === left.entityId && a.handle === left.handle && b.entityId === right.entityId && b.handle === right.handle)
      || (a.entityId === right.entityId && a.handle === right.handle && b.entityId === left.entityId && b.handle === left.handle);
  }
  return false;
});

export const findEndpointConnectionCandidate = (
  entities: Draft["sketch"]["entities"],
  movingIds: Set<string>,
  constraints: Draft["sketch"]["constraints"],
  scale: number,
  previous: EndpointConnectionCandidate | null,
): EndpointConnectionCandidate | null => {
  const moving = entities.filter((entity) => movingIds.has(entity.id));
  const targets = entities.filter((entity) => !movingIds.has(entity.id));
  const candidates: EndpointConnectionCandidate[] = [];
  for (const source of moving) {
    if (source.geometryType !== "line" && source.geometryType !== "arc") continue;
    for (const sourceHandle of ["start", "end"] as const) {
      const sourcePoint = endpointPoint(source, sourceHandle);
      if (!sourcePoint) continue;
      for (const target of targets) {
        const hit = resolveSketchSnap(
          { x: sourcePoint[0], y: sourcePoint[1] },
          [target],
          {
            enabled: true,
            toleranceMm: endpointSnapToleranceMm(scale),
            lineToleranceMm: endpointSnapToleranceMm(scale, 8),
            kinds: DEFAULT_SKETCH_SNAP_OPTIONS.kinds,
          },
        );
        const snap = hit.target;
        if (!snap) continue;
        const targetHandle = isEndpointSnapKind(snap.kind) ? snap.handle || null : null;
        if (targetHandle && hasCoincidentEndpointConstraint(constraints, { entityId: source.id, handle: sourceHandle }, { entityId: target.id, handle: targetHandle })) continue;
        candidates.push({
          sourceEntityId: source.id,
          sourceHandle,
          targetEntityId: target.id,
          targetHandle,
          targetKind: targetHandle ? "endpoint" : snap.kind === "lineNearest" ? "line" : "object",
          snapKind: snap.kind,
          sourcePoint,
          targetPoint: snap.point,
          distancePx: Math.hypot(sourcePoint[0] - snap.point[0], sourcePoint[1] - snap.point[1]) * scale,
        });
      }
    }
  }
  const hysteresis = previous ? 14 : 10;
  const stable = previous && candidates.find((item) => item.sourceEntityId === previous.sourceEntityId && item.sourceHandle === previous.sourceHandle && item.targetEntityId === previous.targetEntityId && item.targetHandle === previous.targetHandle && item.targetKind === previous.targetKind && item.snapKind === previous.snapKind && item.distancePx <= hysteresis);
  if (stable) return stable;
  return candidates
    .filter((item) => item.distancePx <= 10)
    .sort((a, b) => (a.targetKind === "endpoint" ? 0 : 1) - (b.targetKind === "endpoint" ? 0 : 1)
      || a.distancePx - b.distancePx
      || a.sourceEntityId.localeCompare(b.sourceEntityId)
      || a.targetEntityId.localeCompare(b.targetEntityId))[0] || null;
};

export const snapEntityEndpointToCandidate = (
  entities: Draft["sketch"]["entities"],
  candidate: EndpointConnectionCandidate,
) => entities.map((entity) => {
  if (entity.id !== candidate.sourceEntityId) return entity;
  const next = { ...entity, [candidate.sourceHandle]: [...candidate.targetPoint] as [number, number] };
  if (entity.geometryType === "arc" && entity.center) {
    const angle = (Math.atan2(candidate.targetPoint[1] - entity.center[1], candidate.targetPoint[0] - entity.center[0]) * 180) / Math.PI;
    return { ...next, [candidate.sourceHandle === "start" ? "startAngle" : "endAngle"]: angle };
  }
  return next;
});

export const coincidentEndpointLinks = (
  constraints: Draft["sketch"]["constraints"],
) => {
  const links: {
    left: { entityId: string; handle: EndpointHandle };
    right: { entityId: string; handle: EndpointHandle };
  }[] = [];
  for (const constraint of constraints) {
    if (
      !constraint.enabled ||
      !STRONG_CONSTRAINT_TYPES.has(constraint.constraintType) ||
      constraint.entityRefs.length < 2
    ) {
      continue;
    }
    const refs = constraint.entityRefs;
    const handles = constraint.endpointRefs || [];
    if (refs.length === 2 && handles.length >= 2) {
      links.push({
        left: {
          entityId: refs[0],
          handle: handles[0] === "start" ? "start" : "end",
        },
        right: {
          entityId: refs[1],
          handle: handles[1] === "start" ? "start" : "end",
        },
      });
      continue;
    }
    for (let index = 0; index < refs.length - 1; index += 1) {
      links.push({
        left: { entityId: refs[index], handle: "end" },
        right: { entityId: refs[index + 1], handle: "start" },
      });
    }
    if (constraint.constraintType === "closed" && refs.length > 1) {
      links.push({
        left: { entityId: refs[refs.length - 1], handle: "end" },
        right: { entityId: refs[0], handle: "start" },
      });
    }
  }
  return links;
};/** Keep strong coincident joints when an endpoint (or whole entity) moves. */
export const propagateCoincidentMove = (
  constraints: Draft["sketch"]["constraints"],
  entities: Draft["sketch"]["entities"],
  sourceId: string,
  handle: "start" | "end" | "center",
  beforeEntities: Draft["sketch"]["entities"],
): { entities: Draft["sketch"]["entities"]; touchedIds: string[] } => {
  const links = coincidentEndpointLinks(constraints);
  const next = cloneSketchEntities(entities);
  const byId = new Map(next.map((item) => [item.id, item]));
  const touched = new Set<string>([sourceId]);
  const queue: { entityId: string; handle: EndpointHandle; point: [number, number] }[] =
    [];
  const source = byId.get(sourceId);
  const before = beforeEntities.find((item) => item.id === sourceId);
  if (!source) return { entities: next, touchedIds: [sourceId] };

  const enqueue = (
    entityId: string,
    endpoint: EndpointHandle,
    point: [number, number],
  ) => {
    queue.push({ entityId, handle: endpoint, point: [point[0], point[1]] });
  };

  if (handle === "center" && before?.start && before.end && source.start && source.end) {
    enqueue(sourceId, "start", source.start);
    enqueue(sourceId, "end", source.end);
  } else if (handle !== "center" && source[handle]) {
    enqueue(sourceId, handle, source[handle] as [number, number]);
  }

  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.entityId}:${current.handle}:${current.point[0].toFixed(2)},${current.point[1].toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entity = byId.get(current.entityId);
    if (!entity) continue;
    touched.add(current.entityId);
    const point = [current.point[0], current.point[1]] as [number, number];
    if (current.handle === "start") entity.start = point;
    else entity.end = point;
    if (entity.geometryType === "arc" && entity.center) {
      const angle =
        (Math.atan2(point[1] - entity.center[1], point[0] - entity.center[0]) *
          180) /
        Math.PI;
      if (current.handle === "start") entity.startAngle = angle;
      else entity.endAngle = angle;
    }
    for (const link of links) {
      const leftMatch =
        link.left.entityId === current.entityId &&
        link.left.handle === current.handle;
      const rightMatch =
        link.right.entityId === current.entityId &&
        link.right.handle === current.handle;
      if (leftMatch) {
        enqueue(link.right.entityId, link.right.handle, point);
      }
      if (rightMatch) {
        enqueue(link.left.entityId, link.left.handle, point);
      }
    }
  }
  return { entities: next, touchedIds: [...touched] };
};

/** Propagate every endpoint changed by a shape handle through existing joints. */
export const propagateShapeHandleEdit = (
  constraints: Draft["sketch"]["constraints"],
  entities: Draft["sketch"]["entities"],
  beforeEntities: Draft["sketch"]["entities"],
  editedEntityIds: string[],
) => {
  let next = entities;
  const touched = new Set(editedEntityIds);
  for (const entityId of editedEntityIds) {
    const before = beforeEntities.find((entity) => entity.id === entityId);
    const after = next.find((entity) => entity.id === entityId);
    if (!before || !after) continue;
    for (const handle of ["start", "end"] as const) {
      if (!endpointChanged(before[handle], after[handle])) continue;
      const propagated = propagateCoincidentMove(
        constraints,
        next,
        entityId,
        handle,
        beforeEntities,
      );
      next = propagated.entities;
      propagated.touchedIds.forEach((id) => touched.add(id));
    }
  }
  return { entities: next, touchedIds: [...touched] };
};

export const changedSketchEntityIds = (
  beforeEntities: Draft["sketch"]["entities"],
  afterEntities: Draft["sketch"]["entities"],
) => {
  const beforeById = new Map(beforeEntities.map((entity) => [entity.id, entity]));
  return afterEntities
    .filter((entity) => {
      const before = beforeById.get(entity.id);
      if (!before) return true;
      return (
        JSON.stringify({
          start: before.start,
          end: before.end,
          center: before.center,
          radius: before.radius,
          startAngle: before.startAngle,
          endAngle: before.endAngle,
          largeArc: before.largeArc,
          points: before.points,
        }) !==
        JSON.stringify({
          start: entity.start,
          end: entity.end,
          center: entity.center,
          radius: entity.radius,
          startAngle: entity.startAngle,
          endAngle: entity.endAngle,
          largeArc: entity.largeArc,
          points: entity.points,
        })
      );
    })
    .map((entity) => entity.id);
};

export const entitiesToPrimitives = (entities: Draft["sketch"]["entities"]) =>
  entities.map((item) => ({
    id: item.id,
    role: item.role,
    type: item.geometryType,
    construction: item.construction,
    start: item.start ? { x: item.start[0], y: item.start[1] } : undefined,
    end: item.end ? { x: item.end[0], y: item.end[1] } : undefined,
    center: item.center
      ? { x: item.center[0], y: item.center[1] }
      : undefined,
    radius: item.radius || undefined,
    startAngle: item.startAngle,
    endAngle: item.endAngle,
    largeArc: item.largeArc,
    sweepDirection: item.sweepDirection,
    points: item.points.map(([x, y]) => ({ x, y })),
  }));

/** Align draft entities to the currently displayed primitives to avoid drag jumps. */
export const alignEntitiesToPrimitives = (
  entities: Draft["sketch"]["entities"],
  primitives: {
    id: string;
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    center?: { x: number; y: number };
    radius?: number;
    startAngle?: number | null;
    endAngle?: number | null;
    largeArc?: boolean | null;
    sweepDirection?: "ccw" | "cw";
    points?: { x: number; y: number }[];
  }[],
) => {
  const byId = new Map(primitives.map((item) => [item.id, item]));
  return entities.map((entity) => {
    const primitive = byId.get(entity.id);
    if (!primitive) return { ...entity };
    return {
      ...entity,
      start: primitive.start
        ? ([primitive.start.x, primitive.start.y] as [number, number])
        : entity.start,
      end: primitive.end
        ? ([primitive.end.x, primitive.end.y] as [number, number])
        : entity.end,
      center: primitive.center
        ? ([primitive.center.x, primitive.center.y] as [number, number])
        : entity.center,
      radius:
        primitive.radius != null ? primitive.radius : entity.radius,
      startAngle:
        primitive.startAngle != null ? primitive.startAngle : entity.startAngle,
      endAngle:
        primitive.endAngle != null ? primitive.endAngle : entity.endAngle,
      largeArc:
        primitive.largeArc != null ? primitive.largeArc : entity.largeArc,
      sweepDirection: primitive.sweepDirection || entity.sweepDirection,
      points: primitive.points?.length
        ? primitive.points.map(
            (point) => [point.x, point.y] as [number, number],
          )
        : entity.points,
    };

  });
};

