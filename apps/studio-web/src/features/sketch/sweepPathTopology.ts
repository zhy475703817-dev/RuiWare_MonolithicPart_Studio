import type { Diagnostic, SweepPathGeometry, SweepPathSketch } from "../../types";

export const PATH_ENDPOINT_EPSILON = 0.05;
export type SweepPathTopology = {
  diagnostics: Diagnostic[];
  ordered: Array<{ geometryId: string; forward: boolean }>;
  startEndpointRef: { geometryId: string; endpoint: "start" | "end" } | null;
};

type Point = [number, number];
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const endpoints = (g: SweepPathGeometry): [Point, Point] | null => {
  const pts = g.points || [];
  let a = g.start || pts[0];
  let b = g.end || pts[pts.length - 1];
  if ((!a || !b) && g.geometryType === "arc" && g.center && g.radius != null && g.startAngle != null && g.endAngle != null) {
    a = a || [g.center[0] + g.radius * Math.cos(g.startAngle), g.center[1] + g.radius * Math.sin(g.startAngle)];
    b = b || [g.center[0] + g.radius * Math.cos(g.endAngle), g.center[1] + g.radius * Math.sin(g.endAngle)];
  }
  return a && b ? [a, b] : null;
};
const diag = (code: string, path: string, message: string, geometryIds?: string[]): Diagnostic => ({ severity: "error", code, path, message, geometryIds });
const arcSweep = (g: SweepPathGeometry) => {
  if (g.startAngle == null || g.endAngle == null) return null;
  let d = g.endAngle - g.startAngle;
  if (g.largeArc) {
    if (d >= 0 && d < Math.PI) d += 2 * Math.PI;
    if (d < 0 && d > -Math.PI) d -= 2 * Math.PI;
  } else {
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
  }
  return d;
};
const polyline = (g: SweepPathGeometry, ep: [Point, Point]) => {
  if (g.geometryType === "line") return g.points?.length > 1 ? g.points : ep;
  const sweep = arcSweep(g);
  if (sweep == null || !g.center || g.radius == null || g.startAngle == null) return ep;
  const count = Math.max(8, Math.min(128, Math.floor(Math.abs(sweep) / (Math.PI / 24)) + 1));
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = g.startAngle! + sweep * i / count;
    return [g.center![0] + g.radius! * Math.cos(a), g.center![1] + g.radius! * Math.sin(a)] as Point;
  });
};
const orientation = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: Point, b: Point, p: Point) => p[0] >= Math.min(a[0], b[0]) - PATH_ENDPOINT_EPSILON && p[0] <= Math.max(a[0], b[0]) + PATH_ENDPOINT_EPSILON && p[1] >= Math.min(a[1], b[1]) - PATH_ENDPOINT_EPSILON && p[1] <= Math.max(a[1], b[1]) + PATH_ENDPOINT_EPSILON;
const segmentIntersects = (a: Point, b: Point, c: Point, d: Point) => {
  const [o1, o2, o3, o4] = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)];
  const cross = (x: number, y: number) => (x > 1e-8 && y < -1e-8) || (x < -1e-8 && y > 1e-8);
  return (cross(o1, o2) && cross(o3, o4)) || (Math.abs(o1) <= 1e-8 && onSegment(a, b, c)) || (Math.abs(o2) <= 1e-8 && onSegment(a, b, d)) || (Math.abs(o3) <= 1e-8 && onSegment(c, d, a)) || (Math.abs(o4) <= 1e-8 && onSegment(c, d, b));
};
const intersects = (a: Point[], b: Point[]) => a.slice(0, -1).some((p, i) => b.slice(0, -1).some((q, j) => segmentIntersects(p, a[i + 1], q, b[j + 1])));

