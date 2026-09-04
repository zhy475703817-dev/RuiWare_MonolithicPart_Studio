import type { Draft } from "../../types";
import {
  ccwSweepDegrees,
  isAngleBetweenCcw,
  pointAngleDegrees,
  projectPointOntoCircle,
  signedArcSweep,
} from "./sketchArc";

/** Supported object-snap target kinds. Extend this union for future snap modes. */
export type SketchSnapKind =
  | "point"
  | "lineEndpoint"
  | "lineNearest"
  | "arcEndpoint"
  | "arcNearest"
  | "circleNearest"
  | "tangent";

export type SketchSnapEndpointHandle = "start" | "end";

/** Exact tangent information at one endpoint of a circular sketch arc. */
export type SketchArcEndpointTangent = {
  entityId: string;
  handle: SketchSnapEndpointHandle;
  point: [number, number];
  /** Unit tangent oriented in the arc's start-to-end traversal direction. */
  tangent: [number, number];
  sweepDirection: "ccw" | "cw";
};

/** A resolved snap target in sketch world coordinates (mm). */
export type SketchSnapTarget = {
  kind: SketchSnapKind;
  entityId: string;
  /** Present for endpoint snaps; omitted for on-curve nearest snaps. */
  handle?: SketchSnapEndpointHandle;
  point: [number, number];
  /**
  * When false, snap only relocates the draw point and must not create constraints.
  * Drawing consumers treat every resolved snap as positional assistance; the
  * explicit constraint helper is reserved for intentional topology operations.
   */
  createsConstraint: boolean;
};

export type SketchSnapOptions = {
  enabled: boolean;
  /** Endpoint / tangent search radius in sketch mm. */
  toleranceMm: number;
  /**
   * On-curve nearest-point search radius in sketch mm.
   * Defaults to half of `toleranceMm` when omitted.
   */
  lineToleranceMm?: number;
  /** Subset of snap kinds to evaluate; defaults to all registered kinds. */
  kinds?: SketchSnapKind[];
  /**
   * When set (circle 2nd click / arc first endpoint with center fixed),
   * also evaluate tangent points relative to this center.
   */
  tangentFromCenter?: { x: number; y: number } | null;
};

export type SketchSnapHit = {
  point: [number, number];
  target: SketchSnapTarget | null;
};

export type SketchDrawPoint = {
  x: number;
  y: number;
  snapTarget: SketchSnapTarget | null;
};

export const DEFAULT_SKETCH_SNAP_OPTIONS: Pick<
  SketchSnapOptions,
  "toleranceMm" | "lineToleranceMm" | "kinds"
> = {
  toleranceMm: 2,
  lineToleranceMm: 1,
  kinds: [
    "point",
    "lineEndpoint",
    "arcEndpoint",
    "tangent",
    "lineNearest",
    "arcNearest",
    "circleNearest",
  ],
};

export const ENDPOINT_SNAP_RADIUS_VIEW_PX = 10;

/** Convert a stable SVG-view snap radius to sketch millimetres at the current zoom. */
export const endpointSnapToleranceMm = (
  worldToViewScale: number,
  radiusViewPx = ENDPOINT_SNAP_RADIUS_VIEW_PX,
) => {
  if (!Number.isFinite(worldToViewScale) || worldToViewScale <= 0) {
    return DEFAULT_SKETCH_SNAP_OPTIONS.toleranceMm;
  }
  return Math.max(0.25, Math.min(10, radiusViewPx / worldToViewScale));
};

const roundCoord = (value: number) => Math.round(value * 100) / 100;

const endpointLabel = (handle: SketchSnapEndpointHandle) =>
  handle === "start" ? "起点" : "终点";

type SketchEntity = Draft["sketch"]["entities"][number];
type SketchConstraint = Draft["sketch"]["constraints"][number];

/**
 * Resolve an arc endpoint tangent analytically from its center/radius and
 * directed sweep. The endpoint coordinates are used when present so callers
 * retain the exact topology point instead of a rounded/sample point.
 */
