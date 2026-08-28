import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api";
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

/** 前端统一展示的错误信息，避免页面组件直接解析 HTTP 响应。 */
export type ErrorNotice = {
  code: string;
  message: string;
  action?: string | null;
  fields: { path?: string; message: string; type?: string }[];
  traceId?: string;
};

/** 将 API、浏览器和未知异常转换成统一的页面提示结构。 */
function toErrorNotice(error: unknown): ErrorNotice {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      action: error.action,
      fields: error.fields,
      traceId: error.traceId,
    };
  }
  if (error instanceof Error) {
    return { code: "CLIENT_ERROR", message: error.message, fields: [] };
  }
  return { code: "CLIENT_ERROR", message: String(error), fields: [] };
}

/**
 * 管理模板工作台的跨阶段状态和动作。
 *
 * 页面组件只负责编辑和渲染，草稿加载、保存、阶段完成、材料绑定、
 * CAD 编译、发布以及统一错误提示都集中在这里，保持原有业务流程不变。
 */
export function useDraftWorkspace() {
  const initialized = useRef(false);
  const errorTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stage, setStage] = useState<StageName>("templateInfo");
  const [validation, setValidation] = useState<StageValidation | null>(null);
  const [compile, setCompile] = useState<CompileResult | null>(null);
  const [versions, setVersions] = useState<PublishedVersion[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [registry, setRegistry] = useState<TemplateAuthoringRegistry | null>(null);
  const [materialSearch, setMaterialSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<ErrorNotice | null>(null);

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
    setDirty(false);
    setValidation(null);
    setCompile(null);
    setVersions([]);
    const next = STAGES.find((itemStage) => item.stageStatus[itemStage.id] !== "complete");
    setStage(next?.id || "variants");
    if (item.id) {
      void api.latestCompile(item.id).then(setCompile).catch(showError);
      void api.versions(item.id).then(setVersions).catch(showError);
    }
  }

  async function loadDrafts(selectId?: string) {
    try {
      const rows = await api.drafts();
      setDrafts(rows);
      const selected =
        rows.find((item) => item.id === selectId) ||
        rows[0] ||
        (await api.createBlank("Ω型立柱模板"));
      if (!rows.length) setDrafts([selected]);
      chooseDraft(selected);
    } catch (errorValue) {
      showError(errorValue);
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
      void api.latestCompile(draft.id).then(setCompile).catch(showError);
    }
    if (stage === "admission") {
      void api.versions(draft.id).then(setVersions).catch(showError);
    }
  }, [stage, draft?.id]);

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
      setNotice("已保存为新修订");
      if (noticeTimerRef.current != null)
        window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice("");
        noticeTimerRef.current = null;
      }, 2400);
      return saved;
    } catch (errorValue) {
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
        setNotice("阶段检查通过");
        if (noticeTimerRef.current != null)
          window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => {
          setNotice("");
          noticeTimerRef.current = null;
        }, 2600);
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
    try {
      const result = await api.compile(saved.id);
      setCompile(result);
      setValidation(await api.validateStage(saved.id, "review"));
      if (!result.success) showError(result.diagnostics.map((item) => item.message).join("；"));
    } catch (errorValue) {
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
    stage,
    validation,
    compile,
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
  };
}
