import type {
  Diagnostic,
  SweepDirection,
  SweepPathGeometry,
  SweepPathSketch,
} from "../../types";

/** Endpoint clustering tolerance shared by topology and path serialization. */
export const PATH_ENDPOINT_EPSILON = 0.05;
const ANGLE_EPSILON = 1e-7;
const DEFAULT_MAX_ANGLE_DEGREES = 5;
const DEFAULT_MAX_CHORD_ERROR = 0.1;

export type SweepPathOrderedGeometry = {
  geometryId: string;
  forward: boolean;
};

export type SweepPathTopology = {
  diagnostics: Diagnostic[];
  ordered: SweepPathOrderedGeometry[];
  startEndpointRef: { geometryId: string; endpoint: "start" | "end" } | null;
};

type Point = [number, number];
type Edge = {
  geometry: SweepPathGeometry;
  start: Point;
  end: Point;
  startNode: number;
  endNode: number;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleDistance = (a: number, b: number) => {
  const delta = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return Math.min(delta, 360 - delta);
};
const normalizeDegrees = (angle: number) => {
  const value = angle % 360;
  return value < 0 ? value + 360 : value;
};

const asPoint = (value: unknown): Point | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

const diag = (
  code: string,
  path: string,
  message: string,
  geometryIds?: string[],
): Diagnostic => ({
  severity: "error",
  code,
  path,
  message,
  geometryIds,
});

/**
 * Return the signed selected sweep in degrees. Angles in the web sketch are
 * degrees.  The endpoint angles remain authoritative; for a legacy
 * ``largeArc`` record whose requested direction would miss that endpoint, the
 * complementary signed route is selected instead of introducing a jump.
 */
export const sweepArcDegrees = (geometry: SweepPathGeometry): number | null => {
  if (!finite(geometry.startAngle) || !finite(geometry.endAngle)) return null;
  const direction: SweepDirection = geometry.sweepDirection || "ccw";
  if (direction !== "ccw" && direction !== "cw") return null;
  const ccwDelta = normalizeDegrees(geometry.endAngle - geometry.startAngle);
  if (ccwDelta <= ANGLE_EPSILON) return 0;
  let sweep = direction === "ccw" ? ccwDelta : ccwDelta - 360;
  if (geometry.largeArc && Math.abs(sweep) < 180) {
    // Keep the parameterized end point exact.  When the requested direction
    // and the major route are opposite (for example 0° -> 90° CCW with
    // largeArc), changing only the magnitude would land at 270°.  Flipping
    // the signed travel selects the complementary directed route and mirrors
    // the Python sampler's endpoint-preserving rule.
    sweep = -Math.sign(sweep) * (360 - Math.abs(sweep));
  }
  return sweep;
};

const circlePoint = (
  center: Point,
  radius: number,
  angleDegrees: number,
): Point => {
  const radians = (angleDegrees * Math.PI) / 180;
  return [
    center[0] + radius * Math.cos(radians),
    center[1] + radius * Math.sin(radians),
  ];
};

const arcParameterEndpoints = (
  geometry: SweepPathGeometry,
): [Point, Point] | null => {
  if (
    !geometry.center ||
    !finite(geometry.radius) ||
    geometry.radius <= 0 ||
    !finite(geometry.startAngle) ||
    !finite(geometry.endAngle) ||
    sweepArcDegrees(geometry) == null
  ) {
    return null;
  }
  return [
    circlePoint(geometry.center, geometry.radius, geometry.startAngle),
    circlePoint(geometry.center, geometry.radius, geometry.endAngle),
  ];
};

/**
 * Return the analytic, directed tangent of a path edge at one of its
 * parameter endpoints.  This is intentionally independent from
 * `sampleSweepPathGeometry`: sampled chords are compatibility data and must
 * never be used to decide whether an exact line/arc join is G1 continuous.
 */
const pathEndpointTangent = (
  geometry: SweepPathGeometry,
  endpoint: "start" | "end",
  forward: boolean,
): [number, number] | null => {
  const pair = endpoints(geometry);
  if (!pair) return null;
  const first = pair[0];
  const last = pair[1];
  if (geometry.geometryType === "line") {
    const from = forward ? first : last;
    const to = forward ? last : first;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    return length > 1e-12 ? [dx / length, dy / length] : null;
  }
  if (geometry.geometryType !== "arc" || !geometry.center || !finite(geometry.radius) || geometry.radius <= 0) {
    return null;
  }
  const sweep = sweepArcDegrees(geometry);
  if (sweep == null || Math.abs(sweep) <= ANGLE_EPSILON) return null;
  const authoredEndpoint = endpoint === "start" ? 0 : 1;
  const angleValue = authoredEndpoint === 0 ? geometry.startAngle : geometry.endAngle;
  if (!finite(angleValue)) return null;
  const sign = sweep >= 0 ? 1 : -1;
  const radians = (angleValue * Math.PI) / 180;
  let tangent: [number, number] = [
    -Math.sin(radians) * sign,
    Math.cos(radians) * sign,
  ];
  // Reversing an edge reverses its traversal direction.  The endpoint handle
  // is expressed in authored coordinates, while `forward` is path order.
  if (!forward) tangent = [-tangent[0], -tangent[1]];
  return tangent;
};

const pathTangentErrorDegrees = (
  incoming: [number, number],
  outgoing: [number, number],
) => {
  const dot = Math.max(-1, Math.min(1, incoming[0] * outgoing[0] + incoming[1] * outgoing[1]));
  return (Math.acos(dot) * 180) / Math.PI;
};

/** Maximum numerical noise tolerated before reporting a G1 join diagnostic. */
export const PATH_TANGENCY_EPSILON_DEGREES = 0.25;

export const sweepPathJoinTangency = (
  incoming: SweepPathGeometry,
  incomingForward: boolean,
  outgoing: SweepPathGeometry,
  outgoingForward: boolean,
) => {
  // RightCorner is meaningful only for line-line joins.  A line-arc, arc-line,
  // or arc-arc join must be truly tangent or be reported to the user.
  if (incoming.geometryType === "line" && outgoing.geometryType === "line") return null;
  const incomingTangent = pathEndpointTangent(incoming, incomingForward ? "end" : "start", incomingForward);
  const outgoingTangent = pathEndpointTangent(outgoing, outgoingForward ? "start" : "end", outgoingForward);
  if (!incomingTangent || !outgoingTangent) return null;
  const angleErrorDegrees = pathTangentErrorDegrees(incomingTangent, outgoingTangent);
  return { angleErrorDegrees, incomingTangent, outgoingTangent };
};

const endpoints = (geometry: SweepPathGeometry): [Point, Point] | null => {
  if (geometry.geometryType === "arc") {
    const calculated = arcParameterEndpoints(geometry);
    if (!calculated) return null;
    const explicitStart = asPoint(geometry.start);
    const explicitEnd = asPoint(geometry.end);
    // Keep authored snap coordinates, but reject malformed parameter data in
    // validateSweepPathTopology when they drift away from the circle.
    return [explicitStart || calculated[0], explicitEnd || calculated[1]];
  }
  const points = (geometry.points || []).map(asPoint).filter((point): point is Point => !!point);
  const start = asPoint(geometry.start) || asPoint(points[0]);
  const end = asPoint(geometry.end) || asPoint(points[points.length - 1]);
  return start && end ? [start, end] : null;
};

const linePoints = (geometry: SweepPathGeometry, ep: [Point, Point]): Point[] => {
  const points = (geometry.points || []).map(asPoint).filter((point): point is Point => !!point);
  return points.length >= 2 ? points : ep;
};

/** Sample an authored path edge for diagnostics and path-point serialization.
 * Endpoint clustering never uses these samples; only the two true endpoints
 * participate in the topology graph.
 */
export const sampleSweepPathGeometry = (
  geometry: SweepPathGeometry,
  forward = true,
  maxAngleDegrees = DEFAULT_MAX_ANGLE_DEGREES,
  maxChordError = DEFAULT_MAX_CHORD_ERROR,
): Point[] => {
  const ep = endpoints(geometry);
  if (!ep) return [];
  if (geometry.geometryType === "line") {
    const points = linePoints(geometry, ep);
    return forward ? points : [...points].reverse();
  }
  if (geometry.geometryType !== "arc" || !geometry.center || !finite(geometry.radius)) return [];
  const sweep = sweepArcDegrees(geometry);
  if (sweep == null || Math.abs(sweep) <= ANGLE_EPSILON || geometry.radius <= 0) return [];
  const maxAngle = Number(maxAngleDegrees);
  const chordError = Number(maxChordError);
  if (!Number.isFinite(maxAngle) || maxAngle <= 0 || !Number.isFinite(chordError) || chordError < 0) return [];
  let step = (maxAngle * Math.PI) / 180;
  if (chordError > 0) {
    const cosine = Math.max(-1, Math.min(1, 1 - chordError / geometry.radius));
    const sagittaStep = 2 * Math.acos(cosine);
    if (sagittaStep > ANGLE_EPSILON) step = Math.min(step, sagittaStep);
  }
  if (step <= ANGLE_EPSILON) step = Math.min(Math.PI / 18000, (maxAngle * Math.PI) / 180);
  const count = Math.max(1, Math.ceil((Math.abs(sweep) * Math.PI) / 180 / step));
  const points: Point[] = [];
  for (let index = 0; index <= count; index += 1) {
    if (index === 0) points.push(ep[0]);
    else if (index === count) points.push(ep[1]);
    else points.push(circlePoint(geometry.center, geometry.radius, geometry.startAngle! + (sweep * index) / count));
  }
  return forward ? points : points.reverse();
};

const orientation = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: Point, b: Point, p: Point) =>
  p[0] >= Math.min(a[0], b[0]) - PATH_ENDPOINT_EPSILON &&
  p[0] <= Math.max(a[0], b[0]) + PATH_ENDPOINT_EPSILON &&
  p[1] >= Math.min(a[1], b[1]) - PATH_ENDPOINT_EPSILON &&
  p[1] <= Math.max(a[1], b[1]) + PATH_ENDPOINT_EPSILON;
