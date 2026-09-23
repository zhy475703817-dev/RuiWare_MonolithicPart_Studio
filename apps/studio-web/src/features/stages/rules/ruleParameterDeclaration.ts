import type { ParameterDefinition } from "../../../types";

export type RulePredeclaredParameterInput = {
  id: string;
  label: string;
  default: number;
  valueType?: "number" | "integer";
  unit?: string;
  minimum?: number;
  maximum?: number;
};

export const createRulePredeclaredParameter = ({
  id,
  label,
  default: defaultValue,
  valueType = "number",
  unit = "mm",
  minimum = 0,
  maximum = 10000,
}: RulePredeclaredParameterInput): ParameterDefinition => {
  const normalizedDefault = valueType === "integer" ? Math.trunc(defaultValue) : defaultValue;
  const normalizedMinimum = valueType === "integer" ? Math.trunc(minimum) : minimum;
  const normalizedMaximum = valueType === "integer" ? Math.trunc(maximum) : maximum;
  return {
    id,
    label,
    displayName: label,
    valueType,
    unit,
    default: normalizedDefault,
    minimum: normalizedMinimum,
    maximum: normalizedMaximum,
    allowedValues: [],
    exposed: true,
    source: "user",
    sourceDefinition: {
      type: "userInput",
      dependencies: [],
      lookupTable: {},
      fallback: normalizedDefault,
    },
    scope: "partInstance",
    declaredInRuleStage: true,
    contractReady: false,
    description: "规则页预声明，进入契约页后补全来源、作用域与发布要求。",
  };
};
