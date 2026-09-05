import { useState } from "react";
import { GitBranch, Link2, Variable } from "lucide-react";
import { api } from "../../../api";
import { InterfaceEditor } from "../workflow/interface/InterfaceEditor";
import { ContractParametersPanel } from "./ContractParametersPanel";
import { ContractSimulationWorkspace } from "./ContractSimulationWorkspace";
import { ParameterAssistancePanel } from "./ParameterAssistancePanel";
import {
  normalizeParameterAliasReferences,
  renameParameterReferences,
  renameRecordKey,
} from "../../authoring/authoringUtils";
import type { Draft, ParameterDefinition, TemplateEvaluation } from "../../../types";

export function ContractStage({
  draft,
  change,
  save,
  onAdoptSavedDraft,
  dirty,
  showError,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  save: (d?: Draft | null) => Promise<Draft | null | undefined>;
  onAdoptSavedDraft: (draft: Draft) => void;
  dirty: boolean;
  showError: (e: unknown) => void;
}) {
  const [tab, setTab] = useState<
    "parameters" | "interfaces" | "simulation"
  >("parameters");
  const [overrides, setOverrides] = useState<
    Record<string, string | number | boolean>
  >({});
  const [evaluation, setEvaluation] = useState<TemplateEvaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [parameterIdErrors, setParameterIdErrors] = useState<
    Record<string, string>
  >({});
  const editParam = (i: number, patch: Partial<ParameterDefinition>) =>
    change({
      ...draft,
      parameterDefinitions: draft.parameterDefinitions.map((p, n) =>
        n === i
          ? {
              ...p,
              ...patch,
              ...(p.declaredInRuleStage ? { contractReady: true } : {}),
            }
          : p,
      ),
    });
  const editParamDisplayName = (parameter: ParameterDefinition, displayName: string) => {
    const normalized = normalizeParameterAliasReferences(draft, parameter.id, [
      parameter.displayName || "",
      parameter.label || "",
    ]);
    change({
      ...normalized,
      parameterDefinitions: normalized.parameterDefinitions.map((item) =>
        item.id === parameter.id
          ? {
              ...item,
              label: displayName,
              displayName,
              ...(item.declaredInRuleStage ? { contractReady: true } : {}),
            }
          : item,
      ),
    });
  };
  const renameParam = (previousId: string, rawNextId: string) => {
    const nextId = rawNextId.trim();
    if (nextId === previousId) return true;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nextId)) {
      setParameterIdErrors((errors) => ({
        ...errors,
        [previousId]: "ID 须以字母开头，只能包含字母、数字和下划线。",
      }));
      return false;
    }
    if (draft.parameterDefinitions.some((item) => item.id === nextId)) {
      setParameterIdErrors((errors) => ({
        ...errors,
        [previousId]: "该参数 ID 已存在。",
      }));
      return false;
    }
    const renamed = renameParameterReferences(draft, previousId, nextId);
    change({
      ...renamed,
      parameterDefinitions: renamed.parameterDefinitions.map((parameter) =>
        parameter.id === nextId && parameter.declaredInRuleStage
          ? { ...parameter, contractReady: true }
          : parameter,
      ),
    });
    setOverrides((values) => renameRecordKey(values, previousId, nextId));
    setParameterIdErrors((errors) => {
      const next = { ...errors };
      delete next[previousId];
      return next;
    });
    return true;
  };
  const addParam = () =>
    change({
      ...draft,
      parameterDefinitions: [
        ...draft.parameterDefinitions,
        {
          id: `parameter${Date.now().toString(36)}`,
          label: "新参数",
          unit: "mm",
          default: 0,
          minimum: 0,
          maximum: 100,
          exposed: true,
          source: "user",
          sourceDefinition: {
            type: "userInput",
            dependencies: [],
            lookupTable: {},
            fallback: 0,
          },
          scope: "partInstance",
          declaredInRuleStage: false,
          contractReady: true,
        },
      ],
    });
  const pendingRuleParameters = draft.parameterDefinitions.filter(
    (parameter) => parameter.declaredInRuleStage && !parameter.contractReady,
  );
  async function evaluate(overridesInput = overrides) {
    setEvaluating(true);
    try {
      const saved = dirty ? await save(draft) : draft;
      if (saved?.id)
        setEvaluation(
          await api.evaluate(saved.id, { overrides: overridesInput }),
        );
    } catch (e) {
      showError(e);
    } finally {
      setEvaluating(false);
    }
  }
  return (
    <>
      <ParameterAssistancePanel draft={draft} onAdoptSavedDraft={onAdoptSavedDraft} showError={showError} />
      <div className="contract-tabs">
        <button
          className={tab === "parameters" ? "active" : ""}
          onClick={() => setTab("parameters")}
        >
          <Variable />
          参数契约 <span>{draft.parameterDefinitions.length}</span>
        </button>
        <button
          className={tab === "interfaces" ? "active" : ""}
          onClick={() => setTab("interfaces")}
        >
          <Link2 />
          零部件接口 <span>{draft.interfaces.length}</span>
        </button>
        <button
          className={tab === "simulation" ? "active" : ""}
          onClick={() => setTab("simulation")}
        >
          <GitBranch />
          试算与验证 <span>{draft.variants.length}</span>
        </button>
      </div>
      {tab === "parameters" && (
        <ContractParametersPanel
          draft={draft}
          parameterIdErrors={parameterIdErrors}
          pendingRuleParametersCount={pendingRuleParameters.length}
          onAddParameter={addParam}
          onRenameParameter={renameParam}
          onEditParameter={editParam}
          onEditDisplayName={editParamDisplayName}
          onDeleteParameter={(index) =>
            change({
              ...draft,
              parameterDefinitions: draft.parameterDefinitions.filter(
                (_, itemIndex) => itemIndex !== index,
              ),
            })
          }
        />
      )}
      {tab === "interfaces" && (
        <InterfaceEditor draft={draft} change={change} />
      )}
      {tab === "simulation" && (
        <ContractSimulationWorkspace
          draft={draft}
          change={change}
          overrides={overrides}
          setOverrides={setOverrides}
          evaluation={evaluation}
          evaluating={evaluating}
          onEvaluate={evaluate}
        />
      )}
    </>
  );
}