export const arcEndpointTangent = (
  entity: SketchEntity,
  handle: SketchSnapEndpointHandle,
): SketchArcEndpointTangent | null => {
  if (
    entity.geometryType !== "arc" ||
    !entity.center ||
    !Number.isFinite(entity.center[0]) ||
    !Number.isFinite(entity.center[1])
  ) {
    return null;
  }

  const center: [number, number] = [entity.center[0], entity.center[1]];
  const rawPoint = entity[handle];
  const angleValue = handle === "start" ? entity.startAngle : entity.endAngle;
  const radiusValue = entity.radius;
  const radius =
    Number.isFinite(radiusValue) && (radiusValue as number) > 1e-9
      ? (radiusValue as number)
      : rawPoint
        ? Math.hypot(rawPoint[0] - center[0], rawPoint[1] - center[1])
        : 0;
  if (!Number.isFinite(radius) || radius < 1e-9) return null;

  let point: [number, number];
  if (
    rawPoint &&
    Number.isFinite(rawPoint[0]) &&
    Number.isFinite(rawPoint[1])
  ) {
    point = [rawPoint[0], rawPoint[1]];
  } else if (Number.isFinite(angleValue)) {
    const radians = ((angleValue as number) * Math.PI) / 180;
    point = [
      center[0] + radius * Math.cos(radians),
      center[1] + radius * Math.sin(radians),
    ];
  } else {
    return null;
  }

  let radialX = point[0] - center[0];
  let radialY = point[1] - center[1];
  const radialLength = Math.hypot(radialX, radialY);
  if (radialLength < 1e-9) {
    if (!Number.isFinite(angleValue)) return null;
    const radians = ((angleValue as number) * Math.PI) / 180;
    radialX = Math.cos(radians);
    radialY = Math.sin(radians);
  } else {
    radialX /= radialLength;
    radialY /= radialLength;
  }

  const startAngle =
    Number.isFinite(entity.startAngle) && entity.startAngle != null
      ? entity.startAngle
      : pointAngleDegrees(
          center,
          entity.start || point,
        );
  const endAngle =
    Number.isFinite(entity.endAngle) && entity.endAngle != null
      ? entity.endAngle
      : pointAngleDegrees(
          center,
          entity.end || point,
        );
  const largeArc =
    entity.largeArc ?? ccwSweepDegrees(startAngle, endAngle) > 180;
  const sweepDirection =
    entity.sweepDirection ||
    (signedArcSweep(startAngle, endAngle, largeArc) >= 0 ? "ccw" : "cw");
  const tangent: [number, number] =
    sweepDirection === "ccw"
      ? [Math.abs(radialY) < 1e-12 ? 0 : -radialY, Math.abs(radialX) < 1e-12 ? 0 : radialX]
      : [Math.abs(radialY) < 1e-12 ? 0 : radialY, Math.abs(radialX) < 1e-12 ? 0 : -radialX];
  // Avoid leaking signed zero into serialized/test-visible geometry while
  // preserving the exact analytic direction.
  tangent[0] = Math.abs(tangent[0]) < 1e-12 ? 0 : tangent[0];
  tangent[1] = Math.abs(tangent[1]) < 1e-12 ? 0 : tangent[1];

  return {
    entityId: entity.id,
    handle,
    point,
    tangent,
    sweepDirection,
  };
};

export const isNearestSnapKind = (kind: SketchSnapKind) =>
  kind === "lineNearest" ||
  kind === "arcNearest" ||
  kind === "circleNearest";

export const isEndpointSnapKind = (kind: SketchSnapKind) =>
  kind === "lineEndpoint" || kind === "arcEndpoint";

export const isTangentSnapKind = (kind: SketchSnapKind) => kind === "tangent";

const pushUniquePoint = (
  targets: Array<{ target: SketchSnapTarget; distance: number }>,
  worldPoint: { x: number; y: number },
  point: [number, number],
  entityId: string,
  toleranceMm: number,
) => {
  const distance = Math.hypot(point[0] - worldPoint.x, point[1] - worldPoint.y);
  if (distance > toleranceMm) return;
  targets.push({
    distance,
    target: {
      kind: "tangent",
      entityId,
      point: [roundCoord(point[0]), roundCoord(point[1])],
      createsConstraint: false,
    },
  });
};

/**
 * Tangent snap points for a circle/arc whose center is already fixed.
 * - Line: foot of perpendicular from center onto the segment (contact point).
 * - Circle/arc: points along the centers' line at radii d±r (external/internal).
 */
