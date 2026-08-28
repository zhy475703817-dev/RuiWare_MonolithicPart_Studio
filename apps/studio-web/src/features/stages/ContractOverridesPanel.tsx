import { LoaderCircle, Play } from "lucide-react";
import { Field, PanelTitle } from "../../components/ui/FormParts";
import type { Draft, ParameterDefinition } from "../../types";
import { instanceParameterEditable } from "../authoring/authoringUtils";

type Props = {
  draft: Draft;
  overrides: Record<string, string | number | boolean>;
  evaluating: boolean;
  onOverrideChange: (id: string, value: string | number | boolean) => void;
  onEvaluate: () => void;
};

function parseOverride(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && value.trim() !== "" ? numeric : value;
}

export function ContractOverridesPanel({
  draft,
  overrides,
  evaluating,
  onOverrideChange,
  onEvaluate,
}: Props) {
  return (
    <div className="panel">
      <PanelTitle
        icon={Play}
        title="实例参数"
        subtitle="仅实例输入参数可在此修改；组件、产品和区域参数应在对应上层配置中修改。试算值不改模板默认值。"
      />
      {draft.parameterDefinitions
        .filter((parameter) => parameter.exposed && instanceParameterEditable(parameter))
        .map((parameter) => (
          <Field
            key={parameter.id}
            label={`${parameter.displayName || parameter.label} · ${parameter.id}`}
          >
            <div className="number-wrap">
              <input
                value={String(overrides[parameter.id] ?? parameter.default)}
                onChange={(event) =>
                  onOverrideChange(parameter.id, parseOverride(event.target.value))
                }
              />
              <span>{parameter.unit || "—"}</span>
            </div>
          </Field>
        ))}
      <button className="primary-btn full-btn" disabled={evaluating} onClick={onEvaluate}>
        {evaluating ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
        保存并运行规则求值
      </button>
    </div>
  );
}
