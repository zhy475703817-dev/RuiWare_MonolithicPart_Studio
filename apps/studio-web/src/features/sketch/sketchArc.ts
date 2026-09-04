export type ArcDrawMode = "centerEndpoints" | "threePoint";

export const normalizeDegrees = (degrees: number) => {
  if (!Number.isFinite(degrees)) return 0;
  const mod = degrees % 360;
  return mod < 0 ? mod + 360 : mod;
};

/** Signed delta from `from` to `to` in (-180, 180]. */
export const signedAngleDelta = (from: number, to: number) => {
  let delta = normalizeDegrees(to) - normalizeDegrees(from);
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
};

export const pointAngleDegrees = (
  center: [number, number],
  point: [number, number],
) =>
  normalizeDegrees(
    (Math.atan2(point[1] - center[1], point[0] - center[0]) * 180) / Math.PI,
  );

/** Counter-clockwise sweep from start to end in (0, 360]. */
export const ccwSweepDegrees = (startAngle: number, endAngle: number) => {
  const sweep = normalizeDegrees(endAngle - startAngle);
  return sweep === 0 ? 360 : sweep;
};

export const arcSweepDegrees = (
  startAngle: number,
  endAngle: number,
  largeArc = false,
) => {
  const ccw = ccwSweepDegrees(startAngle, endAngle);
  const minor = Math.min(ccw, 360 - ccw);
  return largeArc ? 360 - minor : minor;
};

export const isAngleBetweenCcw = (
  startAngle: number,
  endAngle: number,
  probeAngle: number,
) => {
  const sweep = ccwSweepDegrees(startAngle, endAngle);
  const offset = normalizeDegrees(probeAngle - startAngle);
  return offset > 0 && offset < sweep;
};

/**
 * Signed sweep (degrees) of the selected arc from start → end.
 * Positive = counter-clockwise in world coordinates.
 */
export const signedArcSweep = (
  startAngle: number,
  endAngle: number,
  largeArc: boolean,
) => {
  const ccw = ccwSweepDegrees(startAngle, endAngle);
  const cw = 360 - ccw;
  if (Math.abs(ccw - 180) < 1e-6) return largeArc ? 180 : 180;
  if (largeArc) return ccw > 180 ? ccw : -cw;
  return ccw < 180 ? ccw : -cw;
};

export const pointOnCircle = (
  center: [number, number],
  radius: number,
  angleDegrees: number,
): [number, number] => {
  const radians = (angleDegrees * Math.PI) / 180;
  return [
    center[0] + radius * Math.cos(radians),
    center[1] + radius * Math.sin(radians),
  ];
};

export const projectPointOntoCircle = (
  center: [number, number],
  radius: number,
  point: { x: number; y: number },
): [number, number] => {
  const dx = point.x - center[0];
  const dy = point.y - center[1];
  if (Math.hypot(dx, dy) < 1e-9) {
    return [center[0] + radius, center[1]];
  }
  const angle = Math.atan2(dy, dx);
  return [
    center[0] + radius * Math.cos(angle),
    center[1] + radius * Math.sin(angle),
  ];
};

export type ArcGeometry = {
  center: [number, number];
  radius: number;
  start: [number, number];
  end: [number, number];
  startAngle: number;
  endAngle: number;
  /** Signed sweep start→end in degrees; positive = CCW. */
  sweep: number;
  largeArc: boolean;
};

const roundCoord = (value: number) => Math.round(value * 100) / 100;
const roundPoint = (point: [number, number]): [number, number] => [
  roundCoord(point[0]),
  roundCoord(point[1]),
];

const geometryFromSweep = (
  center: [number, number],
  radius: number,
  start: [number, number],
  startAngle: number,
  sweep: number,
): ArcGeometry => {
  const safeSweep =
    Math.abs(sweep) < 1e-6 ? (sweep < 0 ? -0.01 : 0.01) : sweep;
  const clamped = Math.max(-359.99, Math.min(359.99, safeSweep));
  const endAngle = normalizeDegrees(startAngle + clamped);
  const end = pointOnCircle(center, radius, endAngle);
  return {
    center: roundPoint(center),
    radius: roundCoord(radius),
    start: roundPoint(start),
    end: roundPoint(end),
    startAngle: roundCoord(startAngle),
    endAngle: roundCoord(endAngle),
    sweep: roundCoord(clamped),
    largeArc: Math.abs(clamped) > 180,
  };
};

export const arcFromThreePoints = (
  a: { x: number; y: number },
  m: { x: number; y: number },
  b: { x: number; y: number },
): ArcGeometry | null => {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-6) return null;
  const center: [number, number] = [
    ((a.x * a.x + a.y * a.y) * (m.y - b.y) +
      (m.x * m.x + m.y * m.y) * (b.y - a.y) +
      (b.x * b.x + b.y * b.y) * (a.y - m.y)) /
      d,
    ((a.x * a.x + a.y * a.y) * (b.x - m.x) +
      (m.x * m.x + m.y * m.y) * (a.x - b.x) +
      (b.x * b.x + b.y * b.y) * (m.x - a.x)) /
      d,
  ];
  const radius = Math.max(
    0.1,
    Math.hypot(a.x - center[0], a.y - center[1]),
  );
  const startAngle = pointAngleDegrees(center, [a.x, a.y]);
  const endAngle = pointAngleDegrees(center, [b.x, b.y]);
  const middleAngle = pointAngleDegrees(center, [m.x, m.y]);
  const middleOnCcw = isAngleBetweenCcw(startAngle, endAngle, middleAngle);
  const ccw = ccwSweepDegrees(startAngle, endAngle);
  const sweep = middleOnCcw ? ccw : -(360 - ccw);
  const safe =
    Math.abs(sweep) < 1e-6 || Math.abs(Math.abs(sweep) - 360) < 1e-6
      ? middleOnCcw
        ? 0.01
        : -0.01
      : sweep;
  return geometryFromSweep(center, radius, [a.x, a.y], startAngle, safe);
};