const findTangentSnaps = (
  worldPoint: { x: number; y: number },
  center: { x: number; y: number },
  entities: SketchEntity[],
  toleranceMm: number,
): Array<{ target: SketchSnapTarget; distance: number }> => {
  const hits: Array<{ target: SketchSnapTarget; distance: number }> = [];

  for (const entity of entities) {
    if (entity.geometryType === "line" && entity.start && entity.end) {
      const dx = entity.end[0] - entity.start[0];
      const dy = entity.end[1] - entity.start[1];
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq < 1e-12) continue;
      const t =
        ((center.x - entity.start[0]) * dx +
          (center.y - entity.start[1]) * dy) /
        lengthSq;
      if (t < 0 || t > 1) continue;
      const foot: [number, number] = [
        entity.start[0] + t * dx,
        entity.start[1] + t * dy,
      ];
      if (Math.hypot(foot[0] - center.x, foot[1] - center.y) < 0.1) continue;
      pushUniquePoint(hits, worldPoint, foot, entity.id, toleranceMm);
      continue;
    }

    if (
      (entity.geometryType === "circle" || entity.geometryType === "arc") &&
      entity.center &&
      entity.radius != null &&
      entity.radius >= 0.1
    ) {
      const ox = entity.center[0];
      const oy = entity.center[1];
      const dx = ox - center.x;
      const dy = oy - center.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const ux = dx / d;
      const uy = dy / d;
      const radiusOptions = [d + entity.radius, Math.abs(d - entity.radius)];
      for (const radius of radiusOptions) {
        if (radius < 0.1) continue;
        const candidates: [number, number][] = [
          [center.x + ux * radius, center.y + uy * radius],
          [center.x - ux * radius, center.y - uy * radius],
        ];
        for (const candidate of candidates) {
          if (entity.geometryType === "arc") {
            const angles = arcAngles(entity);
            if (!angles) continue;
            // Contact on the existing circle lies on CO; pick the nearer entity
            // point to the candidate as the tangency location check.
            const contact = projectPointOntoCircle(
              entity.center,
              entity.radius,
              { x: candidate[0], y: candidate[1] },
            );
            if (
              !angleOnSelectedArc(
                angles.startAngle,
                angles.endAngle,
                angles.largeArc,
                pointAngleDegrees(entity.center, contact),
              )
            ) {
              continue;
            }
          }
          pushUniquePoint(hits, worldPoint, candidate, entity.id, toleranceMm);
        }
      }
    }
  }

  return hits;
};

const lineEndpointCandidates = (
  entities: SketchEntity[],
): SketchSnapTarget[] => {
  const targets: SketchSnapTarget[] = [];
  for (const entity of entities) {
    if (entity.geometryType !== "line" || !entity.start || !entity.end) continue;
    for (const handle of ["start", "end"] as const) {
      const endpoint = entity[handle];
      if (!endpoint) continue;
      targets.push({
        kind: "lineEndpoint",
        entityId: entity.id,
        handle,
        point: [endpoint[0], endpoint[1]],
        createsConstraint: true,
      });
    }
  }
  return targets;
};

const arcEndpointCandidates = (
  entities: SketchEntity[],
): SketchSnapTarget[] => {
  const targets: SketchSnapTarget[] = [];
  for (const entity of entities) {
    if (entity.geometryType !== "arc" || !entity.start || !entity.end) continue;
    for (const handle of ["start", "end"] as const) {
      const endpoint = entity[handle];
      if (!endpoint) continue;
      targets.push({
        kind: "arcEndpoint",
        entityId: entity.id,
        handle,
        point: [endpoint[0], endpoint[1]],
        // Line tool may create coincident; circle/arc drawing never does.
        createsConstraint: true,
      });
    }
  }
  return targets;
};

const pointCandidates = (entities: SketchEntity[]): SketchSnapTarget[] =>
  entities
    .filter((entity) => entity.geometryType === "point" && !!entity.start)
    .map((entity) => ({
      kind: "point" as const,
      entityId: entity.id,
      point: [entity.start![0], entity.start![1]] as [number, number],
      createsConstraint: false,
    }));

