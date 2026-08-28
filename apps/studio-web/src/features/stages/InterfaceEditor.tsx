import { ChevronDown, Link2, Plus, Trash2 } from "lucide-react";
import { Field, PanelTitle } from "../../components/ui/FormParts";
import type { Draft, PartInterface } from "../../types";

const uid = (prefix: string) => `${prefix}.${Date.now().toString(36)}`;

const csv = (value: string) =>
  value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);

type InterfaceEditorProps = {
  draft: Draft;
  change: (draft: Draft) => void;
};

export function InterfaceEditor({ draft, change }: InterfaceEditorProps) {
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
                    <small>选择本零件已定义的语义面；接口 ID 将稳定引用这些几何基准。</small>
                    <div className="face-binding-list">
                      {geometryRefs.map((face) => (
                        <label key={face.id} className="face-binding-option">
                          <input
                            type="checkbox"
                            checked={item.geometryRefs.includes(face.id)}
                            onChange={() =>
                              edit(index, {
                                geometryRefs: item.geometryRefs.includes(face.id)
                                  ? item.geometryRefs.filter(
                                      (faceId) => faceId !== face.id,
                                    )
                                  : [...item.geometryRefs, face.id],
                              })
                            }
                          />
                          <span>
                            <strong>{face.label}</strong>
                            <code>{face.id}</code>
                          </span>
                        </label>
                      ))}
                    </div>
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
    </div>
  );
}
