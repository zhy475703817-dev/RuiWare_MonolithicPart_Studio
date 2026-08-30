import type { SketchSolveResult } from "../../../types";

type Props = {
  solution: SketchSolveResult | null;
  solving: boolean;
  solveError?: string | null;
  solveCase: "minimum" | "nominal" | "maximum";
  plane: string;
  planeAxes: { horizontal: string; vertical: string; normal: string };
  cursorPoint: { x: number; y: number } | null;
  selectedEntity: string;
};

export function SketchWorkspaceStatusBar({
  solution,
  solving,
  solveError,
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
        <span className={solution?.valid ? "ok" : solveError ? "bad" : solution ? "bad" : "pending"}>
          <strong>
            {solving
              ? "求解中…"
              : solveError
                ? "求解失败"
              : solution?.valid
                ? "几何通过"
                : solution
                  ? "几何失败"
                  : "等待求解"}
          </strong>
          <small>{solveError || solution?.solver || "parametric-sketch"}</small>
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







