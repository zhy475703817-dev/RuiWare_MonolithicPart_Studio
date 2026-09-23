import { describe, expect, it } from "vitest";
import type { Draft, ParameterDefinition } from "../../../types";
import {
  getRuleExpressionParameterIssues,
  getRuleParameterGroups,
} from "./ruleParameterVisibility";

const parameter = (patch: Partial<ParameterDefinition>): ParameterDefinition => ({
  id: "parameter",
  label: "参数",
  unit: "mm",
  default: 0,
  exposed: true,
  source: "user",
  ...patch,
});

const draftWith = (featureRules: Draft["featureRules"], parameterDefinitions: Draft["parameterDefinitions"]): Pick<Draft, "featureRules" | "parameterDefinitions"> => ({
  featureRules,
  parameterDefinitions,
});

describe("rule parameter visibility", () => {
  it("hides all rule-page parameters when no rule exists", () => {
    const groups = getRuleParameterGroups(
      draftWith([], [
        parameter({ id: "length", label: "长度", default: 2400 }),
        parameter({ id: "sectionWidth", label: "截面宽度", default: 80 }),
      ]),
    );

    expect(groups.existingParameters).toEqual([]);
    expect(groups.predeclaredParameters).toEqual([]);
    expect(groups.pendingParameters).toEqual([]);
    expect(groups.canCreateParameters).toBe(false);
  });

  it("shows only rule-owned parameters after a rule exists", () => {
    const groups = getRuleParameterGroups(
      draftWith(
        [{ id: "rule-1" } as Draft["featureRules"][number]],
        [
          parameter({ id: "length", label: "长度", default: 2400 }),
          parameter({ id: "holeDiameter", label: "孔径", default: 12, ruleDefaultFor: "ruleDefault:rule-1:holeDiameter" }),
          parameter({ id: "customPitch", label: "孔距", default: 100, declaredInRuleStage: true, contractReady: false }),
        ],
      ),
    );

    expect(groups.existingParameters.map((parameter) => parameter.id)).toEqual([
      "holeDiameter",
    ]);
    expect(groups.predeclaredParameters.map((parameter) => parameter.id)).toEqual([
      "customPitch",
    ]);
    expect(groups.pendingParameters.map((parameter) => parameter.id)).toEqual([
      "customPitch",
    ]);
    expect(groups.canCreateParameters).toBe(true);
  });

  it("reports identifiers used by rules that are not declared parameter IDs", () => {
    const groups = getRuleExpressionParameterIssues({
      featureRules: [
        {
          id: "holes.main",
          name: "主孔列",
          indexVariable: "i",
          conditionExpression: "length >= 1800 and hasServiceHole",
          countExpression: "holeCount",
          argumentExpressions: { z: "unknownOffset + i" },
          placement: {
            pitchExpression: "holePitch",
            startMarginExpression: "0",
            endMarginExpression: "0",
            maximumPitchExpression: "maxPitch",
          },
          polygonVertices: [],
        } as unknown as Draft["featureRules"][number],
      ],
      parameterDefinitions: [
        parameter({ id: "length" }),
        parameter({ id: "holeCount" }),
        parameter({ id: "holePitch" }),
        parameter({ id: "maxPitch" }),
      ],
    });

    expect(groups).toEqual([
      {
        ruleId: "holes.main",
        ruleName: "主孔列",
        identifiers: ["hasServiceHole", "unknownOffset"],
      },
    ]);
  });
});
