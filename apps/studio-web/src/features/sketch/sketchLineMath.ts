import { normalizeDegrees } from "./sketchArc";

export const linePolar = (
  start: [number, number],
  end: [number, number],
): { length: number; angleDegrees: number } => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  const angleDegrees = normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
  return {
    length: Math.round(length * 100) / 100,
    angleDegrees: Math.round(angleDegrees * 100) / 100,
  };
};

export const endFromLengthAndAngle = (
  start: [number, number],
  length: number,
  angleDegrees: number,
): [number, number] => {
  const safeLength = Math.max(0, length);
  const radians = (normalizeDegrees(angleDegrees) * Math.PI) / 180;
  return [
    Math.round((start[0] + safeLength * Math.cos(radians)) * 100) / 100,
    Math.round((start[1] + safeLength * Math.sin(radians)) * 100) / 100,
  ];
};
