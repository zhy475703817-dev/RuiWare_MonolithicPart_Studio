import { describe, expect, it } from "vitest";

import type { Draft } from "../../types";
import type { SketchDrawPoint } from "./sketchObjectSnap";
import {
  advanceSketchPolyline,
  terminateSketchPolyline,
  type SketchPolylineSession,
} from "./sketchPolyline";

const emptySketch = (): Draft["sketch"] => ({
  model: "semanticProfile",
  acquisitionMethod: "manual",
  plane: "XY",
  profileMode: "closedRegion",
  drivingParameters: [],
  entities: [],
  constraints: [],
  regions: [],
  constraintsReviewed: false,
  conversionReviewed: true,
  sourceAttachmentId: null,
  sourceProfileId: null,
  sourceHash: null,
  importUnit: null,
  importScale: null,
});

const point = (
  x: number,
  y: number,
  target: SketchDrawPoint["snapTarget"] = null,
): SketchDrawPoint => ({ x, y, snapTarget: target });

const createIds = () => {
  let lineNumber = 0;
  let constraintNumber = 0;
  return {
    line: () => `edge.polyline.${++lineNumber}`,
    constraint: () => `constraint.polyline.${++constraintNumber}`,
  };
};

const advance = (
  session: SketchPolylineSession | null,
  nextPoint: SketchDrawPoint,
  sketch: Draft["sketch"],
  ids: ReturnType<typeof createIds>,
) =>
  advanceSketchPolyline(
    session,
    nextPoint,
    sketch,
    ids.line,
    ids.constraint,
  );

describe("二维草图连续折线", () => {
  it("creates consecutive line entities with exact shared endpoints", () => {
    const ids = createIds();
    const started = advance(null, point(1.25, 2.5), emptySketch(), ids);
    const first = advance(started.session, point(8.75, 2.5), started.sketch, ids);
    const second = advance(first.session, point(8.75, 9.125), first.sketch, ids);

    expect(second.sketch.entities).toHaveLength(2);
    expect(second.sketch.entities[0].geometryType).toBe("line");
    expect(second.sketch.entities[1].geometryType).toBe("line");
    expect(second.sketch.entities[0].end).toEqual([8.75, 2.5]);
    expect(second.sketch.entities[1].start).toEqual(
      second.sketch.entities[0].end,
    );
    expect(second.sketch.constraints).toContainEqual(
      expect.objectContaining({
        constraintType: "coincident",
        entityRefs: ["edge.polyline.2", "edge.polyline.1"],
        endpointRefs: ["start", "end"],
      }),
    );
  });

  it("finishes and cancels only the preview while retaining confirmed segments", () => {
    const ids = createIds();
    const started = advance(null, point(0, 0), emptySketch(), ids);
    const first = advance(started.session, point(10, 0), started.sketch, ids);

    expect(terminateSketchPolyline(first.session, "finish")).toEqual({
      reason: "finish",
      retainedSegmentIds: ["edge.polyline.1"],
      session: null,
    });
    expect(terminateSketchPolyline(first.session, "cancel")).toEqual({
      reason: "cancel",
      retainedSegmentIds: ["edge.polyline.1"],
      session: null,
    });
    expect(first.sketch.entities).toHaveLength(1);
  });

  it("closes at the first snapped point and adds the closing coincidence", () => {
    const ids = createIds();
    const started = advance(null, point(0, 0), emptySketch(), ids);
    const first = advance(started.session, point(10, 0), started.sketch, ids);
    const second = advance(first.session, point(10, 10), first.sketch, ids);
    const closingPoint = point(0, 0, {
      kind: "lineEndpoint",
      entityId: "edge.polyline.1",
      handle: "start",
      point: [0, 0],
      createsConstraint: true,
    });
    const closed = advance(second.session, closingPoint, second.sketch, ids);

    expect(closed.closed).toBe(true);
    expect(closed.session).toBeNull();
    expect(closed.sketch.entities.at(-1)?.end).toEqual(
      closed.sketch.entities[0].start,
    );
    expect(closed.sketch.constraints).toContainEqual(
      expect.objectContaining({
        constraintType: "coincident",
        entityRefs: ["edge.polyline.3", "edge.polyline.1"],
        endpointRefs: ["end", "start"],
      }),
    );
  });

  it("records one undo boundary for the entire drawing transaction", () => {
    const ids = createIds();
    const original = emptySketch();
    const started = advance(null, point(0, 0), original, ids);
    const first = advance(started.session, point(10, 0), started.sketch, ids);
    const second = advance(first.session, point(10, 10), first.sketch, ids);
    const third = advance(second.session, point(20, 10), second.sketch, ids);
    const history = [first, second, third]
      .filter((result) => result.beginUndo)
      .map(() => original);

    expect(history).toHaveLength(1);
    expect(history.at(-1)?.entities).toHaveLength(0);
    expect(third.sketch.entities).toHaveLength(3);
  });

  it("rejects the repeated point produced by a double-click", () => {
    const ids = createIds();
    const started = advance(null, point(0, 0), emptySketch(), ids);
    const first = advance(started.session, point(10, 0), started.sketch, ids);
    const duplicate = advance(first.session, point(10, 0), first.sketch, ids);

    expect(duplicate.accepted).toBe(false);
    expect(duplicate.sketch.entities).toHaveLength(1);
    expect(duplicate.session).toBe(first.session);
  });
});
