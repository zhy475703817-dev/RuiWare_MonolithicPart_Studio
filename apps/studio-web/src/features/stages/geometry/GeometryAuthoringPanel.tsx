import { Layers3, Braces, Upload } from "lucide-react";
import { api } from "../../../api";
import type { Dispatch, SetStateAction } from "react";
import type { Draft } from "../../../types";
import { Field, NumberInput, PanelTitle } from "../../../components/ui/FormParts";

type GeometryAuthoringPanelProps = {
  draft: Draft;
  change: (draft: Draft) => void;
  showError: (error: unknown) => void;
  setSketch: (patch: Partial<Draft["sketch"]>) => void;
  pendingProfileMode: Draft["sketch"]["profileMode"] | null;
  setPendingProfileMode: (
    value: Draft["sketch"]["profileMode"] | null,
  ) => void;
  applyProfileMode: (reset: boolean) => void;
  thinwallOffset: { side1: number; side2: number };
  setThinwallOffset: Dispatch<SetStateAction<{ side1: number; side2: number }>>;
  applyThinwallOffset: () => void;
  thinwallOffsetNote: string | null;
};

export function GeometryAuthoringPanel({
  draft,
  change,
  showError,
  setSketch,
  pendingProfileMode,
  setPendingProfileMode,
  applyProfileMode,
  thinwallOffset,
  setThinwallOffset,
  applyThinwallOffset,
  thinwallOffsetNote,
}: GeometryAuthoringPanelProps) {
  const acquisitionLabels = {
    manual: "交互绘制",
    imported: "导入转换",
    reused: "复用受控截面",
  };
  const selectAcquisition = (method: Draft["sketch"]["acquisitionMethod"]) => {
    setSketch({
      acquisitionMethod: method,
      sourceAttachmentId: null,
      sourceProfileId: null,
      sourceHash: null,
      importUnit: method === "imported" ? "mm" : null,
      importScale: method === "imported" ? 1 : null,
      conversionReviewed: method === "manual",
    });
  };

  return (
    <>
      <div className="panel semantic-authoring">
        <PanelTitle
          icon={Braces}
          title="统一语义参数轮廓"
          subtitle="所有草图构造件使用同一种权威模型；创建入口只记录来源，不改变后续参数化、验证与编译方式。"
          actions={<span className="schema-pill">semanticProfile</span>}
        />
        <div className="acquisition-grid">
          {(
            [
              ["manual", "交互绘制", "从空白语义图元与约束开始"],
              ["imported", "导入轮廓", "DXF等文件转换为语义草图"],
              ["reused", "复用受控截面", "复制受控截面并保持来源"],
            ] as const
          ).map(([id, label, note]) => (
            <button
              className={draft.sketch.acquisitionMethod === id ? "active" : ""}
              key={id}
              onClick={() => selectAcquisition(id)}
            >
              <strong>{label}</strong>
              <span>{note}</span>
            </button>
          ))}
        </div>
        {draft.sketch.acquisitionMethod === "imported" && (
          <div className="source-conversion">
            <label className="upload-zone compact">
              <Upload size={18} />
              <strong>选择DXF或轮廓文件</strong>
              <span>文件仅作为转换证据，不直接参与CAD编译</span>
              <input
                type="file"
                accept=".dxf,.dwg,.svg,.step,.stp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !draft.id) return;
                  try {
                    const saved = await api.uploadAttachment(
                      draft.id,
                      file,
                      "drawing",
                    );
                    const attachment = saved.attachments.at(-1);
                    change({
                      ...draft,
                      attachments: saved.attachments,
                      sketch: {
                        ...draft.sketch,
                        acquisitionMethod: "imported",
                        sourceAttachmentId: attachment?.id || null,
                        sourceHash: attachment?.sha256 || null,
                        importUnit: "mm",
                        importScale: 1,
                        conversionReviewed: false,
                        constraintsReviewed: false,
                      },
                    });
                  } catch (error) {
                    showError(error);
                  }
                }}
              />
            </label>
            <div className="form-grid two">
              <Field label="导入单位">
                <select
                  value={draft.sketch.importUnit || "mm"}
                  onChange={(e) =>
                    setSketch({
                      importUnit: e.target.value as NonNullable<
                        Draft["sketch"]["importUnit"]
                      >,
                      conversionReviewed: false,
                    })
                  }
                >
                  <option value="mm">毫米</option>
                  <option value="cm">厘米</option>
                  <option value="m">米</option>
                  <option value="inch">英寸</option>
                </select>
              </Field>
              <Field label="导入比例">
                <NumberInput
                  value={draft.sketch.importScale || 1}
                  unit="倍"
                  step={0.01}
                  min={0.001}
                  onChange={(importScale) =>
                    setSketch({ importScale, conversionReviewed: false })
                  }
                />
              </Field>
            </div>
          </div>
        )}
        {draft.sketch.acquisitionMethod === "reused" && (
          <Field label="受控截面ID" hint="复用后仍复制为当前模板的统一语义草图">
            <input
              value={draft.sketch.sourceProfileId || ""}
              onChange={(e) =>
                setSketch({
                  sourceProfileId: e.target.value || null,
                  conversionReviewed: false,
                })
              }
              placeholder="profile.catalog.omega-100"
            />
          </Field>
        )}
        <div className="semantic-status">
          <span>
            <strong>当前来源</strong>
            <small>{acquisitionLabels[draft.sketch.acquisitionMethod]}</small>
          </span>
          <span>
            <strong>语义图元</strong>
            <small>{draft.sketch.entities.length} 项</small>
          </span>
          <span>
            <strong>约束</strong>
            <small>{draft.sketch.constraints.length} 项</small>
          </span>
          <span>
            <strong>闭合区域</strong>
            <small>
              {draft.sketch.regions.filter((item) => item.closed).length} 项
            </small>
          </span>
        </div>
        {["imported", "reused"].includes(draft.sketch.acquisitionMethod) && (
          <label className="confirm-box">
            <input
              type="checkbox"
              checked={draft.sketch.conversionReviewed}
              onChange={(e) =>
                change({
                  ...draft,
                  sketch: {
                    ...draft.sketch,
                    conversionReviewed: e.target.checked,
                    constraintsReviewed: false,
                  },
                })
              }
            />
            <span>
              <strong>来源已转换为语义草图并复核</strong>
              <small>
                确认原始图元已清理，尺寸已参数化，语义名称和约束不再依赖外部文件图元编号。
              </small>
            </span>
          </label>
        )}
      </div>
      {pendingProfileMode && (
        <div
          className="dialog-scrim"
          role="presentation"
          onPointerDown={() => setPendingProfileMode(null)}
        >
          <section
            className="profile-mode-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-mode-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-icon">
              <Layers3 size={20} />
            </div>
            <div>
              <h2 id="profile-mode-title">
                切换为
                {pendingProfileMode === "closedRegion"
                  ? "单闭合区域"
                  : pendingProfileMode === "multiRegion"
                    ? "多闭合区域"
                    : "中心线薄壁"}
              </h2>
              <p>
                {pendingProfileMode === "centerlineThinWall"
                  ? "当前截面将切换为中心线薄壁模式：现有轮廓会重建为中心线，并保留可用于后续厚度偏移的参数约束。"
                  : "当前截面将切换为闭合区域模式：会重建基于区域的草图轮廓，便于后续制造流程识别。"}
              </p>
            </div>
            <div className="profile-mode-actions">
              <button type="button" onClick={() => setPendingProfileMode(null)}>
                取消
              </button>
              <button type="button" onClick={() => applyProfileMode(false)}>
                仅切换模式
              </button>
              <button type="button" className="primary" onClick={() => applyProfileMode(true)}>
                重建轮廓
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}







