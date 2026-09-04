import { describe, expect, it } from "vitest";

import { panSketchViewport } from "./sketchViewport";

describe("panSketchViewport", () => {
  it("moves only the observed bounds and preserves their size", () => {
    const bounds = {
      minimumX: -100,
      maximumX: 100,
      minimumY: -75,
      maximumY: 75,
    };

    const panned = panSketchViewport(bounds, 40, -20, 2);

    expect(panned).toEqual({
      minimumX: -120,
      maximumX: 80,
      minimumY: -85,
      maximumY: 65,
    });
    expect(panned.maximumX - panned.minimumX).toBe(200);
    expect(panned.maximumY - panned.minimumY).toBe(150);
    expect(bounds).toEqual({
      minimumX: -100,
      maximumX: 100,
      minimumY: -75,
      maximumY: 75,
    });
  });

  it("returns a copy when the view scale is invalid", () => {
    const bounds = {
      minimumX: 0,
      maximumX: 10,
      minimumY: 0,
      maximumY: 10,
    };

    const panned = panSketchViewport(bounds, 10, 10, 0);

    expect(panned).toEqual(bounds);
    expect(panned).not.toBe(bounds);
  });
});
