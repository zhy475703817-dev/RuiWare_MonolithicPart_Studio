import { describe, expect, it } from "vitest";

import type { Draft } from "../../types";
import {
  arcEndpointTangent,
  buildUniqueTangentConstraint,
  lineArcTangencyErrorDegrees,
  repairLineArcTangency,
} from "./sketchTangency";

type SketchEntity = Draft["sketch"]["entities"][number];
type SketchConstraint = Draft["sketch"]["constraints"][number];

const line = (
  id: string,
  start: [number, number],
  end: [number, number],
): SketchEntity => ({
  id,
  role: id,
  geometryType: "line",
  parameterRefs: [],
  construction: false,
  start,
  end,
  center: null,
  radius: null,
  startAngle: null,
  endAngle: null,
  points: [],
});

const arc = (
  id: string,
  start: [number, number],
  end: [number, number],
  startAngle: number,
  endAngle: number,
  sweepDirection: "ccw" | "cw" = "ccw",
  largeArc = false,
): SketchEntity => ({
  id,
  role: id,
  geometryType: "arc",
  parameterRefs: [],
  construction: false,
  start,
  end,
  center: [0, 0],
  radius: 10,
  startAngle,
  endAngle,
  largeArc,
  sweepDirection,
  points: [],
});

const fixed = (entityId: string): SketchConstraint => ({
  id: `fixed.${entityId}`,
  label: "fixed",
  constraintType: "fixed",
  entityRefs: [entityId],
  expression: null,
  parameterId: null,
  value: null,
  driverMode: null,
  enabled: true,
  driving: true,
});

describe("解析圆弧端点切线", () => {
  it("uses CCW and CW tangent signs", () => {
    const ccw = arc("arc.ccw", [10, 0], [0, 10], 0, 90, "ccw");
    const cw = arc("arc.cw", [10, 0], [0, -10], 0, 90, "cw");

    expect(arcEndpointTangent(ccw, "start")).toEqual([0, 1]);
    expect(arcEndpointTangent(ccw, "end")).toEqual([-1, 0]);
    expect(arcEndpointTangent(cw, "start")).toEqual([0, -1]);
    expect(arcEndpointTangent(cw, "end")).toEqual([-1, 0]);
  });

  it("can negate the tangent for reverse traversal", () => {
    const ccw = arc("arc", [10, 0], [0, 10], 0, 90, "ccw");
    expect(arcEndpointTangent(ccw, "start", { reverse: true })).toEqual([0, -1]);
  });
});

describe("直线-圆弧相切修复", () => {
  it("repairs a line entering an arc start while preserving length", () => {
    const path = [
      line("line", [9, -10], [10, 0]),
      arc("arc", [10, 0], [0, 10], 0, 90, "ccw"),
    ];
    expect(lineArcTangencyErrorDegrees(path[0], path[1], "end", "start")).toBeCloseTo(5.711, 2);

    const result = repairLineArcTangency(path, [], { endpointToleranceMm: 0.1 });
    expect(result.repaired).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.entities[0].start![0]).toBeCloseTo(10);
    expect(result.entities[0].start![1]).toBeCloseTo(-Math.hypot(1, 10));
    expect(result.entities[0].end).toEqual([10, 0]);
    expect(Math.hypot(
      path[0].end![0] - path[0].start![0],
      path[0].end![1] - path[0].start![1],
    )).toBeCloseTo(Math.hypot(
      result.entities[0].end![0] - result.entities[0].start![0],
      result.entities[0].end![1] - result.entities[0].start![1],
    ));
    expect(path[0].start).toEqual([9, -10]);
  });

  it("repairs a line leaving an arc end", () => {
    const path = [
      arc("arc", [10, 0], [0, 10], 0, 90, "ccw"),
      line("line", [0, 10], [-10.5, 10.2]),
    ];
    const result = repairLineArcTangency(path);
    expect(result.repaired).toBe(true);
    expect(result.entities[1].start).toEqual([0, 10]);
    expect(result.entities[1].end![0]).toBeCloseTo(-Math.hypot(10.5, 0.2));
    expect(result.entities[1].end![1]).toBeCloseTo(10);
  });

  it("handles a reversed line/arc endpoint pairing", () => {
    const path = [
      line("line", [10, 10], [0.03, 10.03]),
      arc("arc", [10, 0], [0, 10], 0, 90, "ccw"),
    ];
    const result = repairLineArcTangency(path);
    expect(result.repaired).toBe(true);
    expect(result.entities[0].end).toEqual([0, 10]);
    expect(result.entities[0].start![0]).toBeCloseTo(9.97);
    expect(result.entities[0].end![1]).toBeCloseTo(10);
  });

  it("does not silently modify a large angle error", () => {
    const path = [
      line("line", [0, 0], [10, 0]),
      arc("arc", [10, 0], [0, 10], 0, 90, "ccw"),
    ];
    const result = repairLineArcTangency(path);
    expect(result.repaired).toBe(false);
    expect(result.entities[0]).toEqual(path[0]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TANGENCY_ANGLE_EXCEEDS_TOLERANCE" }),
    );
  });

  it("does not move a fixed or fully constrained line", () => {
    const path = [
      line("line", [0, 0], [10, 0]),
      arc("arc", [10, 0], [0, 10], 0, 90, "ccw"),
    ];
    const fixedResult = repairLineArcTangency(path, [fixed("line")]);
    expect(fixedResult.repaired).toBe(false);
    expect(fixedResult.entities).toEqual(path);
    expect(fixedResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TANGENCY_REPAIR_BLOCKED" }),
    );

    const constrainedResult = repairLineArcTangency(path, [], {
      fullyConstrainedEntityIds: ["line"],
    });
    expect(constrainedResult.repaired).toBe(false);
    expect(constrainedResult.entities).toEqual(path);
  });

  it("reports a small-angle repair blocked by a fixed line", () => {
    const path = [
      line("line", [9, -10], [10, 0]),
      arc("arc", [10, 0], [0, 10], 0, 90, "ccw"),
    ];
    const result = repairLineArcTangency(path, [fixed("line")]);
    expect(result.repaired).toBe(false);
    expect(result.entities).toEqual(path);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TANGENCY_REPAIR_BLOCKED",
        angleErrorDegrees: expect.closeTo(5.711, 2),
      }),
    );
  });

  it("reports a joined line whose other endpoint is constrained", () => {
    const path = [
      line("line", [0, 0], [10, 0]),
      arc("arc", [10, 0], [0, 10], 0, 90, "ccw"),
    ];
    const result = repairLineArcTangency(path, [{
      id: "coincident.free",
      label: "coincident",
      constraintType: "coincident",
      entityRefs: ["line", "other"],
      endpointRefs: ["start", "end"],
      expression: null,
      parameterId: null,
      value: null,
      driverMode: null,
      enabled: true,
      driving: true,
    }]);
    expect(result.repaired).toBe(false);
    expect(result.diagnostics[0].code).toBe("TANGENCY_REPAIR_BLOCKED");
  });
});

describe("唯一相切约束", () => {
  it("returns one tangent constraint and rejects duplicates", () => {
    const first = buildUniqueTangentConstraint("line", "arc", [], () => "tangent.1", {
      lineHandle: "end",
      arcHandle: "start",
    });
    expect(first).toMatchObject({
      id: "tangent.1",
      constraintType: "tangent",
      entityRefs: ["line", "arc"],
      endpointRefs: ["end", "start"],
    });
    const duplicate = buildUniqueTangentConstraint("line", "arc", [first!], () => "tangent.2");
    expect(duplicate).toBeNull();
  });
});