const segmentIntersects = (a: Point, b: Point, c: Point, d: Point) => {
  const [o1, o2, o3, o4] = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)];
  const cross = (x: number, y: number) => (x > 1e-8 && y < -1e-8) || (x < -1e-8 && y > 1e-8);
  return (cross(o1, o2) && cross(o3, o4)) || (Math.abs(o1) <= 1e-8 && onSegment(a, b, c)) || (Math.abs(o2) <= 1e-8 && onSegment(a, b, d)) || (Math.abs(o3) <= 1e-8 && onSegment(c, d, a)) || (Math.abs(o4) <= 1e-8 && onSegment(c, d, b));
};
const intersects = (a: Point[], b: Point[]) => a.slice(0, -1).some((point, i) => b.slice(0, -1).some((other, j) => segmentIntersects(point, a[i + 1], other, b[j + 1])));

const sameLine = (a: Edge, b: Edge) =>
  (dist(a.start, b.start) <= PATH_ENDPOINT_EPSILON && dist(a.end, b.end) <= PATH_ENDPOINT_EPSILON) ||
  (dist(a.start, b.end) <= PATH_ENDPOINT_EPSILON && dist(a.end, b.start) <= PATH_ENDPOINT_EPSILON);

const sameArc = (a: Edge, b: Edge) => {
  const ga = a.geometry;
  const gb = b.geometry;
  if (!ga.center || !gb.center || !finite(ga.radius) || !finite(gb.radius)) return false;
  if (dist(ga.center, gb.center) > PATH_ENDPOINT_EPSILON || Math.abs(ga.radius - gb.radius) > PATH_ENDPOINT_EPSILON) return false;
  if ((ga.sweepDirection || "ccw") !== (gb.sweepDirection || "ccw")) return false;
  const firstSweep = sweepArcDegrees(ga);
  const secondSweep = sweepArcDegrees(gb);
  if (firstSweep == null || secondSweep == null || Math.abs(firstSweep - secondSweep) > ANGLE_EPSILON) return false;
  return angleDistance(ga.startAngle!, gb.startAngle!) <= ANGLE_EPSILON && angleDistance(ga.endAngle!, gb.endAngle!) <= ANGLE_EPSILON && dist(a.start, b.start) <= PATH_ENDPOINT_EPSILON && dist(a.end, b.end) <= PATH_ENDPOINT_EPSILON;
};

