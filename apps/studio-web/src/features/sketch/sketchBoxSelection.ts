import type { SketchPrimitive } from "../../types";
import { arcFromEntity, normalizeDegrees, pointOnCircle } from "./sketchArc";

export type SketchSelectionMode = "contain" | "cross";

export type SketchSelectionBox = {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
};

type Point = { x: number; y: number };

const EPSILON = 1e-9;

export function normalizeSketchSelectionBox(
  start: Point,
  end: Point,
): SketchSelectionBox {
  return {
    minimumX: Math.min(start.x, end.x),
    maximumX: Math.max(start.x, end.x),
    minimumY: Math.min(start.y, end.y),
    maximumY: Math.max(start.y, end.y),
  };
}

/** A click or a purely horizontal/vertical drag has no selectable area. */
export const sketchSelectionBoxHasArea = (box: SketchSelectionBox) =>
  box.maximumX - box.minimumX > EPSILON &&
  box.maximumY - box.minimumY > EPSILON;

const pointInBox = (point: Point, box: SketchSelectionBox) =>
  point.x >= box.minimumX - EPSILON &&
  point.x <= box.maximumX + EPSILON &&
  point.y >= box.minimumY - EPSILON &&
  point.y <= box.maximumY + EPSILON;

const orientation = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const onSegment = (a: Point, b: Point, point: Point) =>
  Math.min(a.x, b.x) - EPSILON <= point.x &&
  point.x <= Math.max(a.x, b.x) + EPSILON &&
  Math.min(a.y, b.y) - EPSILON <= point.y &&
  point.y <= Math.max(a.y, b.y) + EPSILON &&
  Math.abs(orientation(a, b, point)) <= EPSILON;

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (
    ((abC > EPSILON && abD < -EPSILON) ||
      (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) ||
      (cdA < -EPSILON && cdB > EPSILON))
  ) {
    return true;
  }
  return (
    Math.abs(abC) <= EPSILON && onSegment(a, b, c) ||
    Math.abs(abD) <= EPSILON && onSegment(a, b, d) ||
    Math.abs(cdA) <= EPSILON && onSegment(c, d, a) ||
    Math.abs(cdB) <= EPSILON && onSegment(c, d, b)
  );
};

const boxEdges = (box: SketchSelectionBox): [Point, Point][] => {
  const topLeft = { x: box.minimumX, y: box.minimumY };
  const topRight = { x: box.maximumX, y: box.minimumY };
  const bottomRight = { x: box.maximumX, y: box.maximumY };
  const bottomLeft = { x: box.minimumX, y: box.maximumY };
  return [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ];
};

const segmentInBox = (start: Point, end: Point, box: SketchSelectionBox) =>
  pointInBox(start, box) ||
  pointInBox(end, box) ||
  boxEdges(box).some(([a, b]) => segmentsIntersect(start, end, a, b));

const arcAngleIsOnSweep = (
  startAngle: number,
  sweep: number,
  probeAngle: number,
) => {
  if (sweep >= 0) {
    return normalizeDegrees(probeAngle - startAngle) <= sweep + EPSILON;
  }
  return normalizeDegrees(startAngle - probeAngle) <= -sweep + EPSILON;
};

const arcPoints = (primitive: SketchPrimitive): Point[] => {
  const geometry = arcFromEntity({
    center: primitive.center
      ? [primitive.center.x, primitive.center.y]
      : null,
    start: primitive.start ? [primitive.start.x, primitive.start.y] : null,
    end: primitive.end ? [primitive.end.x, primitive.end.y] : null,
    radius: primitive.radius,
    startAngle: primitive.startAngle,
    endAngle: primitive.endAngle,
    largeArc: primitive.largeArc,
  });
  if (!geometry) return [primitive.start, primitive.end].filter(Boolean) as Point[];
  const samples = Math.max(8, Math.ceil(Math.abs(geometry.sweep) / 5));
  const points: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = geometry.startAngle + (geometry.sweep * index) / samples;
    const [x, y] = pointOnCircle(geometry.center, geometry.radius, angle);
    points.push({ x, y });
  }
  for (const angle of [0, 90, 180, 270]) {
    if (arcAngleIsOnSweep(geometry.startAngle, geometry.sweep, angle)) {
      const [x, y] = pointOnCircle(geometry.center, geometry.radius, angle);
      points.push({ x, y });
    }
  }
  return points;
};