/** Project a world point onto a finite line segment; returns null for degenerate segments. */
export const projectPointOntoLineSegment = (
  point: { x: number; y: number },
  start: [number, number],
  end: [number, number],
): { point: [number, number]; distance: number; t: number } | null => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return null;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / lengthSq),
  );
  const projected: [number, number] = [
    roundCoord(start[0] + t * dx),
    roundCoord(start[1] + t * dy),
  ];
  return {
    point: projected,
    distance: Math.hypot(projected[0] - point.x, projected[1] - point.y),
    t,
  };
};

/**
 * Nearest points on existing line segments. Evaluated dynamically against the cursor
 * (unlike endpoint candidates, which are fixed positions).
 */
const findBestLineNearestSnap = (
  worldPoint: { x: number; y: number },
  entities: SketchEntity[],
  toleranceMm: number,
): { target: SketchSnapTarget; distance: number } | null => {
  let best: { target: SketchSnapTarget; distance: number } | null = null;
  for (const entity of entities) {
    if (entity.geometryType !== "line" || !entity.start || !entity.end) continue;
    const projection = projectPointOntoLineSegment(
      worldPoint,
      entity.start,
      entity.end,
    );
    if (!projection || projection.distance > toleranceMm) continue;
    // Prefer mid-segment hits for lineNearest; endpoints are handled by lineEndpoint.
    if (projection.t <= 0.02 || projection.t >= 0.98) continue;
    if (best && projection.distance >= best.distance) continue;
    best = {
      distance: projection.distance,
      target: {
        kind: "lineNearest",
        entityId: entity.id,
        point: projection.point,
        createsConstraint: false,
      },
    };
  }
  return best;
};

const arcAngles = (entity: SketchEntity) => {
  if (!entity.center || entity.radius == null) return null;
  const startAngle =
    entity.startAngle ??
    (entity.start ? pointAngleDegrees(entity.center, entity.start) : 0);
  const endAngle =
    entity.endAngle ??
    (entity.end ? pointAngleDegrees(entity.center, entity.end) : 0);
  const largeArc =
    entity.largeArc ?? ccwSweepDegrees(startAngle, endAngle) > 180;
  return { startAngle, endAngle, largeArc, center: entity.center, radius: entity.radius };
};

const angleOnSelectedArc = (
  startAngle: number,
  endAngle: number,
  largeArc: boolean,
  probeAngle: number,
) => {
  const onCcw = isAngleBetweenCcw(startAngle, endAngle, probeAngle);
  const ccwSweep =
    ((endAngle - startAngle) % 360 + 360) % 360 || 360;
  const preferCcw = largeArc ? ccwSweep > 180 : ccwSweep < 180 || Math.abs(ccwSweep - 180) < 1e-6;
  if (preferCcw) return onCcw || Math.abs(probeAngle - startAngle) < 1e-6 || Math.abs(probeAngle - endAngle) < 1e-6;
  return !onCcw || Math.abs(probeAngle - startAngle) < 1e-6 || Math.abs(probeAngle - endAngle) < 1e-6;
};

const findBestArcNearestSnap = (
  worldPoint: { x: number; y: number },
  entities: SketchEntity[],
  toleranceMm: number,
): { target: SketchSnapTarget; distance: number } | null => {
  let best: { target: SketchSnapTarget; distance: number } | null = null;
  for (const entity of entities) {
    if (entity.geometryType !== "arc") continue;
    const angles = arcAngles(entity);
    if (!angles || angles.radius < 0.1) continue;
    const projected = projectPointOntoCircle(
      angles.center,
      angles.radius,
      worldPoint,
    );
    const probeAngle = pointAngleDegrees(angles.center, projected);
    const angularDistance = (from: number, to: number) => {
      const delta = Math.abs(((to - from) % 360 + 360) % 360);
      return Math.min(delta, 360 - delta);
    };
    // Skip near endpoints — those belong to arcEndpoint.
    if (
      angularDistance(probeAngle, angles.startAngle) < 4 ||
      angularDistance(probeAngle, angles.endAngle) < 4
    ) {
      continue;
    }
    if (
      !angleOnSelectedArc(
        angles.startAngle,
        angles.endAngle,
        angles.largeArc,
        probeAngle,
      )
    ) {
      continue;
    }
    const distance = Math.hypot(
      projected[0] - worldPoint.x,
      projected[1] - worldPoint.y,
    );
    if (distance > toleranceMm) continue;
    if (best && distance >= best.distance) continue;
    best = {
      distance,
      target: {
        kind: "arcNearest",
        entityId: entity.id,
        point: [roundCoord(projected[0]), roundCoord(projected[1])],
        createsConstraint: false,
      },
    };
  }
  return best;
};

