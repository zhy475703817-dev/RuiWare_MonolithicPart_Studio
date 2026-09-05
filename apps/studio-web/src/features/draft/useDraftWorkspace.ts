import { useEffect, useRef, useState } from "react";
import { api, ApiError, toErrorNotice, type ErrorNotice } from "../../api";
import { STAGES } from "../workflow/stageConfig";
import type {
  CompileResult,
  Draft,
  Material,
  MaterialValidationSample,
  PublishedVersion,
  StageName,
  StageValidation,
  TemplateAuthoringRegistry,
} from "../../types";

export function preservePreviousCompileArtifacts(previous: CompileResult | null, failed: CompileResult): CompileResult {
  return previous ? { ...failed, artifacts: previous.artifacts, metrics: previous.metrics } : failed;
}

export const DRAFT_SYNC_INTERVAL_MS = 3000;

export type DraftSyncConflict = {
  localRevision: number;
  remoteRevision: number;
  remoteDraft: Draft;
};

export function remoteDraftNeedsSync(local: Draft | null, remote: Draft): boolean {
  return !!local?.id && local.id === remote.id && remote.revision > local.revision;
}

/**
 * 管理模板工作台的跨阶段状态和动作。
 *
 * 页面组件只负责编辑和渲染，草稿加载、保存、阶段完成、材料绑定、
 * CAD 编译、发布以及统一错误提示都集中在这里，保持原有业务流程不变。
 */
