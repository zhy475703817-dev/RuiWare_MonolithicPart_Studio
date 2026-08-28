import { ChevronDown, MoveHorizontal } from "lucide-react";
import { Field, NumberInput, PanelTitle } from "../../components/ui/FormParts";
import type { Draft } from "../../types";

type Props = {
  draft: Draft;
  requestProfileMode: (mode: Draft["sketch"]["profileMode"]) => void;
  setSketch: (patch: Partial<Draft["sketch"]>) => void;
  solveCase: "minimum" | "nominal" | "maximum";
  thinwallOffset: { side1: number; side2: number };
  setThinwallOffset: (
    value:
      | { side1: number; side2: number }
      | ((current: { side1: number; side2: number }) => { side1: number; side2: number }),
  ) => void;
  applyThinwallOffset: () => void;
  thinwallOffsetNote: string | null;
};

export function SketchModePanel({
  draft,
  requestProfileMode,
  setSketch,
  solveCase,
  thinwallOffset,
  setThinwallOffset,
  applyThinwallOffset,
  thinwallOffsetNote,
}: Props) {
  return (
    <>
      <PanelTitle
        icon={ChevronDown}
        title="2. 当前对象与草图设置"
        subtitle="定义截面如何形成实体，以及草图在三维坐标系中的位置。"
      />
      <div className="form-grid two">
        <Field
          label="截面建模模式"
          hint="实心使用闭合区域；管材使用外环减内环；冷弯薄壁可使用开放中心线加厚度"
        >
          <select
            value={draft.sketch.profileMode}
            onChange={(event) =>
              requestProfileMode(event.target.value as Draft["sketch"]["profileMode"])
            }
          >
            <option value="closedRegion">单闭合区域</option>
            <option value="multiRegion">管材／多环多腔区域</option>
            <option value="centerlineThinWall">中心线＋厚度薄壁</option>
          </select>
        </Field>
        <Field
          label="截面所在平面"
          hint="XY → 法向 Z；XZ → 法向 Y；YZ → 法向 X。切换平面不改变二维尺寸和拓扑。"
        >
          <select
            value={draft.sketch.plane}
            onChange={(event) =>
              setSketch({ plane: event.target.value as Draft["sketch"]["plane"] })
            }
          >
            <option value="XY">XY</option>
            <option value="XZ">XZ</option>
            <option value="YZ">YZ</option>
          </select>
        </Field>
      </div>
      {draft.sketch.profileMode === "centerlineThinWall" ? (
        <details className="thinwall-offset-panel" open>
          <summary className="thinwall-offset-summary">
            <div>
              <strong>中心线偏移</strong>
              <span>向两侧偏移生成薄壁轮廓；相连处延伸／裁切，自由端封口</span>
            </div>
            <ChevronDown size={15} />
          </summary>
          <div className="thinwall-offset-body">
            <p className="thinwall-offset-hint">
              将中心线向两侧偏移生成薄壁轮廓；相连处延伸／裁切并对齐封口后自动添加首尾重合约束，偏移边与原中心线自动平行。
            </p>
            <div className="form-grid two">
              <Field label="偏移距离 1" hint="中心线法向一侧（相对路径前进方向左侧）">
                <NumberInput
                  value={thinwallOffset.side1}
                  step={0.01}
                  min={0}
                  onChange={(side1) =>
                    setThinwallOffset((value) => ({ ...value, side1 }))
                  }
                />
              </Field>
              <Field label="偏移距离 2" hint="中心线法向另一侧（相对路径前进方向右侧）">
                <NumberInput
                  value={thinwallOffset.side2}
                  step={0.01}
                  min={0}
                  onChange={(side2) =>
                    setThinwallOffset((value) => ({ ...value, side2 }))
                  }
                />
              </Field>
            </div>
            <div className="thinwall-offset-actions">
              <button
                type="button"
                className="primary"
                disabled={solveCase !== "nominal"}
                onClick={applyThinwallOffset}
              >
                <MoveHorizontal size={14} />
                一键偏移
              </button>
              <small>
                可重复执行：会先清除旧薄壁轮廓再按当前距离重新生成。默认取壁厚参数的一半。
              </small>
            </div>
            {thinwallOffsetNote ? (
              <p className="thinwall-offset-note">{thinwallOffsetNote}</p>
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
}