const findBestCircleNearestSnap = (
  worldPoint: { x: number; y: number },
  entities: SketchEntity[],
  toleranceMm: number,
): { target: SketchSnapTarget; distance: number } | null => {
  let best: { target: SketchSnapTarget; distance: number } | null = null;
  for (const entity of entities) {
    if (
      entity.geometryType !== "circle" ||
      !entity.center ||
      entity.radius == null ||
      entity.radius < 0.1
    ) {
      continue;
    }
    const projected = projectPointOntoCircle(
      entity.center,
      entity.radius,
      worldPoint,
    );
    const distance = Math.hypot(
      projected[0] - worldPoint.x,
      projected[1] - worldPoint.y,
    );
    if (distance > toleranceMm) continue;
    if (best && distance >= best.distance) continue;
    best = {
      distance,
      target: {
        kind: "circleNearest",
        entityId: entity.id,
        point: [roundCoord(projected[0]), roundCoord(projected[1])],
        createsConstraint: false,
      },
    };
  }
  return best;
};

const SNAP_KIND_PRIORITY: Record<SketchSnapKind, number> = {
  point: 0,
  lineEndpoint: 0,
  arcEndpoint: 0,
  tangent: 0,
  lineNearest: 1,
  arcNearest: 1,
  circleNearest: 1,
};

/**
 * Resolve the best object snap near a world-space pointer, or fall back to the raw point.
 * Endpoint snaps outrank on-curve snaps; on-curve tolerance defaults to half the endpoint radius.
 */
export function resolveSketchSnap(
  worldPoint: { x: number; y: number },
  entities: SketchEntity[],
  options: SketchSnapOptions,
): SketchSnapHit {
  const fallback: SketchSnapHit = {
    point: [roundCoord(worldPoint.x), roundCoord(worldPoint.y)],
    target: null,
  };
  if (!options.enabled) return fallback;

  const kinds = options.kinds ?? DEFAULT_SKETCH_SNAP_OPTIONS.kinds!;
  const endpointTolerance = options.toleranceMm;
  const curveTolerance =
    options.lineToleranceMm ??
    DEFAULT_SKETCH_SNAP_OPTIONS.lineToleranceMm ??
    endpointTolerance / 2;

  type Candidate = { target: SketchSnapTarget; distance: number };
  const candidates: Candidate[] = [];

  if (kinds.includes("point")) {
    for (const target of pointCandidates(entities)) {
      const distance = Math.hypot(
        target.point[0] - worldPoint.x,
        target.point[1] - worldPoint.y,
      );
      if (distance <= endpointTolerance) candidates.push({ target, distance });
    }
  }

  if (kinds.includes("lineEndpoint")) {
    for (const target of lineEndpointCandidates(entities)) {
      const distance = Math.hypot(
        target.point[0] - worldPoint.x,
        target.point[1] - worldPoint.y,
      );
      if (distance <= endpointTolerance) candidates.push({ target, distance });
    }
  }

  if (kinds.includes("arcEndpoint")) {
    for (const target of arcEndpointCandidates(entities)) {
      const distance = Math.hypot(
        target.point[0] - worldPoint.x,
        target.point[1] - worldPoint.y,
      );
      if (distance <= endpointTolerance) candidates.push({ target, distance });
    }
  }

  if (
    kinds.includes("tangent") &&
    options.tangentFromCenter &&
    Number.isFinite(options.tangentFromCenter.x) &&
    Number.isFinite(options.tangentFromCenter.y)
  ) {
    candidates.push(
      ...findTangentSnaps(
        worldPoint,
        options.tangentFromCenter,
        entities,
        endpointTolerance,
      ),
    );
  }

  if (kinds.includes("lineNearest")) {
    const lineHit = findBestLineNearestSnap(
      worldPoint,
      entities,
      curveTolerance,
    );
    if (lineHit) candidates.push(lineHit);
  }

  if (kinds.includes("arcNearest")) {
    const arcHit = findBestArcNearestSnap(
      worldPoint,
      entities,
      curveTolerance,
    );
    if (arcHit) candidates.push(arcHit);
  }

  if (kinds.includes("circleNearest")) {
    const circleHit = findBestCircleNearestSnap(
      worldPoint,
      entities,
      curveTolerance,
    );
    if (circleHit) candidates.push(circleHit);
  }

  if (!candidates.length) return fallback;

  candidates.sort((left, right) => {
    const priorityDelta =
      SNAP_KIND_PRIORITY[left.target.kind] -
      SNAP_KIND_PRIORITY[right.target.kind];
    if (priorityDelta !== 0) return priorityDelta;
    return left.distance - right.distance;
  });

  const best = candidates[0];
  return { point: best.target.point, target: best.target };
}

