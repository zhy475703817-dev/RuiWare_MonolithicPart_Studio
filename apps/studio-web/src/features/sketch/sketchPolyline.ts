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
    : session.firstPoint.snapTarget;

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
  createConstraintId: () => string,
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
  const constraints = buildLineSnapCoincidentConstraints(
    lineId,
    previousEndpointTarget(session),
    point.snapTarget,
    entities,
    sketch.constraints,
    createConstraintId,
  );
  const segmentIds = [...session.segmentIds, lineId];
  const closed = closesAtFirstPoint(session, point);
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