export function validateSweepPathTopology(path: SweepPathSketch): SweepPathTopology {
  const diagnostics: Diagnostic[] = [];
  const source = path.geometry.filter((geometry) => geometry.geometryType === "line" || geometry.geometryType === "arc");
  path.geometry.filter((geometry) => geometry.geometryType !== "line" && geometry.geometryType !== "arc").forEach((geometry) => diagnostics.push(diag("SWEEP_PATH_ILLEGAL_GEOMETRY", `sweepPath.geometry.${geometry.id}`, "扫掠路径只允许直线和圆弧图元。", [geometry.id])));
  if (!source.length) return { diagnostics: diagnostics.length ? diagnostics : [diag("SWEEP_PATH_EMPTY", "sweepPath.geometry", "请至少绘制一条扫掠路径图元。")], ordered: [], startEndpointRef: null };
  const valid: Array<{ geometry: SweepPathGeometry; endpoints: [Point, Point] }> = [];
  for (const geometry of source) {
    const pair = endpoints(geometry);
    if (!pair) {
      diagnostics.push(diag("SWEEP_PATH_GEOMETRY_INVALID", `sweepPath.geometry.${geometry.id}`, geometry.geometryType === "arc" ? "圆弧必须包含有效圆心、正半径、起止角和扫掠方向。" : "路径图元端点无效。", [geometry.id]));
      continue;
    }
    if (geometry.geometryType === "arc") {
      const parameterPair = arcParameterEndpoints(geometry);
      if (!parameterPair || (geometry.sweepDirection && !["ccw", "cw"].includes(geometry.sweepDirection))) {
        diagnostics.push(diag("SWEEP_PATH_GEOMETRY_INVALID", `sweepPath.geometry.${geometry.id}`, "圆弧必须包含有效圆心、正半径、起止角和扫掠方向。", [geometry.id]));
        continue;
      }
      if ((geometry.start && dist(geometry.start, parameterPair[0]) > PATH_ENDPOINT_EPSILON) || (geometry.end && dist(geometry.end, parameterPair[1]) > PATH_ENDPOINT_EPSILON)) {
        diagnostics.push(diag("SWEEP_PATH_GEOMETRY_INVALID", `sweepPath.geometry.${geometry.id}`, "圆弧显式端点与圆心、半径和角度不一致。", [geometry.id]));
        continue;
      }
      const sweep = sweepArcDegrees(geometry);
      if (sweep == null || Math.abs(sweep) <= ANGLE_EPSILON) {
        diagnostics.push(diag("SWEEP_PATH_ZERO_LENGTH", `sweepPath.geometry.${geometry.id}`, "圆弧路径长度不能为零。", [geometry.id]));
        continue;
      }
    }
    if (dist(pair[0], pair[1]) <= 1e-9) {
      diagnostics.push(diag("SWEEP_PATH_ZERO_LENGTH", `sweepPath.geometry.${geometry.id}`, "路径图元端点无效或长度为零。", [geometry.id]));
      continue;
    }
    valid.push({ geometry, endpoints: pair });
  }
  if (!valid.length) return { diagnostics, ordered: [], startEndpointRef: null };
  const nodes: Point[] = [];
  const nodeFor = (point: Point) => {
    const existing = nodes.findIndex((node) => dist(node, point) <= PATH_ENDPOINT_EPSILON);
    if (existing >= 0) return existing;
    nodes.push(point);
    return nodes.length - 1;
  };
  const edges: Edge[] = valid.map(({ geometry, endpoints: pair }) => ({ geometry, start: pair[0], end: pair[1], startNode: nodeFor(pair[0]), endNode: nodeFor(pair[1]) }));
  const incident = nodes.map(() => [] as number[]);
  edges.forEach((edge, index) => { incident[edge.startNode].push(index); incident[edge.endNode].push(index); });
  incident.forEach((members) => {
    if (new Set(members).size > 2) diagnostics.push(diag("SWEEP_PATH_BRANCH", "sweepPath.geometry", "路径连接点出现分叉，连接点度数不能大于 2。", [...new Set(members)].map((index) => edges[index].geometry.id)));
  });

  const requested = path.startEndpointRef || (path.startPointId ? { geometryId: path.startPointId, endpoint: "start" as const } : null);
  let startIndex = requested ? edges.findIndex((edge) => edge.geometry.id === requested.geometryId) : -1;
  let endpoint: "start" | "end" = requested?.endpoint || "start";
  if (requested && requested.endpoint !== "start" && requested.endpoint !== "end") {
    diagnostics.push(diag("SWEEP_PATH_START_UNDEFINED", "sweepPath.startEndpointRef.endpoint", "扫掠路径起点端点必须是 start 或 end."));
    endpoint = "start";
  }
  const degreeOne = incident.map((members, index) => (new Set(members).size === 1 ? index : -1)).filter((index) => index >= 0);
  if (startIndex < 0 && degreeOne.length) {
    const node = degreeOne[0];
    startIndex = incident[node][0];
    endpoint = edges[startIndex].startNode === node ? "start" : "end";
  }
  if (startIndex < 0) diagnostics.push(diag("SWEEP_PATH_START_UNDEFINED", "sweepPath.startEndpointRef", "闭合扫掠路径必须明确选择起点。"));
  const startEndpointRef = startIndex >= 0 ? { geometryId: edges[startIndex].geometry.id, endpoint } : null;

  const ordered: SweepPathOrderedGeometry[] = [];
  const visited = new Set<number>();
  if (startIndex >= 0) {
    const first = edges[startIndex];
    const firstForward = endpoint === "start";
    ordered.push({ geometryId: first.geometry.id, forward: firstForward });
    visited.add(startIndex);
    let node = firstForward ? first.endNode : first.startNode;
    let previous = startIndex;
    while (true) {
      const next = incident[node].find((index) => index !== previous && !visited.has(index));
      if (next == null) break;
      const edge = edges[next];
      const forward = edge.startNode === node;
      ordered.push({ geometryId: edge.geometry.id, forward });
      visited.add(next);
      node = forward ? edge.endNode : edge.startNode;
      previous = next;
    }
    if (visited.size !== edges.length) diagnostics.push(diag("SWEEP_PATH_DISCONNECTED", "sweepPath.geometry", "扫掠路径存在未连接的图元。", edges.filter((_edge, index) => !visited.has(index)).map((edge) => edge.geometry.id)));
  }

  // Validate the directed joins after the topology graph has established path
  // order.  Endpoint proximity alone is not enough for an exact CAD sweep:
  // line-arc, arc-line, and arc-arc joins must share the same analytic tangent.
  // The first/last join is included for closed paths, while line-line joins are
  // intentionally left to the selected corner transition mode.
  if (ordered.length >= 2) {
    const byId = new Map(edges.map((edge) => [edge.geometry.id, edge]));
    const joins = ordered.slice(0, -1).map((item, index) => [item, ordered[index + 1]] as const);
    const lastRef = ordered[ordered.length - 1];
    const firstRef = ordered[0];
    const lastEdge = byId.get(lastRef.geometryId);
    const firstEdge = byId.get(firstRef.geometryId);
    const exitNode = lastEdge ? (lastRef.forward ? lastEdge.endNode : lastEdge.startNode) : null;
    const entryNode = firstEdge ? (firstRef.forward ? firstEdge.startNode : firstEdge.endNode) : null;
    const isClosed = ordered.length === edges.length && exitNode != null && exitNode === entryNode;
    if (isClosed && ordered.length > 1) joins.push([ordered[ordered.length - 1], ordered[0]]);
    for (const [incomingRef, outgoingRef] of joins) {
      const incoming = byId.get(incomingRef.geometryId);
      const outgoing = byId.get(outgoingRef.geometryId);
      if (!incoming || !outgoing) continue;
      const result = sweepPathJoinTangency(
        incoming.geometry,
        incomingRef.forward,
        outgoing.geometry,
        outgoingRef.forward,
      );
      if (!result || result.angleErrorDegrees <= PATH_TANGENCY_EPSILON_DEGREES) continue;
      diagnostics.push(diag(
        "SWEEP_PATH_TANGENT_DISCONTINUITY",
        "sweepPath.geometry",
        `相邻路径段 ${incoming.geometry.id} 与 ${outgoing.geometry.id} 的解析切线不连续（误差 ${result.angleErrorDegrees.toFixed(3)}°）；请执行“修复为相切”后重试。`,
        [incoming.geometry.id, outgoing.geometry.id],
      ));
    }
  }
  for (let left = 0; left < edges.length; left += 1) {
    for (let right = left + 1; right < edges.length; right += 1) {
      const first = edges[left];
      const second = edges[right];
      if (first.geometry.geometryType === "line" && second.geometry.geometryType === "line" && sameLine(first, second)) diagnostics.push(diag("SWEEP_PATH_DUPLICATE_SEGMENT", "sweepPath.geometry", "发现重复的线段（含反向重合）。", [first.geometry.id, second.geometry.id]));
      else if (first.geometry.geometryType === "arc" && second.geometry.geometryType === "arc" && sameArc(first, second)) diagnostics.push(diag("SWEEP_PATH_DUPLICATE_SEGMENT", "sweepPath.geometry", "发现重复的圆弧。", [first.geometry.id, second.geometry.id]));
      const adjacent = first.startNode === second.startNode || first.startNode === second.endNode || first.endNode === second.startNode || first.endNode === second.endNode;
      if (!adjacent && intersects(sampleSweepPathGeometry(first.geometry), sampleSweepPathGeometry(second.geometry))) diagnostics.push(diag("SWEEP_PATH_SELF_INTERSECTION", "sweepPath.geometry", "路径图元之间存在自相交。", [first.geometry.id, second.geometry.id]));
    }
  }
  return { diagnostics, ordered, startEndpointRef };
}
