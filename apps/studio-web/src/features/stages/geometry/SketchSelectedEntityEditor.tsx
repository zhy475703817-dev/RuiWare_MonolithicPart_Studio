import { RefreshCw, Trash2 } from "lucide-react";
import { Field, NumberInput } from "../../../components/ui/FormParts";
import type { Draft } from "../../../types";
import { arcFromEntity, arcSweepDegrees, arcWithSweep, toggleArcDirection } from "../../sketch/sketchArc";
import { endFromLengthAndAngle, linePolar } from "../../sketch/sketchLineMath";

type Entity = Draft["sketch"]["entities"][number];

type Props = {
  selected: Entity | null;
  selectedCount: number;
  draft: Draft;
  planeAxes: { horizontal: string; vertical: string };
  renameEntity: (oldId: string, rawId: string) => boolean;
  editEntity: (
    index: number,
    patch: Partial<Draft["sketch"]["entities"][number]>,
  ) => void;
  deleteSelectedEntities: () => void;
  linePolar: (
    start: [number, number],
    end: [number, number],
  ) => { length: number; angleDegrees: number };
  endFromLengthAndAngle: (
    start: [number, number],
    length: number,
    angleDegrees: number,
  ) => [number, number];
  pointAngleDegrees: (center: [number, number], point: [number, number]) => number;
};

