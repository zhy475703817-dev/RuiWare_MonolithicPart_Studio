# 零部件接口配合契约

在零部件模板编辑器的“零部件接口”中，展开对应接口，添加“配合契约（mating）”。可选择销孔示例、面贴合·焊接或面贴合·螺栓连接。示例仅作为填写起点，须按实际零件核对。保存并发布新版本后，在组件工作台将该零部件更新到新版本。

```json
{
  "mating": {
    "version": 1,
    "family": "pin-hole",
    "role": "pin",
    "connectionMethod": "clearance-fit",
    "dimensions": {
      "diameter": {
        "nominal": 10,
        "lowerTolerance": -0.02,
        "upperTolerance": 0.02,
        "unit": "mm"
      }
    },
    "allowedRelations": ["同轴", "贴合"],
    "capacity": 1
  }
}
```

- `version` 是契约格式版本，独立于模板发布版本；当前仅支持整数 `1`，其他版本会被拒绝。
- `family` 是配合族，两端须一致；`role` 是配合角色，例如 `pin` 与 `hole`，不影响接口原有的主／次／第三定位角色。
- `connectionMethod` 是配合方式，不替代原有 `connectionProcesses` 连接工艺。
- `dimensions` 支持多个命名尺寸。数值必须有限，单位不能为空，下偏差不能大于上偏差。当前为固定值，不支持参数表达式或自动从制造特征提取尺寸；修改几何尺寸后须同步核对契约。
- `allowedRelations` 是允许的装配关系，至少一项且不能重复；`capacity` 是每个接口实例允许的最大连接数，须为正整数。

销的允许直径范围为 9.98～10.02 mm。若要保证间隙配合，另一端孔的最小直径应大于 10.02 mm，例如孔名义直径 10.05 mm，下偏差 0，上偏差 0.02 mm。两端的尺寸应兼容，并非数值完全相同。

旧模板不要求补填契约，`mating` 可以省略或为 `null`。保存、求值后的静态／区域／制造特征派生接口，以及发布包 `interfaces.json` 均保留契约；派生的每个接口实例继承相同契约。接口说明书也包含契约明细。

本平台校验契约格式、公差顺序与必填项，不在单零部件模板中判断另一端是否兼容，也不自动建立装配关系。两端匹配和连接容量执行由组件工作台负责。

## 面贴合：焊接与螺栓连接

面贴合使用 `family: "plane-contact"`，当前支持 `connectionMethod: "welded"`（焊接）和 `"bolted"`（螺栓连接）。两端须使用相同配合族和连接方式；普通对等贴合面两端可均填 `role: "surface"`，有支承方向时可另行约定 `support` 与 `supported`。角色仍由组件工作台解释，不自动判断支承方向。

焊接面的最小接口数据示例（其余接口字段按实际模板填写）：

```json
{
  "id": "mount.surface",
  "name": "焊接贴合面",
  "geometryRefs": ["part.face.front"],
  "connectionProcesses": ["welded"],
  "mating": {
    "version": 1,
    "family": "plane-contact",
    "role": "surface",
    "connectionMethod": "welded",
    "dimensions": {},
    "allowedRelations": ["贴合"],
    "capacity": 1
  }
}
```

螺栓贴合面将 `connectionMethod` 改为 `bolted`，并在 `connectionProcesses` 中包含 `bolted`。编辑器自动勾选并锁定当前契约要求的工艺，保留其他已选工艺；切换连接方式或移除契约不会自动删除原有工艺，不再必需的工艺可手动取消。面贴合契约若与工艺列表矛盾，后端拒绝保存。

接触面引用接口原有的关联几何，作用范围沿用整个面或矩形区域，不重复填写几何基准。定位接口添加面贴合契约时，定位方式同步设为面贴合。

仅 `plane-contact` 允许 `dimensions: {}`，但字段本身仍须提供；销孔等其他配合族仍须至少一个尺寸。面贴合也可按需添加接触宽度、长度、孔距等实际尺寸，不需要填写虚构的直径。若填写尺寸，仍执行原有数值、公差和单位校验。

`allowedRelations` 必须包含“贴合”；`capacity` 仍是每个接口实例的连接容量，不是螺栓数量或焊缝条数。

本次支持贴合面连接条件的声明、校验和发布，不包含孔阵列匹配、螺栓规格或强度计算、焊缝形式或强度计算，也不处理带垫片间距或焊接预留间隙。面贴合只描述面关系，必要时还须通过孔、边或止挡补足定位。
