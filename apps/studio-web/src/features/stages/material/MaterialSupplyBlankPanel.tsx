import { ArrowRight, Layers3 } from "lucide-react";
import { Field, NumberInput } from "../../../components/ui/FormParts";
import type { Draft, MaterialRequirement } from "../../../types";

type Props = {
  draft: Draft;
  req: MaterialRequirement;
  onBlankChange: (patch: Partial<Draft["blank"]>) => void;
};

const blankForms = [
  ["strip", "纵向带料"],
  ["flatBlank", "定尺平板坯"],
  ["profileSegment", "定尺型材段"],
  ["tubeSegment", "定尺管段"],
  ["barSegment", "棒料段"],
  ["wireBlank", "线材毛坯"],
  ["castBlank", "铸造毛坯"],
  ["externalModel", "外部模型"],
  ["standardPart", "采购标准件"],
];

const prepProcesses = [
  ["uncoiling", "开卷"],
  ["leveling", "校平"],
  ["slitting", "分条"],
  ["cutToLength", "定尺切断"],
  ["sawing", "锯切"],
  ["blanking", "冲裁下料"],
  ["preforming", "预成形"],
];

export function MaterialSupplyBlankPanel({ draft, req, onBlankChange }: Props) {
  return (
    <div className="panel">
      <div className="panel-title">
        <Layers3 />
        <div>
          <h3>2. 供应材料与毛坯准备</h3>
          <p>供应材料描述采购状态；制造起始毛坯描述进入主体成形或加工时的几何状态。</p>
        </div>
      </div>
      <div className="supply-blank-flow">
        <span>
          {(
            [
              ["coil", "卷材"],
              ["sheet", "平板"],
              ["openProfile", "开口型材"],
              ["closedProfile", "闭口型材"],
              ["tube", "管材"],
              ["bar", "棒材"],
              ["wire", "线材"],
              ["engineeringPlastic", "工程塑料"],
              ["standardPart", "标准件"],
            ] as const
          ).find(([v]) => v === req.supplyForm)?.[1] || req.supplyForm}
        </span>
        <ArrowRight />
        <strong>
          {blankForms.find(([v]) => v === draft.blank.form)?.[1] || draft.blank.form}
        </strong>
        <ArrowRight />
        <span>{draft.blank.manufacturingRoute}</span>
      </div>
      <div className="form-grid three">
        <Field label="毛坯准备关系">
          <select
            value={draft.blank.preparationMode}
            onChange={(e) =>
              onBlankChange({
                preparationMode: e.target.value as Draft["blank"]["preparationMode"],
                preparationProcesses:
                  e.target.value === "sameAsSupply" ? ["none"] : [],
              })
            }
          >
            <option value="sameAsSupply">与供应材料一致</option>
            <option value="preparedBlank">需要毛坯准备</option>
          </select>
        </Field>
        <Field label="制造起始毛坯">
          <select
            value={draft.blank.form}
            onChange={(e) =>
              onBlankChange({ form: e.target.value as Draft["blank"]["form"] })
            }
          >
            {blankForms.map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="主体制造路线">
          <select
            value={draft.blank.manufacturingRoute}
            onChange={(e) =>
              onBlankChange({
                manufacturingRoute: e.target
                  .value as Draft["blank"]["manufacturingRoute"],
              })
            }
          >
            {[
              ["coldRollForming", "冷弯辊压"],
              ["laserCutting", "激光下料"],
              ["machining", "机加工"],
              ["extrusion", "挤压"],
              ["bending", "折弯"],
              ["casting", "铸造"],
              ["purchased", "采购"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {draft.blank.preparationMode === "preparedBlank" && (
        <Field label="毛坯准备工序">
          <div className="process-grid">
            {prepProcesses.map(([id, label]) => (
              <label
                className={
                  draft.blank.preparationProcesses.includes(
                    id as Draft["blank"]["preparationProcesses"][number],
                  )
                    ? "selected"
                    : ""
                }
                key={id}
              >
                <input
                  type="checkbox"
                  checked={draft.blank.preparationProcesses.includes(
                    id as Draft["blank"]["preparationProcesses"][number],
                  )}
                  onChange={(e) =>
                    onBlankChange({
                      preparationProcesses: e.target.checked
                        ? [
                            ...draft.blank.preparationProcesses,
                            id as Draft["blank"]["preparationProcesses"][number],
                          ]
                        : draft.blank.preparationProcesses.filter((x) => x !== id),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </Field>
      )}
      <div className="form-grid three">
        <Field label="毛坯长度表达式">
          <input
            value={draft.blank.lengthExpression}
            onChange={(e) => onBlankChange({ lengthExpression: e.target.value })}
          />
        </Field>
        <Field label="毛坯宽度表达式">
          <input
            value={draft.blank.widthExpression}
            onChange={(e) => onBlankChange({ widthExpression: e.target.value })}
          />
        </Field>
        <Field label="毛坯厚度表达式">
          <input
            value={draft.blank.thicknessExpression}
            onChange={(e) => onBlankChange({ thicknessExpression: e.target.value })}
          />
        </Field>
        <Field label="长度余量">
          <NumberInput
            value={draft.blank.lengthAllowance}
            onChange={(lengthAllowance) => onBlankChange({ lengthAllowance })}
          />
        </Field>
        <Field label="宽度余量">
          <NumberInput
            value={draft.blank.widthAllowance}
            onChange={(widthAllowance) => onBlankChange({ widthAllowance })}
          />
        </Field>
      </div>
    </div>
  );
}