export function validateSweepPathTopology(path: SweepPathSketch): SweepPathTopology {
  const diagnostics: Diagnostic[] = [];
  const source = path.geometry.filter((g) => g.geometryType === "line" || g.geometryType === "arc");
  path.geometry.filter((g) => g.geometryType !== "line" && g.geometryType !== "arc").forEach((g) => diagnostics.push(diag("SWEEP_PATH_ILLEGAL_GEOMETRY", `sweepPath.geometry.${g.id}`, "扫掠路径只允许直线和圆弧图元。", [g.id])));
  if (!source.length) return { diagnostics: diagnostics.length ? diagnostics : [diag("SWEEP_PATH_EMPTY", "sweepPath.geometry", "请至少绘制一条扫掠路径图元。")], ordered: [], startEndpointRef: null };
  const valid = source.map((g) => ({ g, ep: endpoints(g) })).filter((x): x is { g: SweepPathGeometry; ep: [Point, Point] } => !!x.ep && dist(x.ep[0], x.ep[1]) > 1e-9);
  source.filter((g) => !valid.some((x) => x.g.id === g.id)).forEach((g) => diagnostics.push(diag("SWEEP_PATH_GEOMETRY_INVALID", `sweepPath.geometry.${g.id}`, "路径图元端点无效或长度为零。", [g.id])));
  const nodes: Point[] = [];
  const nodeFor = (p: Point) => { const i = nodes.findIndex((n) => dist(n, p) <= PATH_ENDPOINT_EPSILON); if (i >= 0) return i; nodes.push(p); return nodes.length - 1; };
  const edges = valid.map(({ g, ep }) => ({ g, ep, a: nodeFor(ep[0]), b: nodeFor(ep[1]) }));
  edges.filter((e) => e.g.geometryType === "arc").forEach((e) => diagnostics.push(diag("SWEEP_PATH_ARC_UNSUPPORTED", `sweepPath.geometry.${e.g.id}`, "第一版扫掠跟随暂不支持圆弧路径，请使用直线或连续折线。", [e.g.id])));
  const incident = nodes.map(() => [] as number[]);
  edges.forEach((e, i) => { incident[e.a].push(i); incident[e.b].push(i); });
  incident.forEach((members) => { if (new Set(members).size > 2) diagnostics.push(diag("SWEEP_PATH_BRANCH", "sweepPath.geometry", "路径连接点出现分叉，连接点度数不能大于 2。", members.map((i) => edges[i].g.id))); });
  const requested = path.startEndpointRef || (path.startPointId ? { geometryId: path.startPointId, endpoint: "start" as const } : null);
  let startIndex = requested ? edges.findIndex((e) => e.g.id === requested.geometryId) : -1;
  let endpoint: "start" | "end" = requested?.endpoint || "start";
  const degreeOne = incident.map((m, i) => m.length === 1 ? i : -1).filter((i) => i >= 0);
  if (startIndex < 0 && degreeOne.length) { const node = degreeOne[0]; startIndex = incident[node][0]; endpoint = edges[startIndex].a === node ? "start" : "end"; }
  if (startIndex < 0) diagnostics.push(diag("SWEEP_PATH_START_UNDEFINED", "sweepPath.startEndpointRef", "闭合扫掠路径必须明确选择起点。"));
  const startEndpointRef = startIndex >= 0 ? { geometryId: edges[startIndex].g.id, endpoint } : null;
  const ordered: Array<{ geometryId: string; forward: boolean }> = [];
  if (startIndex >= 0) {
    const first = edges[startIndex];
    const firstForward = endpoint === "start";
    ordered.push({ geometryId: first.g.id, forward: firstForward });
    let node = firstForward ? first.b : first.a;
    let previous = startIndex;
    while (true) {
      const next = incident[node].find((i) => i !== previous && !ordered.some((o) => o.geometryId === edges[i].g.id));
      if (next == null) break;
      const edge = edges[next]; const forward = edge.a === node;
      ordered.push({ geometryId: edge.g.id, forward }); node = forward ? edge.b : edge.a; previous = next;
    }
    if (ordered.length !== edges.length) diagnostics.push(diag("SWEEP_PATH_DISCONNECTED", "sweepPath.geometry", "扫掠路径存在未连接的图元。", edges.filter((e) => !ordered.some((o) => o.geometryId === e.g.id)).map((e) => e.g.id)));
  }
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j];
    const sameLine = a.g.geometryType === "line" && b.g.geometryType === "line" && ((dist(a.ep[0], b.ep[0]) <= PATH_ENDPOINT_EPSILON && dist(a.ep[1], b.ep[1]) <= PATH_ENDPOINT_EPSILON) || (dist(a.ep[0], b.ep[1]) <= PATH_ENDPOINT_EPSILON && dist(a.ep[1], b.ep[0]) <= PATH_ENDPOINT_EPSILON));
    if (sameLine) diagnostics.push(diag("SWEEP_PATH_DUPLICATE_SEGMENT", "sweepPath.geometry", "发现重复的线段（含反向重合）。", [a.g.id, b.g.id]));
    const adjacent = a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;
    if (!adjacent && intersects(polyline(a.g, a.ep), polyline(b.g, b.ep))) diagnostics.push(diag("SWEEP_PATH_SELF_INTERSECTION", "sweepPath.geometry", "路径图元之间存在自相交。", [a.g.id, b.g.id]));
  }
  return { diagnostics, ordered, startEndpointRef };
}
