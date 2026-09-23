import type {
  CompileResult,
  Draft,
  EvaluationRequest,
  Material,
  MaterialBinding,
  MaterialRequirement,
  ParameterChange,
  ParameterContract,
  ParameterPreviewResult,
  ParameterValidationResult,
  PublishedVersion,
  PublishResult,
  RevisionEntry,
  SketchSolveResult,
  StageActionResult,
  StageName,
  StageValidation,
  TemplateAuthoringRegistry,
  TemplateEvaluation,
} from "../types";
import { ApiError, type ApiErrorPayload } from "./errors";

const WORKSPACE_STORAGE_KEY = "ruiware.workspaceId";
const DEFAULT_WORKSPACE_ID = "ruiware-main";

function workspaceId(): string {
  if (typeof localStorage === "undefined") return DEFAULT_WORKSPACE_ID;
  const existing = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (existing) return existing;
  localStorage.setItem(WORKSPACE_STORAGE_KEY, DEFAULT_WORKSPACE_ID);
  return DEFAULT_WORKSPACE_ID;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.headers as Record<string, string> | undefined),
      "X-RuiWare-Workspace": workspaceId(),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }));
    const error = payload.error || payload.detail;
    if (error && typeof error === "object" && "code" in error && "message" in error) {
      throw new ApiError(response.status, {
        fields: [],
        ...error,
        context: payload.context || error.context || {},
      } as ApiErrorPayload);
    }
    const detail = typeof payload.detail === "string" ? payload.detail : response.statusText;
    throw new ApiError(response.status, {
      code: `HTTP_${response.status}`,
      message: detail || "请求处理失败",
      action: "请刷新页面后重试。",
      fields: [],
      retryable: response.status >= 500,
    });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  templateAuthoringRegistry: () => request<TemplateAuthoringRegistry>("/api/v1/registries/template-authoring"),
  drafts: () => request<Draft[]>("/api/v1/template-drafts"),
  draft: (id: string) => request<Draft>(`/api/v1/template-drafts/${id}`),
  draftEventsUrl: (id: string) => `/api/v1/template-drafts/${encodeURIComponent(id)}/events`,
  parameterContract: (id: string) => request<ParameterContract>(`/api/v1/template-drafts/${id}/parameters`),
  validateParameterValues: (id: string, values: Record<string, string | number | boolean>, units: Record<string, string> = {}) => request<ParameterValidationResult>(`/api/v1/template-drafts/${id}/parameters/validate`, json("POST", { values, units })),
  previewParameterChanges: (id: string, baseRevision: number, changes: ParameterChange[]) => request<ParameterPreviewResult>(`/api/v1/template-drafts/${id}/parameters/preview`, json("POST", { baseRevision, changes })),
  applyParameterChanges: (id: string, baseRevision: number, changes: ParameterChange[], confirmed: boolean) => request<{ draft: Draft; changes: ParameterChange[]; downstreamValidations: Record<StageName, StageValidation> }>(`/api/v1/template-drafts/${id}/parameters/apply`, json("POST", { baseRevision, changes, confirmed })),
  setCurrentDraft: (draftId: string) => request<{ draftId: string }>("/api/v1/workspace/current-draft", json("PUT", { draftId })),
  currentDraft: () => request<{ draftId: string | null }>("/api/v1/workspace/current-draft"),
  createBlank: (name = "未命名零部件模板") => request<Draft>("/api/v1/template-drafts/blank", json("POST", { name })),
  saveDraft: (draft: Draft) => request<Draft>(`/api/v1/template-drafts/${draft.id}`, json("PUT", draft)),
  duplicateDraft: (id: string) => request<Draft>(`/api/v1/template-drafts/${id}/duplicate`, json("POST")),
  archiveDraft: (id: string) => request<void>(`/api/v1/template-drafts/${id}`, { method: "DELETE" }),
  revisions: (id: string) => request<RevisionEntry[]>(`/api/v1/template-drafts/${id}/revisions`),
  restoreRevision: (id: string, revision: number) => request<Draft>(`/api/v1/template-drafts/${id}/revisions/${revision}/restore`, json("POST")),
  validateStage: (id: string, stage: StageName, signal?: AbortSignal) => request<StageValidation>(`/api/v1/template-drafts/${id}/stages/${stage}/validate`, signal ? { signal } : undefined),
  completeStage: (id: string, stage: StageName, baseRevision: number, signal?: AbortSignal) => request<StageActionResult>(`/api/v1/template-drafts/${id}/stages/${stage}/complete`, { ...json("POST", { baseRevision }), signal }),
  materials: (search = "", draftId?: string) => request<Material[]>(`/api/v1/materials?search=${encodeURIComponent(search)}&limit=100${draftId ? `&draft_id=${encodeURIComponent(draftId)}` : ""}`),
  searchMaterials: (search: string, requirement: MaterialRequirement) => request<Material[]>("/api/v1/materials/search", json("POST", { search, limit: 100, requirement })),
  solveSketch: (draft: Draft, overrides: Record<string, number> = {}) => request<SketchSolveResult>("/api/v1/sketches/solve", json("POST", { draft, overrides })),
  previewSketchEdit: (id: string, baseRevision: number, changes: Record<string, unknown>) => request<Record<string, unknown>>(`/api/v1/template-drafts/${id}/sketch/preview`, json("POST", { baseRevision, changes })),
  applySketchEdit: (id: string, baseRevision: number, changes: Record<string, unknown>, confirmed: boolean) => request<{ draft: Draft; solve: SketchSolveResult }>(`/api/v1/template-drafts/${id}/sketch/apply`, json("POST", { baseRevision, changes, confirmed })),
  bindMaterial: (sourceRecordId: string, mode: "reference" | "copy") => request<MaterialBinding>("/api/v1/material-bindings", json("POST", { sourceRecordId, mode })),
  previewMaterialBinding: (id: string, baseRevision: number, sourceRecordId: string, mode: "reference" | "copy" = "copy", role = "nominal") => request<Record<string, unknown>>(`/api/v1/template-drafts/${id}/material-binding/preview`, json("POST", { baseRevision, sourceRecordId, mode, role })),
  applyMaterialBinding: (id: string, baseRevision: number, sourceRecordId: string, mode: "reference" | "copy" = "copy", role = "nominal", confirmed = false) => request<{ draft: Draft; binding: MaterialBinding }>(`/api/v1/template-drafts/${id}/material-binding/apply`, json("POST", { baseRevision, sourceRecordId, mode, role, confirmed })),
  planTask: (id: string, task: "completeCurrentStage" | "fixCurrentErrors" | "prepareCadCompile" | "checkPublishReadiness") => request<Record<string, unknown>>(`/api/v1/template-drafts/${id}/assistant/tasks/plan`, json("POST", { task })),
  executeTask: (id: string, task: "completeCurrentStage" | "fixCurrentErrors" | "prepareCadCompile" | "checkPublishReadiness", baseRevision: number, confirmed: boolean, input: Record<string, unknown> = {}) => request<Record<string, unknown>>(`/api/v1/template-drafts/${id}/assistant/tasks/execute`, json("POST", { task, baseRevision, confirmed, input })),
  resolveMaterial: (id: string) => request<{ material: Material; provenance: { drifted: boolean; resolvedChecksum: string } }>(`/api/v1/material-bindings/${id}/resolved`),
  compile: (id: string, baseRevision: number) => request<CompileResult>(`/api/v1/template-drafts/${id}/compile`, json("POST", { baseRevision })),
  compilePreview: (draft: Draft, materialSnapshot: Record<string, unknown> = {}) =>
    request<CompileResult>("/api/v1/compile-preview", json("POST", { draft, materialSnapshot })),
  latestCompile: (id: string) => request<CompileResult | null>(`/api/v1/template-drafts/${id}/compile-runs/latest`),
  versions: (id: string) => request<PublishedVersion[]>(`/api/v1/template-drafts/${id}/versions`),
  publish: (id: string, baseRevision: number) => request<PublishResult>(`/api/v1/template-drafts/${id}/publish`, json("POST", { baseRevision })),
  evaluate: (id: string, input: EvaluationRequest) => request<TemplateEvaluation>(`/api/v1/template-drafts/${id}/evaluate`, json("POST", input)),
  uploadAttachment: (id: string, file: File, kind: string) => request<Draft>(`/api/v1/template-drafts/${id}/attachments?filename=${encodeURIComponent(file.name)}&kind=${encodeURIComponent(kind)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }),
  updateAttachment: (id: string, attachmentId: string, input: { description: string; kind?: string }) => request<Draft>(`/api/v1/template-drafts/${id}/attachments/${attachmentId}`, json("PATCH", input)),
  removeAttachment: (id: string, attachmentId: string) => request<Draft>(`/api/v1/template-drafts/${id}/attachments/${attachmentId}`, { method: "DELETE" }),
  sourcePackageUrl: (id: string) => `/api/v1/template-drafts/${id}/source-package`,
};

export { ApiError };
