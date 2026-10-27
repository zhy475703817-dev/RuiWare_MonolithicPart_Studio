# 统一模板元模型与规则求值层

## 目标

当前文档定义单体零部件模板的统一外层契约：

```text
证据 → 材料需求 → 参数及来源 → 几何配方 → 特征规则 → 接口 → 变体 → 审查与发布
```

当前且唯一支持的元模型版本为 `3.0`。API、源包、规则求值器与 CAD 编译器均拒绝旧字段和旧版结构；需要迁移的数据应在平台外完成一次性清洗后再导入。

每份草稿必须声明 `templateKind: monolithicPart`。这是范围约束而不是可编辑分类：模板必须从一个毛坯出发，经成形与去除材料得到一个连续实体。未来组合零部件、组件和产品可以复用参数、规则、接口及发布基础设施，但必须拥有各自的专用定义块和准入策略。

## 核心对象

### MaterialRequirement

模板选择材料类别或材料族，不要求绑定唯一材料记录：

- `selectionMode`: `category | family | specificRecord`
- `supplyForm`: 卷材、平板、型材、管材等供应材料形态
- 允许牌号、标准和表面处理
- 厚度参数、允许厚度集合或范围
- 实例是否允许替换

只有 `specificRecord` 模式要求具体材料绑定。

### MaterialValidationSample / BlankDefinition

材料适用范围不直接承担 CAD 编译所需的具体属性。模板以验证矩阵保存 `minimum | nominal | maximum | special` 材料样例；其中标称样例作为当前编译材料，多厚度范围必须同时覆盖最小和最大样例。样例可以动态引用材料库，也可以复制为冻结快照。

三种选择模式是同一材料范围契约的三个严格度级别：`category` 只按供应形态和厚度过滤，`family` 再叠加材料族标签、牌号、标准和表面要求，`specificRecord` 锁定唯一材料记录。RuiWare 材料库仍保存“带钢、平钢板、Ω钢、方矩管、五金”等业务类型；只读适配层把它们映射为统一的 `supplyForm` 后再进行匹配，不修改原材料库。

厚度只允许有一个权威求值结果 `effectiveThicknessDomain`。离散允许值和连续上下限同时存在时取交集；交集为空则材料阶段不得完成。该结果同时用于材料候选过滤、`material.thickness → thickness` 参数契约、最小/最大验证样例和 CAD 编译。`.rwpart` 的 `material-requirements.json` 固化该求值结果，避免下游系统自行重复解释。

`BlankDefinition` 与供应材料分离，声明制造起始毛坯、毛坯准备关系、准备工序、长度/宽度/厚度表达式和加工余量。例如Ω型立柱的供应材料是卷材，制造起始毛坯是经开卷、分条得到的纵向带料。

## 统一语义草图

所有通过二维草图构造的零部件固定使用 `SketchDefinition.model = semanticProfile`。交互绘制、AI辅助、导入轮廓和复用受控截面只是 `acquisitionMethod`，最终必须转换为同一份包含稳定语义图元、参数引用、约束和闭合区域的草图契约。导入文件只作为带哈希的来源证据保存，不直接参与CAD编译；导入或复用来源必须完成 `conversionReviewed`。

草图驱动参数仅包含轮廓自身所需参数，例如Ω截面的 `width/depth/lip/thickness`。拉伸长度、旋转角度等属于几何配方参数，可以引用同一模板参数体系，但不伪装成截面草图尺寸。无法合理转换为语义草图的复杂自由曲面或供应商黑盒STEP模型进入 `externalDerived` 几何路线。

### ParameterDefinition

内部 `id` 是稳定引用，`displayName/label` 可修改，`aliases` 保存历史名和行业别名。每个参数具有：

- 值类型、单位、默认值、范围或枚举；
- 公开性和作用域；
- `sourceDefinition`；
- 公式依赖、材料/产品/组件/项目区域引用或查表数据。

支持的来源包括用户输入、材料属性、公式、查表、产品配置、组件配置、项目区域、标准、几何测量、外部接口和常量。

### GeometryRecipe

基础几何不局限于截面拉伸。配方声明构造模式和有序操作：

- 拉伸、旋转、扫掠、放样；
- 钣金、冷弯成形、毛坯加工；
- 外部CAD派生、标准件参数模型。

每个操作具有稳定ID、输入引用、常量参数、表达式参数、条件和语义输出。当前CAD Worker仍只实现第一批拉伸算子；元模型已经允许后续算子包按统一方式注册。

### FeatureRule

规则保存“如何生成特征”，而不是保存固定节点数量：

- 显式、线性阵列、等距、最大间距、对称、路径、条件、查表和公式模式；
- 数量表达式；
- 逐项参数表达式；
- 最大数量安全限制；
- 稳定规则ID和语义组。

