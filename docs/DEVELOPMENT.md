# 七阶段开发与扩展说明

## 总体数据流

> 平台只接受统一模板元模型 3.0。字段定义与规则求值以 `UNIFIED-METAMODEL.md` 为准，不提供旧模板读取、转换或编辑能力。

> 当前生成器固定处理 `monolithicPart`。所有几何操作完成后必须形成一个连续有效实体。组合零部件、组件和产品将在未来模板工程平台中由独立生成器负责。

```text
草稿与证据
  → 材料绑定 + 毛坯
  → 参数化基准草图
  → 制造特征规则
  → 参数契约 + 变体
  → 静态几何计划
  → OpenCascade B-Rep + STEP
  → 准入报告 + 不可变版本
```

AI 位于各阶段旁路，只读取受控上下文并返回建议，不位于几何生成主链。

## 阶段实现

| 阶段 | 权威数据 | 阻断校验 | 主要产物 |
|---|---|---|---|
| 模板信息 | 身份、制造分类、几何原型、用途、证据 | 注册表引用有效、分类和意图已确认 | `manifest.json`、`classification.json`、素材 |
| 材料与毛坯 | `MaterialRequirement[]`、`MaterialValidationSample[]`、`BlankDefinition` | 材料范围、样例匹配、毛坯准备与制造路线 | `material-requirements.json`、`material-validation.json` |
| 基准几何 | 统一 `SemanticSketch`、`GeometryRecipe` | 语义图元、约束、闭合区域、来源转换和配方已确认 | `constraints.json`、`geometry-recipe.json` |
| 制造特征 | `FeatureRule[]` | 规则表达式可求值、规则集已确认 | `feature-rules.json` |
| 参数与变体 | `ParameterDefinition[]`、`VariantDefinition[]` | 来源、依赖图、配方参数契约、变体覆盖键 | `parameters.json`、`variants.json` |
| 三维审查 | `CanonicalPlan`、`CompileResult` | 当前输入哈希、有效单实体、正体积 | STEP、STL、计划、诊断、语义映射 |
| 准入发布 | `AdmissionDefinition`、全部阶段状态 | 上游完成、当前审查、复核人、版本说明 | 不可变版本、`.rwpart` |

## 稳定拓扑策略

- 模板参数是数据，不是代码字符串。
- 可变数量孔、槽、切口使用集合，在 lowering 阶段展开为确定的静态操作列表。
- 编译计划按稳定标识排序；同一输入得到同一 `inputHash`。
- 几何哈希只包含几何、草图、毛坯和材料快照，不包含修订时间、阶段状态或说明附件。
- 草图固定为 `semanticProfile`；手工、AI、导入和受控复用只改变来源审计，均须形成同一语义图元、参数、约束和闭合区域结构。
- `parametric-sketch-3.0` 用阻尼 Gauss-Newton 同时求解尺寸和几何约束，用雅可比矩阵秩计算自由度，并对最小、标称、最大工况执行区域闭合、自交、退化与拓扑签名检查。源包同时保存 `sketch-solver.json`，CAD 编译器直接消费其求解后图元与材料区域。
- 每个布尔操作立即检查执行结果，最终检查 B-Rep 有效性、实体数和体积。
- 上游指纹变化按顺序失效下游阶段；历史修订恢复不执行新编辑失效逻辑。
- 发布记录不可修改；修改已发布草稿会自动回到 draft 并生成后续版本。

## 目录职责

```text
apps/studio-web                 七阶段可视化工作台
libs/python/template_core      领域模型、校验、lowering
services/template-api          草稿、材料、审查、发布、AI 辅助 API
services/cad-worker            进程隔离 OpenCascade 执行器
tests                          领域、API、B-Rep、七阶段端到端测试
artifacts                      STEP/STL/计划/快照/源包
```

## 新增单体零部件能力的标准步骤

1. 在领域模型中增加通用的草图、特征或成形操作，不加入产品名称分支。
2. 为新操作定义输入约束、单位、语义输出和确定性排序规则。
3. 在 lowering 中从模板数据生成静态操作。
4. 在 CAD Worker 中实现对应 OpenCascade 算子，并检查每次操作结果。
5. 在阶段校验中加入可解释的前置检查。
6. 在 UI 中增加可视化编辑器和人工确认点。
7. 增加标称、最小、最大、非法输入和拓扑退化测试。
8. 用 STEP 检查、快照和端到端发布验证后才能进入生产算子包。

焊接组合件和组件应进入未来模板工程平台的独立生成器，通过已发布零部件版本、接口和约束组合。本模块不增加制造子件、焊缝、装配约束或多实体准入分支。

## 材料页面的数据边界

- `MaterialRequirement` 定义供应材料适用范围：宽泛类别、受控材料族或唯一指定记录。
- `supplyForm` 只描述供应链中的材料状态，不承担毛坯几何语义。
- `BlankDefinition` 定义制造起始毛坯、供应材料到毛坯的准备工序、尺寸表达式与余量。
- `MaterialValidationSample[]` 保存最小、标称、最大和特殊工况材料；标称样例用于当前 CAD 编译。
- 多厚度材料族发布前必须具有最小、标称和最大三个已确认样例。
- 样例材料必须通过材料族牌号、标准、表面状态、供应形态和厚度约束校验。
- `reference` 每次解析材料库当前记录并检测漂移；`copy` 使用冻结快照以保证回归可复现。

## 第五、六阶段：确认、审计和稳定性

GUI 通过签名 `ruiware_session` Cookie 获得会话；MCP 必须配置 `RUIWARE_AGENT_TOKEN` 并使用 Bearer Token。`X-RuiWare-Actor` 和 `X-RuiWare-Source` 只作为兼容输入，服务端不以它们作为身份依据。GUI 和 MCP 默认通过 `X-RuiWare-Workspace: ruiware-main` 共享当前零部件；`X-RuiWare-Session` 仍保留为旧调用的工作区回退，不代替身份认证。

本机协作模式可通过环境变量配置：`RUIWARE_AGENT_TOKEN` 设置 MCP Token，`RUIWARE_AGENT_OWNER_ID` 设置 Agent 所属用户，`RUIWARE_GUI_OWNER_ID` 设置本机 GUI 用户，`RUIWARE_SESSION_SECRET` 设置签名会话密钥，`RUIWARE_WORKSPACE_ID` 设置 MCP 工作区。默认工作区为 `ruiware-main`。默认值仅适用于绑定 `127.0.0.1` 的开发环境；局域网或公网部署必须替换 Token 和会话密钥，并在反向代理层接入正式用户认证。

Repository 使用 SQLite 事务锁保护 revision 检查，审计记录写入 `operation_audit` 表。审计可通过 `GET /api/v1/audit-logs` 或 MCP `ruiware_get_audit_log` 查询；回滚通过 `POST /api/v1/template-drafts/{draftId}/rollback` 或 `ruiware_rollback_draft` 生成新 revision。

MCP 客户端只对连接错误和可重试的 5xx 进行最多两次退避重试，409 版本冲突、422 校验错误和默认非幂等写入不会重试。验证命令：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm --prefix apps/studio-web run test
npm --prefix apps/studio-web run build
```
