import { useEffect, useState } from "react";
import { ChevronDown, Link2, Plus, Trash2 } from "lucide-react";
import { api } from "../../../../api";
import { Field, PanelTitle } from "../../../../components/ui/FormParts";
import type { CompileResult, Draft, PartInterface, TemplateEvaluation } from "../../../../types";
import { InterfacePreview3D } from "./InterfacePreview3D";

const uid = (prefix: string) => `${prefix}.${Date.now().toString(36)}`;

const csv = (value: string) =>
  value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);

type InterfaceEditorProps = {
  draft: Draft;
  change: (draft: Draft) => void;
  save?: (draft?: Draft | null) => Promise<Draft | null | undefined>;
};

const defaultPlacement = (): NonNullable<PartInterface["region"]>["placement"] => ({
  mode: "single",
  axis: "v",
  pitchExpression: "100",
  startMarginExpression: "0",
  endMarginExpression: "0",
  maximumPitchExpression: "300",
});

const centeredRegionExpressions = (
  face?: Draft["geometryRecipe"]["semanticFaces"][number],
) => ({
  uStartExpression: face
    ? `(${face.uStartExpression}) + (${face.uSpanExpression}) / 2`
    : "0",
  vStartExpression: face
    ? `(${face.vStartExpression}) + (${face.vSpanExpression}) / 2`
    : "0",
  uSpanExpression: face ? `(${face.uSpanExpression}) / 2` : "100",
  vSpanExpression: face ? `(${face.vSpanExpression}) / 2` : "100",
});

function InterfaceRegionEditor({
  item,
  face,
  onChange,
}: {
  item: PartInterface;
  face?: Draft["geometryRecipe"]["semanticFaces"][number];
  onChange: (region: NonNullable<PartInterface["region"]>) => void;
}) {
  const defaultExpressions = centeredRegionExpressions(face);
  const region = item.region || {
    mode: "fullFace" as const,
    ...defaultExpressions,
    countExpression: "1",
    indexVariable: "i",
    placement: defaultPlacement(),
    maximumCount: 2000,
  };
  const setRegion = (patch: Partial<typeof region>) => onChange({ ...region, ...patch });
  const setPlacement = (patch: Partial<typeof region.placement>) =>
    setRegion({ placement: { ...region.placement, ...patch } });
  const expressionInput = (value: string, update: (value: string) => void) => (
    <code className="code-input"><input list="interface-parameter-options" value={value} onChange={(event) => update(event.target.value)} /></code>
  );
  return (
    <div className="interface-region-editor">
      <strong>区域</strong>
      <small>矩形区域使用语义面局部 U/V 表达式，可引用参数和 min、max、round、clamp 等函数。</small>
      <div className="form-grid four">
        <Field label="区域方式">
          <select value={region.mode} onChange={(event) => {
            const mode = event.target.value as "fullFace" | "rectangle";
            setRegion(mode === "rectangle" && region.mode !== "rectangle" ? {
              mode,
              ...defaultExpressions,
            } : { mode });
          }}>
            <option value="fullFace">整个几何面</option>
            <option value="rectangle">矩形区域</option>
          </select>
        </Field>
        {region.mode === "rectangle" && <>
          <Field label="U 中点表达式">{expressionInput(region.uStartExpression, (value) => setRegion({ uStartExpression: value }))}</Field>
          <Field label="V 中点表达式">{expressionInput(region.vStartExpression, (value) => setRegion({ vStartExpression: value }))}</Field>
          <Field label="U 尺寸表达式">{expressionInput(region.uSpanExpression, (value) => setRegion({ uSpanExpression: value }))}</Field>
          <Field label="V 尺寸表达式">{expressionInput(region.vSpanExpression, (value) => setRegion({ vSpanExpression: value }))}</Field>
        </>}
      </div>
      {region.mode === "rectangle" && <div className="interface-region-placement">
        <strong>布置规则</strong>
        <small>规则语义与制造特征一致；U/V 方向均以矩形中点为定位点，并保证矩形不超出语义面。</small>
        <div className="form-grid three">
          <Field label="布置方式">
            <select value={region.placement.mode} onChange={(event) => setPlacement({ mode: event.target.value as typeof region.placement.mode })}>
              <option value="single">单项</option>
              <option value="linearArray">线性阵列</option>
              <option value="equalSpan">两端均布</option>
              <option value="maxPitch">最大间距</option>
              <option value="symmetric">对称阵列</option>
            </select>
          </Field>
          <Field label="布置轴">
            <select value={region.placement.axis} onChange={(event) => setPlacement({ axis: event.target.value as "u" | "v" })}>
              <option value="u">U</option><option value="v">V</option>
            </select>
          </Field>
          <Field label={region.placement.mode === "maxPitch" ? "数量" : "数量表达式"}>
            <code className="code-input"><input list="interface-parameter-options" disabled={region.placement.mode === "single" || region.placement.mode === "maxPitch"} value={region.placement.mode === "single" ? "1" : region.placement.mode === "maxPitch" ? "自动计算" : region.countExpression} onChange={(event) => setRegion({ countExpression: event.target.value })} /></code>
          </Field>
        </div>
        {(region.placement.mode === "linearArray" || region.placement.mode === "symmetric") && <div className="form-grid two placement-margins">
          {region.placement.mode === "linearArray" && <Field label="首项距起始端">{expressionInput(region.placement.startMarginExpression, (value) => setPlacement({ startMarginExpression: value }))}</Field>}
          <Field label="相邻间距表达式">{expressionInput(region.placement.pitchExpression, (value) => setPlacement({ pitchExpression: value }))}</Field>
        </div>}
        {region.placement.mode === "equalSpan" && <div className="form-grid two placement-margins">
          <Field label="首项距起始端">{expressionInput(region.placement.startMarginExpression, (value) => setPlacement({ startMarginExpression: value }))}</Field>
          <Field label="末项距终止端">{expressionInput(region.placement.endMarginExpression, (value) => setPlacement({ endMarginExpression: value }))}</Field>
        </div>}
        {region.placement.mode === "maxPitch" && <div className="form-grid three placement-margins">
          <Field label="首项距起始端">{expressionInput(region.placement.startMarginExpression, (value) => setPlacement({ startMarginExpression: value }))}</Field>
          <Field label="末项距终止端">{expressionInput(region.placement.endMarginExpression, (value) => setPlacement({ endMarginExpression: value }))}</Field>
          <Field label="最大间距表达式">{expressionInput(region.placement.maximumPitchExpression, (value) => setPlacement({ maximumPitchExpression: value }))}</Field>
        </div>}
      </div>}
    </div>
  );
}