const boundsFromPoints = (points: Point[]): SketchSelectionBox | null => {
  if (!points.length) return null;
  return {
    minimumX: Math.min(...points.map((point) => point.x)),
    maximumX: Math.max(...points.map((point) => point.x)),
    minimumY: Math.min(...points.map((point) => point.y)),
    maximumY: Math.max(...points.map((point) => point.y)),
  };
};

export function sketchPrimitiveBounds(
  primitive: SketchPrimitive,
): SketchSelectionBox | null {
  if (primitive.type === "point") {
    return primitive.start
      ? normalizeSketchSelectionBox(primitive.start, primitive.start)
      : null;
  }
  if (primitive.type === "line") {
    return primitive.start && primitive.end
      ? boundsFromPoints([primitive.start, primitive.end])
      : null;
  }
  if (primitive.type === "circle") {
    if (!primitive.center || !Number.isFinite(primitive.radius)) return null;
    const radius = Math.abs(primitive.radius || 0);
    return {
      minimumX: primitive.center.x - radius,
      maximumX: primitive.center.x + radius,
      minimumY: primitive.center.y - radius,
      maximumY: primitive.center.y + radius,
    };
  }
  if (primitive.type === "arc") return boundsFromPoints(arcPoints(primitive));
  return boundsFromPoints(primitive.points || []);
}

const boundsContainedBy = (
  bounds: SketchSelectionBox,
  box: SketchSelectionBox,
) =>
  bounds.minimumX >= box.minimumX - EPSILON &&
  bounds.maximumX <= box.maximumX + EPSILON &&
  bounds.minimumY >= box.minimumY - EPSILON &&
  bounds.maximumY <= box.maximumY + EPSILON;

const circleIntersectsBoxBoundary = (
  center: Point,
  radius: number,
  box: SketchSelectionBox,
) =>
  boxEdges(box).some(([a, b]) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= EPSILON) {
      return Math.abs(Math.hypot(a.x - center.x, a.y - center.y) - radius) <= EPSILON;
    }
    const projection = Math.max(
      0,
      Math.min(
        1,
        ((center.x - a.x) * dx + (center.y - a.y) * dy) / lengthSquared,
      ),
    );
    const closest = { x: a.x + projection * dx, y: a.y + projection * dy };
    const closestDistance = Math.hypot(closest.x - center.x, closest.y - center.y);
    const startDistance = Math.hypot(a.x - center.x, a.y - center.y);
    const endDistance = Math.hypot(b.x - center.x, b.y - center.y);
    return closestDistance <= radius + EPSILON &&
      (startDistance >= radius - EPSILON || endDistance >= radius - EPSILON);
  });

const primitiveCrossesBox = (
  primitive: SketchPrimitive,
  box: SketchSelectionBox,
) => {
  if (primitive.type === "point") return !!primitive.start && pointInBox(primitive.start, box);
  if (primitive.type === "line") {
    return !!primitive.start && !!primitive.end && segmentInBox(primitive.start, primitive.end, box);
  }
  if (primitive.type === "circle") {
    if (!primitive.center || !Number.isFinite(primitive.radius)) return false;
    const radius = Math.abs(primitive.radius || 0);
    const bounds = sketchPrimitiveBounds(primitive);
    return !!bounds &&
      (boundsContainedBy(bounds, box) ||
        circleIntersectsBoxBoundary(primitive.center, radius, box));
  }
  const points = arcPoints(primitive);
  return points.some((point) => pointInBox(point, box)) ||
    points.some((point, index) => index > 0 && segmentInBox(points[index - 1], point, box));
};

export function isSketchPrimitiveInSelectionBox(
  primitive: SketchPrimitive,
  box: SketchSelectionBox,
  mode: SketchSelectionMode,
): boolean {
  if (!sketchSelectionBoxHasArea(box)) return false;
  const bounds = sketchPrimitiveBounds(primitive);
  if (!bounds) return false;
  if (mode === "contain") return boundsContainedBy(bounds, box);
  return primitiveCrossesBox(primitive, box);
}

export function selectSketchPrimitives(
  primitives: SketchPrimitive[],
  box: SketchSelectionBox,
  mode: SketchSelectionMode,
): string[] {
  return primitives
    .filter((primitive) => isSketchPrimitiveInSelectionBox(primitive, box, mode))
    .map((primitive) => primitive.id);
}
