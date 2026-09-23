import type { Draft, ParameterDefinition } from "../../../types";

export type RuleParameterGroups = {
  existingParameters: ParameterDefinition[];
  predeclaredParameters: ParameterDefinition[];
  pendingParameters: ParameterDefinition[];
  canCreateParameters: boolean;
};

export type RuleExpressionParameterIssue = {
  ruleId: string;
  ruleName: string;
  identifiers: string[];
};

const expressionIdentifierPattern = /\b[A-Za-z][A-Za-z0-9_]*\b/g;
const expressionFunctionNames = new Set([
  "abs",
  "ceil",
  "clamp",
  "floor",
  "max",
  "min",
  "round",
  "sqrt",
  "and",
  "or",
  "not",
  "True",
  "False",
]);

export function getRuleExpressionParameterIssues(
  draft: Pick<Draft, "featureRules" | "parameterDefinitions">,
): RuleExpressionParameterIssue[] {
  const parameterIds = new Set(draft.parameterDefinitions.map((parameter) => parameter.id));
  return draft.featureRules.flatMap((rule) => {
    const expressions = [
      rule.conditionExpression,
      rule.countExpression,
      ...Object.values(rule.argumentExpressions),
      rule.placement.pitchExpression,
      rule.placement.startMarginExpression,
      rule.placement.endMarginExpression,
      rule.placement.maximumPitchExpression,
      ...rule.polygonVertices.flatMap((vertex) => [vertex.uExpression, vertex.vExpression]),
    ];
    const identifiers = new Set<string>();
    for (const expression of expressions) {
      for (const identifier of expression.match(expressionIdentifierPattern) ?? []) {
        if (
          identifier !== rule.indexVariable &&
          !parameterIds.has(identifier) &&
          !expressionFunctionNames.has(identifier)
        ) {
          identifiers.add(identifier);
        }
      }
    }
    return identifiers.size
      ? [{ ruleId: rule.id, ruleName: rule.name, identifiers: [...identifiers].sort() }]
      : [];
  });
}

export function getRuleParameterGroups(
  draft: Pick<Draft, "featureRules" | "parameterDefinitions">,
): RuleParameterGroups {
  const hasRules = draft.featureRules.length > 0;
  const ruleParameters = hasRules
    ? draft.parameterDefinitions.filter(
        (parameter) => parameter.ruleDefaultFor || parameter.declaredInRuleStage,
      )
    : [];
  const predeclaredParameters = ruleParameters.filter(
    (parameter) => parameter.declaredInRuleStage && !parameter.ruleDefaultFor,
  );
  const existingParameters = ruleParameters.filter(
    (parameter) => !!parameter.ruleDefaultFor,
  );

  return {
    existingParameters,
    predeclaredParameters,
    pendingParameters: predeclaredParameters.filter(
      (parameter) => !parameter.contractReady,
    ),
    canCreateParameters: hasRules,
  };
}