export function sketchDrawPointFromSnap(hit: SketchSnapHit): SketchDrawPoint {
  return {
    x: hit.point[0],
    y: hit.point[1],
    snapTarget: hit.target,
  };
}

const coincidentAlreadyExists = (
  constraints: SketchConstraint[],
  leftEntityId: string,
  leftHandle: SketchSnapEndpointHandle,
  rightEntityId: string,
  rightHandle: SketchSnapEndpointHandle,
) =>
  constraints.some(
    (constraint) =>
      constraint.constraintType === "coincident" &&
      constraint.entityRefs.length === 2 &&
      constraint.endpointRefs?.length === 2 &&
      ((constraint.entityRefs[0] === leftEntityId &&
        constraint.endpointRefs[0] === leftHandle &&
        constraint.entityRefs[1] === rightEntityId &&
        constraint.endpointRefs[1] === rightHandle) ||
        (constraint.entityRefs[0] === rightEntityId &&
          constraint.endpointRefs[0] === rightHandle &&
          constraint.entityRefs[1] === leftEntityId &&
          constraint.endpointRefs[1] === leftHandle)),
  );

const makeCoincidentConstraint = (
  id: string,
  newEntityId: string,
  newHandle: SketchSnapEndpointHandle,
  target: SketchSnapTarget & {
    handle: SketchSnapEndpointHandle;
  },
  entities: SketchEntity[],
): SketchConstraint => {
  const newEntity = entities.find((item) => item.id === newEntityId);
  const targetEntity = entities.find((item) => item.id === target.entityId);
  const newName = newEntity?.role || newEntityId;
  const targetName = targetEntity?.role || target.entityId;
  return {
    id,
    label: `重合 · ${newName}${endpointLabel(newHandle)} ↔ ${targetName}${endpointLabel(target.handle)}`,
    constraintType: "coincident",
    entityRefs: [newEntityId, target.entityId],
    endpointRefs: [newHandle, target.handle],
    expression: null,
    parameterId: null,
    value: null,
    driverMode: null,
    enabled: true,
    driving: true,
  };
};

/**
 * Build coincident constraints for an intentional topology operation (for
 * example, a polyline's own shared joint or explicit closure). Free drawing
 * snap callers must not pass external snap targets to this helper.
 */
export function buildLineSnapCoincidentConstraints(
  newLineId: string,
  startSnap: SketchSnapTarget | null | undefined,
  endSnap: SketchSnapTarget | null | undefined,
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  createId: () => string,
): SketchConstraint[] {
  const next: SketchConstraint[] = [];
  const append = (
    newHandle: SketchSnapEndpointHandle,
    target: SketchSnapTarget | null | undefined,
  ) => {
    if (
      !target ||
      !isEndpointSnapKind(target.kind) ||
      !target.createsConstraint ||
      !target.handle
    ) {
      return;
    }
    const endpointTarget = target as SketchSnapTarget & {
      handle: SketchSnapEndpointHandle;
    };
    if (
      coincidentAlreadyExists(
        [...constraints, ...next],
        newLineId,
        newHandle,
        endpointTarget.entityId,
        endpointTarget.handle,
      )
    ) {
      return;
    }
    next.push(
      makeCoincidentConstraint(
        createId(),
        newLineId,
        newHandle,
        endpointTarget,
        entities,
      ),
    );
  };
  append("start", startSnap);
  append("end", endSnap);
  return next;
}

export const sketchPointTooClose = (
  a: SketchDrawPoint,
  b: SketchDrawPoint,
  minimum = 0.01,
) => Math.hypot(a.x - b.x, a.y - b.y) < minimum;
