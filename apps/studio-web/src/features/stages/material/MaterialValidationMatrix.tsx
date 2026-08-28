import { Beaker, Search } from "lucide-react";
import type { Draft, Material, MaterialValidationSample } from "../../../types";

type Props = {
  draft: Draft;
  materials: Material[];
  search: string;
  setSearch: (value: string) => void;
  runSearch: () => void;
  bind: (
    material: Material,
    mode: "reference" | "copy",
    role: MaterialValidationSample["role"],
  ) => void;
  busy: string;
  targetRole: MaterialValidationSample["role"];
  setTargetRole: (value: MaterialValidationSample["role"]) => void;
  onlyCompatible: boolean;
  setOnlyCompatible: (value: boolean) => void;
  setSamples: (samples: MaterialValidationSample[]) => void;
  editSample: (id: string, patch: Partial<MaterialValidationSample>) => void;
};

export function MaterialValidationMatrix({
  draft,
  materials,
  search,
  setSearch,
  runSearch,
  bind,
  busy,
  targetRole,
  setTargetRole,
  onlyCompatible,
  setOnlyCompatible,
  setSamples,
  editSample,
}: Props) {
  const visibleMaterials = onlyCompatible
    ? materials.filter((item) => item.requirementMatch?.compatible ?? true)
    : materials;
  const hiddenIncompatibleCount = onlyCompatible
    ? materials.length - visibleMaterials.length
    : 0;

  return (
    <div className="panel">
      <div className="panel-title">
        <Beaker />
        <div>
          <h3>3. 材料验证矩阵</h3>
          <p>用具体材料验证参数和几何，但不会改变材料适用范围。标称样例用于当前CAD编译。</p>
        </div>
      </div>
      <div className="sample-grid">
        {(["minimum", "nominal", "maximum", "special"] as const).map((role) => {
          const sample = draft.materialValidationSamples.find((item) => item.role === role);
          const label = {
            minimum: "最小边界",
            nominal: "标称样例",
            maximum: "最大边界",
            special: "特殊工况",
          }[role];
          return (
            <div className={`sample-card ${sample?.reviewed ? "ok" : ""}`} key={role}>
              <div>
                <strong>{label}</strong>
                <span>{role === "nominal" ? "当前编译材料" : "边界回归材料"}</span>
              </div>
              {sample ? (
                <>
                  <b>{sample.materialCode}</b>
                  <small>
                    {sample.materialName} · {sample.materialThickness ?? "—"} mm
                  </small>
                  <small>
                    {sample.bindingMode === "reference" ? "动态引用" : "冻结快照"} · 变体{" "}
                    {sample.variantId}
                  </small>
                  <label>
                    <input
                      type="checkbox"
                      checked={sample.reviewed}
                      onChange={(e) => editSample(sample.id, { reviewed: e.target.checked })}
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
                <button onClick={() => setTargetRole(role)}>选择材料</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="material-search-head">
        <div>
          <strong>从RuiWare材料库选择</strong>
          <span>目标槽位：</span>
          <select
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value as MaterialValidationSample["role"])}
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
        {visibleMaterials.map((material) => {
          const compatible = material.requirementMatch?.compatible ?? true;
          return (
            <div className="table-row material-matrix-row" key={material.id}>
              <span>
                <strong>{material.code}</strong>
                <small>{material.name}</small>
              </span>
              <span>
                {material.grade || "—"}
                <small>{material.standard || material.type}</small>
              </span>
              <span>{material.thickness ? `${material.thickness} mm` : "—"}</span>
              <span className={`match-state ${compatible ? "ok" : "bad"}`}>
                {compatible ? "符合" : material.requirementMatch?.reasons.join("；")}
              </span>
              <span className="row-actions">
                <button disabled={!!busy || !compatible} onClick={() => bind(material, "reference", targetRole)}>
                  动态引用
                </button>
                <button disabled={!!busy || !compatible} onClick={() => bind(material, "copy", targetRole)}>
                  冻结快照
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
