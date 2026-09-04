import { useEffect, useState } from "react";
import { ArrowRight, Beaker, Database, Layers3, Search } from "lucide-react";
import { Field, NumberInput, PanelTitle } from "../../../components/ui/FormParts";
import type {
  Draft,
  Material,
  MaterialRequirement,
  MaterialValidationSample,
} from "../../../types";

const csv = (value: string) =>
  value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export function MaterialStage({
  draft,
  change,
  materials,
  search,
  setSearch,
  runSearch,
  bind,
  busy,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  materials: Material[];
  search: string;
  setSearch: (s: string) => void;
  runSearch: () => void;
  bind: (
    m: Material,
    mode: "reference" | "copy",
    role: MaterialValidationSample["role"],
  ) => void;
  busy: string;
}) {
  const [targetRole, setTargetRole] =
    useState<MaterialValidationSample["role"]>("nominal");
  const [onlyCompatible, setOnlyCompatible] = useState(true);
  const req =
    draft.materialRequirements[0] ||
    ({
      id: "material.main",
      selectionMode: "family",
      supplyForm: "coil",
      familyTags: [],
      allowedGrades: [],
      standards: [],
      surfaces: [],
      thickness: { parameterId: "thickness", allowedValues: [] },
      requiredProperties: {},
      allowInstanceSubstitution: true,
      reviewed: false,
    } satisfies MaterialRequirement);
  const [allowedThicknessText, setAllowedThicknessText] = useState(
    req.thickness.allowedValues.join(", "),
  );
  useEffect(
    () => setAllowedThicknessText(req.thickness.allowedValues.join(", ")),
    [draft.id, req.thickness.allowedValues.join("|")],
  );
  const domainFor = (requirement: MaterialRequirement) => {
    const declared = [...new Set(requirement.thickness.allowedValues)].sort(
      (a, b) => a - b,
    );
    const reversed =
      requirement.thickness.minimum != null &&
      requirement.thickness.maximum != null &&
      requirement.thickness.minimum > requirement.thickness.maximum;
    const values = declared.filter(
      (value) =>
        (requirement.thickness.minimum == null ||
          value >= requirement.thickness.minimum) &&
        (requirement.thickness.maximum == null ||
          value <= requirement.thickness.maximum),
    );
    return {
      values,
      empty: reversed || (declared.length > 0 && values.length === 0),
      minimum: values.length ? values[0] : requirement.thickness.minimum,
      maximum: values.length
        ? (values.at(-1) ?? null)
        : requirement.thickness.maximum,
    };
  };
  const setReq = (patch: Partial<MaterialRequirement>) => {
    const next = { ...req, ...patch };
    const domain = domainFor(next);
    const parameterId = next.thickness.parameterId;
    const parameterDefinitions = draft.parameterDefinitions.map((item) =>
      item.id !== parameterId
        ? item
        : {
            ...item,
            source: "material" as const,
            sourceDefinition: {
              type: "materialProperty" as const,
              reference: "material.thickness",
              dependencies: [],
              lookupTable: {},
              fallback: item.default,
            },
            minimum: domain.minimum,
            maximum: domain.maximum,
            allowedValues: domain.values,
          },
    );
    const invalidatesSamples = Object.keys(patch).some(
      (key) => key !== "reviewed",
    );
    change({
      ...draft,
      materialRequirements: [next, ...draft.materialRequirements.slice(1)],
      parameterDefinitions,
      materialValidationSamples: invalidatesSamples
        ? draft.materialValidationSamples.map((item) => ({
            ...item,
            reviewed: false,
          }))
        : draft.materialValidationSamples,
    });
  };
  const setMode = (selectionMode: MaterialRequirement["selectionMode"]) =>
    setReq({
      selectionMode,
      familyTags: selectionMode === "category" ? [] : req.familyTags,
      allowedGrades: selectionMode === "category" ? [] : req.allowedGrades,
      standards: selectionMode === "category" ? [] : req.standards,
      surfaces: selectionMode === "category" ? [] : req.surfaces,
      specificBindingId: null,
      allowInstanceSubstitution: selectionMode !== "specificRecord",
      reviewed: false,
    });
  const setBlank = (patch: Partial<Draft["blank"]>) =>
    change({ ...draft, blank: { ...draft.blank, ...patch } });
  const setSamples = (materialValidationSamples: MaterialValidationSample[]) =>
    change({ ...draft, materialValidationSamples });
  const editSample = (id: string, patch: Partial<MaterialValidationSample>) =>
    setSamples(
      draft.materialValidationSamples.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    );
  const familyMode = req.selectionMode !== "category";
  const supplyForms = [
    ["coil", "卷材"],
    ["sheet", "平板"],
    ["openProfile", "开口型材"],
    ["closedProfile", "闭口型材"],
    ["tube", "管材"],
    ["bar", "棒材"],
    ["wire", "线材"],
    ["engineeringPlastic", "工程塑料"],
    ["standardPart", "标准件"],
  ];
  const blankForms = [
    ["strip", "纵向带料"],
    ["flatBlank", "定尺平板坯"],
    ["profileSegment", "定尺型材段"],
    ["tubeSegment", "定尺管段"],
    ["barSegment", "棒料段"],
    ["wireBlank", "线材毛坯"],
    ["castBlank", "铸造毛坯"],
    ["externalModel", "外部模型"],
    ["standardPart", "采购标准件"],
  ];
  const prepProcesses = [
    ["uncoiling", "开卷"],
    ["leveling", "校平"],
    ["slitting", "分条"],
    ["cutToLength", "定尺切断"],
    ["sawing", "锯切"],
    ["blanking", "冲裁下料"],
    ["preforming", "预成形"],
  ];
  const visibleMaterials = onlyCompatible
    ? materials.filter((item) => item.requirementMatch?.compatible ?? true)
    : materials;
  const hiddenIncompatibleCount = materials.length - visibleMaterials.length;
  const effectiveDomain = domainFor(req);
  const effectiveDomainLabel = effectiveDomain.empty
    ? "空集合"
    : effectiveDomain.values.length
      ? effectiveDomain.values.map((value) => `${value} mm`).join("、")
      : effectiveDomain.minimum != null || effectiveDomain.maximum != null
        ? `${effectiveDomain.minimum ?? "不限"} ～ ${effectiveDomain.maximum ?? "不限"} mm`
        : "不限厚度";
  const commitAllowedThickness = () => {
    const values = allowedThicknessText
      .split(/[,，;；\s]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    setAllowedThicknessText(values.join(", "));
    setReq({
      thickness: { ...req.thickness, allowedValues: values },
      reviewed: false,
    });
  };
  const setThicknessBoundary = (key: "minimum" | "maximum", value: string) =>
    setReq({
      thickness: {
        ...req.thickness,
        [key]: value === "" ? null : Number(value),
      },
      reviewed: false,
    });
  return (
    <>
      <div className="panel material-scope">
        <PanelTitle
          icon={Database}
          title="1. 材料适用范围"
          subtitle="定义模板允许使用的供应材料，而不是在这里固定某次实例的材料。"
          actions={
            <span className={`review-chip ${req.reviewed ? "ok" : ""}`}>
              {req.reviewed ? "边界已确认" : "待确认"}
            </span>
          }
        />
        <div className="mode-cards">
          {(
            [
              [
                "category",
                "宽泛类别",
                "按供应形态与厚度限定，可在实例化时选择任意合格材料",
              ],
              [
                "family",
                "受控材料族",
                "在类别基础上继续限定牌号、标准、表面与材料族标签",
              ],
              [
                "specificRecord",
                "唯一指定材料",
                "锁定材料库中的唯一记录，不允许实例替换",
              ],
            ] as const
          ).map(([id, label, note]) => (
            <button
              key={id}
              className={req.selectionMode === id ? "active" : ""}
              onClick={() => setMode(id)}
            >
              <strong>{label}</strong>
              <span>{note}</span>
            </button>
          ))}
        </div>
        <div className="form-grid three">
          <Field label="供应材料形态" hint="由材料库业务类型映射为统一形态">
            <select
              value={req.supplyForm}
              onChange={(e) =>
                setReq({ supplyForm: e.target.value, reviewed: false })
              }
            >
              {supplyForms.map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="允许厚度值" hint="离散规格；支持小数，逗号或空格分隔">
            <input
              inputMode="decimal"
              value={allowedThicknessText}
              onChange={(e) => setAllowedThicknessText(e.target.value)}
              onBlur={commitAllowedThickness}
              onKeyDown={(e) => e.key === "Enter" && commitAllowedThickness()}
              placeholder="1.5, 1.8, 2.0, 2.5"
            />
          </Field>
          <Field label="厚度驱动参数">
            <input
              value={req.thickness.parameterId || ""}
              onChange={(e) =>
                setReq({
                  thickness: {
                    ...req.thickness,
                    parameterId: e.target.value || null,
                  },
                  reviewed: false,
                })
              }
              placeholder="thickness"
            />
          </Field>
          <Field label="厚度下限" hint="与离散值可二选一或组合">
            <div className="number-wrap">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={req.thickness.minimum ?? ""}
                onChange={(e) =>
                  setThicknessBoundary("minimum", e.target.value)
                }
              />
              <span>mm</span>
            </div>
          </Field>
          <Field label="厚度上限">
            <div className="number-wrap">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={req.thickness.maximum ?? ""}
                onChange={(e) =>
                  setThicknessBoundary("maximum", e.target.value)
                }
              />
              <span>mm</span>
            </div>
          </Field>
        </div>
        <div
          className={`effective-domain ${effectiveDomain.empty ? "invalid" : "valid"}`}
        >
          <div>
            <strong>实际执行的有效厚度域</strong>
            <span>离散允许值 ∩ 厚度范围</span>
          </div>
          <b>{effectiveDomainLabel}</b>
          <small>
            同步约束材料候选、{req.thickness.parameterId || "未指定参数"}{" "}
            参数和边界验证样例
          </small>
        </div>
        {familyMode && (
          <div className="form-grid two">
            <Field label="材料族标签">
              <input
                value={req.familyTags.join(", ")}
                onChange={(e) =>
                  setReq({ familyTags: csv(e.target.value), reviewed: false })
                }
                placeholder="结构钢, 冷轧"
              />
            </Field>
            <Field label="允许牌号">
              <input
                value={req.allowedGrades.join(", ")}
                onChange={(e) =>
                  setReq({
                    allowedGrades: csv(e.target.value),
                    reviewed: false,
                  })
                }
                placeholder="Q235, Q355"
              />
            </Field>
            <Field label="适用标准">
              <input
                value={req.standards.join(", ")}
                onChange={(e) =>
                  setReq({ standards: csv(e.target.value), reviewed: false })
                }
              />
            </Field>
            <Field label="表面状态">
              <input
                value={req.surfaces.join(", ")}
                onChange={(e) =>
                  setReq({ surfaces: csv(e.target.value), reviewed: false })
                }
              />
            </Field>
          </div>
        )}
        <div className="inline-checks">
          <label>
            <input
              type="checkbox"
              checked={req.allowInstanceSubstitution}
              disabled={req.selectionMode === "specificRecord"}
              onChange={(e) =>
                setReq({
                  allowInstanceSubstitution: e.target.checked,
                  reviewed: false,
                })
              }
            />
            允许实例选择满足条件的材料
          </label>
          <label>
            <input
              type="checkbox"
              checked={req.reviewed}
              onChange={(e) => setReq({ reviewed: e.target.checked })}
            />
            工程师已确认材料边界
          </label>
        </div>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Layers3}
          title="2. 供应材料与毛坯准备"
          subtitle="供应材料描述采购状态；制造起始毛坯描述进入主体成形或加工时的几何状态。"
        />
        <div className="supply-blank-flow">
          <span>
            {supplyForms.find(([v]) => v === req.supplyForm)?.[1] ||
              req.supplyForm}
          </span>
          <ArrowRight />
          <strong>
            {blankForms.find(([v]) => v === draft.blank.form)?.[1] ||
              draft.blank.form}
          </strong>
          <ArrowRight />
          <span>{draft.blank.manufacturingRoute}</span>
        </div>
        <div className="form-grid three">
          <Field label="毛坯准备关系">
            <select
              value={draft.blank.preparationMode}
              onChange={(e) =>
                setBlank({
                  preparationMode: e.target
                    .value as Draft["blank"]["preparationMode"],
                  preparationProcesses:
                    e.target.value === "sameAsSupply" ? ["none"] : [],
                })
              }
            >
              <option value="sameAsSupply">与供应材料一致</option>
              <option value="preparedBlank">需要毛坯准备</option>
            </select>
          </Field>
          <Field label="制造起始毛坯">
            <select
              value={draft.blank.form}
              onChange={(e) =>
                setBlank({ form: e.target.value as Draft["blank"]["form"] })
              }
            >
              {blankForms.map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="主体制造路线">
            <select
              value={draft.blank.manufacturingRoute}
              onChange={(e) =>
                setBlank({
                  manufacturingRoute: e.target
                    .value as Draft["blank"]["manufacturingRoute"],
                })
              }
            >
              {[
                ["coldRollForming", "冷弯辊压"],
                ["laserCutting", "激光下料"],
                ["machining", "机加工"],
                ["extrusion", "挤压"],
                ["bending", "折弯"],
                ["casting", "铸造"],
                ["purchased", "采购"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {draft.blank.preparationMode === "preparedBlank" && (
          <Field label="毛坯准备工序">
            <div className="process-grid">
              {prepProcesses.map(([id, label]) => (
                <label
                  className={
                    draft.blank.preparationProcesses.includes(
                      id as Draft["blank"]["preparationProcesses"][number],
                    )
                      ? "selected"
                      : ""
                  }
                  key={id}
                >
                  <input
                    type="checkbox"
                    checked={draft.blank.preparationProcesses.includes(
                      id as Draft["blank"]["preparationProcesses"][number],
                    )}
                    onChange={(e) =>
                      setBlank({
                        preparationProcesses: e.target.checked
                          ? [
                              ...draft.blank.preparationProcesses,
                              id as Draft["blank"]["preparationProcesses"][number],
                            ]
                          : draft.blank.preparationProcesses.filter(
                              (x) => x !== id,
                            ),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </Field>
        )}
        <div className="form-grid three">
          <Field label="毛坯长度表达式">
            <input
              value={draft.blank.lengthExpression}
              onChange={(e) => setBlank({ lengthExpression: e.target.value })}
            />
          </Field>
          <Field label="毛坯宽度表达式">
            <input
              value={draft.blank.widthExpression}
              onChange={(e) => setBlank({ widthExpression: e.target.value })}
            />
          </Field>
          <Field label="毛坯厚度表达式">
            <input
              value={draft.blank.thicknessExpression}
              onChange={(e) =>
                setBlank({ thicknessExpression: e.target.value })
              }
            />
          </Field>
          <Field label="长度余量">
            <NumberInput
              value={draft.blank.lengthAllowance}
              onChange={(lengthAllowance) => setBlank({ lengthAllowance })}
            />
          </Field>
          <Field label="宽度余量">
            <NumberInput
              value={draft.blank.widthAllowance}
              onChange={(widthAllowance) => setBlank({ widthAllowance })}
            />
          </Field>
        </div>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Beaker}
          title="3. 材料验证矩阵"
          subtitle="用具体材料验证参数和几何，但不会改变材料适用范围。标称样例用于当前CAD编译。"
        />
        <div className="sample-grid">
          {(["minimum", "nominal", "maximum", "special"] as const).map(
            (role) => {
              const sample = draft.materialValidationSamples.find(
                (item) => item.role === role,
              );
              const label = {
                minimum: "最小边界",
                nominal: "标称样例",
                maximum: "最大边界",
                special: "特殊工况",
              }[role];
              return (
                <div
                  className={`sample-card ${sample?.reviewed ? "ok" : ""}`}
                  key={role}
                >
                  <div>
                    <strong>{label}</strong>
                    <span>
                      {role === "nominal" ? "当前编译材料" : "边界回归材料"}
                    </span>
                  </div>
                  {sample ? (
                    <>
                      <b>{sample.materialCode}</b>
                      <small>
                        {sample.materialName} ·{" "}
                        {sample.materialThickness ?? "—"} mm
                      </small>
                      <small>
                        {sample.bindingMode === "reference"
                          ? "动态引用"
                          : "冻结快照"}{" "}
                        · 变体 {sample.variantId}
                      </small>
                      <label>
                        <input
                          type="checkbox"
                          checked={sample.reviewed}
                          onChange={(e) =>
                            editSample(sample.id, {
                              reviewed: e.target.checked,
                            })
                          }
                        />
                        已复核
                      </label>
                      <button
                        onClick={() =>
                          setSamples(
                            draft.materialValidationSamples.filter(
                              (item) => item.id !== sample.id,
                            ),
                          )
                        }
                      >
                        移除
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setTargetRole(role)}>
                      选择材料
                    </button>
                  )}
                </div>
              );
            },
          )}
        </div>
        <div className="material-search-head">
          <div>
            <strong>从RuiWare材料库选择</strong>
            <span>目标槽位：</span>
            <select
              value={targetRole}
              onChange={(e) =>
                setTargetRole(
                  e.target.value as MaterialValidationSample["role"],
                )
              }
            >
              <option value="minimum">最小边界</option>
              <option value="nominal">标称样例</option>
              <option value="maximum">最大边界</option>
              <option value="special">特殊工况</option>
            </select>
            <label className="compatible-filter">
              <input
                type="checkbox"
                checked={onlyCompatible}
                onChange={(e) => setOnlyCompatible(e.target.checked)}
              />
              仅显示符合要求
            </label>
            {onlyCompatible && hiddenIncompatibleCount > 0 && (
              <small className="compatible-filter-note">
                已隐藏 {hiddenIncompatibleCount} 条命中搜索但不满足当前材料要求的记录
              </small>
            )}
          </div>
          <div className="search-row">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="搜索牌号、名称或标准"
            />
            <button onClick={runSearch}>搜索</button>
          </div>
        </div>
        <div className="material-table">
          <div className="table-head material-matrix-head">
            <span>材料</span>
            <span>牌号 / 标准</span>
            <span>厚度</span>
            <span>要求匹配</span>
            <span>操作</span>
          </div>
          {visibleMaterials.length === 0 && (
            <div className="material-empty">
              <Search size={18} />
              <span>
                当前材料库中没有满足适用范围的记录。可调整材料要求，或取消“仅显示符合要求”查看不匹配原因。
              </span>
            </div>
          )}
          {visibleMaterials.map((m) => {
            const compatible = m.requirementMatch?.compatible ?? true;
            return (
              <div className="table-row material-matrix-row" key={m.id}>
                <span>
                  <strong>{m.code}</strong>
                  <small>{m.name}</small>
                </span>
                <span>
                  {m.grade || "—"}
                  <small>{m.standard || m.type}</small>
                </span>
                <span>{m.thickness ? `${m.thickness} mm` : "—"}</span>
                <span className={`match-state ${compatible ? "ok" : "bad"}`}>
                  {compatible ? "符合" : m.requirementMatch?.reasons.join("；")}
                </span>
                <span className="row-actions">
                  <button
                    disabled={!!busy || !compatible}
                    onClick={() => bind(m, "reference", targetRole)}
                  >
                    动态引用
                  </button>
                  <button
                    disabled={!!busy || !compatible}
                    onClick={() => bind(m, "copy", targetRole)}
                  >
                    冻结快照
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

