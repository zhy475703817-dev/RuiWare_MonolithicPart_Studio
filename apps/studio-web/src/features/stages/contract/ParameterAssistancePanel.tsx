import { Check, Eye, LoaderCircle, ShieldCheck } from "lucide-react";
import * as React from "react";
import { api } from "../../../api";
import { Field, PanelTitle } from "../../../components/ui/FormParts";
import type { Draft, ParameterChange, ParameterPreviewResult, ParameterValidationResult } from "../../../types";
import { instanceParameterEditable, parameterValueType } from "../../authoring/authoringUtils";

type Props = {
  draft: Draft;
  onAdoptSavedDraft: (draft: Draft) => void;
  showError: (error: unknown) => void;
};

function parseValue(raw: string, type: ReturnType<typeof parameterValueType>) {
  if (type === "boolean") return raw === "true";
  if (type === "number") return Number(raw);
  if (type === "integer") return Math.trunc(Number(raw));
  return raw;
}

export function ParameterAssistancePanel({ draft, onAdoptSavedDraft, showError }: Props) {
  const [values, setValues] = React.useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(
      draft.parameterDefinitions
        .filter((parameter) => parameter.exposed && instanceParameterEditable(parameter))
        .map((parameter) => [parameter.id, parameter.default]),
    ),
  );
  const [validation, setValidation] = React.useState<ParameterValidationResult | null>(null);
  const [preview, setPreview] = React.useState<ParameterPreviewResult | null>(null);
  const [busy, setBusy] = React.useState<"validate" | "preview" | "apply" | "">("");

  React.useEffect(() => {
    setValues(
      Object.fromEntries(
        draft.parameterDefinitions
          .filter((parameter) => parameter.exposed && instanceParameterEditable(parameter))
          .map((parameter) => [parameter.id, parameter.default]),
      ),
    );
    setValidation(null);
    setPreview(null);
  }, [draft.id, draft.revision]);

  const changes: ParameterChange[] = Object.entries(values).map(([parameterId, value]) => ({
    parameterId,
    value,
    unit: draft.parameterDefinitions.find((parameter) => parameter.id === parameterId)?.unit,
  }));

  async function validate() {
    if (!draft.id) return;
    setBusy("validate");
    try {
      setValidation(await api.validateParameterValues(draft.id, values));
      setPreview(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function previewChanges() {
    if (!draft.id) return;
    setBusy("preview");
    try {
      const next = await api.previewParameterChanges(draft.id, draft.revision, changes);
      setPreview(next);
      setValidation(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function applyChanges() {
    if (!draft.id || !preview?.canAccept) return;
    setBusy("apply");
    try {
      const result = await api.applyParameterChanges(draft.id, draft.revision, changes, true);
      onAdoptSavedDraft(result.draft);
      setPreview(null);
      setValidation(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="panel parameter-assistance-panel">
      <PanelTitle
        icon={ShieldCheck}
        title="参数辅助"
        subtitle="批量读取公开实例参数，先校验和预览，再确认写入新修订。"
      />
      {draft.parameterDefinitions
        .filter((parameter) => parameter.exposed && instanceParameterEditable(parameter))
        .map((parameter) => {
          const type = parameterValueType(parameter);
          return (
            <Field key={parameter.id} label={`${parameter.displayName || parameter.label} · ${parameter.id}`} hint={`${parameter.unit || "无单位"}${parameter.minimum != null || parameter.maximum != null ? ` · ${parameter.minimum ?? "−∞"} 至 ${parameter.maximum ?? "+∞"}` : ""}`}>
              {type === "boolean" || type === "enum" ? (
                <select value={String(values[parameter.id])} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: parseValue(event.target.value, type) }))}>
                  {type === "boolean" ? <>
                    <option value="true">是（true）</option>
                    <option value="false">否（false）</option>
                  </> : (parameter.allowedValues || []).map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
                </select>
              ) : (
                <input
                  type={type === "number" || type === "integer" ? "number" : "text"}
                  step={type === "integer" ? 1 : "any"}
                  value={String(values[parameter.id] ?? "")}
                  onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: parseValue(event.target.value, type) }))}
                />
              )}
            </Field>
          );
        })}
      <div className="parameter-assistance-actions">
        <button className="secondary-btn" disabled={!!busy} onClick={() => void validate()}>
          {busy === "validate" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
          校验参数
        </button>
        <button className="secondary-btn" disabled={!!busy} onClick={() => void previewChanges()}>
          {busy === "preview" ? <LoaderCircle className="spin" size={15} /> : <Eye size={15} />}
          预览修改
        </button>
        <button className="primary-btn" disabled={!!busy || !preview?.canAccept} onClick={() => void applyChanges()}>
          {busy === "apply" ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
          确认写入
        </button>
      </div>
      {validation && (
        <div className={`parameter-assistance-result ${validation.valid ? "valid" : "invalid"}`}>
          <strong>{validation.valid ? "参数校验通过" : "参数校验未通过"}</strong>
          {validation.evaluation.diagnostics.map((item) => <span key={`${item.code}-${item.path}`}>{item.message}</span>)}
        </div>
      )}
      {preview && (
        <div className={`parameter-assistance-result ${preview.canAccept ? "valid" : "invalid"}`}>
          <strong>{preview.canAccept ? `预览通过，将生成 R${draft.revision + 1}` : "预览未通过"}</strong>
          {Object.entries(preview.downstreamValidations).map(([stage, item]) => <span key={stage}>{stage}：{item.complete ? "通过" : "需要重新检查"}</span>)}
          {preview.evaluation.diagnostics.map((item) => <span key={`${item.code}-${item.path}`}>{item.message}</span>)}
        </div>
      )}
    </div>
  );
}
