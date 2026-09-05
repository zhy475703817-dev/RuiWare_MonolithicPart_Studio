import type { Draft } from "../../types";

type SketchEntity = Draft["sketch"]["entities"][number];
type SketchConstraint = Draft["sketch"]["constraints"][number];
export type TangencyEndpoint = "start" | "end";

export type TangencyDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  lineEntityId: string;
  arcEntityId: string;
  lineHandle: TangencyEndpoint;
  arcHandle: TangencyEndpoint;
  angleErrorDegrees?: number;
};

export type TangencyRepair = {
  lineEntityId: string;
  arcEntityId: string;
  lineHandle: TangencyEndpoint;
  arcHandle: TangencyEndpoint;
  angleErrorDegrees: number;
  before: { start: [number, number]; end: [number, number] };
  after: { start: [number, number]; end: [number, number] };
};

export type RepairLineArcTangencyOptions = {
  /** Endpoint clustering tolerance in sketch units. */
  endpointToleranceMm?: number;
  /** Maximum direction error eligible for automatic repair. */
  maxAngleDegrees?: number;
  /** Entity ids known by the solver to be fully constrained. */
  fullyConstrainedEntityIds?: ReadonlySet<string> | readonly string[];
};

export type RepairLineArcTangencyResult = {
  entities: Draft["sketch"]["entities"];
  repaired: boolean;
  changedEntityIds: string[];
  repairs: TangencyRepair[];
  diagnostics: TangencyDiagnostic[];
};

const EPSILON = 1e-9;
const DEFAULT_ENDPOINT_TOLERANCE_MM = 0.05;
const DEFAULT_MAX_ANGLE_DEGREES = 8;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clonePoint = (point: [number, number]): [number, number] => [
  point[0],
  point[1],
];

const cloneEntities = (entities: Draft["sketch"]["entities"]) =>
  entities.map((entity) => ({
    ...entity,
    start: entity.start ? clonePoint(entity.start) : null,
    end: entity.end ? clonePoint(entity.end) : null,
    center: entity.center ? clonePoint(entity.center) : null,
    points: entity.points.map(clonePoint),
  }));

const distance = (left: [number, number], right: [number, number]) =>
  Math.hypot(left[0] - right[0], left[1] - right[1]);

const normalizeDegrees = (angle: number) => {
  const value = angle % 360;
  return value < 0 ? value + 360 : value;
};

const pointAngleDegrees = (
  center: [number, number],
  point: [number, number],
) =>
  normalizeDegrees(
    (Math.atan2(point[1] - center[1], point[0] - center[0]) * 180) /
      Math.PI,
  );

const ccwSweepDegrees = (startAngle: number, endAngle: number) => {
  const sweep = normalizeDegrees(endAngle - startAngle);
  return sweep === 0 ? 360 : sweep;
};

const inferredSweepSign = (
  startAngle: number,
  endAngle: number,
  largeArc: boolean,
) => {
  const ccw = ccwSweepDegrees(startAngle, endAngle);
  if (Math.abs(ccw - 180) < 1e-7) return 1;
  if (largeArc) return ccw > 180 ? 1 : -1;
  return ccw < 180 ? 1 : -1;
};

const arcDirectionSign = (entity: SketchEntity, startAngle: number, endAngle: number) => {
  if (entity.sweepDirection === "cw") return -1;
  if (entity.sweepDirection === "ccw") return 1;
  return inferredSweepSign(startAngle, endAngle, !!entity.largeArc);
};

/**
 * Return the analytic unit tangent of an arc at one of its parameter endpoints.
 * The tangent follows the authored sweep direction; callers can negate it when
 * traversing the same edge in reverse.
 */
export const arcEndpointTangent = (
  entity: SketchEntity,
  endpoint: TangencyEndpoint,
  options: { reverse?: boolean } = {},
): [number, number] | null => {
  if (
    entity.geometryType !== "arc" ||
    !entity.center ||
    !finite(entity.radius) ||
    entity.radius <= 0
  ) {
    return null;
  }
  const point = entity[endpoint];
  const angleValue =
    point && distance(entity.center, point) > EPSILON
      ? pointAngleDegrees(entity.center, point)
      : endpoint === "start"
        ? entity.startAngle
        : entity.endAngle;
  if (!finite(angleValue)) return null;
  const startAngle = finite(entity.startAngle)
    ? entity.startAngle
    : entity.start
      ? pointAngleDegrees(entity.center, entity.start)
      : angleValue;
  const endAngle = finite(entity.endAngle)
    ? entity.endAngle
    : entity.end
      ? pointAngleDegrees(entity.center, entity.end)
      : angleValue;
  const sign = arcDirectionSign(entity, startAngle, endAngle) * (options.reverse ? -1 : 1);
  const radians = (angleValue * Math.PI) / 180;
  const tangent: [number, number] = [
    -Math.sin(radians) * sign,
    Math.cos(radians) * sign,
  ];
  if (Math.abs(tangent[0]) < 1e-12) tangent[0] = 0;
  if (Math.abs(tangent[1]) < 1e-12) tangent[1] = 0;
  const length = Math.hypot(tangent[0], tangent[1]);
  return length > EPSILON
    ? [
        Math.abs(tangent[0] / length) < EPSILON ? 0 : tangent[0] / length,
        Math.abs(tangent[1] / length) < EPSILON ? 0 : tangent[1] / length,
      ]
    : null;
};