/**
 * Center + start define a fixed circle. `end` only sets the sweep on that circle.
 * Pass `sweep` explicitly (from drag tracking) so the arc extends continuously
 * in the direction the pointer travels around the center.
 */
export const arcFromCenterEndpoints = (
  center: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  sweep?: number | null,
): ArcGeometry | null => {
  const centerPoint: [number, number] = [center.x, center.y];
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  if (radius < 0.1) return null;
  const startPoint: [number, number] = [start.x, start.y];
  const startAngle = pointAngleDegrees(centerPoint, startPoint);
  const endAngle = pointAngleDegrees(
    centerPoint,
    projectPointOntoCircle(centerPoint, radius, end),
  );
  const resolvedSweep =
    sweep != null && Number.isFinite(sweep)
      ? sweep
      : signedAngleDelta(startAngle, endAngle);
  return geometryFromSweep(
    centerPoint,
    radius,
    startPoint,
    startAngle,
    resolvedSweep,
  );
};

/**
 * Update cumulative signed sweep while the pointer moves around a fixed circle.
 * Keeps the arc growing continuously instead of always snapping to the minor arc.
 */
export const accumulateCenterArcSweep = (
  previousSweep: number,
  previousEndAngle: number,
  nextEndAngle: number,
) => previousSweep + signedAngleDelta(previousEndAngle, nextEndAngle);

export const arcFromEntity = (entity: {
  center?: [number, number] | null;
  start?: [number, number] | null;
  end?: [number, number] | null;
  radius?: number | null;
  startAngle?: number | null;
  endAngle?: number | null;
  largeArc?: boolean | null;
}): ArcGeometry | null => {
  if (!entity.center || !entity.start || !entity.end) return null;
  const center = entity.center;
  const radius =
    entity.radius ??
    Math.max(
      Math.hypot(entity.start[0] - center[0], entity.start[1] - center[1]),
      0.1,
    );
  const startAngle =
    entity.startAngle ?? pointAngleDegrees(center, entity.start);
  const endAngle = entity.endAngle ?? pointAngleDegrees(center, entity.end);
  const largeArc =
    entity.largeArc ?? ccwSweepDegrees(startAngle, endAngle) > 180;
  const sweep = signedArcSweep(startAngle, endAngle, largeArc);
  return {
    center,
    radius,
    start: entity.start,
    end: entity.end,
    startAngle,
    endAngle,
    sweep,
    largeArc,
  };
};

export const arcWithSweep = (
  geometry: ArcGeometry,
  sweepDegrees: number,
): ArcGeometry =>
  geometryFromSweep(
    geometry.center,
    geometry.radius,
    geometry.start,
    geometry.startAngle,
    Math.max(0.01, Math.min(359.99, sweepDegrees)),
  );

export const toggleArcDirection = (geometry: ArcGeometry): ArcGeometry => {
  const sweep = geometry.sweep;
  const reversed =
    sweep >= 0 ? -(360 - Math.abs(sweep) || 360) : 360 - Math.abs(sweep);
  return geometryFromSweep(
    geometry.center,
    geometry.radius,
    geometry.start,
    geometry.startAngle,
    reversed,
  );
};

export const arcPreviewFromPending = (
  mode: ArcDrawMode,
  pending: Array<{ x: number; y: number }>,
  cursor: { x: number; y: number },
  centerSweep?: number | null,
): ArcGeometry | null => {
  if (mode === "centerEndpoints") {
    if (pending.length === 2) {
      return arcFromCenterEndpoints(
        pending[0],
        pending[1],
        cursor,
        centerSweep,
      );
    }
    return null;
  }
  if (pending.length === 2) {
    return arcFromThreePoints(pending[0], pending[1], cursor);
  }
  return null;
};

/**
 * Sample the arc around the known center so the path cannot drift to the
 * alternate SVG elliptical-arc center under Y-flipped screen coordinates.
 */
export const arcSvgPath = (
  geometry: ArcGeometry,
  screen: (point: { x: number; y: number }) => { x: number; y: number },
  _scale?: number,
) => {
  const sweep =
    geometry.sweep ??
    signedArcSweep(geometry.startAngle, geometry.endAngle, geometry.largeArc);
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 3));
  const [sx, sy] = pointOnCircle(
    geometry.center,
    geometry.radius,
    geometry.startAngle,
  );
  const start = screen({ x: sx, y: sy });
  let d = `M${start.x},${start.y}`;
  for (let i = 1; i <= steps; i += 1) {
    const angle = geometry.startAngle + (sweep * i) / steps;
    const [x, y] = pointOnCircle(geometry.center, geometry.radius, angle);
    const p = screen({ x, y });
    d += `L${p.x},${p.y}`;
  }
  return d;
};
