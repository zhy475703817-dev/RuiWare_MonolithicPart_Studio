import { Plus, Trash2 } from "lucide-react";
import { Field, NumberInput } from "../../../../components/ui/FormParts";
import type { MatingContract } from "../../../../types";

export function MatingContractEditor({
  value,
  onChange,
}: {
  value?: MatingContract | null;
  onChange: (value: MatingContract | null) => void;
}) {
  if (!value) return (
    <div className="interface-region-editor">
      <strong>配合契约（mating）</strong>
      <small>在零部件模板中声明配合条件，发布新版本后由组件工作台读取。旧接口可不填写。</small>
      <button className="mini-btn" onClick={() => onChange({
        version: 1, family: "pin-hole", role: "pin", connectionMethod: "clearance-fit",
        dimensions: { diameter: { nominal: 10, lowerTolerance: -0.02, upperTolerance: 0.02, unit: "mm" } },
        allowedRelations: ["同轴", "贴合"], capacity: 1,
      })}><Plus size={14} />添加配合契约（销孔示例）</button>
      <div className="inline-checks">
        {(["welded", "bolted"] as const).map((method) => (
          <button key={method} className="mini-btn" onClick={() => onChange({
            version: 1, family: "plane-contact", role: "surface", connectionMethod: method,
            dimensions: {}, allowedRelations: ["贴合"], capacity: 1,
          })}><Plus size={14} />添加面贴合契约·{method === "welded" ? "焊接" : "螺栓连接"}</button>
        ))}
      </div>
    </div>
  );

  const edit = (patch: Partial<MatingContract>) => onChange({ ...value, ...patch });
  const planeContact = value.family === "plane-contact";
  return (
    <div className="interface-region-editor">
      <strong>配合契约（mating）</strong>
      <small>另一端须使用相同 family、相配的 role，以及兼容的尺寸、公差和连接方式。请按实际接口核对示例值。</small>
      {planeContact && <small>面贴合：两端可使用中性角色 surface。接触面和区域沿用接口的关联几何与区域定义；焊接和螺栓连接须分别与另一端使用相同连接方式。</small>}
      {planeContact && !["welded", "bolted"].includes(value.connectionMethod) && <small role="alert">面贴合须选择焊接或螺栓连接。</small>}
      {planeContact && !value.allowedRelations.includes("贴合") && <small role="alert">面贴合契约必须允许“贴合”装配关系。</small>}
      <div className="form-grid three">
        <Field label="契约版本" hint="契约规则版本，独立于模板发布版本；当前支持版本 1。"><input value={value.version} readOnly /></Field>
        <Field label="配合族（family）"><input value={value.family} onChange={(event) => edit({ family: event.target.value })} placeholder="pin-hole" /></Field>
        <Field label="配合角色（role）" hint={planeContact ? "普通贴合面两端均填 surface；有支承方向时可约定 support / supported。" : "例如销 pin 对应孔 hole，与主／次定位角色独立。"}><input value={value.role} onChange={(event) => edit({ role: event.target.value })} placeholder={planeContact ? "surface" : "pin / hole"} /></Field>
        <Field label="连接方式（connectionMethod）">
          {planeContact ? <select value={value.connectionMethod} onChange={(event) => edit({ connectionMethod: event.target.value })}>
            <option value="" disabled>请选择连接方式</option>
            <option value="welded">焊接</option>
            <option value="bolted">螺栓连接</option>
          </select> : <input value={value.connectionMethod} onChange={(event) => edit({ connectionMethod: event.target.value })} placeholder="clearance-fit" />}
        </Field>
        <Field label="允许的装配关系" hint="用逗号分隔，例如：同轴, 贴合。离开输入框后应用。">
          <input key={JSON.stringify(value.allowedRelations)} defaultValue={value.allowedRelations.join(", ")} onBlur={(event) => edit({ allowedRelations: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} />
        </Field>
        <Field label="连接容量（capacity）" hint="每个接口实例最多允许的配合连接数，须为正整数。"><NumberInput value={value.capacity} min={1} step={1} precision={0} unit="个" onChange={(capacity) => edit({ capacity })} /></Field>
      </div>
      <strong>配合尺寸与公差</strong>
      <small>实际范围 = 名义值 + 下偏差 ～ 名义值 + 上偏差；下偏差不能大于上偏差。尺寸为固定数值，不随几何参数自动变化。</small>
      {planeContact && <small>面贴合可不填写尺寸；如需声明接触宽度、孔距等固定尺寸，可按实际需要添加。此处不自动校核孔位、螺栓或焊缝。</small>}
      {Object.entries(value.dimensions).map(([name, dimension], index) => (
        <div className="form-grid three" key={index}>
          <Field label="尺寸名称" hint="例如 diameter；与另一端对应的尺寸名称一致。">
            <input value={name} onChange={(event) => {
              const next = event.target.value;
              if (next !== name && Object.hasOwn(value.dimensions, next)) return;
              edit({ dimensions: Object.fromEntries(Object.entries(value.dimensions).map(([key, item]) => [key === name ? next : key, item])) });
            }} />
          </Field>
          <Field label="名义值"><NumberInput value={dimension.nominal} precision={6} unit={dimension.unit} onChange={(nominal) => edit({ dimensions: { ...value.dimensions, [name]: { ...dimension, nominal } } })} /></Field>
          <Field label="单位"><input value={dimension.unit} onChange={(event) => edit({ dimensions: { ...value.dimensions, [name]: { ...dimension, unit: event.target.value } } })} /></Field>
          <Field label="下偏差"><NumberInput value={dimension.lowerTolerance} precision={6} unit={dimension.unit} onChange={(lowerTolerance) => edit({ dimensions: { ...value.dimensions, [name]: { ...dimension, lowerTolerance } } })} /></Field>
          <Field label="上偏差"><NumberInput value={dimension.upperTolerance} precision={6} unit={dimension.unit} onChange={(upperTolerance) => edit({ dimensions: { ...value.dimensions, [name]: { ...dimension, upperTolerance } } })} /></Field>
          <div>
            {dimension.lowerTolerance > dimension.upperTolerance && <small role="alert">下偏差不能大于上偏差</small>}
            <button className="danger-text" disabled={!planeContact && Object.keys(value.dimensions).length === 1} onClick={() => edit({ dimensions: Object.fromEntries(Object.entries(value.dimensions).filter(([key]) => key !== name)) })}><Trash2 size={13} />删除尺寸</button>
          </div>
        </div>
      ))}
      <div className="inline-checks">
        <button className="mini-btn" onClick={() => {
          let index = 1;
          while (Object.hasOwn(value.dimensions, `dimension${index}`)) index += 1;
          edit({ dimensions: { ...value.dimensions, [`dimension${index}`]: { nominal: 0, lowerTolerance: 0, upperTolerance: 0, unit: "mm" } } });
        }}><Plus size={14} />新增尺寸</button>
        <button className="danger-text" onClick={() => onChange(null)}><Trash2 size={13} />移除配合契约</button>
      </div>
      <small>保存并发布新版本后，需在组件工作台将该零部件更新到新版本。</small>
    </div>
  );
}
