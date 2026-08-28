import { Variable } from "lucide-react";
import { Field, NumberInput } from "../../../../components/ui/FormParts";
import type { ParameterDefinition, ParameterSource } from "../../../../types";
import {
  PARAMETER_SCOPE_LABELS,
  requiredScopeForSource,
} from "../../../authoring/authoringUtils";

type NewParameter = {
  id: string;
  displayName: string;
  unit: string;
  default: number;
  minimum: number;
  maximum: number;
  sourceType: ParameterSource["type"];
  scope: NonNullable<ParameterDefinition["scope"]>;
  exposed: boolean;
};

type Props = {
  draftParameterCount: number;
  parameterCreator: boolean;
  setParameterCreator: (value: boolean | ((current: boolean) => boolean)) => void;
  newParameter: NewParameter;
  setNewParameter: (
    value: NewParameter | ((current: NewParameter) => NewParameter),
  ) => void;
  parameterError: string;
  setParameterError: (value: string) => void;
  createParameter: () => void;
};

export function ParameterCreateCard({
  draftParameterCount,
  parameterCreator,
  setParameterCreator,
  newParameter,
  setNewParameter,
  parameterError,
  setParameterError,
  createParameter,
}: Props) {
  const sourceOptions = Object.entries({
    userInput: "实例输入",
    materialProperty: "材料属性",
    formula: "公式",
    lookup: "查表",
    productConfig: "产品配置",
    componentConfig: "组件配置",
    projectZone: "项目区域",
    standard: "标准规范",
    geometricMeasurement: "几何测量",
    externalApi: "外部接口",
    constant: "模板常量",
  }) as Array<[ParameterSource["type"], string]>;
  const scopeOptions = Object.entries(PARAMETER_SCOPE_LABELS) as Array<
    [NonNullable<ParameterDefinition["scope"]>, string]
  >;
  if (!parameterCreator) return null;
  return (
    <div className="parameter-create-card">
      <div className="form-grid three">
        <Field label="参数 ID">
          <input
            value={newParameter.id}
            onChange={(event) =>
              setNewParameter({ ...newParameter, id: event.target.value })
            }
          />
        </Field>
        <Field label="参数名称">
          <input
            value={newParameter.displayName}
            onChange={(event) =>
              setNewParameter({
                ...newParameter,
                displayName: event.target.value,
              })
            }
          />
        </Field>
        <Field label="单位">
          <input
            value={newParameter.unit}
            onChange={(event) =>
              setNewParameter({ ...newParameter, unit: event.target.value })
            }
          />
        </Field>
        <Field label="参数来源">
          <select
            value={newParameter.sourceType}
            onChange={(event) => {
              const sourceType = event.target.value as ParameterSource["type"];
              const requiredScope = requiredScopeForSource(sourceType);
              setNewParameter({
                ...newParameter,
                sourceType,
                scope: requiredScope || newParameter.scope,
                exposed:
                  sourceType === "userInput" &&
                  (requiredScope || newParameter.scope) === "partInstance",
              });
            }}
          >
            {sourceOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="作用域">
          <select
            value={newParameter.scope}
            disabled={requiredScopeForSource(newParameter.sourceType) != null}
            onChange={(event) => {
              const scope = event.target.value as NonNullable<ParameterDefinition["scope"]>;
              setNewParameter({
                ...newParameter,
                scope,
                exposed:
                  newParameter.sourceType === "userInput" &&
                  scope === "partInstance",
              });
            }}
          >
            {scopeOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="最小值">
          <NumberInput
            value={newParameter.minimum}
            onChange={(minimum) => setNewParameter({ ...newParameter, minimum })}
          />
        </Field>
        <Field label="标称值">
          <NumberInput
            value={newParameter.default}
            onChange={(value) => setNewParameter({ ...newParameter, default: value })}
          />
        </Field>
        <Field label="最大值">
          <NumberInput
            value={newParameter.maximum}
            onChange={(maximum) => setNewParameter({ ...newParameter, maximum })}
          />
        </Field>
      </div>
      <div className="parameter-create-link">
        <Variable size={13} />
        <span>
          <strong>参数只定义可求值变量，不会因当前选中图元而自动建立几何关系。</strong>
          创建后，在尺寸卡片的“驱动方式”中绑定该参数。
        </span>
        <label>
          <input
            type="checkbox"
            checked={newParameter.exposed}
            disabled={
              newParameter.sourceType !== "userInput" ||
              newParameter.scope !== "partInstance"
            }
            onChange={(event) =>
              setNewParameter({
                ...newParameter,
                exposed: event.target.checked,
              })
            }
          />
          在零部件实例生成时开放输入
        </label>
      </div>
      {parameterError && <p className="inline-error">{parameterError}</p>}
      <div className="card-actions">
        <button onClick={() => setParameterCreator(false)}>取消</button>
        <button className="primary" onClick={createParameter}>
          创建参数
        </button>
      </div>
    </div>
  );
}





