import type {
  CompileResult,
  Draft,
  EvaluationRequest,
  Material,
  MaterialBinding,
  MaterialRequirement,
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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
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
  setCurrentDraft: (draftId: string) => request<{ draftId: string }>("/api/v1/workspace/current-draft", json("PUT", { draftId })),
  currentDraft: () => request<{ draftId: string | null }>("/api/v1/workspace/current-draft"),
  createBlank: (name = "未命名零部件模板") => request<Draft>("/api/v1/template-drafts/blank", json("POST", { name })),
  saveDraft: (draft: Draft) => request<Draft>(`/api/v1/template-drafts/${draft.id}`, json("PUT", draft)),
  duplicateDraft: (id: string) => request<Draft>(`/api/v1/template-drafts/${id}/duplicate`, json("POST")),
  archiveDraft: (id: string) => request<void>(`/api/v1/template-drafts/${id}`, { method: "DELETE" }),
  revisions: (id: string) => request<RevisionEntry[]>(`/api/v1/template-drafts/${id}/revisions`),
  restoreRevision: (id: string, revision: number) => request<Draft>(`/api/v1/template-drafts/${id}/revisions/${revision}/restore`, json("POST")),
  validateStage: (id: string, stage: StageName) => request<StageValidation>(`/api/v1/template-drafts/${id}/stages/${stage}/validate`),
  completeStage: (id: string, stage: StageName) => request<StageActionResult>(`/api/v1/template-drafts/${id}/stages/${stage}/complete`, json("POST")),
  materials: (search = "", draftId?: string) => request<Material[]>(`/api/v1/materials?search=${encodeURIComponent(search)}&limit=100${draftId ? `&draft_id=${encodeURIComponent(draftId)}` : ""}`),
  searchMaterials: (search: string, requirement: MaterialRequirement) => request<Material[]>("/api/v1/materials/search", json("POST", { search, limit: 100, requirement })),
  solveSketch: (draft: Draft, overrides: Record<string, number> = {}) => request<SketchSolveResult>("/api/v1/sketches/solve", json("POST", { draft, overrides })),
  bindMaterial: (sourceRecordId: string, mode: "reference" | "copy") => request<MaterialBinding>("/api/v1/material-bindings", json("POST", { sourceRecordId, mode })),
  resolveMaterial: (id: string) => request<{ material: Material; provenance: { drifted: boolean; resolvedChecksum: string } }>(`/api/v1/material-bindings/${id}/resolved`),
  compile: (id: string) => request<CompileResult>(`/api/v1/template-drafts/${id}/compile`, json("POST")),
  latestCompile: (id: string) => request<CompileResult | null>(`/api/v1/template-drafts/${id}/compile-runs/latest`),
  versions: (id: string) => request<PublishedVersion[]>(`/api/v1/template-drafts/${id}/versions`),
  publish: (id: string) => request<PublishResult>(`/api/v1/template-drafts/${id}/publish`, json("POST")),
  evaluate: (id: string, input: EvaluationRequest) => request<TemplateEvaluation>(`/api/v1/template-drafts/${id}/evaluate`, json("POST", input)),
  uploadAttachment: (id: string, file: File, kind: string) => request<Draft>(`/api/v1/template-drafts/${id}/attachments?filename=${encodeURIComponent(file.name)}&kind=${encodeURIComponent(kind)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }),
  updateAttachment: (id: string, attachmentId: string, input: { description: string; kind?: string }) => request<Draft>(`/api/v1/template-drafts/${id}/attachments/${attachmentId}`, json("PATCH", input)),
  removeAttachment: (id: string, attachmentId: string) => request<Draft>(`/api/v1/template-drafts/${id}/attachments/${attachmentId}`, { method: "DELETE" }),
  sourcePackageUrl: (id: string) => `/api/v1/template-drafts/${id}/source-package`,
};

export { ApiError };
