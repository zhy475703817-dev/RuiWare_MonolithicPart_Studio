import { RefreshCw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Draft } from "../../../types";

type SketchRegionPanelProps = {
  draft: Draft;
  selected: string[];
  setSketch: (patch: Partial<Draft["sketch"]>) => void;
  detectRegions: () => void;
  renderRefs: (refs: string[]) => ReactNode;
};

export function SketchRegionPanel({
  draft,
  selected,
  setSketch,
  detectRegions,
  renderRefs,
}: SketchRegionPanelProps) {
  return (
    <>
      <div className="region-guidance">
        <div>
          <strong>自动识别闭合环</strong>
          <span>按轮廓连续性生成截面区域，圆会直接识别为闭合环。</span>
        </div>
        <button onClick={detectRegions}>
          <RefreshCw size={14} />
          重新识别
        </button>
      </div>
      <div className="region-visual-list">
        {draft.sketch.regions.map((region, index) => (
          <div
            className={`region-visual-card ${region.operation}`}
            key={region.id}
          >
            <span className="region-swatch" />
            <div>
              <code>{region.id}</code>
              <strong>
                {region.operation === "add" ? "实体外环" : "孔洞／减材内环"}
              </strong>
              {renderRefs(region.boundaryRefs)}
            </div>
            <select
              value={region.operation}
              onChange={(event) =>
                setSketch({
                  regions: draft.sketch.regions.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          operation: event.target
                            .value as typeof region.operation,
                        }
                      : item,
                  ),
                })
              }
            >
              <option value="add">生成实体</option>
              <option value="subtract">作为孔洞</option>
            </select>
            <button
              className="selection-apply"
              disabled={!selected.length}
              onClick={() =>
                setSketch({
                  regions: draft.sketch.regions.map((item, i) =>
                    i === index ? { ...item, boundaryRefs: selected } : item,
                  ),
                })
              }
            >
              使用当前选择
            </button>
            <button
              className="delete-icon"
              onClick={() =>
                setSketch({
                  regions: draft.sketch.regions.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!draft.sketch.regions.length && (
          <div className="empty-note">
            尚未定义截面区域，点击“重新识别”从闭合轮廓生成。
          </div>
        )}
      </div>
    </>
  );
}







