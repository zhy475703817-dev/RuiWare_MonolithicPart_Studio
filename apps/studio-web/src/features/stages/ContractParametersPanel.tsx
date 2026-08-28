import { Plus, Trash2, Variable, X } from "lucide-react";
import { Field, PanelTitle } from "../../components/ui/FormParts";
import type { Draft, ParameterDefinition, ParameterSource } from "../../types";
import {
  defaultReferenceForSource,
  instanceParameterEditable,
  legacyParameterSource,
  parameterDefaultForType,
  parameterValueType,
  requiredScopeForSource,
} from "../authoring/authoringUtils";

const SOURCE_LABELS: Record<ParameterSource["type"], string> = {
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
};

type Props = {
  draft: Draft;
  parameterIdErrors: Record<string, string>;
  pendingRuleParametersCount: number;
  onAddParameter: () => void;
  onRenameParameter: (previousId: string, rawNextId: string) => boolean;
  onEditParameter: (index: number, patch: Partial<ParameterDefinition>) => void;
  onEditDisplayName: (parameter: ParameterDefinition, displayName: string) => void;
  onDeleteParameter: (index: number) => void;
};

export function ContractParametersPanel({
  draft,
  parameterIdErrors,
  pendingRuleParametersCount,
  onAddParameter,
  onRenameParameter,
  onEditParameter,
  onEditDisplayName,
  onDeleteParameter,
}: Props) {
  return (
    <div className="panel">
      <PanelTitle
        icon={Variable}
        title="参数及来源"
        subtitle="新增参数用于驱动尺寸、轮廓和布置；稳定 ID 写入规则表达式，显示名称只供人阅读。"
        actions={
          <button className="mini-btn" onClick={onAddParameter}>
            <Plus size={14} />
            新增可填写实例参数
          </button>
        }
      />
      <div className="parameter-contract-guide">
        <strong>使用方式</strong>
        <span>
          <code>稳定 ID</code> 是规则中的变量名，如 <code>holePitch</code>；显示名称可用中文且不会影响规则。
        </span>
        <span>“实例输入”会在实例生成时由用户填写；“公式”由其他参数派生；材料、组件、产品等来源才需要填写上游数据路径。</span>
        <span>规则页预声明的参数会自动出现在这里，先补来源、作用域和范围，再进入试算和发布。</span>
      </div>
      {pendingRuleParametersCount > 0 && (
        <div className="parameter-contract-banner warning">
          <strong>有 {pendingRuleParametersCount} 个规则预声明参数尚未补全。</strong>
          <span>先完成这些参数的正式契约，再继续试算、验证和发布。</span>
        </div>
      )}
      <div className="parameter-list">
        {draft.parameterDefinitions.map((parameter, index) => (
          <div className="parameter-row" key={`${parameter.id}-${index}`}>
            <div className="parameter-id">
              <input
                className="parameter-id-input"
                key={parameter.id}
                defaultValue={parameter.id}
                onBlur={(event) => {
                  if (!onRenameParameter(parameter.id, event.target.value))
                    event.currentTarget.value = parameter.id;
                }}
                aria-label={`${parameter.displayName || parameter.label} 的稳定 ID`}
                aria-invalid={!!parameterIdErrors[parameter.id]}
              />
              {parameterIdErrors[parameter.id] && (
                <small className="field-error" role="alert">
                  {parameterIdErrors[parameter.id]}
                </small>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={parameter.exposed && instanceParameterEditable(parameter)}
                  disabled={!instanceParameterEditable(parameter)}
                  onChange={(event) =>
                    onEditParameter(index, { exposed: event.target.checked })
                  }
                />
                公开
              </label>
            </div>
            <div className="parameter-fields">
              <div className="parameter-inline-note">
                <strong>
                  {parameter.declaredInRuleStage ? "规则页预声明" : "契约页定义"}
                </strong>
                <small>
                  {parameter.declaredInRuleStage
                    ? parameter.contractReady
                      ? "已补全正式契约"
                      : "进入契约页后需要补全"
                    : "这里定义为正式契约"}
                </small>
              </div>
              <Field label="显示名称">
                <input
                  value={parameter.displayName || parameter.label}
                  onChange={(event) =>
                    onEditDisplayName(parameter, event.target.value)
                  }
                />
              </Field>
              <Field label="类型">
                <select
                  value={parameterValueType(parameter)}
                  onChange={(event) => {
                    const valueType = event.target.value as NonNullable<ParameterDefinition["valueType"]>;
                    const defaultValue = parameterDefaultForType(valueType);
                    onEditParameter(index, {
                      valueType,
                      default: defaultValue,
                      minimum:
                        valueType === "number" || valueType === "integer"
                          ? 0
                          : null,
                      maximum:
                        valueType === "number" || valueType === "integer"
                          ? 100
                          : null,
                      allowedValues: valueType === "enum" ? ["option1"] : [],
                      sourceDefinition: parameter.sourceDefinition
                        ? { ...parameter.sourceDefinition, fallback: defaultValue }
                        : parameter.sourceDefinition,
                    });
                  }}
                >
                  <option value="number">数值</option>
                  <option value="integer">整数</option>
                  <option value="boolean">布尔</option>
                  <option value="enum">枚举</option>
                  <option value="string">文本</option>
                </select>
              </Field>
              {parameterValueType(parameter) === "boolean" ? (
                <Field label="默认值" hint="布尔参数只有“是 / 否”两种值。">
                  <select
                    value={String(Boolean(parameter.default))}
                    onChange={(event) =>
                      onEditParameter(index, {
                        default: event.target.value === "true",
                        sourceDefinition: parameter.sourceDefinition
                          ? {
                              ...parameter.sourceDefinition,
                              fallback: event.target.value === "true",
                            }
                          : parameter.sourceDefinition,
                      })
                    }
                  >
                    <option value="true">是（true）</option>
                    <option value="false">否（false）</option>
                  </select>
                </Field>
              ) : (
                <Field
                  label={
                    parameterValueType(parameter) === "enum"
                      ? "默认选项"
                      : "默认／标称值"
                  }
                  hint={
                    parameterValueType(parameter) === "enum"
                      ? "默认值必须是下面枚举选项之一。"
                      : "实例初始值；上游值缺失时作为最终回退。"
                  }
                >
                  {parameterValueType(parameter) === "enum" ? (
                    <select
                      value={String(parameter.default)}
                      onChange={(event) =>
                        onEditParameter(index, {
                          default: event.target.value,
                          sourceDefinition: parameter.sourceDefinition
                            ? {
                                ...parameter.sourceDefinition,
                                fallback: event.target.value,
                              }
                            : parameter.sourceDefinition,
                        })
                      }
                    >
                      {(parameter.allowedValues || []).map((value) => (
                        <option key={String(value)} value={String(value)}>
                          {String(value)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={
                        parameterValueType(parameter) === "number" ||
                        parameterValueType(parameter) === "integer"
                          ? "number"
                          : "text"
                      }
                      step={parameterValueType(parameter) === "integer" ? 1 : "any"}
                      value={String(parameter.default)}
                      onChange={(event) => {
                        const value =
                          parameterValueType(parameter) === "integer"
                            ? Math.trunc(Number(event.target.value || 0))
                            : parameterValueType(parameter) === "number"
                              ? Number(event.target.value || 0)
                              : event.target.value;
                        onEditParameter(index, {
                          default: value,
                          sourceDefinition: parameter.sourceDefinition
                            ? {
                                ...parameter.sourceDefinition,
                                fallback: value,
                              }
                            : parameter.sourceDefinition,
                        });
                      }}
                    />
                  )}
                </Field>
              )}
              {(parameterValueType(parameter) === "number" ||
                parameterValueType(parameter) === "integer") && (
                <Field label="数值范围">
                  <div className="range-input">
                    <input
                      type="number"
                      value={parameter.minimum ?? ""}
                      onChange={(event) =>
                        onEditParameter(index, {
                          minimum:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                    <span>—</span>
                    <input
                      type="number"
                      value={parameter.maximum ?? ""}
                      onChange={(event) =>
                        onEditParameter(index, {
                          maximum:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </Field>
              )}
              {parameterValueType(parameter) === "enum" && (
                <Field label="枚举选项" hint="逐项维护，不需要输入逗号；至少保留一个选项。">
                  <div className="enum-option-list">
                    {(parameter.allowedValues || []).map((option, optionIndex) => (
                      <div
                        className="enum-option-row"
                        key={`${String(option)}-${optionIndex}`}
                      >
                        <input
                          aria-label={`枚举选项 ${optionIndex + 1}`}
                          value={String(option)}
                          onChange={(event) => {
                            const allowedValues = [...(parameter.allowedValues || [])].map(
                              String,
                            );
                            allowedValues[optionIndex] = event.target.value;
                            const defaultValue =
                              String(parameter.default) === String(option)
                                ? event.target.value
                                : String(parameter.default);
                            onEditParameter(index, {
                              allowedValues,
                              default: defaultValue,
                              sourceDefinition: parameter.sourceDefinition
                                ? {
                                    ...parameter.sourceDefinition,
                                    fallback: defaultValue,
                                  }
                                : parameter.sourceDefinition,
                            });
                          }}
                        />
                        <button
                          type="button"
                          aria-label={`删除枚举选项 ${optionIndex + 1}`}
                          disabled={(parameter.allowedValues || []).length <= 1}
                          onClick={() => {
                            const allowedValues = [...(parameter.allowedValues || [])]
                              .map(String)
                              .filter((_, currentIndex) => currentIndex !== optionIndex);
                            const defaultValue = allowedValues.includes(
                              String(parameter.default),
                            )
                              ? String(parameter.default)
                              : allowedValues[0];
                            onEditParameter(index, {
                              allowedValues,
                              default: defaultValue,
                              sourceDefinition: parameter.sourceDefinition
                                ? {
                                    ...parameter.sourceDefinition,
                                    fallback: defaultValue,
                                  }
                                : parameter.sourceDefinition,
                            });
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-btn compact"
                      onClick={() => {
                        const allowedValues = [...(parameter.allowedValues || [])].map(String);
                        let optionNumber = allowedValues.length + 1;
                        let option = `选项${optionNumber}`;
                        while (allowedValues.includes(option)) option = `选项${++optionNumber}`;
                        onEditParameter(index, {
                          allowedValues: [...allowedValues, option],
                        });
                      }}
                    >
                      <Plus size={12} />
                      添加选项
                    </button>
                  </div>
                </Field>
              )}
              <Field label="来源">
                <select
                  value={parameter.sourceDefinition?.type || "userInput"}
                  onChange={(event) => {
                    const type = event.target.value as ParameterSource["type"];
                    const scope =
                      requiredScopeForSource(type) ||
                      parameter.scope ||
                      "partInstance";
                    onEditParameter(index, {
                      source: legacyParameterSource(type),
                      scope,
                      exposed:
                        type === "userInput" && scope === "partInstance"
                          ? parameter.exposed
                          : false,
                      sourceDefinition: {
                        ...(parameter.sourceDefinition || {
                          dependencies: [],
                          lookupTable: {},
                        }),
                        type,
                        reference:
                          defaultReferenceForSource(type, parameter.id) ??
                          parameter.sourceDefinition?.reference ??
                          null,
                        fallback: parameter.default,
                      },
                    });
                  }}
                >
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {(parameter.sourceDefinition?.type || "userInput") === "userInput" ? (
                <div className="parameter-inline-note">
                  <strong>实例输入</strong>
                  <small>
                    该参数会出现在实例生成表单中；“公开”开启后可由用户在允许范围内填写，无需设置引用路径。
                  </small>
                </div>
              ) : (parameter.sourceDefinition?.type || "userInput") === "constant" ? (
                <div className="parameter-inline-note">
                  <strong>模板常量</strong>
                  <small>固定使用默认／标称值，不会出现在实例生成表单中，也没有引用路径。</small>
                </div>
              ) : (
                <Field
                  label={
                    parameter.sourceDefinition?.type === "formula"
                      ? "派生公式"
                      : parameter.sourceDefinition?.type === "materialProperty"
                        ? "材料属性路径"
                        : "上游数据路径"
                  }
                  hint={
                    parameter.sourceDefinition?.type === "formula"
                      ? "引用其他稳定 ID，例如 holePitch = length / holeCount。"
                      : "用点号访问上游数据，例如 material.thickness 或 component.span。"
                  }
                >
                  <input
                    value={
                      parameter.sourceDefinition?.type === "formula"
                        ? parameter.sourceDefinition.expression || ""
                        : parameter.sourceDefinition?.reference || ""
                    }
                    onChange={(event) =>
                      onEditParameter(index, {
                        sourceDefinition: {
                          ...(parameter.sourceDefinition || {
                            type: "userInput",
                            dependencies: [],
                            lookupTable: {},
                          }),
                          [parameter.sourceDefinition?.type === "formula"
                            ? "expression"
                            : "reference"]: event.target.value,
                        },
                      })
                    }
                    placeholder={
                      parameter.sourceDefinition?.type === "formula"
                        ? "例如 length / 300"
                        : "例如 material.thickness"
                    }
                  />
                </Field>
              )}
            </div>
            <button
              className="delete-icon"
              disabled={[
                "length",
                "width",
                "depth",
                "lip",
                "thickness",
              ].includes(parameter.id)}
              onClick={() => onDeleteParameter(index)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
