import type { Draft } from "../../types";
import {
  buildLineSnapCoincidentConstraints,
  isEndpointSnapKind,
  sketchPointTooClose,
  type SketchDrawPoint,
  type SketchSnapTarget,
} from "./sketchObjectSnap";

type Sketch = Draft["sketch"];

export type SketchPolylineSession = {
  firstPoint: SketchDrawPoint;
  lastPoint: SketchDrawPoint;
  firstLineId: string | null;
  lastLineId: string | null;
  segmentIds: string[];
};

export type SketchPolylineAdvance = {
  accepted: boolean;
  beginUndo: boolean;
  closed: boolean;
  createdLineId: string | null;
  session: SketchPolylineSession | null;
  sketch: Sketch;
};

export type SketchPolylineTermination = {
  reason: "finish" | "cancel";
  retainedSegmentIds: string[];
  session: null;
};

const copyPoint = (point: SketchDrawPoint): SketchDrawPoint => ({
  ...point,
  snapTarget: point.snapTarget
    ? {
        ...point.snapTarget,
        point: [
          point.snapTarget.point[0],
          point.snapTarget.point[1],
        ] as [number, number],
      }
    : null,
});

const previousEndpointTarget = (
  session: SketchPolylineSession,
): SketchSnapTarget | null =>
  session.lastLineId
    ? {
        kind: "lineEndpoint",
        entityId: session.lastLineId,
        handle: "end",
        point: [session.lastPoint.x, session.lastPoint.y],
        createsConstraint: true,
      }
    : null;

const closesAtFirstPoint = (
  session: SketchPolylineSession,
  point: SketchDrawPoint,
) =>
  session.segmentIds.length >= 2 &&
  !!point.snapTarget &&
  isEndpointSnapKind(point.snapTarget.kind) &&
  !sketchPointTooClose(session.lastPoint, point) &&
  sketchPointTooClose(session.firstPoint, point, 1e-9);

export function advanceSketchPolyline(
  session: SketchPolylineSession | null,
  point: SketchDrawPoint,
  sketch: Sketch,
  createLineId: () => string,
  _createConstraintId: () => string,
): SketchPolylineAdvance {
  if (!session) {
    const anchor = copyPoint(point);
    return {
      accepted: false,
      beginUndo: false,
      closed: false,
      createdLineId: null,
      session: {
        firstPoint: anchor,
        lastPoint: anchor,
        firstLineId: null,
        lastLineId: null,
        segmentIds: [],
      },
      sketch,
    };
  }

  if (sketchPointTooClose(session.lastPoint, point)) {
    return {
      accepted: false,
      beginUndo: false,
      closed: false,
      createdLineId: null,
      session,
      sketch,
    };
  }

  const lineId = createLineId();
  const entity: Sketch["entities"][number] = {
    id: lineId,
    role: "section.edge",
    geometryType: "line",
    parameterRefs: [],
    construction: false,
    start: [session.lastPoint.x, session.lastPoint.y],
    end: [point.x, point.y],
    center: null,
    radius: null,
    startAngle: null,
    endAngle: null,
    points: [],
  };
  const entities = [...sketch.entities, entity];
  const segmentIds = [...session.segmentIds, lineId];
  const closed = closesAtFirstPoint(session, point);
  // Keep the polyline's own segment joints parametric. The newly drawn end
  // uses free-snap only; snapping to another object's endpoint never creates
  // an automatic constraint.
  const constraints = buildLineSnapCoincidentConstraints(
    lineId,
    previousEndpointTarget(session),
    closed ? point.snapTarget : null,
    entities,
    sketch.constraints,
    _createConstraintId,
  );
  const nextSession: SketchPolylineSession = {
    firstPoint: session.firstPoint,
    lastPoint: copyPoint(point),
    firstLineId: session.firstLineId || lineId,
    lastLineId: lineId,
    segmentIds,
  };

  return {
    accepted: true,
    beginUndo: session.segmentIds.length === 0,
    closed,
    createdLineId: lineId,
    session: closed ? null : nextSession,
    sketch: {
      ...sketch,
      entities,
      // Drawing endpoint free-snap is positional assistance only. Explicit
      // constraints remain available through the constraint tools.
      constraints: [...sketch.constraints, ...constraints],
      constraintsReviewed: false,
    },
  };
}

export function terminateSketchPolyline(
  session: SketchPolylineSession | null,
  reason: SketchPolylineTermination["reason"],
): SketchPolylineTermination {
  return {
    reason,
    retainedSegmentIds: session ? [...session.segmentIds] : [],
    session: null,
  };
}
