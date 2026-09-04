import {
  ArrowRight,
  Beaker,
  Box,
  CircleDot,
  ClipboardCheck,
  GitBranch,
  Layers3,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Variable,
} from "lucide-react";
import { api } from "./api";
import { WorkspaceShell } from "./components/layout/WorkspaceShell";
import { CheckList } from "./components/ui/FormParts";
import { useDraftWorkspace } from "./features/draft/useDraftWorkspace";
import { GeometryStage, operatorDefaults, profileModeSketch } from "./features/stages/geometry";
import { MaterialStage } from "./features/stages/material/MaterialStage";
import { AdmissionStage } from "./features/stages/review/admission/AdmissionStage";
import { ReviewStage } from "./features/stages/review/compile/ReviewStage";
import { ContractStage } from "./features/stages/contract/ContractStage";
import { RulesStage } from "./features/stages/rules/RulesStage";
import { TemplateInfo } from "./features/stages/workflow/template/TemplateInfo";
import { semanticParameterIds } from "./features/authoring/authoringUtils";
import type { StageName } from "./types";
const STAGES: {
  id: StageName;
  number: string;
  title: string;
  caption: string;
  icon: typeof Box;
}[] = [
  {
    id: "templateInfo",
    number: "01",
    title: "定义",
    caption: "需求与证据",
    icon: ClipboardCheck,
  },
  {
    id: "material",
    number: "02",
    title: "材料",
    caption: "适用范围、毛坯与验证",
    icon: Layers3,
  },
  {
    id: "baseSketch",
    number: "03",
    title: "几何",
    caption: "配方与基准",
    icon: Box,
  },
  {
    id: "features",
    number: "04",
    title: "规则",
    caption: "制造特征生成",
    icon: GitBranch,
  },
  {
    id: "variants",
    number: "05",
    title: "契约",
    caption: "参数、接口与变体",
    icon: Variable,
  },
  {
    id: "review",
    number: "06",
    title: "验证",
    caption: "求值与 B-Rep",
    icon: Beaker,
  },
  {
    id: "admission",
    number: "07",
    title: "发布",
    caption: "准入与版本",
    icon: PackageCheck,
  },
];

export default function App() {
  const {
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
    reload,
  } = useDraftWorkspace();
  if (!draft)
    return (
      <div className="loading-screen">
        {loading ? (
          <>
            <LoaderCircle className="spin" />
            正在载入单体零部件模板平台…
          </>
        ) : (
          <>
            <p>{loadError?.message || "零部件数据加载失败"}</p>
            <button className="primary-btn" onClick={() => void reload()}>
              <RefreshCw size={15} />
              重新加载
            </button>
          </>
        )}
      </div>
    );
  const stageIndex = STAGES.findIndex((x) => x.id === stage);
  const completeCount = Object.values(draft.stageStatus).filter(
    (x) => x === "complete",
  ).length;
  const overall = Math.round((completeCount / 7) * 100);
  const currentStage = STAGES[stageIndex];
  return (
    <WorkspaceShell
      draft={draft}
      drafts={drafts}
      stage={stage}
      overall={overall}
      completeCount={completeCount}
      busy={busy}
      dirty={dirty}
      notice={notice}
      error={error}
      onSelectDraft={(draftId) => {
        const selected = drafts.find((item) => item.id === draftId);
        if (selected) chooseDraft(selected);
      }}
      onSelectStage={setStage}
      onCreateDraft={createDraft}
      onDuplicateDraft={duplicate}
      onArchiveDraft={archive}
      onSave={() => void save()}
      onDismissToast={() => {
        setError(null);
        setNotice("");
      }}
      sourcePackageUrl={api.sourcePackageUrl(draft.id!)}
    >
        <div className="stage-heading">
          <div>
            <span>工作流 {currentStage.number} / 07</span>
            <h1>{currentStage.title}</h1>
            <p>
              {currentStage.caption} · 修改会形成新修订，下游验证结果可重新执行
            </p>
          </div>
          <div className="heading-actions">
            <button className="secondary-btn" disabled={!!busy} onClick={check}>
              <RefreshCw size={15} />
              阶段检查
            </button>
            {stage !== "review" && stage !== "admission" && (
              <button
                className="primary-btn"
                disabled={!!busy}
                onClick={completeStage}
              >
                检查并继续
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="context-strip">
          <span className="context-code">{draft.code}</span>
          <span>
            {registry?.primaryProcesses.find(
              (x) =>
                x.id === draft.manufacturingClassification.primaryProcessId,
            )?.label || "未分类"}
          </span>
          <span>
            {registry?.geometryPrototypes.find(
              (x) => x.id === draft.geometryPrototypeId,
            )?.label || "自定义几何"}
          </span>
          <span>{draft.parameterDefinitions.length} 个参数</span>
          <span>{draft.featureRules.length} 条规则</span>
          <span>{draft.interfaces.length} 个接口</span>
          {dirty && <em>有未保存修改</em>}
        </div>

        <div className="work-grid">
          <section className="stage-content">
            {stage === "templateInfo" && (
              <TemplateInfo
                draft={draft}
                change={change}
                update={update}
                registry={registry}
                showError={showError}
                profileModeSketch={profileModeSketch}
                operatorDefaults={operatorDefaults}
                semanticParameterIds={semanticParameterIds}
              />
            )}
            {stage === "material" && (
              <MaterialStage
                draft={draft}
                change={change}
                materials={materials}
                search={materialSearch}
                setSearch={setMaterialSearch}
                runSearch={() =>
                  api
                    .searchMaterials(
                      materialSearch,
                      draft.materialRequirements[0],
                    )
                    .then(setMaterials)
                    .catch(showError)
                }
                bind={bindMaterial}
                busy={busy}
              />
            )}
            {stage === "baseSketch" && (
              <GeometryStage draft={draft} change={change} showError={showError} />
            )}
            {stage === "features" && (
              <RulesStage draft={draft} change={change} />
            )}
            {stage === "variants" && (
              <ContractStage
                draft={draft}
                change={change}
                save={save}
                dirty={dirty}
                showError={showError}
              />
            )}
            {stage === "review" && (
              <ReviewStage
                result={compile}
                run={runCompile}
                busy={busy}
                complete={completeStage}
                draft={draft}
                compileStatus={compileStatus}
                compileStale={compileStale}
              />
            )}
            {stage === "admission" && (
              <AdmissionStage
                draft={draft}
                change={change}
                validation={validation}
                versions={versions}
                publish={publish}
                busy={busy}
              />
            )}
          </section>
          <aside className="inspector">
            <div className="inspector-card">
              <div className="card-title">
                <CircleDot size={16} />
                <strong>阶段准入</strong>
                {validation && <span>{validation.progress}%</span>}
              </div>
              <CheckList validation={validation} />
            </div>
          </aside>
        </div>
    </WorkspaceShell>
  );
}


