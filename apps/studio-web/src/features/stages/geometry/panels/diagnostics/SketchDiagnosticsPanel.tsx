import { CheckCircle2, CircleAlert } from "lucide-react";
import type { SketchSolveResult } from "../../../../../types";
import type { Draft } from "../../../../../types";

type SketchDiagnosticsPanelProps = {
  draft: Draft;
  solution: SketchSolveResult | null;
  onSelect: (id: string | string[], additive?: boolean) => void;
};

export function SketchDiagnosticsPanel({
  draft,
  solution,
  onSelect,
}: SketchDiagnosticsPanelProps) {
  return (
    <div className="diagnostic-workbench">
      <div className="diagnostic-summary">
        <span className={solution?.valid ? "ok" : "bad"}>
          <strong>{solution?.valid ? "所有工况通过" : "需要处理"}</strong>
          <small>几何与拓扑</small>
        </span>
        <span>
          <strong>{solution?.degreesOfFreedom ?? "—"}</strong>
          <small>剩余自由度</small>
        </span>
        <span>
          <strong>{solution?.redundantConstraints.length || 0}</strong>
          <small>冗余约束</small>
        </span>
      </div>
      <div className="case-validation-matrix">
        <div className="case-validation-head">
          <span>工况</span>
          <span>求解</span>
          <span>自由度</span>
          <span>闭合区域</span>
          <span>驱动参数值</span>
        </div>
        {solution?.cases.map((item) => {
          const values = Object.entries(item.values).filter(([id]) =>
            draft.sketch.drivingParameters.includes(id),
          );
          return (
            <div className="case-validation-row" key={item.case}>
              <strong>
                {item.case === "minimum"
                  ? "最小"
                  : item.case === "nominal"
                    ? "标称"
                    : "最大"}
              </strong>
              <span className={item.valid ? "ok" : "bad"}>
                {item.valid ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
                {item.valid ? "通过" : "失败"}
              </span>
              <span>{item.degreesOfFreedom}</span>
              <span>{item.regions.filter((region) => region.closed).length}</span>
              <code>
                {values.length
                  ? values.map(([id, value]) => `${id}=${value}`).join(" · ")
                  : "—"}
              </code>
            </div>
          );
        })}
      </div>
      <div className="solver-diagnostics">
        {solution?.diagnostics.length ? (
          solution.diagnostics.map((item, index) => (
            <button
              key={`${item.code}-${index}`}
              className={item.severity}
              onClick={() => {
                const match = draft.sketch.entities.find((entity) =>
                  item.path.includes(entity.id),
                );
                if (match) onSelect(match.id);
              }}
            >
              <CircleAlert size={14} />
              <span>
                <strong>{item.code}</strong>
                {item.message}
              </span>
            </button>
          ))
        ) : (
          <div className="diagnostic-clear">
            <CheckCircle2 size={20} />
            <strong>未发现约束、闭环或拓扑错误</strong>
          </div>
        )}
      </div>
    </div>
  );
}








