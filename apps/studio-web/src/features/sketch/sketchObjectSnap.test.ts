import { describe, expect, it } from "vitest";

import type { Draft } from "../../types";
import {
  buildLineSnapCoincidentConstraints,
  endpointSnapToleranceMm,
  resolveSketchSnap,
  sketchDrawPointFromSnap,
} from "./sketchObjectSnap";

type SketchEntity = Draft["sketch"]["entities"][number];

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

describe("二维草图端点吸附", () => {
  it("returns the existing endpoint without losing coordinate precision", () => {
    const existing = line("edge.existing", [1.234567, 2.345678], [20, 2]);

    const hit = resolveSketchSnap(
      { x: 1.5, y: 2.5 },
      [existing],
      { enabled: true, toleranceMm: 1, kinds: ["lineEndpoint"] },
    );

    expect(hit.target).toMatchObject({
      kind: "lineEndpoint",
      entityId: existing.id,
      handle: "start",
    });
    expect(sketchDrawPointFromSnap(hit)).toMatchObject({
      x: existing.start![0],
      y: existing.start![1],
    });
  });

  it("creates a coincident constraint for the snapped endpoint", () => {
    const existing = line("edge.existing", [0, 0], [10, 0]);
    const hit = resolveSketchSnap(
      { x: 10.4, y: 0.2 },
      [existing],
      { enabled: true, toleranceMm: 1, kinds: ["lineEndpoint"] },
    );
    const created = line("edge.new", [10, 0], [20, 8]);

    const constraints = buildLineSnapCoincidentConstraints(
      created.id,
      hit.target,
      null,
      [existing, created],
      [],
      () => "constraint.snap.1",
    );

    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({
      id: "constraint.snap.1",
      constraintType: "coincident",
      entityRefs: [created.id, existing.id],
      endpointRefs: ["start", "end"],
      enabled: true,
      driving: true,
    });
  });

  it("returns the unsnapped pointer when endpoint snapping is disabled", () => {
    const existing = line("edge.existing", [0, 0], [10, 0]);

    const hit = resolveSketchSnap(
      { x: 10.4, y: 0.2 },
      [existing],
      { enabled: false, toleranceMm: 1, kinds: ["lineEndpoint"] },
    );

    expect(hit).toEqual({ point: [10.4, 0.2], target: null });
  });

  it("keeps a stable view-space radius across zoom levels", () => {
    expect(endpointSnapToleranceMm(2)).toBe(5);
    expect(endpointSnapToleranceMm(20)).toBe(0.5);
    expect(endpointSnapToleranceMm(0)).toBe(2);
  });
});