const lineDirection = (line: SketchEntity): [number, number] | null => {
  if (line.geometryType !== "line" || !line.start || !line.end) return null;
  const dx = line.end[0] - line.start[0];
  const dy = line.end[1] - line.start[1];
  const length = Math.hypot(dx, dy);
  return length > EPSILON ? [dx / length, dy / length] : null;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

/**
 * Return the orientation-free angle between a line and an arc tangent.  A line
 * can be authored in either direction, so both parallel and anti-parallel
 * vectors represent a tangent connection.
 */
export const lineArcTangencyErrorDegrees = (
  line: SketchEntity,
  arc: SketchEntity,
  lineHandle: TangencyEndpoint,
  arcHandle: TangencyEndpoint,
) => {
  const direction = lineDirection(line);
  const tangent = arcEndpointTangent(arc, arcHandle);
  if (!direction || !tangent) return null;
  // Tangency is a line property, so authored line direction may be reversed.
  // Use the absolute dot product here; repair preserves the original sign.
  void lineHandle;
  const dot = clamp(direction[0] * tangent[0] + direction[1] * tangent[1], -1, 1);
  return (Math.acos(Math.abs(dot)) * 180) / Math.PI;
};

const endpointIsReferenced = (
  constraints: Draft["sketch"]["constraints"],
  entityId: string,
  endpoint: TangencyEndpoint,
) =>
  constraints.some((constraint) => {
    if (!constraint.enabled) return false;
    if (constraint.constraintType === "fixed" && constraint.entityRefs.includes(entityId)) {
      return true;
    }
    if (
      constraint.constraintType !== "coincident" ||
      constraint.entityRefs.length !== 2 ||
      !constraint.endpointRefs ||
      constraint.endpointRefs.length < 2
    ) {
      return false;
    }
    return constraint.entityRefs.some(
      (ref, index) => ref === entityId && constraint.endpointRefs![index] === endpoint,
    );
  });

const fullyConstrained = (
  entityId: string,
  constraints: Draft["sketch"]["constraints"],
  options: RepairLineArcTangencyOptions,
) => {
  const known = options.fullyConstrainedEntityIds;
  if (
    known &&
    (known instanceof Set
      ? known.has(entityId)
      : Array.from(known).includes(entityId))
  ) {
    return true;
  }
  return constraints.some(
    (constraint) =>
      constraint.enabled &&
      constraint.constraintType === "fixed" &&
      constraint.entityRefs.includes(entityId),
  );
};

const makeDiagnostic = (
  code: string,
  message: string,
  line: SketchEntity,
  arc: SketchEntity,
  lineHandle: TangencyEndpoint,
  arcHandle: TangencyEndpoint,
  angleErrorDegrees?: number,
): TangencyDiagnostic => ({
  severity: "error",
  code,
  message,
  lineEntityId: line.id,
  arcEntityId: arc.id,
  lineHandle,
  arcHandle,
  ...(angleErrorDegrees == null ? {} : { angleErrorDegrees }),
});

const sharedEndpointPairs = (
  line: SketchEntity,
  arc: SketchEntity,
  tolerance: number,
) => {
  const pairs: Array<{
    lineHandle: TangencyEndpoint;
    arcHandle: TangencyEndpoint;
    distance: number;
  }> = [];
  for (const lineHandle of ["start", "end"] as const) {
    const linePoint = line[lineHandle];
    if (!linePoint) continue;
    for (const arcHandle of ["start", "end"] as const) {
      const arcPoint = arc[arcHandle];
      if (!arcPoint) continue;
      const gap = distance(linePoint, arcPoint);
      if (gap <= tolerance) pairs.push({ lineHandle, arcHandle, distance: gap });
    }
  }
  return pairs.sort((left, right) => left.distance - right.distance);
};

/**
 * Repair every nearby line-arc endpoint pair without mutating the input.
 * The arc remains authoritative.  A repair rotates the line around the shared
 * endpoint and preserves its pre-repair length.  Lines with fixed or otherwise
 * constrained endpoints are reported and left unchanged.
 */
export const repairLineArcTangency = (
  sourceEntities: Draft["sketch"]["entities"],
  constraints: Draft["sketch"]["constraints"] = [],
  options: RepairLineArcTangencyOptions = {},
): RepairLineArcTangencyResult => {
  const endpointTolerance = Math.max(
    0,
    options.endpointToleranceMm ?? DEFAULT_ENDPOINT_TOLERANCE_MM,
  );
  const maxAngle = Math.max(
    0,
    options.maxAngleDegrees ?? DEFAULT_MAX_ANGLE_DEGREES,
  );
  const entities = cloneEntities(sourceEntities);
  const diagnostics: TangencyDiagnostic[] = [];
  const repairs: TangencyRepair[] = [];
  const changedEntityIds = new Set<string>();
  const processed = new Set<string>();

  for (const line of entities) {
    if (line.geometryType !== "line" || !line.start || !line.end) continue;
    for (const arc of entities) {
      if (arc.geometryType !== "arc" || !arc.center) continue;
      const pair = sharedEndpointPairs(line, arc, endpointTolerance)[0];
      if (!pair) continue;
      const key = `${line.id}|${arc.id}|${pair.lineHandle}|${pair.arcHandle}`;
      if (processed.has(key)) continue;
      processed.add(key);

      const error = lineArcTangencyErrorDegrees(
        line,
        arc,
        pair.lineHandle,
        pair.arcHandle,
      );
      if (error == null) {
        diagnostics.push(
          makeDiagnostic(
            "TANGENCY_GEOMETRY_INVALID",
            "直线或圆弧缺少有效端点/参数，无法计算解析切线。",
            line,
            arc,
            pair.lineHandle,
            pair.arcHandle,
          ),
        );
        continue;
      }
      if (error <= EPSILON) continue;
      const blocked =
        fullyConstrained(line.id, constraints, options) ||
        endpointIsReferenced(
          constraints,
          line.id,
          pair.lineHandle === "start" ? "end" : "start",
        );
      if (blocked || error > maxAngle) {
        diagnostics.push(
          makeDiagnostic(
            blocked
              ? "TANGENCY_REPAIR_BLOCKED"
              : "TANGENCY_ANGLE_EXCEEDS_TOLERANCE",
            blocked
              ? "直线已固定或另一端不是自由点，无法自动修复相切；请释放约束后重试。"
              : `直线与圆弧端点切线方向误差为 ${error.toFixed(3)}°，超过 ${maxAngle.toFixed(3)}°；未自动修改。可执行“修复为相切”或手动调整。`,
            line,
            arc,
            pair.lineHandle,
            pair.arcHandle,
            error,
          ),
        );
        continue;
      }

      const tangent = arcEndpointTangent(arc, pair.arcHandle);
      const originalLength = distance(line.start, line.end);
      if (!tangent || originalLength <= EPSILON) {
        diagnostics.push(
          makeDiagnostic(
            "TANGENCY_GEOMETRY_INVALID",
            "直线长度或圆弧解析切线无效，无法修复相切。",
            line,
            arc,
            pair.lineHandle,
            pair.arcHandle,
            error,
          ),
        );
        continue;
      }

      const currentDirection = lineDirection(line)!;
      const sign =
        currentDirection[0] * tangent[0] + currentDirection[1] * tangent[1] >= 0
          ? 1
          : -1;
      const directed: [number, number] = [
        tangent[0] * sign,
        tangent[1] * sign,
      ];
      const shared = arc[pair.arcHandle]!;
      const before = { start: clonePoint(line.start), end: clonePoint(line.end) };
      if (pair.lineHandle === "start") {
        line.start = clonePoint(shared);
        line.end = [
          shared[0] + directed[0] * originalLength,
          shared[1] + directed[1] * originalLength,
        ];
      } else {
        line.end = clonePoint(shared);
        line.start = [
          shared[0] - directed[0] * originalLength,
          shared[1] - directed[1] * originalLength,
        ];
      }
      const after = { start: clonePoint(line.start), end: clonePoint(line.end) };
      repairs.push({
        lineEntityId: line.id,
        arcEntityId: arc.id,
        lineHandle: pair.lineHandle,
        arcHandle: pair.arcHandle,
        angleErrorDegrees: error,
        before,
        after,
      });
      changedEntityIds.add(line.id);
    }
  }

  return {
    entities,
    repaired: repairs.length > 0,
    changedEntityIds: [...changedEntityIds],
    repairs,
    diagnostics,
  };
};

/** Create one tangent constraint for a line-arc pair, unless it already exists. */
export const buildUniqueTangentConstraint = (
  lineEntityId: string,
  arcEntityId: string,
  constraints: Draft["sketch"]["constraints"],
  createId: () => string,
  options: {
    lineHandle?: TangencyEndpoint;
    arcHandle?: TangencyEndpoint;
  } = {},
): SketchConstraint | null => {
  const alreadyExists = constraints.some(
    (constraint) =>
      constraint.constraintType === "tangent" &&
      constraint.entityRefs.length === 2 &&
      new Set(constraint.entityRefs).size === 2 &&
      constraint.entityRefs.includes(lineEntityId) &&
      constraint.entityRefs.includes(arcEntityId),
  );
  if (alreadyExists) return null;
  const endpointRefs =
    options.lineHandle && options.arcHandle
      ? [options.lineHandle, options.arcHandle] as [TangencyEndpoint, TangencyEndpoint]
      : undefined;
  return {
    id: createId(),
    label: `相切 · ${lineEntityId} ↔ ${arcEntityId}`,
    constraintType: "tangent",
    entityRefs: [lineEntityId, arcEntityId],
    ...(endpointRefs ? { endpointRefs } : {}),
    expression: null,
    parameterId: null,
    value: null,
    driverMode: null,
    enabled: true,
    driving: true,
  };
};
