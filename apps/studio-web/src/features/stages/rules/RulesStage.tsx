import { useState } from "react";
import { ArrowRight, GitBranch, Plus, Trash2, Variable, X } from "lucide-react";
import { Field, NumberInput, PanelTitle } from "../../../components/ui/FormParts";
import { RuleLocalPreview } from "../review/compile/RuleLocalPreview";
import {
  normalizeParameterAliasReferences,
  parameterDefaultForType,
  parameterValueType,
  renameParameterReferences,
} from "../../authoring/authoringUtils";
import type { Draft, FeatureRule, ParameterDefinition } from "../../../types";
import {
  RuleParameterPanel,
  type NewRuleParameter,
} from "./RuleParameterPanel";

const uid = (prefix: string) => `${prefix}.${Date.now().toString(36)}`;

const scalar = (value: string): string | number | boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
};

export function RulesStage({
  draft,
  change,
}: {
  draft: Draft;
  change: (d: Draft) => void;
}) {
  const semanticFaces = draft.geometryRecipe.semanticFaces;
  const declaredParameters = draft.parameterDefinitions.filter(
    (parameter) => parameter.declaredInRuleStage,
  );
  const pendingParameters = declaredParameters.filter(
    (parameter) => !parameter.contractReady,
  );
  const [ruleParameterError, setRuleParameterError] = useState("");
  const [ruleParameterRenameErrors, setRuleParameterRenameErrors] = useState<
    Record<string, string>
  >({});
  const [newRuleParameter, setNewRuleParameter] = useState<NewRuleParameter>({
    id: "",
    displayName: "",
    valueType: "number",
    unit: "mm",
    default: 100,
    minimum: 0,
    maximum: 1000,
  });
  const setRules = (featureRules: FeatureRule[]) =>
    change({ ...draft, featureRules });
  const editParameter = (parameterId: string, patch: Partial<ParameterDefinition>) =>
    change({
      ...draft,
      parameterDefinitions: draft.parameterDefinitions.map((parameter) =>
        parameter.id === parameterId
          ? {
              ...parameter,
              ...patch,
              ...(parameter.declaredInRuleStage
                ? { contractReady: false }
                : {}),
            }
          : parameter,
      ),
    });
  const editParameterDisplayName = (parameter: ParameterDefinition, displayName: string) => {
    const normalized = normalizeParameterAliasReferences(draft, parameter.id, [
      parameter.displayName || "",
      parameter.label || "",
    ]);
    change({
      ...normalized,
      parameterDefinitions: normalized.parameterDefinitions.map((item) =>
        item.id === parameter.id
          ? {
              ...item,
              label: displayName,
              displayName,
              ...(item.declaredInRuleStage ? { contractReady: false } : {}),
            }
          : item,
      ),
    });
  };
  const renameRuleParameter = (previousId: string, rawNextId: string) => {
    const nextId = rawNextId.trim();
    if (nextId === previousId) return true;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nextId)) {
      setRuleParameterRenameErrors((errors) => ({
        ...errors,
        [previousId]: "ID 须以字母开头，只能包含字母、数字和下划线。",
      }));
      return false;
    }
    if (draft.parameterDefinitions.some((parameter) => parameter.id === nextId)) {
      setRuleParameterRenameErrors((errors) => ({
        ...errors,
        [previousId]: "该参数 ID 已存在。",
      }));
      return false;
    }
    change(renameParameterReferences(draft, previousId, nextId));
    setRuleParameterRenameErrors((errors) => {
      const next = { ...errors };
      delete next[previousId];
      return next;
    });
    return true;
  };
  const createRuleParameter = (parameter: {
    id: string;
    label: string;
    displayName: string;
    valueType: "number" | "integer";
    unit: string;
    default: number;
    minimum: number;
    maximum: number;
  }) => ({
    id: parameter.id,
    label: parameter.label,
    displayName: parameter.displayName,
    valueType: parameter.valueType,
    unit: parameter.unit,
    default: parameter.valueType === "integer" ? Math.trunc(parameter.default) : parameter.default,
    minimum: parameter.valueType === "integer" ? Math.trunc(parameter.minimum) : parameter.minimum,
    maximum: parameter.valueType === "integer" ? Math.trunc(parameter.maximum) : parameter.maximum,
    allowedValues: [],
    exposed: true,
    source: "user" as const,
    sourceDefinition: {
      type: "userInput" as const,
      dependencies: [],
      lookupTable: {},
      fallback: parameter.valueType === "integer" ? Math.trunc(parameter.default) : parameter.default,
    },
    scope: "partInstance" as const,
    declaredInRuleStage: true,
    contractReady: false,
    description: "规则页预声明，进入契约页后补全来源、作用域与发布要求。",
  });
  const addRuleParameter = () => {
    const id = newRuleParameter.id.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) {
      setRuleParameterError("参数 ID 需以字母开头，只能包含字母、数字和下划线。");
      return;
    }
    if (draft.parameterDefinitions.some((parameter) => parameter.id === id)) {
      setRuleParameterError("参数 ID 已存在。");
      return;
    }
    if (
      newRuleParameter.valueType === "number" ||
      newRuleParameter.valueType === "integer"
    ) {
      if (newRuleParameter.minimum > newRuleParameter.maximum) {
        setRuleParameterError("最小值不能大于最大值。");
        return;
      }
      if (
        newRuleParameter.minimum > newRuleParameter.default ||
        newRuleParameter.default > newRuleParameter.maximum
      ) {
        setRuleParameterError("需满足最小值 ≤ 标称值 ≤ 最大值。");
        return;
      }
    }
    change({
      ...draft,
      parameterDefinitions: [
        ...draft.parameterDefinitions,
        createRuleParameter({
          id,
          label: newRuleParameter.displayName.trim() || id,
          displayName: newRuleParameter.displayName.trim() || id,
          valueType: newRuleParameter.valueType,
          unit: newRuleParameter.unit.trim() || "mm",
          default: newRuleParameter.default,
          minimum: newRuleParameter.minimum,
          maximum: newRuleParameter.maximum,
        }),
      ],
    });
    setNewRuleParameter({
      id: "",
      displayName: "",
      valueType: "number",
      unit: "mm",
      default: 100,
      minimum: 0,
      maximum: 1000,
    });
    setRuleParameterError("");
  };
  const edit = (i: number, patch: Partial<FeatureRule>) =>
    setRules(
      draft.featureRules.map((rule, n) =>
        n === i ? { ...rule, ...patch } : rule,
      ),
    );
  const addRule = () =>
    setRules([
      ...draft.featureRules,
      {
        id: uid("feature"),
        name: "新制造规则",
        featureType: "circularHole",
        enabled: true,
        conditionExpression: "True",
        countExpression: "1",
        indexVariable: "i",
        arguments: { x: 0, diameter: 12 },
        argumentExpressions: { z: "length / 2" },
        faceBindings: [{ semanticFaceId: draft.geometryRecipe.semanticFaces[0]?.id || "part.face.front" }],
        profileDimensions: [],
        placement: { mode: "single", axis: "v", pitchExpression: "100", startMarginExpression: "0", endMarginExpression: "0", maximumPitchExpression: "300" },
        polygonVertices: [],
        maximumCount: 200,
        semanticGroup: null,
        description: "",
      },
    ]);
  const changeArgumentMode = (
    index: number,
    rule: FeatureRule,
    key: string,
    value: string,
    toExpression: boolean,
  ) => {
    const argumentsNext = { ...rule.arguments };
    const expressionsNext = { ...rule.argumentExpressions };
    if (toExpression) {
      delete argumentsNext[key];
      expressionsNext[key] = value;
    } else {
      delete expressionsNext[key];
      argumentsNext[key] = scalar(value);
    }
    edit(index, {
      arguments: argumentsNext,
      argumentExpressions: expressionsNext,
    });
  };
  const removeArgument = (index: number, rule: FeatureRule, key: string) => {
    const argumentsNext = { ...rule.arguments };
    const expressionsNext = { ...rule.argumentExpressions };
    delete argumentsNext[key];
    delete expressionsNext[key];
    edit(index, {
      arguments: argumentsNext,
      argumentExpressions: expressionsNext,
    });
  };
  const changeFeatureType = (
    index: number,
    rule: FeatureRule,
    featureType: FeatureRule["featureType"],
  ) =>
    edit(index, {
      featureType,
      arguments:
        featureType === "circularHole" ? { x: 0, diameter: 12 }
        : featureType === "straightSlot" ? { x: 0, width: 12, length: 40 }
        : featureType === "rectangularCutout" ? { x: 0, width: 20, height: 20 }
        : {},
      argumentExpressions:
        featureType === "polygonalCutout" ? {} : { z: "length / 2" },
      polygonVertices:
        featureType === "polygonalCutout" && rule.polygonVertices.length === 0
          ? [
              { uExpression: "-10", vExpression: "length / 2 - 10" },
              { uExpression: "10", vExpression: "length / 2 - 10" },
              { uExpression: "10", vExpression: "length / 2 + 10" },
              { uExpression: "-10", vExpression: "length / 2 + 10" },
            ]
          : rule.polygonVertices,
    });
  const editVertex = (
    index: number,
    rule: FeatureRule,
    vertexIndex: number,
    key: "uExpression" | "vExpression",
    value: string,
  ) =>
    edit(index, {
      polygonVertices: rule.polygonVertices.map((vertex, n) =>
        n === vertexIndex ? { ...vertex, [key]: value } : vertex,
      ),
    });
  const toggleFace = (ruleIndex: number, rule: FeatureRule, semanticFaceId: string) => {
    const exists = rule.faceBindings.some((binding) => binding.semanticFaceId === semanticFaceId);
    edit(ruleIndex, {
      faceBindings: exists
        ? rule.faceBindings.filter((binding) => binding.semanticFaceId !== semanticFaceId)
        : [...rule.faceBindings, { semanticFaceId }],
    });
  };
  const editProfileDimension = (
    ruleIndex: number,
    rule: FeatureRule,
    dimensionIndex: number,
    patch: Partial<FeatureRule["profileDimensions"][number]>,
  ) =>
    edit(ruleIndex, {
      profileDimensions: rule.profileDimensions.map((dimension, n) =>
        n === dimensionIndex ? { ...dimension, ...patch } : dimension,
      ),
    });
  const uniqueParameterId = (rule: FeatureRule, suffix: string) => {
    const stem = `${rule.id.replace(/[^A-Za-z0-9_]/g, "_")}_${suffix}`.replace(/^[^A-Za-z]+/, "feature_");
    let candidate = stem;
    let sequence = 2;
    while (draft.parameterDefinitions.some((parameter) => parameter.id === candidate)) candidate = `${stem}_${sequence++}`;
    return candidate;
  };
  const addInstanceParameter = (ruleIndex: number, rule: FeatureRule, suffix: string, label: string, apply: (id: string) => Partial<FeatureRule>) => {
    const id = uniqueParameterId(rule, suffix);
    const parameter = createRuleParameter({
      id,
      label,
      displayName: label,
      valueType: "number",
      unit: "mm",
      default: 100,
      minimum: 0,
      maximum: 10000,
    });
    change({
      ...draft,
      parameterDefinitions: [...draft.parameterDefinitions, parameter],
      featureRules: draft.featureRules.map((item, n) => n === ruleIndex ? { ...item, ...apply(id) } : item),
    });
  };
  const applyPolygonPreset = (ruleIndex: number, rule: FeatureRule, kind: "rectangle" | "trapezoid" | "notch") => {
    const dimensions: [string, string, number][] = kind === "rectangle"
      ? [["cutoutWidth", "切口宽度", 40], ["cutoutHeight", "切口高度", 24]]
      : kind === "trapezoid"
        ? [["bottomWidth", "底边宽度", 50], ["topWidth", "顶边宽度", 30], ["cutoutHeight", "切口高度", 30]]
        : [["cutoutWidth", "切口宽度", 48], ["cutoutHeight", "切口高度", 32], ["notchWidth", "缺口宽度", 20], ["notchHeight", "缺口高度", 14]];
    const usedIds = new Set(draft.parameterDefinitions.map((parameter) => parameter.id));
    const newParameters: ParameterDefinition[] = [];
    const profileDimensions = [...rule.profileDimensions];
    for (const [id, label, defaultValue] of dimensions) {
      if (profileDimensions.some((dimension) => dimension.id === id)) continue;
      const stem = `${rule.id.replace(/[^A-Za-z0-9_]/g, "_")}_${id}`;
      let parameterId = stem;
      let suffix = 2;
      while (usedIds.has(parameterId)) parameterId = `${stem}_${suffix++}`;
      usedIds.add(parameterId);
      newParameters.push(createRuleParameter({
        id: parameterId,
        label,
        displayName: label,
        valueType: "number",
        unit: "mm",
        default: defaultValue,
        minimum: 0,
        maximum: 10000,
      }));
      profileDimensions.push({ id, label, parameterId });
    }
    const vertices = kind === "rectangle"
      ? [{ uExpression: "-cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "cutoutHeight / 2" }, { uExpression: "-cutoutWidth / 2", vExpression: "cutoutHeight / 2" }]
      : kind === "trapezoid"
        ? [{ uExpression: "-bottomWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "bottomWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "topWidth / 2", vExpression: "cutoutHeight / 2" }, { uExpression: "-topWidth / 2", vExpression: "cutoutHeight / 2" }]
        : [{ uExpression: "-cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "cutoutHeight / 2" }, { uExpression: "-cutoutWidth / 2 + notchWidth", vExpression: "cutoutHeight / 2" }, { uExpression: "-cutoutWidth / 2 + notchWidth", vExpression: "cutoutHeight / 2 - notchHeight" }, { uExpression: "-cutoutWidth / 2", vExpression: "cutoutHeight / 2 - notchHeight" }];
    change({
      ...draft,
      parameterDefinitions: [...draft.parameterDefinitions, ...newParameters],
      featureRules: draft.featureRules.map((item, n) => n === ruleIndex ? { ...item, profileDimensions, polygonVertices: vertices } : item),
    });
  };
  return (
    <>
      <div className="panel rule-intro">
        <div>
          <PanelTitle
            icon={GitBranch}
            title="制造特征规则"
            subtitle="规则在实例求值时展开为稳定、静态的特征集合；数量可以随参数变化。"
          />
          <div className="rule-flow">
            <span>参数与上下文</span>
            <ArrowRight />
            <span>规则求值</span>
            <ArrowRight />
            <span>静态特征集合</span>
            <ArrowRight />
            <span>布尔加工</span>
          </div>
        </div>
        <div className="rule-intro-actions">
          <button className="primary-btn" onClick={addRule}>
            <Plus size={15} />
            新建规则
          </button>
        </div>
      </div>
      <RuleParameterPanel
        pendingParameters={pendingParameters}
        declaredParameters={declaredParameters}
        newRuleParameter={newRuleParameter}
        setNewRuleParameter={setNewRuleParameter}
        ruleParameterError={ruleParameterError}
        ruleParameterRenameErrors={ruleParameterRenameErrors}
        addRuleParameter={addRuleParameter}
        renameRuleParameter={renameRuleParameter}
        editParameterDisplayName={editParameterDisplayName}
        editParameter={editParameter}
      />
      {draft.featureRules.length === 0 ? (
        <div className="empty-canvas">
          <GitBranch size={34} />
          <strong>尚未定义制造规则</strong>
          <span>
            无孔零件可以保持为空；存在孔、槽或切口时建议用规则表达生成逻辑。
          </span>
          <button onClick={addRule}>
            <Plus size={14} />
            创建第一条规则
          </button>
        </div>
      ) : (
        <div className="rule-list">
          {draft.featureRules.map((rule, i) => {
            const allArguments = {
              ...rule.arguments,
              ...rule.argumentExpressions,
            };
            return (
              <div
                className={`panel rule-card ${!rule.enabled ? "disabled" : ""}`}
                key={`${rule.id}-${i}`}
              >
                <div className="rule-head">
                  <div className="rule-type">
                    <span>{i + 1}</span>
                    <div>
                      <strong>{rule.name}</strong>
                      <code>{rule.id}</code>
                    </div>
                  </div>
                  <div className="rule-actions">
                    <label className="switch-label">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => edit(i, { enabled: e.target.checked })}
                      />
                      启用
                    </label>
                    <button
                      className="delete-icon"
                      onClick={() =>
                        setRules(draft.featureRules.filter((_, n) => n !== i))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="form-grid two">
                  <Field label="规则名称">
                    <input
                      value={rule.name}
                      onChange={(e) => edit(i, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="特征类型">
                    <select
                      value={rule.featureType}
                      onChange={(e) =>
                        changeFeatureType(
                          i,
                          rule,
                          e.target.value as FeatureRule["featureType"],
                        )
                      }
                    >
                      <option value="circularHole">圆孔</option>
                      <option value="straightSlot">直槽 / 长圆孔</option>
                      <option value="rectangularCutout">矩形切口</option>
                      <option value="polygonalCutout">直线多边形切口</option>
                    </select>
                  </Field>
                </div>
                <div className="host-frame">
                  <div>
                    <strong>目标语义面</strong>
                    <small>由几何阶段定义面 ID、局部 U/V 坐标和法向；规则只引用此处选定的语义面。</small>
                  </div>
                  <div className="face-binding-list" aria-label="目标语义面">
                    {semanticFaces.map((face) => (
                      <label key={face.id} className="face-binding-option">
                        <input type="checkbox" checked={rule.faceBindings.some((binding) => binding.semanticFaceId === face.id)} onChange={() => toggleFace(i, rule, face.id)} />
                        <span><strong>{face.label}</strong><code>{face.id}</code></span>
                      </label>
                    ))}
                    {semanticFaces.length === 0 && <small>请先在几何阶段定义可用于制造特征的语义面。</small>}
                  </div>
                </div>
                <div className="rule-args placement-editor">
                  <strong>布置规则</strong>
                  <small>基准位置和偏移全部使用目标语义面的局部 U/V 坐标。</small>
                  <div className="form-grid three">
                    <Field label="布置方式">
                      <select value={rule.placement.mode} onChange={(e) => edit(i, { placement: { ...rule.placement, mode: e.target.value as FeatureRule["placement"]["mode"] } })}>
                        <option value="single">单项</option>
                        <option value="linearArray">线性阵列</option>
                        <option value="equalSpan">两端均布</option>
                        <option value="maxPitch">最大间距</option>
                        <option value="symmetric">对称阵列</option>
                      </select>
                    </Field>
                    <Field label="布置轴">
                      <select value={rule.placement.axis} onChange={(e) => edit(i, { placement: { ...rule.placement, axis: e.target.value as FeatureRule["placement"]["axis"] } })}>
                        <option value="u">U</option><option value="v">V</option>
                      </select>
                    </Field>
                    <Field label={rule.placement.mode === "maxPitch" ? "数量" : "数量表达式"}>
                      <code className="code-input"><input disabled={rule.placement.mode === "single" || rule.placement.mode === "maxPitch"} value={rule.placement.mode === "single" ? "1" : rule.placement.mode === "maxPitch" ? "自动计算" : rule.countExpression} onChange={(e) => edit(i, { countExpression: e.target.value })} /></code>
                    </Field>
                  </div>
                  {rule.placement.mode === "linearArray" || rule.placement.mode === "symmetric" ? (
                    <div className="placement-value-row">
                      {rule.placement.mode === "linearArray" && <Field label="首项距起始端" hint="从所选语义面的局部 U/V 起始边界量取。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.startMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, startMarginExpression: e.target.value } })} /></code></Field>}
                      <Field label={rule.placement.mode === "symmetric" ? "相邻间距表达式" : "间距表达式"} hint="填参数 ID（如 holePitch）即可在实例化时输入；也可在参数页把该参数设为公式派生。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.pitchExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, pitchExpression: e.target.value } })} /></code></Field>
                      <button className="text-btn compact" onClick={() => addInstanceParameter(i, rule, "pitch", `${rule.name}间距`, (id) => ({ placement: { ...rule.placement, pitchExpression: id } }))}><Plus size={13} />创建可填写间距参数</button>
                    </div>
                  ) : rule.placement.mode === "equalSpan" ? (
                    <div className="form-grid two placement-margins">
                      <Field label="首孔距起始端" hint="从语义面所选 U/V 轴的起始边界开始量取。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.startMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, startMarginExpression: e.target.value } })} /></code></Field>
                      <Field label="终孔距终止端" hint="系统以“语义面跨度 − 首端距 − 终端距”自动均布。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.endMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, endMarginExpression: e.target.value } })} /></code></Field>
                    </div>
                  ) : rule.placement.mode === "maxPitch" ? (
                    <div className="form-grid three placement-margins">
                      <Field label="首孔距起始端"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.startMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, startMarginExpression: e.target.value } })} /></code></Field>
                      <Field label="终孔距终止端"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.endMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, endMarginExpression: e.target.value } })} /></code></Field>
                      <Field label="最大间距表达式"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.maximumPitchExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, maximumPitchExpression: e.target.value } })} /></code></Field>
                    </div>
                  ) : <small className="placement-note">单项使用特征局部 U/V；对称阵列以该坐标作为中心。线性阵列的首项从语义面起始边界加首端距开始。</small>}
                </div>
                {rule.featureType === "polygonalCutout" && (
                  <div className="rule-args profile-dimensions">
                    <strong>尺寸变量（可选）</strong>
                    <small>固定轮廓无需绑定。只有希望切口随实例参数变化时，才把局部名称绑定到模板参数；顶点表达式可引用这些名称，例如 bottomWidth / cutoutHeight。</small>
                    {rule.profileDimensions.map((dimension, dimensionIndex) => (
                      <div className="dimension-row" key={`${dimension.id}-${dimensionIndex}`}>
                        <input value={dimension.id} aria-label="局部尺寸 ID" onChange={(e) => editProfileDimension(i, rule, dimensionIndex, { id: e.target.value })} />
                        <input value={dimension.label} aria-label="尺寸名称" onChange={(e) => editProfileDimension(i, rule, dimensionIndex, { label: e.target.value })} />
                        <select value={dimension.parameterId} aria-label="来源模板参数" onChange={(e) => editProfileDimension(i, rule, dimensionIndex, { parameterId: e.target.value })}>
                          {draft.parameterDefinitions.filter((parameter) => parameter.valueType === "number" || parameter.valueType === "integer").map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label} · {parameter.id}</option>)}
                        </select>
                        <button className="delete-icon" onClick={() => edit(i, { profileDimensions: rule.profileDimensions.filter((_, n) => n !== dimensionIndex) })}><X size={13} /></button>
                      </div>
                    ))}
                    <div className="contour-actions">
                      <button className="text-btn" onClick={() => edit(i, { profileDimensions: [...rule.profileDimensions, { id: `dimension${rule.profileDimensions.length + 1}`, label: "新尺寸", parameterId: draft.parameterDefinitions.find((parameter) => parameter.valueType === "number" || parameter.valueType === "integer")?.id || "length" }] })}><Plus size={13} />绑定已有参数</button>
                      <button className="text-btn" onClick={() => addInstanceParameter(i, rule, "cutoutSize", `${rule.name}尺寸`, (id) => ({ profileDimensions: [...rule.profileDimensions, { id: `dimension${rule.profileDimensions.length + 1}`, label: "切口尺寸", parameterId: id }] }))}><Plus size={13} />创建可填写尺寸参数</button>
                    </div>
                 </div>
                )}
                <RuleLocalPreview
                  rule={rule}
                  parameterValues={Object.fromEntries(draft.parameterDefinitions.map((parameter) => [parameter.id, parameter.default]))}
                />
                <div className="form-grid two">
                  <Field label="生效条件" hint="返回 true 才生成该规则。例如：length >= 1800 and hasServiceHole。留为 True 表示始终生成。">
                    <code className="code-input">
                      <input
                        value={rule.conditionExpression}
                        onChange={(e) =>
                          edit(i, { conditionExpression: e.target.value })
                        }
                      />
                    </code>
                  </Field>
                  <Field label="展开安全上限" hint="防止数量或最大间距表达式异常时生成过多特征；它不是实际数量。">
                    <NumberInput
                      value={rule.maximumCount}
                      unit="项"
                      min={1}
                      onChange={(v) => edit(i, { maximumCount: v })}
                    />
                  </Field>
                </div>
                {rule.featureType === "polygonalCutout" ? (
                  <div className="rule-args polygon-vertices">
                    <strong>闭合直线轮廓</strong>
                    <small>先选一个轮廓预置，再按需要修改每个顶点的局部 U/V 坐标或表达式；顶点按顺序连接并自动闭合，且不能自交。</small>
                    <div className="contour-actions">
                      <button className="text-btn" onClick={() => applyPolygonPreset(i, rule, "rectangle")}>参数化矩形</button>
                      <button className="text-btn" onClick={() => applyPolygonPreset(i, rule, "trapezoid")}>参数化梯形</button>
                      <button className="text-btn" onClick={() => applyPolygonPreset(i, rule, "notch")}>参数化 L 形</button>
                    </div>
                    {rule.polygonVertices.map((vertex, vertexIndex) => (
                      <div className="vertex-row" key={vertexIndex}>
                        <span>#{vertexIndex + 1}</span>
                        <code className="code-input">
                          <input aria-label={`顶点 ${vertexIndex + 1} U`} value={vertex.uExpression} onChange={(e) => editVertex(i, rule, vertexIndex, "uExpression", e.target.value)} />
                        </code>
                        <code className="code-input">
                          <input aria-label={`顶点 ${vertexIndex + 1} V`} value={vertex.vExpression} onChange={(e) => editVertex(i, rule, vertexIndex, "vExpression", e.target.value)} />
                        </code>
                        <button aria-label={`删除顶点 ${vertexIndex + 1}`} disabled={rule.polygonVertices.length <= 3} onClick={() => edit(i, { polygonVertices: rule.polygonVertices.filter((_, n) => n !== vertexIndex) })}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <button className="text-btn" onClick={() => edit(i, { polygonVertices: [...rule.polygonVertices, { uExpression: "0", vExpression: "length / 2" }] })}>
                      <Plus size={13} />
                      添加顶点
                    </button>
                  </div>
                ) : (
                  <div className="rule-args">
                    <strong>特征局部尺寸与位置</strong>
                    <small>字段 x、z 分别是目标语义面局部坐标的 U、V；其余字段是孔径、槽宽或切口尺寸。</small>
                    {Object.entries(allArguments).map(([key, rawValue]) => {
                      const expression = key in rule.argumentExpressions;
                      const value = String(rawValue);
                      return (
                        <div className="arg-row" key={key}>
                          <input value={key} readOnly />
                          <select value={expression ? "expression" : "constant"} onChange={(e) => changeArgumentMode(i, rule, key, value, e.target.value === "expression")}>
                            <option value="constant">常量</option>
                            <option value="expression">表达式</option>
                          </select>
                          <input list="feature-parameter-options" value={value} onChange={(e) => expression ? edit(i, { argumentExpressions: { ...rule.argumentExpressions, [key]: e.target.value } }) : edit(i, { arguments: { ...rule.arguments, [key]: scalar(e.target.value) } })} />
                          <button onClick={() => removeArgument(i, rule, key)}><X size={13} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <datalist id="feature-parameter-options">
                  {draft.parameterDefinitions.filter((parameter) => parameter.valueType === "number" || parameter.valueType === "integer").map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label}</option>)}
                </datalist>
                <Field label="规则说明">
                  <textarea
                    rows={2}
                    value={rule.description}
                    onChange={(e) => edit(i, { description: e.target.value })}
                  />
                </Field>
              </div>
            );
          })}
        </div>
      )}
      <label className="confirm-box panel-confirm">
        <input
          type="checkbox"
          checked={draft.featureRulesReviewed}
          onChange={(e) =>
            change({ ...draft, featureRulesReviewed: e.target.checked })
          }
        />
        <span>
          <strong>制造特征规则集合已确认</strong>
          <small>
            有规则时确认条件、数量和坐标；无规则时确认该零件不需要制造特征。
          </small>
        </span>
      </label>
    </>
  );
}

