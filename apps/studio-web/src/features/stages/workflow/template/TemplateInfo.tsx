import { useState } from "react";
import { ArrowRight, Box, CheckCircle2, CircleAlert, ClipboardCheck, FileImage, Hammer, MessageSquareText, Trash2, Upload, Database, Layers3, Search } from "lucide-react";
import { api } from "../../../../api";
import { Field, NumberInput, PanelTitle } from "../../../../components/ui/FormParts";
import type { Draft, GeometryRecipe, MaterialValidationSample, TemplateAuthoringRegistry } from "../../../../types";

type TemplateInfoProps = {
  draft: Draft;
  change: (draft: Draft) => void;
  update: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  registry: TemplateAuthoringRegistry | null;
  showError: (error: unknown) => void;
  profileModeSketch: (profileMode: Draft["sketch"]["profileMode"], sketch: Draft["sketch"], semanticParameterIds: Partial<Record<"length" | "sectionWidth" | "sectionHeight" | "thickness", string>>) => Draft["sketch"];
  operatorDefaults: (operator: string) => Pick<GeometryRecipe["operations"][number], "arguments" | "argumentExpressions" | "sourceRefs">;
  semanticParameterIds: (draft: Draft) => Partial<Record<"length" | "sectionWidth" | "sectionHeight" | "thickness", string>>;
};

const csv = (value: string) => value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);

