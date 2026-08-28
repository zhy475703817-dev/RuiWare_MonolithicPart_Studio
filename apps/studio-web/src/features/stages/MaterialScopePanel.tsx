import { Database } from "lucide-react";
import { Field } from "../../components/ui/FormParts";
import type { Draft, MaterialRequirement, MaterialValidationSample } from "../../types";

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

const allowedModes = [
  ["category", "宽泛类别", "按供应形态与厚度限定，可在实例化时选择任意合格材料"],
  ["family", "受控材料族", "在类别基础上继续限定牌号、标准、表面与材料族标签"],
  ["specificRecord", "唯一指定材料", "锁定材料库中的唯一记录，不允许实例替换"],
] as const;

export function csv(value: string) {
  return value
    .split(/[,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type Props = {
  draft: Draft;
  req: MaterialRequirement;
  reviewed: boolean;
  onReqChange: (patch: Partial<MaterialRequirement>) => void;
  onModeChange: (selectionMode: MaterialRequirement["selectionMode"]) => void;
  allowedThicknessText: string;
  setAllowedThicknessText: (value: string) => void;
};

function domainFor(requirement: MaterialRequirement) {
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
    maximum: values.length ? (values.at(-1) ?? null) : requirement.thickness.maximum,
  };
}

export function MaterialScopePanel({
  draft,
  req,
  reviewed,
  onReqChange,
  onModeChange,
  allowedThicknessText,
  setAllowedThicknessText,
}: Props) {
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
    onReqChange({
      thickness: { ...req.thickness, allowedValues: values },
      reviewed: false,
    });
  };
  const setThicknessBoundary = (key: "minimum" | "maximum", value: string) =>
    onReqChange({
      thickness: {
        ...req.thickness,
        [key]: value === "" ? null : Number(value),
      },
      reviewed: false,
    });

  return (
    <div className="panel material-scope">
      <div className="panel-title">
        <Database />
        <div>
          <h3>1. 材料适用范围</h3>
          <p>定义模板允许使用的供应材料，而不是在这里固定某次实例的材料。</p>
        </div>
        <span className={`review-chip ${reviewed ? "ok" : ""}`}>
          {reviewed ? "边界已确认" : "待确认"}
        </span>
      </div>
      <div className="mode-cards">
        {allowedModes.map(([id, label, note]) => (
          <button
            key={id}
            className={req.selectionMode === id ? "active" : ""}
            onClick={() => onModeChange(id)}
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
            onChange={(e) => onReqChange({ supplyForm: e.target.value, reviewed: false })}
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
              onReqChange({
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
              onChange={(e) => setThicknessBoundary("minimum", e.target.value)}
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
              onChange={(e) => setThicknessBoundary("maximum", e.target.value)}
            />
            <span>mm</span>
          </div>
        </Field>
      </div>
      <div className={`effective-domain ${effectiveDomain.empty ? "invalid" : "valid"}`}>
        <div>
          <strong>实际执行的有效厚度域</strong>
          <span>离散允许值 ∩ 厚度范围</span>
        </div>
        <b>{effectiveDomainLabel}</b>
        <small>
          同步约束材料候选、{req.thickness.parameterId || "未指定参数"} 参数和边界验证样例
        </small>
      </div>
      {req.selectionMode !== "category" && (
        <div className="form-grid two">
          <Field label="材料族标签">
            <input
              value={req.familyTags.join(", ")}
              onChange={(e) => onReqChange({ familyTags: csv(e.target.value), reviewed: false })}
              placeholder="结构钢, 冷轧"
            />
          </Field>
          <Field label="允许牌号">
            <input
              value={req.allowedGrades.join(", ")}
              onChange={(e) => onReqChange({ allowedGrades: csv(e.target.value), reviewed: false })}
              placeholder="Q235, Q355"
            />
          </Field>
          <Field label="适用标准">
            <input
              value={req.standards.join(", ")}
              onChange={(e) => onReqChange({ standards: csv(e.target.value), reviewed: false })}
            />
          </Field>
          <Field label="表面状态">
            <input
              value={req.surfaces.join(", ")}
              onChange={(e) => onReqChange({ surfaces: csv(e.target.value), reviewed: false })}
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
              onReqChange({
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
            checked={reviewed}
            onChange={(e) => onReqChange({ reviewed: e.target.checked })}
          />
          工程师已确认材料边界
        </label>
      </div>
    </div>
  );
}