export function InterfaceEditor({ draft, change, save }: InterfaceEditorProps) {
  const [preview, setPreview] = useState<CompileResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewEvaluation, setPreviewEvaluation] = useState<TemplateEvaluation | null>(null);
  const setItems = (interfaces: PartInterface[]) =>
    change({ ...draft, interfaces });
  const geometryRefs = draft.geometryRecipe.semanticFaces;
  const interfaceTypeLabels: Record<PartInterface["interfaceType"], string> = {
    locating: "定位",
    connecting: "连接",
    supporting: "支承",
    adjustable: "可调",
    processDatum: "工艺基准",
    other: "其他",
  };
  const edit = (index: number, patch: Partial<PartInterface>) =>
    setItems(
      draft.interfaces.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const add = () =>
    setItems([
      ...draft.interfaces,
      {
        id: uid("interface"),
        name: "新定位接口",
        declarationMode: "staticGeometry",
        sourceFeatureRuleId: null,
        interfaceType: "locating",
        locatingType: "planeContact",
        role: "primary",
        geometryRefs: geometryRefs[0] ? [geometryRefs[0].id] : [],
        referenceFrame: { originRef: geometryRefs[0]?.id || null, axis: "z" },
        parameterRefs: [],
        compatibilityTags: [],
        description: "",
        required: true,
        reviewed: false,
      },
    ]);
  const refreshPreview = async () => {
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const sample = draft.materialValidationSamples.find((item) => item.role === "nominal") || draft.materialValidationSamples[0];
      const materialSnapshot = { record: { code: sample?.materialCode || "preview", name: sample?.materialName || "预览材料", thickness: sample?.materialThickness }, provenance: { source: "interface-preview" } };
      const source = save ? await save(draft) : draft;
      if (!source) return;
      const result = await api.compilePreview(source, materialSnapshot);
      setPreview(result);
      if (source.id) setPreviewEvaluation(await api.evaluate(source.id, { overrides: {} }));
      if (!result.success) setPreviewError(result.diagnostics.map((item) => item.message).join("；") || "B-Rep 预览未通过");
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "预览生成失败");
    } finally {
      setPreviewBusy(false);
    }
  };
  useEffect(() => { setPreview(null); setPreviewError(""); }, [draft.id]);
  return (
    <div className="panel">
      <PanelTitle
        icon={Link2}
        title="零部件接口"
        subtitle="在单零部件模板中声明可用于未来装配的稳定几何基准；此处不定义配对关系、另一零件或装配偏移。"
        actions={
          <button className="mini-btn" onClick={add}>
            <Plus size={14} />
            新增接口
          </button>
        }
      />
      <datalist id="interface-parameter-options">
        {draft.parameterDefinitions.map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label}</option>)}
      </datalist>
      {draft.interfaces.length === 0 ? (
        <div className="empty-note tall">当前模板尚未声明装配接口</div>
      ) : (
        <div className="interface-list">
          {draft.interfaces.map((item, index) => (
            <details className="interface-card" key={`${item.id}-${index}`} open>
              <summary>
                <div>
                  <strong>{item.name}</strong>
                  <code>{item.id}</code>
                </div>
                <span>
                  {item.declarationMode === "featureDerived"
                    ? "特征派生 · "
                    : "静态几何 · "}
                  {interfaceTypeLabels[item.interfaceType]}
                </span>
                <ChevronDown size={15} />
              </summary>
              <div className="interface-body">
                <div className="interface-declaration-note">
                  <strong>接口声明</strong>
                  <span>
                    描述本零件提供什么装配基准及其参数；真正的“谁与谁配对”留给未来的组件装配层。
                  </span>
                </div>
                <div className="form-grid three">
                  <Field label="接口名称">
                    <input
                      value={item.name}
                      onChange={(event) =>
                        edit(index, { name: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="接口类型">
                    <select
                      value={item.interfaceType}
                      onChange={(event) =>
                        edit(index, {
                          interfaceType: event.target
                            .value as PartInterface["interfaceType"],
                          locatingType:
                            event.target.value === "locating"
                              ? item.locatingType || "planeContact"
                              : null,
                          role:
                            event.target.value === "locating"
                              ? item.role || "primary"
                              : null,
                        })
                      }
                    >
                      {Object.entries(interfaceTypeLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="声明方式" hint="特征派生会跟随制造特征规则自动增减实例。">
                    <select
                      value={item.declarationMode}
                      onChange={(event) => {
                        const declarationMode = event.target.value as PartInterface["declarationMode"];
                        edit(index, {
                          declarationMode,
                          sourceFeatureRuleId:
                            declarationMode === "featureDerived"
                              ? draft.featureRules[0]?.id || null
                              : null,
                        });
                      }}
                    >
                      <option value="staticGeometry">静态几何</option>
                      <option value="featureDerived">制造特征派生</option>
                    </select>
                  </Field>
                  {item.declarationMode === "featureDerived" ? (
                    <Field label="来源制造特征规则" hint="每个解析出的孔或切口都会生成一个接口实例。">
                      <select
                        value={item.sourceFeatureRuleId || ""}
                        onChange={(event) =>
                          edit(index, {
                            sourceFeatureRuleId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">请选择制造特征规则</option>
                        {draft.featureRules.map((rule) => (
                          <option key={rule.id} value={rule.id}>
                            {rule.name} · {rule.id}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field label="参考轴">
                      <select
                        value={item.referenceFrame.axis}
                        onChange={(event) =>
                          edit(index, {
                            referenceFrame: {
                              ...item.referenceFrame,
                              axis: event.target
                                .value as PartInterface["referenceFrame"]["axis"],
                            },
                          })
                        }
                      >
                        <option value="x">X</option>
                        <option value="y">Y</option>
                        <option value="z">Z</option>
                        <option value="-x">-X</option>
                        <option value="-y">-Y</option>
                        <option value="-z">-Z</option>
                      </select>
                    </Field>
                  )}
                  {item.interfaceType === "locating" && (
                    <>
                      <Field label="定位方式">
                        <select
                          value={item.locatingType || "planeContact"}
                          onChange={(event) =>
                            edit(index, {
                              locatingType: event.target
                                .value as NonNullable<PartInterface["locatingType"]>,
                            })
                          }
                        >
                          <option value="planeContact">面贴合</option>
                          <option value="axisCoincident">轴线同轴</option>
                          <option value="pinHole">销孔定位</option>
                          <option value="edgeStop">边／止挡</option>
                          <option value="slotAdjustable">槽孔可调</option>
                          <option value="keyedAntiError">键位防错</option>
                        </select>
                      </Field>
                      <Field label="定位角色" hint="主、次、第三用于表达本零件内部的定位层次。">
                        <select
                          value={item.role || "primary"}
                          onChange={(event) =>
                            edit(index, {
                              role: event.target.value as NonNullable<PartInterface["role"]>,
                            })
                          }
                        >
                          <option value="primary">主定位</option>
                          <option value="secondary">次定位</option>
                          <option value="tertiary">第三定位</option>
                        </select>
                      </Field>
                      {item.locatingType === "planeContact" && (
                        <InterfaceRegionEditor
                          item={item}
                          face={geometryRefs.find((face) => item.geometryRefs.includes(face.id))}
                          onChange={(region) => edit(index, { region })}
                        />
                      )}
                    </>
                  )}
                  {item.declarationMode === "staticGeometry" ? (
                    <Field
                      label="参考原点"
                      hint="选取本零件的语义几何作为接口局部坐标的原点。"
                    >
                      <select
                        value={item.referenceFrame.originRef || ""}
                        onChange={(event) =>
                          edit(index, {
                            referenceFrame: {
                              ...item.referenceFrame,
                              originRef: event.target.value || null,
                            },
                          })
                        }
                      >
                        <option value="">未指定</option>
                        {geometryRefs.map((face) => (
                          <option key={face.id} value={face.id}>
                            {face.label} · {face.id}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <Field label="兼容标签" hint="仅用于将来筛选候选接口，不是配对接口 ID。">
                    <input
                      value={item.compatibilityTags.join(", ")}
                      onChange={(event) =>
                        edit(index, {
                          compatibilityTags: csv(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="相关参数" hint="选择控制接口尺寸、孔距、间隙等的本零件参数。">
                    <select
                      multiple
                      value={item.parameterRefs}
                      onChange={(event) =>
                        edit(index, {
                          parameterRefs: Array.from(
                            event.target.selectedOptions,
                            (option) => option.value,
                          ),
                        })
                      }
                    >
                      {draft.parameterDefinitions.map((parameter) => (
                        <option key={parameter.id} value={parameter.id}>
                          {parameter.label} · {parameter.id}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {item.declarationMode === "featureDerived" ? (
                  <div className="feature-derived-interface-note">
                    <strong>继承制造特征</strong>
                    <span>
                      接口实例的数量、所在语义面、孔／切口位置和尺寸均由所选制造特征规则决定；修改长度、间距或端距参数后，接口实例会同步重新解析。
                    </span>
                  </div>
                ) : (
                  <div className="interface-geometry-refs">
                    <strong>关联几何</strong>
                    <small>选择一个本零件已定义的语义面；接口 ID 将稳定引用该几何基准。</small>
                    <select
                      value={item.geometryRefs.length === 1 ? item.geometryRefs[0] : ""}
                      onChange={(event) => {
                        const face = geometryRefs.find(({ id }) => id === event.target.value);
                        edit(index, {
                          geometryRefs: face ? [face.id] : [],
                          ...(item.region?.mode === "rectangle"
                            ? { region: { ...item.region, ...centeredRegionExpressions(face) } }
                            : {}),
                        });
                      }}
                    >
                      <option value="">未选择</option>
                      {geometryRefs.map((face) => (
                        <option key={face.id} value={face.id}>
                          {face.label} · {face.id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <Field label="接口说明">
                  <textarea
                    rows={2}
                    value={item.description}
                    onChange={(event) =>
                      edit(index, { description: event.target.value })
                    }
                  />
                </Field>
                <div className="inline-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={item.required}
                      onChange={(event) =>
                        edit(index, { required: event.target.checked })
                      }
                    />
                    关键接口
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.reviewed}
                      onChange={(event) =>
                        edit(index, { reviewed: event.target.checked })
                      }
                    />
                    工程师已复核
                  </label>
                  <button
                    className="danger-text"
                    onClick={() =>
                      setItems(draft.interfaces.filter((_, currentIndex) => currentIndex !== index))
                    }
                  >
                    <Trash2 size={13} />
                    删除接口
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
      <InterfacePreview3D draft={draft} result={preview} evaluation={previewEvaluation} busy={previewBusy} error={previewError} onRefresh={() => void refreshPreview()} />
    </div>
  );
}




