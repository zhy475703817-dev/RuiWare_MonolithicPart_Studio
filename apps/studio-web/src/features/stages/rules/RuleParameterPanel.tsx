import { Plus, Variable } from "lucide-react";
import { Field, NumberInput, PanelTitle } from "../../../components/ui/FormParts";
import {
  parameterDefaultForType,
  parameterValueType,
} from "../../authoring/authoringUtils";
import type { ParameterDefinition } from "../../../types";

export type NewRuleParameter = {
  id: string;
  displayName: string;
  valueType: "number" | "integer";
  unit: string;
  default: number;
  minimum: number;
  maximum: number;
};

type Props = {
  pendingParameters: ParameterDefinition[];
  declaredParameters: ParameterDefinition[];
  newRuleParameter: NewRuleParameter;
  setNewRuleParameter: (value: NewRuleParameter) => void;
  ruleParameterError: string;
  ruleParameterRenameErrors: Record<string, string>;
  addRuleParameter: () => void;
  renameRuleParameter: (previousId: string, rawNextId: string) => boolean;
  editParameterDisplayName: (parameter: ParameterDefinition, displayName: string) => void;
  editParameter: (parameterId: string, patch: Partial<ParameterDefinition>) => void;
};

export function RuleParameterPanel({
  pendingParameters,
  declaredParameters,
  newRuleParameter,
  setNewRuleParameter,
  ruleParameterError,
  ruleParameterRenameErrors,
  addRuleParameter,
  renameRuleParameter,
  editParameterDisplayName,
  editParameter,
}: Props) {
  return (      <div className="panel rule-parameter-panel">
        <PanelTitle
          icon={Variable}
          title="规则页预声明参数"
          subtitle="先把变量名、类型和初值锁住，表达式马上可用；进入契约页后再补全来源、作用域与发布约束。"
          actions={
            <span className={`review-chip ${pendingParameters.length ? "" : "ok"}`}>
              {pendingParameters.length ? `${pendingParameters.length} 个待补全` : "已补全"}
            </span>
          }
        />
        <div className="parameter-contract-guide">
          <strong>工作方式</strong>
          <span>这里只定义给规则表达式直接引用的参数，不在这里处理材料、组件或产品级来源。</span>
          <span>规则页创建的参数会自动进入契约页，并以“待补全”状态提示你完成正式契约。</span>
        </div>
        <div className="form-grid three">
          <Field label="参数 ID">
            <input
              value={newRuleParameter.id}
              onChange={(event) =>
                setNewRuleParameter({ ...newRuleParameter, id: event.target.value })
              }
              placeholder="holePitch"
            />
          </Field>
          <Field label="显示名称">
            <input
              value={newRuleParameter.displayName}
              onChange={(event) =>
                setNewRuleParameter({
                  ...newRuleParameter,
                  displayName: event.target.value,
                })
              }
              placeholder="孔距"
            />
          </Field>
          <Field label="类型">
            <select
              value={newRuleParameter.valueType}
              onChange={(event) => {
                const valueType = event.target.value as "number" | "integer";
                setNewRuleParameter({
                  ...newRuleParameter,
                  valueType,
                  default:
                    valueType === "integer"
                      ? Math.trunc(newRuleParameter.default)
                      : newRuleParameter.default,
                  minimum:
                    valueType === "integer"
                      ? Math.trunc(newRuleParameter.minimum)
                      : newRuleParameter.minimum,
                  maximum:
                    valueType === "integer"
                      ? Math.trunc(newRuleParameter.maximum)
                      : newRuleParameter.maximum,
                });
              }}
            >
              <option value="number">数值</option>
              <option value="integer">整数</option>
            </select>
          </Field>
          <Field label="单位">
            <input
              value={newRuleParameter.unit}
              onChange={(event) =>
                setNewRuleParameter({ ...newRuleParameter, unit: event.target.value })
              }
              placeholder="mm"
            />
          </Field>
          <Field label="最小值">
            <NumberInput
              value={newRuleParameter.minimum}
              onChange={(minimum) =>
                setNewRuleParameter({ ...newRuleParameter, minimum })
              }
            />
          </Field>
          <Field label="标称值">
            <NumberInput
              value={newRuleParameter.default}
              onChange={(value) =>
                setNewRuleParameter({ ...newRuleParameter, default: value })
              }
            />
          </Field>
          <Field label="最大值">
            <NumberInput
              value={newRuleParameter.maximum}
              onChange={(maximum) =>
                setNewRuleParameter({ ...newRuleParameter, maximum })
              }
            />
          </Field>
        </div>
        {ruleParameterError && <p className="inline-error">{ruleParameterError}</p>}
        <div className="card-actions">
          <button className="primary" onClick={addRuleParameter}>
            <Plus size={13} />
            预声明参数
          </button>
        </div>
        {declaredParameters.length > 0 && (
          <div className="parameter-contract-list">
            {declaredParameters.map((parameter) => (
              <details className="parameter-contract-card" key={parameter.id}>
                <summary>
                  <span>
                    <strong>{parameter.displayName || parameter.label}</strong>
                    <code>{parameter.id}</code>
                  </span>
                  <small>
                    {parameter.contractReady ? "契约已补全" : "待契约补全"}
                    {" · "}{parameterValueType(parameter)} · {parameter.unit || "—"}
                  </small>
                </summary>
                <div className="form-grid three">
                  <Field label="稳定 ID">
                    <input
                      key={parameter.id}
                      defaultValue={parameter.id}
                      onBlur={(event) => {
                        if (!renameRuleParameter(parameter.id, event.target.value)) {
                          event.currentTarget.value = parameter.id;
                        }
                      }}
                      aria-invalid={!!ruleParameterRenameErrors[parameter.id]}
                    />
                    {ruleParameterRenameErrors[parameter.id] && (
                      <small className="field-error" role="alert">
                        {ruleParameterRenameErrors[parameter.id]}
                      </small>
                    )}
                  </Field>
                  <Field label="显示名称">
                    <input
                      value={parameter.displayName || parameter.label}
                      onChange={(event) =>
                        editParameterDisplayName(parameter, event.target.value)
                      }
                    />
                  </Field>
                  <Field label="类型">
                    <select
                      value={parameterValueType(parameter)}
                      onChange={(event) => {
                        const valueType = event.target.value as "number" | "integer";
                        const defaultValue = parameterDefaultForType(valueType);
                        editParameter(parameter.id, {
                          valueType,
                          default: defaultValue,
                          minimum: valueType === "integer" ? 0 : 0,
                          maximum: valueType === "integer" ? 1000 : 1000,
                          sourceDefinition: parameter.sourceDefinition
                            ? { ...parameter.sourceDefinition, fallback: defaultValue }
                            : parameter.sourceDefinition,
                          contractReady: false,
                        });
                      }}
                    >
                      <option value="number">数值</option>
                      <option value="integer">整数</option>
                    </select>
                  </Field>
                  <Field label="单位">
                    <input
                      value={parameter.unit}
                      onChange={(event) =>
                        editParameter(parameter.id, { unit: event.target.value, contractReady: false })
                      }
                    />
                  </Field>
                  <Field label="最小值">
                    <NumberInput
                      value={parameter.minimum}
                      onChange={(minimum) =>
                        editParameter(parameter.id, { minimum, contractReady: false })
                      }
                    />
                  </Field>
                  <Field label="标称值">
                    <NumberInput
                      value={Number(parameter.default)}
                      onChange={(value) =>
                        editParameter(parameter.id, {
                          default: value,
                          sourceDefinition: parameter.sourceDefinition
                            ? { ...parameter.sourceDefinition, fallback: value }
                            : parameter.sourceDefinition,
                          contractReady: false,
                        })
                      }
                    />
                  </Field>
                  <Field label="最大值">
                    <NumberInput
                      value={parameter.maximum}
                      onChange={(maximum) =>
                        editParameter(parameter.id, { maximum, contractReady: false })
                      }
                    />
                  </Field>
                </div>
                <div className="parameter-source-note">
                  <strong>契约补全</strong>
                  <span>这一步只负责把变量名先放进全局参数表；到契约页再补来源、作用域、公开性与发布约束。</span>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
  );
}

