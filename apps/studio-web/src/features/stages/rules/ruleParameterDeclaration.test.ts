import { describe, expect, it } from "vitest";
import { createRulePredeclaredParameter } from "./ruleParameterDeclaration";

describe("rule parameter declaration", () => {
  it("creates a contract-pending parameter owned by the rules stage", () => {
    const parameter = createRulePredeclaredParameter({
      id: "holeStartMargin",
      label: "首项距起始端",
      default: 100,
    });

    expect(parameter).toMatchObject({
      id: "holeStartMargin",
      declaredInRuleStage: true,
      contractReady: false,
      source: "user",
      scope: "partInstance",
      sourceDefinition: { type: "userInput", fallback: 100 },
    });
  });
});
