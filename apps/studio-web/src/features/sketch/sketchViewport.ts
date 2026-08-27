export type SketchViewportBounds = {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
};

/** Move the camera so the sketch content follows a drag in SVG view coordinates. */
export const panSketchViewport = (
  bounds: SketchViewportBounds,
  deltaViewX: number,
  deltaViewY: number,
  scale: number,
): SketchViewportBounds => {
  if (!Number.isFinite(scale) || scale <= 0) return { ...bounds };
  const worldDeltaX = deltaViewX / scale;
  const worldDeltaY = deltaViewY / scale;
  return {
    minimumX: bounds.minimumX - worldDeltaX,
    maximumX: bounds.maximumX - worldDeltaX,
    minimumY: bounds.minimumY + worldDeltaY,
    maximumY: bounds.maximumY + worldDeltaY,
  };
};