export function TemplateInfo({
  draft,
  change,
  update,
  registry,
  showError,
  profileModeSketch,
  operatorDefaults,
  semanticParameterIds,
}: TemplateInfoProps) {
  const [attachmentBusy, setAttachmentBusy] = useState("");
  const classification = draft.manufacturingClassification;
  const setClassification = (
    patch: Partial<Draft["manufacturingClassification"]>,
  ) =>
    change({
      ...draft,
      manufacturingClassification: {
        ...classification,
        ...patch,
        reviewed: false,
      },
    });
  const selectPrototype = (prototypeId: string) => {
    const prototype = registry?.geometryPrototypes.find(
      (item) => item.id === prototypeId,
    );
    if (!prototype) {
      update("geometryPrototypeId", prototypeId);
      return;
    }
    const first = draft.geometryRecipe.operations[0];
    const operator =
      prototype.operator === "sketch.centerline_thinwall_extrude"
        ? "sketch.region_extrude"
        : prototype.operator;
    const defaults = operatorDefaults(operator);
    const operation = first
      ? {
          ...first,
          operator,
          ...defaults,
        }
      : {
          id: "body.main",
          operator,
          ...defaults,
          conditionExpression: "True",
          semanticOutputs: ["part.body", "part.referenceFrame"],
        };
    const profileParameters = prototype.drivingParameters.filter(
      (id) => id !== "length" && id !== "height",
    );
    const sketch = {
      ...draft.sketch,
      profileMode:
        prototypeId === "prototype.closedProfile"
          ? ("multiRegion" as const)
          : prototypeId === "prototype.openThinWallProfile"
            ? ("centerlineThinWall" as const)
          : draft.sketch.profileMode,
      drivingParameters: profileParameters,
      constraintsReviewed: false,
    };
    change({
      ...draft,
      geometryPrototypeId: prototypeId,
      sketch:
        prototypeId === "prototype.closedProfile" ||
        prototypeId === "prototype.openThinWallProfile"
          ? profileModeSketch(
              sketch.profileMode,
              sketch,
              semanticParameterIds(draft),
            )
          : sketch,
      geometryRecipe: {
        ...draft.geometryRecipe,
        constructionMode:
          prototype.constructionMode as GeometryRecipe["constructionMode"],
        operations: [operation, ...draft.geometryRecipe.operations.slice(1)],
        reviewed: false,
      },
    });
  };
  return (
    <>
      <div className="panel">
        <PanelTitle
          icon={ClipboardCheck}
          title="模板身份"
          subtitle="编码和名称负责业务身份；制造分类与几何原型由受控注册表提供。"
          actions={
            <span className="registry-version">
              注册表 {registry?.version || "加载中"}
            </span>
          }
        />
        <div className="form-grid two">
          <Field label="模板编码">
            <input
              value={draft.code}
              onChange={(e) => update("code", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="模板名称">
            <input
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <Field label="负责人">
            <input
              value={draft.owner}
              onChange={(e) => update("owner", e.target.value)}
            />
          </Field>
          <Field label="组织">
            <input
              value={draft.organization}
              onChange={(e) => update("organization", e.target.value)}
            />
          </Field>
        </div>
        <Field label="检索标签" hint="使用逗号分隔，可包含业务叫法和制造分类">
          <input
            value={draft.tags.join(", ")}
            onChange={(e) => update("tags", csv(e.target.value))}
          />
        </Field>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Hammer}
          title="单体制造分类"
          subtitle="当前生成器只生成最终为一个连续实体的零部件；来源和制造工艺用于筛选算子与可制造性规则。"
        />
        <div className="scope-banner">
          <CheckCircle2 size={16} />
          <span>
            <strong>模板类型：单体零部件</strong>
            <small>
              一个毛坯经成形、去除材料和表面处理形成；焊接组合体和可拆装组件不在当前平台建模。
            </small>
          </span>
        </div>
        <div className="form-grid two">
          <Field label="零部件来源">
            <select
              value={classification.originId}
              onChange={(e) => setClassification({ originId: e.target.value })}
            >
              {registry?.origins
                .filter((x) => x.enabled)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="主成形工艺">
            <select
              value={classification.primaryProcessId}
              onChange={(e) =>
                setClassification({ primaryProcessId: e.target.value })
              }
            >
              {registry?.primaryProcesses
                .filter((x) => x.enabled)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="后续工序（可多选）">
          <div className="process-grid">
            {registry?.secondaryProcesses
              .filter((x) => x.enabled)
              .map((item) => (
                <label
                  className={
                    classification.secondaryProcessIds.includes(item.id)
                      ? "selected"
                      : ""
                  }
                  key={item.id}
                >
                  <input
                    type="checkbox"
                    checked={classification.secondaryProcessIds.includes(
                      item.id,
                    )}
                    onChange={(e) =>
                      setClassification({
                        secondaryProcessIds: e.target.checked
                          ? [...classification.secondaryProcessIds, item.id]
                          : classification.secondaryProcessIds.filter(
                              (id) => id !== item.id,
                            ),
                      })
                    }
                  />
                  {item.label}
                </label>
              ))}
          </div>
        </Field>
        <label className="confirm-box">
          <input
            type="checkbox"
            checked={classification.reviewed}
            onChange={(e) =>
              change({
                ...draft,
                manufacturingClassification: {
                  ...classification,
                  reviewed: e.target.checked,
                },
              })
            }
          />
          <span>
            <strong>制造分类与单体范围已由工程师确认</strong>
            <small>确认该模板不包含焊接子件、装配子件或多个独立实体。</small>
          </span>
        </label>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Box}
          title="初始几何原型"
          subtitle="原型只建立可编辑的初始草图和几何配方，不限制最终形状。"
        />
        <div className="prototype-grid">
          {registry?.geometryPrototypes
            .filter((x) => x.enabled)
            .map((item) => (
              <button
                key={item.id}
                className={
                  draft.geometryPrototypeId === item.id ? "active" : ""
                }
                onClick={() => selectPrototype(item.id)}
              >
                <div>
                  <strong>{item.label}</strong>
                  <span
                    className={`capability-badge ${item.implementationStatus}`}
                  >
                    {item.implementationStatus === "available"
                      ? "可直接编译"
                      : item.implementationStatus === "configurable"
                        ? "需配置配方"
                        : "规划中"}
                  </span>
                </div>
                <p>{item.description}</p>
                <code>{item.constructionMode}</code>
              </button>
            ))}
        </div>
        <div className="prototype-note">
          <CircleAlert size={14} />
          <span>
            切换原型会重置基体首个算子和草图驱动参数，但不会删除制造规则、接口或变体；完成详细建模后不建议再次切换。
          </span>
        </div>
      </div>
      <div className="panel">
        <PanelTitle
          icon={MessageSquareText}
          title="设计意图"
          subtitle="说明它是什么、用于哪里、必须保持什么；不在这里硬编码几何。"
        />
        <Field label="用途说明">
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </Field>
        <Field label="设计约束与可变范围">
          <textarea
            rows={5}
            value={draft.designIntent}
            onChange={(e) => update("designIntent", e.target.value)}
          />
        </Field>
      </div>
      <div className="panel">
        <PanelTitle
          icon={FileImage}
          title="证据与参考"
          subtitle="图片、图纸、标准和样件作为工程参考与追溯依据，不直接成为权威几何。"
        />
        <label className="upload-zone">
          <Upload />
          <strong>{attachmentBusy ? "正在上传证据…" : "添加多张图片、图纸或已有 CAD"}</strong>
          <span>可一次选择多个文件 · PNG / JPG / WEBP / PDF / DXF / STEP · 单文件不超过 20 MB</span>
          <input
            type="file"
            multiple
            disabled={!!attachmentBusy}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.currentTarget.value = "";
              if (!files.length || !draft.id) return;
              setAttachmentBusy(`0/${files.length}`);
              try {
                let saved = draft;
                for (let index = 0; index < files.length; index += 1) {
                  const file = files[index];
                  const image = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
                  saved = await api.uploadAttachment(draft.id, file, image ? "referenceImage" : "drawing");
                  setAttachmentBusy(`${index + 1}/${files.length}`);
                }
                change(saved);
              } catch (error) {
                showError(error);
              } finally {
                setAttachmentBusy("");
              }
            }}
          />
        </label>
        {!!draft.attachments.length && (
          <div className="evidence-summary">
            <strong>{draft.attachments.length} 项证据</strong>
            <span>为每项证据补充说明，便于工程复核与追溯</span>
          </div>
        )}
        {draft.attachments.map((a) => (
          <div className="asset-row evidence-asset" key={a.id}>
            <div className="evidence-preview">
              {a.mediaType.startsWith("image/") ? <img src={a.url} alt={a.description || a.filename} loading="lazy" /> : <FileImage />}
            </div>
            <div className="evidence-fields">
              <div className="evidence-file-heading"><strong>{a.filename}</strong><span>{(a.size / 1024).toFixed(1)} KB · {a.kind}</span></div>
              <label>图片／证据说明
                <textarea
                  rows={2}
                  value={a.description || ""}
                  placeholder="例如：主视图，已知总宽 90 mm；红框处为连接孔。"
                  onChange={(event) => change({...draft, attachments:draft.attachments.map((item) => item.id === a.id ? {...item,description:event.target.value} : item)})}
                  onBlur={async (event) => {
                    if (!draft.id) return;
                    try { change(await api.updateAttachment(draft.id, a.id, {description:event.target.value,kind:a.kind})); }
                    catch (error) { showError(error); }
                  }}
                />
              </label>
            </div>
            <button className="asset-delete" aria-label={`删除附件 ${a.filename}`}
              onClick={async () => {
                if (!draft.id) return;
                try { change(await api.removeAttachment(draft.id, a.id)); }
                catch (error) { showError(error); }
              }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}