export function SketchSelectedEntityEditor({
  selected,
  selectedCount,
  draft,
  planeAxes,
  renameEntity,
  editEntity,
  deleteSelectedEntities,
  linePolar,
  endFromLengthAndAngle,
  pointAngleDegrees,
}: Props) {
  if (!selected) {
    return (
      <div className="empty-note">
        在画布中选择一个图元后编辑属性；多选用于快速建立约束和区域。
      </div>
    );
  }
  return (
    <div className="selected-entity-editor">
      <Field label="稳定 ID" hint="修改后会同步更新约束和区域引用">
        <input
          key={selected.id}
          defaultValue={selected.id}
          onBlur={(event) => {
            if (!renameEntity(selected.id, event.target.value))
              event.currentTarget.value = selected.id;
          }}
        />
      </Field>
      <Field label="图元名称（工程语义）">
        <input
          value={selected.role}
          onChange={(event) =>
            editEntity(draft.sketch.entities.indexOf(selected), {
              role: event.target.value,
            })
          }
        />
      </Field>
      <label>
        <input
          type="checkbox"
          checked={selected.construction}
          onChange={(event) =>
            editEntity(draft.sketch.entities.indexOf(selected), {
              construction: event.target.checked,
            })
          }
        />
        构造图元（不参与截面区域）
      </label>
      {selected.start && (
        <div className="coordinate-grid">
          <Field
            label={
              selected.geometryType === "arc"
                ? `圆弧起点 ${planeAxes.horizontal}`
                : `起点 ${planeAxes.horizontal}`
            }
          >
            <NumberInput
              value={selected.start[0]}
              step={0.01}
              onChange={(value) => {
                const start: [number, number] = [value, selected.start![1]];
                const patch: Partial<Draft["sketch"]["entities"][number]> = { start };
                if (selected.geometryType === "arc" && selected.center) {
                  patch.startAngle = pointAngleDegrees(selected.center, start);
                }
                editEntity(draft.sketch.entities.indexOf(selected), patch);
              }}
            />
          </Field>
          <Field
            label={
              selected.geometryType === "arc"
                ? `圆弧起点 ${planeAxes.vertical}`
                : `起点 ${planeAxes.vertical}`
            }
          >
            <NumberInput
              value={selected.start[1]}
              step={0.01}
              onChange={(value) => {
                const start: [number, number] = [selected.start![0], value];
                const patch: Partial<Draft["sketch"]["entities"][number]> = { start };
                if (selected.geometryType === "arc" && selected.center) {
                  patch.startAngle = pointAngleDegrees(selected.center, start);
                }
                editEntity(draft.sketch.entities.indexOf(selected), patch);
              }}
            />
          </Field>
          {selected.end && (
            <>
              <Field
                label={
                  selected.geometryType === "arc"
                    ? `圆弧终点 ${planeAxes.horizontal}`
                    : `终点 ${planeAxes.horizontal}`
                }
              >
                <NumberInput
                  value={selected.end[0]}
                  step={0.01}
                  onChange={(value) => {
                    const end: [number, number] = [value, selected.end![1]];
                    const patch: Partial<Draft["sketch"]["entities"][number]> = {
                      end,
                    };
                    if (selected.geometryType === "arc" && selected.center) {
                      patch.endAngle = pointAngleDegrees(selected.center, end);
                    }
                    editEntity(draft.sketch.entities.indexOf(selected), patch);
                  }}
                />
              </Field>
              <Field
                label={
                  selected.geometryType === "arc"
                    ? `圆弧终点 ${planeAxes.vertical}`
                    : `终点 ${planeAxes.vertical}`
                }
              >
                <NumberInput
                  value={selected.end[1]}
                  step={0.01}
                  onChange={(value) => {
                    const end: [number, number] = [selected.end![0], value];
                    const patch: Partial<Draft["sketch"]["entities"][number]> = {
                      end,
                    };
                    if (selected.geometryType === "arc" && selected.center) {
                      patch.endAngle = pointAngleDegrees(selected.center, end);
                    }
                    editEntity(draft.sketch.entities.indexOf(selected), patch);
                  }}
                />
              </Field>
            </>
          )}
        </div>
      )}
      {selected.start && selected.end && selected.geometryType === "line" && (
        <div className="coordinate-grid">
          <Field label="长度" hint="以起点为锚点，沿当前角度调整终点">
            <NumberInput
              value={linePolar(selected.start, selected.end).length}
              step={0.01}
              min={0}
              onChange={(length) => {
                const polar = linePolar(selected.start!, selected.end!);
                editEntity(draft.sketch.entities.indexOf(selected), {
                  end: endFromLengthAndAngle(
                    selected.start!,
                    length,
                    polar.length > 1e-9 ? polar.angleDegrees : 0,
                  ),
                });
              }}
            />
          </Field>
          <Field
            label={`相对 ${planeAxes.horizontal} 正方向逆时针角`}
            hint="角度制；负值或超过 360° 会自动折合到 0°～360°"
          >
            <NumberInput
              value={linePolar(selected.start, selected.end).angleDegrees}
              unit="°"
              step={0.01}
              onChange={(angleDegrees) => {
                const polar = linePolar(selected.start!, selected.end!);
                editEntity(draft.sketch.entities.indexOf(selected), {
                  end: endFromLengthAndAngle(
                    selected.start!,
                    polar.length,
                    angleDegrees,
                  ),
                });
              }}
            />
          </Field>
        </div>
      )}
      {selected.center && (
        <div className="coordinate-grid">
          <Field
            label={
              selected.geometryType === "arc"
                ? `圆心 ${planeAxes.horizontal}`
                : `圆心 ${planeAxes.horizontal}`
            }
          >
            <NumberInput
              value={selected.center[0]}
              step={0.01}
              onChange={(value) => {
                const center: [number, number] = [value, selected.center![1]];
                const patch: Partial<Draft["sketch"]["entities"][number]> = { center };
                if (selected.geometryType === "arc") {
                  const geometry = arcFromEntity({ ...selected, center });
                  if (geometry) {
                    patch.start = geometry.start;
                    patch.end = geometry.end;
                    patch.startAngle = geometry.startAngle;
                    patch.endAngle = geometry.endAngle;
                  }
                }
                editEntity(draft.sketch.entities.indexOf(selected), patch);
              }}
            />
          </Field>
          <Field label={`圆心 ${planeAxes.vertical}`}>
            <NumberInput
              value={selected.center[1]}
              step={0.01}
              onChange={(value) => {
                const center: [number, number] = [selected.center![0], value];
                const patch: Partial<Draft["sketch"]["entities"][number]> = { center };
                if (selected.geometryType === "arc") {
                  const geometry = arcFromEntity({ ...selected, center });
                  if (geometry) {
                    patch.start = geometry.start;
                    patch.end = geometry.end;
                    patch.startAngle = geometry.startAngle;
                    patch.endAngle = geometry.endAngle;
                  }
                }
                editEntity(draft.sketch.entities.indexOf(selected), patch);
              }}
            />
          </Field>
          {selected.radius != null && (
            <Field label="半径">
              <NumberInput
                value={selected.radius}
                step={0.01}
                min={0.01}
                onChange={(radius) => {
                  const patch: Partial<Draft["sketch"]["entities"][number]> = { radius };
                  if (selected.geometryType === "arc") {
                    const geometry = arcFromEntity({ ...selected, radius });
                    if (geometry) {
                      patch.start = geometry.start;
                      patch.end = geometry.end;
                      patch.startAngle = geometry.startAngle;
                      patch.endAngle = geometry.endAngle;
                    }
                  }
                  editEntity(draft.sketch.entities.indexOf(selected), patch);
                }}
              />
            </Field>
          )}
          {selected.geometryType === "arc" &&
          selected.startAngle != null &&
          selected.endAngle != null ? (
            <>
              <Field
                label="圆弧角度（自起点）"
                hint="以起点为基准，沿逆时针方向量取圆弧张角"
              >
                <NumberInput
                  value={arcSweepDegrees(
                    selected.startAngle,
                    selected.endAngle,
                    selected.largeArc ?? false,
                  )}
                  unit="°"
                  step={0.01}
                  min={0.01}
                  onChange={(sweep) => {
                    const geometry = arcFromEntity(selected);
                    if (!geometry) return;
                    const next = arcWithSweep(geometry, sweep);
                    editEntity(draft.sketch.entities.indexOf(selected), {
                      end: next.end,
                      endAngle: next.endAngle,
                      largeArc: next.largeArc,
                    });
                  }}
                />
              </Field>
              <div className="arc-reverse-row">
                <button
                  type="button"
                  onClick={() => {
                    const geometry = arcFromEntity(selected);
                    if (!geometry) return;
                    const next = toggleArcDirection(geometry);
                    editEntity(draft.sketch.entities.indexOf(selected), {
                      end: next.end,
                      endAngle: next.endAngle,
                      largeArc: next.largeArc,
                    });
                  }}
                >
                  <RefreshCw size={14} />
                  反转圆弧
                </button>
                <small>在两种可能的弧段之间切换（小于 180° 与大于 180°）</small>
              </div>
            </>
          ) : null}
        </div>
      )}
      <button className="danger-text" onClick={deleteSelectedEntities}>
        <Trash2 size={13} />
        删除{selectedCount > 1 ? `${selectedCount} 个图元` : "图元"}及其失效引用
      </button>
    </div>
  );
}







