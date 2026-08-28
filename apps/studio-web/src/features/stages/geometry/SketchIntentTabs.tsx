type TabName = "entities" | "constraints" | "dimensions" | "regions" | "diagnostics";

type Props = {
  tab: TabName;
  counts: Record<TabName, number>;
  onChange: (tab: TabName) => void;
};

export function SketchIntentTabs({ tab, counts, onChange }: Props) {
  const tabs: [TabName, string][] = [
    ["entities", "图元"],
    ["constraints", "几何约束"],
    ["dimensions", "尺寸与参数"],
    ["regions", "截面区域"],
    ["diagnostics", "诊断"],
  ];
  return (
    <div className="intent-tabs">
      {tabs.map(([id, label]) => (
        <button key={id} className={tab === id ? "active" : ""} onClick={() => onChange(id)}>
          {label}
          <b>{counts[id]}</b>
        </button>
      ))}
    </div>
  );
}