export function useDraftWorkspace() {
  const initialized = useRef(false);
  const currentDraftSyncRef = useRef(Promise.resolve());
  const errorTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const dirtyRef = useRef(false);
  const compileRef = useRef<CompileResult | null>(null);
  const conflictRevisionRef = useRef<number | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stage, setStage] = useState<StageName>("templateInfo");
  const [validation, setValidation] = useState<StageValidation | null>(null);
  const [compile, setCompile] = useState<CompileResult | null>(null);
  const [compileStatus, setCompileStatus] = useState<"idle" | "generating" | "succeeded" | "failed">("idle");
  const [compileStale, setCompileStale] = useState(false);
  const [versions, setVersions] = useState<PublishedVersion[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [registry, setRegistry] = useState<TemplateAuthoringRegistry | null>(null);
  const [materialSearch, setMaterialSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<ErrorNotice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ErrorNotice | null>(null);
  const [syncConflict, setSyncConflict] = useState<DraftSyncConflict | null>(null);

  useEffect(() => {
    draftRef.current = draft;
    dirtyRef.current = dirty;
    compileRef.current = compile;
  }, [draft, dirty, compile]);

  function showError(errorValue: unknown) {
    setError(toErrorNotice(errorValue));
    if (errorTimerRef.current != null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => {
      setError(null);
      errorTimerRef.current = null;
    }, 9000);
  }

  function chooseDraft(item: Draft) {
    setDraft(structuredClone(item));
    setSyncConflict(null);
    conflictRevisionRef.current = null;
    setDirty(false);
    setValidation(null);
    setCompile(null);
    setCompileStatus("idle");
    setCompileStale(false);
    setVersions([]);
    const next = STAGES.find((itemStage) => item.stageStatus[itemStage.id] !== "complete");
    setStage(next?.id || "variants");
    if (item.id) {
      currentDraftSyncRef.current = currentDraftSyncRef.current
        .catch(() => undefined)
        .then(() => api.setCurrentDraft(item.id!))
        .then(() => undefined)
        .catch(showError);
      void api.latestCompile(item.id).then(setCompile).catch(showError);
      void api.versions(item.id).then(setVersions).catch(showError);
    }
  }

  async function loadDrafts(selectId?: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await api.drafts();
      let currentDraftId: string | null = null;
      try {
        currentDraftId = (await api.currentDraft()).draftId;
      } catch {
        // 工作区状态接口不可用时，仍然使用草稿列表恢复工作台。
      }
      setDrafts(rows);
      const selected =
        rows.find((item) => item.id === selectId) ||
        rows.find((item) => item.id === currentDraftId) ||
        rows[0] ||
        (await api.createBlank("Ω型立柱模板"));
      if (!rows.length) setDrafts([selected]);
      chooseDraft(selected);
    } catch (errorValue) {
      const nextError = toErrorNotice(errorValue);
      setLoadError(nextError);
    } finally {
      setLoading(false);
    }
  }

  function showNotice(message: string, duration = 2400) {
    setNotice(message);
    if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimerRef.current = null;
    }, duration);
  }

  function registerSyncConflict(remoteDraft: Draft) {
    const localDraft = draftRef.current;
    if (!localDraft || !remoteDraftNeedsSync(localDraft, remoteDraft)) return;
    if (conflictRevisionRef.current === remoteDraft.revision) return;
    conflictRevisionRef.current = remoteDraft.revision;
    setSyncConflict({
      localRevision: localDraft.revision,
      remoteRevision: remoteDraft.revision,
      remoteDraft: structuredClone(remoteDraft),
    });
    showNotice("Agent 已修改，请查看变更", 6000);
  }

  function applyRemoteDraft(remoteDraft: Draft) {
    setDraft(structuredClone(remoteDraft));
    setDrafts((items) => items.map((item) => (item.id === remoteDraft.id ? remoteDraft : item)));
    setDirty(false);
    setSyncConflict(null);
    conflictRevisionRef.current = null;
    setValidation(null);
    setCompileStale(!!compileRef.current);
    showNotice(`已同步 Agent 修改（R${remoteDraft.revision}）`);
  }

  async function syncCurrentDraft() {
    const localDraft = draftRef.current;
    if (!localDraft?.id) return;
    try {
      const remoteDraft = await api.draft(localDraft.id);
      if (!remoteDraftNeedsSync(localDraft, remoteDraft)) return;
      setDrafts((items) => items.map((item) => (item.id === remoteDraft.id ? remoteDraft : item)));
      if (dirtyRef.current) registerSyncConflict(remoteDraft);
      else applyRemoteDraft(remoteDraft);
    } catch (errorValue) {
      // A transient polling failure must not interrupt editing; the next tick retries.
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadDrafts();
    void api.templateAuthoringRegistry().then(setRegistry).catch(showError);
  }, []);

  useEffect(() => {
    if (!draft?.id) return;
    setValidation(null);
    if (stage === "material") {
      void api.materials(materialSearch, draft.id).then(setMaterials).catch(showError);
    }
    if (stage === "review") {
      void api.latestCompile(draft.id).then((result) => {
        setCompile(result);
        setCompileStatus(result ? (result.success ? "succeeded" : "failed") : "idle");
        setCompileStale(false);
      }).catch(showError);
    }
    if (stage === "admission") {
      void api.versions(draft.id).then(setVersions).catch(showError);
    }
  }, [stage, draft?.id]);

  useEffect(() => {
    if (!draft?.id) return;
    void syncCurrentDraft();
    const timer = window.setInterval(() => void syncCurrentDraft(), DRAFT_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [draft?.id]);

  useEffect(() => {
    if (stage !== "material" || !draft?.materialRequirements[0]) return;
    const timer = window.setTimeout(() => {
      void api
        .searchMaterials(materialSearch, draft.materialRequirements[0])
        .then(setMaterials)
        .catch(showError);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [stage, materialSearch, draft?.materialRequirements]);

  useEffect(
    () => () => {
      if (errorTimerRef.current != null) window.clearTimeout(errorTimerRef.current);
      if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  function change(next: Draft) {
    setDraft(next);
    setDirty(true);
    setValidation(null);
    if (compile) setCompileStale(true);
  }

  function resolveSyncConflict(action: "reload" | "dismiss") {
    if (!syncConflict) return;
    if (action === "reload") applyRemoteDraft(syncConflict.remoteDraft);
    else setSyncConflict(null);
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (draft) change({ ...draft, [key]: value });
  }

  async function save(current = draft) {
    if (!current?.id) return current;
    setBusy("save");
    try {
      const saved = await api.saveDraft(current);
      setDraft(saved);
      setDrafts((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      setDirty(false);
      setSyncConflict(null);
      conflictRevisionRef.current = null;
      showNotice("已保存为新修订");
      return saved;
    } catch (errorValue) {
      if (errorValue instanceof ApiError && errorValue.code === "DRAFT_REVISION_CONFLICT") {
        try {
          const remoteDraft = await api.draft(current.id);
          conflictRevisionRef.current = null;
          registerSyncConflict(remoteDraft);
        } catch {
          // Preserve the original structured conflict error when the refresh also fails.
        }
      }
      showError(errorValue);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function check() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("check");
    try {
      setValidation(await api.validateStage(saved.id, stage));
    } catch (errorValue) {
      showError(errorValue);
    } finally {
      setBusy("");
    }
  }

  async function completeStage() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("complete");
    try {
      const result = await api.completeStage(saved.id, stage);
      setDraft(result.draft);
      setDrafts((items) => items.map((item) => (item.id === result.draft.id ? result.draft : item)));
      setValidation(result.validation);
      if (result.validation.complete) {
        const index = STAGES.findIndex((item) => item.id === stage);
        if (index < STAGES.length - 1) setStage(STAGES[index + 1].id);
        showNotice("阶段检查通过", 2600);
      }
    } catch (errorValue) {
      showError(errorValue);
    } finally {
      setBusy("");
    }
  }

  async function createDraft() {
    setBusy("create");
    try {
      const created = await api.createBlank();
      setDrafts((items) => [created, ...items]);
      chooseDraft(created);
    } catch (errorValue) {
      showError(errorValue);
    } finally {
      setBusy("");
    }
  }

  async function duplicate() {
    if (!draft?.id) return;
    try {
      const duplicated = await api.duplicateDraft(draft.id);
      setDrafts((items) => [duplicated, ...items]);
      chooseDraft(duplicated);
    } catch (errorValue) {
      showError(errorValue);
    }
  }

  async function archive() {
    if (!draft?.id || !window.confirm(`归档“${draft.name}”？`)) return;
    try {
      await api.archiveDraft(draft.id);
      await loadDrafts();
    } catch (errorValue) {
      showError(errorValue);
    }
  }

  async function bindMaterial(
    material: Material,
    mode: "reference" | "copy",
    role: MaterialValidationSample["role"] = "nominal",
  ) {
    if (!draft) return;
    setBusy(`mat-${material.id}`);
    try {
      const binding = await api.bindMaterial(material.id, mode);
      const sample: MaterialValidationSample = {
        id: `material.${role}`,
        role,
        name: {
          minimum: "最小边界",
          nominal: "标称样例",
          maximum: "最大边界",
          special: "特殊工况",
        }[role],
        bindingId: binding.id,
        bindingMode: mode,
        materialCode: material.code,
        materialName: material.name,
        materialThickness: material.thickness,
        variantId: role === "minimum" ? "minimum" : role === "maximum" ? "maximum" : "nominal",
        requiredForAdmission: role === "nominal",
        reviewed: !!material.requirementMatch?.compatible,
      };
      const samples = [
        ...draft.materialValidationSamples.filter((item) => item.role !== role),
        sample,
      ];
      const requirements = draft.materialRequirements.map((requirement, index) =>
        index
          ? requirement
          : requirement.selectionMode === "specificRecord"
            ? { ...requirement, specificBindingId: binding.id, reviewed: true }
            : requirement,
      );
      change({ ...draft, materialValidationSamples: samples, materialRequirements: requirements });
      setNotice(`${material.code} 已加入${sample.name}`);
    } catch (errorValue) {
      showError(errorValue);
    } finally {
      setBusy("");
    }
  }

  async function runCompile() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("compile");
    setCompileStatus("generating");
    try {
      const result = await api.compile(saved.id);
      if (result.success) {
        setCompile(result);
        setCompileStale(false);
        setCompileStatus("succeeded");
      } else {
        setCompile((previous) => preservePreviousCompileArtifacts(previous, result));
        setCompileStatus("failed");
      }
      setValidation(await api.validateStage(saved.id, "review"));
      if (!result.success) showError(result.diagnostics.map((item) => item.message).join("；"));
    } catch (errorValue) {
      setCompileStatus("failed");
      showError(errorValue);
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("publish");
    try {
      const result = await api.publish(saved.id);
      setDraft(result.draft);
      setDrafts((items) => items.map((item) => (item.id === result.draft.id ? result.draft : item)));
      setVersions(await api.versions(saved.id));
      setNotice(`V${result.version.version} 已发布并冻结`);
    } catch (errorValue) {
      showError(errorValue);
    } finally {
      setBusy("");
    }
  }

  return {
    drafts,
    draft,
    loading,
    loadError,
    stage,
    validation,
    compile,
    compileStatus,
    compileStale,
    versions,
    materials,
    registry,
    materialSearch,
    dirty,
    busy,
    notice,
    error,
    setStage,
    setMaterials,
    setMaterialSearch,
    setError,
    setNotice,
    syncConflict,
    resolveSyncConflict,
    chooseDraft,
    change,
    update,
    save,
    check,
    completeStage,
    createDraft,
    duplicate,
    archive,
    bindMaterial,
    runCompile,
    publish,
    showError,
    reload: loadDrafts,
  };
}
