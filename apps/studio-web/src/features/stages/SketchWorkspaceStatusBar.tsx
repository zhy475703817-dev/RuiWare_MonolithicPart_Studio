import type { SketchSolveResult } from "../../types";

type Props = {
  solution: SketchSolveResult | null;
  solving: boolean;
  solveCase: "minimum" | "nominal" | "maximum";
  plane: string;
  planeAxes: { horizontal: string; vertical: string; normal: string };
  cursorPoint: { x: number; y: number } | null;
  selectedEntity: string;
};

export function SketchWorkspaceStatusBar({
  solution,
  solving,
  solveCase,
  plane,
  planeAxes,
  cursorPoint,
  selectedEntity,
}: Props) {
  return (
    <>
      <div className="sketch-coordinate-bar" aria-live="polite">
        <span>草图平面 {plane}</span>
        <b>
          {planeAxes.horizontal} {cursorPoint ? cursorPoint.x.toFixed(2) : "—"}
        </b>
        <b>
          {planeAxes.vertical} {cursorPoint ? cursorPoint.y.toFixed(2) : "—"}
        </b>
        <span>{planeAxes.normal} = 0.0 mm</span>
      </div>
      <div className="solver-footer">
        <span className={solution?.valid ? "ok" : "bad"}>
          <strong>
            {solving
              ? "求解中…"
              : solution?.valid
                ? "几何通过"
                : "几何失败"}
          </strong>
          <small>{solution?.solver || "parametric-sketch"}</small>
        </span>
        <span>
          <strong>{solution?.degreesOfFreedom ?? "—"}</strong>
          <small>剩余自由度</small>
        </span>
        <span>
          <strong>
            {solution?.cases
              .find((item) => item.case === solveCase)
              ?.regions.filter((item) => item.closed).length ?? 0}
          </strong>
          <small>有效截面区域</small>
        </span>
        <span>
          <strong>{selectedEntity || "未选择"}</strong>
          <small>主选图元</small>
        </span>
      </div>
    </>
  );
}