几何配方声明 `semanticFaces[]`：每个面具有稳定 ID、来源操作和局部坐标系方向。
规则通过 `faceBindings[].semanticFaceId` 选择一个或多个目标面；规则页不重复设置宿主面，切削方向与 U/V
坐标系由几何语义面自动解析。普通孔、槽和矩形切口的位置参数在所选面的局部 U/V 中解释；
`polygonalCutout` 使用按顺序闭合的 `polygonVertices[{uExpression, vExpression}]` 表达任意直线边轮廓。
多边形可通过 `profileDimensions[]` 将局部尺寸名称绑定到模板参数。轮廓在求值时检查最少顶点数、
零长度边、零面积与自交，且不依赖 B-Rep 面序号。

规则求值后生成 `ResolvedFeature[]`，再展开为CAD Worker接收的静态操作。

### PartInterface

接口保存语义引用、局部原点表达式、轴向、配对类型、兼容条件和参数映射。接口不能依赖易变的B-Rep面序号。

### VariantDefinition

变体声明标称、最小、最大、标准规格、临界点前后、历史回归和预期失败用例。它是模板测试输入，不是复制后的新模板。

### EvidenceInference / AIProposal

自然语言和图片识别结果以证据、推断、假设和用户确认分层保存。AI修改以结构化提案保存，包含修改路径、前后值、影响对象、风险和必需确认，不直接写入正式几何。

## 规则求值流程

```text
参数定义 + 实例覆盖 + 外部上下文
  → 参数依赖图
  → 拓扑排序
  → 参数逐项求值和类型/范围检查
  → 特征条件和数量求值
  → 逐项坐标/尺寸求值
  → ResolvedFeature[]
  → CanonicalPlan静态操作
```

表达式使用Python风格的受限算术语法，但不执行Python代码。允许：

- 四则运算、整除、取模和受限幂；
- 比较、布尔和条件表达式；
- `abs`、`min`、`max`、`floor`、`ceil`、`round`、`sqrt`、`clamp`；
- `material.thickness` 等受控上下文引用。

拒绝函数导入、属性反射、容器推导、下标执行、lambda以及任意函数调用。表达式节点数、长度、幂结果和特征数量均有限制。

## Ω型立柱孔规则

```json
{
  "id": "upright.mainHoleRow",
  "featureType": "circularHole",
  "countExpression": "holeCount",
  "arguments": { "x": 0, "diameter": 12 },
  "argumentExpressions": { "z": "endMargin" },
  "placement": { "mode": "equalSpan", "axis": "v", "spanExpression": "length - 2 * endMargin" }
}
```

`holeCount`来自公式参数：

```text
max(2, floor((length - 2 * endMargin) / maxPitch) + 1)
```

验证结果：

| 长度 | 解析孔数 | CAD操作数 |
|---:|---:|---:|
| 2400 mm | 8 | 9（1个基体+8个孔） |
| 3600 mm | 12 | 13（1个基体+12个孔） |

特征ID分别为 `upright.mainHoleRow.001`、`.002`，按规则和序号稳定生成。

## 求值API

```http
POST /api/v1/template-drafts/{draftId}/evaluate
Content-Type: application/json

{
  "overrides": { "length": 3600 },
  "material": { "thickness": 2.0 },
  "product": {},
  "component": {},
  "projectZone": {}
}
```

返回解析参数、求值顺序、解析特征和诊断。该接口只预览，不保存草稿，也不运行CAD。

## `.rwpart`统一文件结构

```text
manifest.json
evidence.json
material-requirements.json
material-validation.json
parameters.json
parameter-dependencies.json
geometry-recipe.json
constraints.json
feature-rules.json
interfaces.json
variants.json
outputs.json
admission.json
geometry/preview.stl
template-reconstruction-guide.md
assets/
```

不存在某类数据时，对应的统一文件仍保存空集合，从而为后续 AI 智能设计提供稳定、可机器读取的格式。源包不输出旧版视图或重复表达同一语义的文件。

发布生成的 `.rwpart` 是 ZIP 文件。`manifest.json` 保留模板声明的 `unitSystem` 与 `coordinateSystem`；包内 STL 直接取自本次发布所对应的成功 CAD 编译结果，不移动、旋转或缩放模型。消费者应使用 `outputs.json` 中 STL artifact 的 `packagePath` 读取包内模型，而不要依赖发布方本机的 artifact URL：

```json
{
  "kind": "stl",
  "url": "/artifacts/_jobs/job-id/preview.stl",
  "packagePath": "geometry/preview.stl",
  "sha256": "<STL 文件的 SHA-256>",
  "size": 123456
}
```

`url` 保留以兼容现有本地流程；`packagePath`、`size` 是新发布包的包内读取契约。旧 `.rwpart` 不会被改写，其 STL artifact 可能没有这两个字段，消费者应将其识别为旧格式，并按旧版本已有逻辑处理。发布会在写入包前验证成功编译、当前输入哈希、STL 非空及文件 SHA-256；草稿状态和版本登记使用同一个 SQLite 事务；远程上传前会再次验证 ZIP 内存在非空 `geometry/preview.stl`；最终 ZIP 的大小和 SHA-256 以该完整包重新计算。
