# 当前代码结构与功能说明

> 更新时间：2026-09-19
> 本文以当前仓库实际代码为准，说明目录边界、主要文件职责、GUI 主线、Agent/MCP 辅助线、数据存储和运行数据流。

## 1. 项目定位

本项目是一个面向模板开发人员的单体零部件模板生成平台，当前固定处理 `monolithicPart`。平台采用“GUI-first、Agent 辅助”的双线结构：

- GUI 是主要工作入口，工程师通过七阶段工作流创建、编辑、验证和发布模板。
- Agent 通过 MCP 读取同一零部件状态、解释参数和错误、预览修改，并在用户确认后调用业务能力。
- GUI 和 Agent 不直接操作数据库，最终都通过同一个 FastAPI、业务服务、领域模型和 Repository。
- CAD 计算由独立 CAD Worker 执行，避免 OpenCascade 运行失败直接影响 API 进程。

```text
GUI（React） ───────────────┐
                            ├─> Template API（FastAPI）
Agent ─> MCP Server ────────┘          │
                                       ├─> 业务服务 services
                                       ├─> 领域内核 template_core
                                       ├─> Repository / SQLite
                                       └─> CAD Worker / OpenCascade
```

## 2. 根目录

```text
template-engineering-platform/
├─ apps/                  前端应用
├─ services/              API、MCP、CAD Worker
├─ libs/                  Python 领域内核
├─ packages/              跨模块 JSON Schema 契约
├─ tests/                 后端、领域、CAD、MCP 测试
├─ docs/                  架构、开发、使用和交付文档
├─ examples/              可执行模板示例
├─ scripts/               初始化和维护脚本
├─ data/                  平台数据库与附件
├─ artifacts/             CAD 和发布产物
├─ tmpgeom/               本地几何调试产物
├─ start-dev.bat          Windows 双击启动入口
├─ start-dev.ps1          开发环境启动脚本
├─ pyproject.toml         Python 包、依赖和 pytest 配置
├─ package.json           前端工作区与顶层脚本
├─ ruiware.db             RuiWare 材料数据库
└─ README.md              项目总览与启动说明
```

### 2.1 根目录文件

- `README.md`：项目能力、实现边界、启动和验证方式。
- `pyproject.toml`：FastAPI、Pydantic、OpenCascade、NumPy、pytest 等 Python 依赖，以及 Python 包搜索路径。
- `package.json`：前端 workspace 和开发、构建、测试命令。
- `package-lock.json`、`bun.lock`：前端依赖锁文件。
- `.editorconfig`：编辑器格式约定。
- `.gitattributes`：Git 文本属性配置。
- `.gitignore`：忽略虚拟环境、依赖、日志和运行产物。
- `start-dev.bat`：调用 PowerShell 启动脚本，便于直接双击启动。
- `start-dev.ps1`：启动模板 API 和前端开发服务器，并打开工作台。
- `CONVERSATION-HANDOFF.md`：历史开发会话交接记录，不属于运行代码。

### 2.2 运行目录

- `data/platform.db`：平台自己的 SQLite 数据库。
- `data/attachments/`：用户上传的图纸、图片和规格附件。
- `ruiware.db`：RuiWare 材料数据库；平台默认只读查询，不把模板工程数据写入其中。
- `artifacts/`：CAD 编译和发布产物，包括 STEP、STL、静态计划、诊断、语义映射和源包。
- `tmpgeom/`：开发期间的几何探针和临时模型，不属于正式源码。
- `.venv/`、`node_modules/`、`.npm-cache/`：本机依赖目录，不应提交到 Git。
- `*.log`、`.pytest_cache/`、`.pytest-tmp/`：运行日志和测试缓存，不属于业务代码。

## 3. 前端 `apps/studio-web`

前端使用 React、TypeScript、Vite、Three.js 和 Vitest。页面按七阶段业务工作流组织：

```text
定义 → 材料 → 几何 → 规则 → 契约 → 验证 → 发布
```

### 3.1 顶层文件

- `index.html`：Vite HTML 入口。
- `package.json`：前端依赖以及 `dev`、`build`、`test` 命令。
- `vite.config.ts`：Vite 和 React 插件配置。
- `tsconfig.json`：TypeScript 编译配置。
- `src/main.tsx`：挂载 React 根组件。
- `src/App.tsx`：页面总装配；调用工作区 Hook，根据当前阶段渲染对应页面，并向阶段组件传递草稿和业务动作。
- `src/styles.css`：全局布局、工作台、表单、草图和提示样式。
- `src/types.ts`：前端共享的草稿、阶段、参数、材料、校验、编译和发布类型。
- `src/api.ts`：API 模块兼容出口，避免上层组件依赖具体实现路径。

`App.tsx` 当前主要承担编排职责，不再包含各阶段的具体编辑实现。七阶段展示配置另存于 `features/workflow/stageConfig.ts`；目前 `App.tsx` 内仍有一份同类配置，后续可统一为单一来源。

### 3.2 API 层 `src/api`

- `client.ts`：统一 HTTP 客户端，封装草稿、参数、草图、材料、阶段、编译、发布和工作区接口；所有 GUI 请求自动携带 `X-RuiWare-Workspace`。
- `errors.ts`：前端统一错误对象和错误信息解析。
- `client.test.ts`：验证 API 客户端请求头和共享工作区行为。

GUI 默认把工作区 `ruiware-main` 保存到 `localStorage["ruiware.workspaceId"]`。工作区只负责定位当前零部件，GUI 身份仍由签名 Cookie 验证。

### 3.3 通用组件 `src/components`

- `layout/WorkspaceShell.tsx`：工作台外壳；负责草稿选择、阶段导航、保存/复制/归档入口、全局提示和远端修改差异展示。
- `review/CadViewer.tsx`：显示 CAD 编译产生的三维预览和结果信息。
- `ui/FormParts.tsx`：通用表单、字段和阶段检查结果组件。
- `ui/Toast.tsx`：成功、警告和错误提示。

### 3.4 草稿工作区 `src/features/draft`

- `useDraftWorkspace.ts`：前端工作区控制器；管理草稿列表、当前草稿、阶段、未保存状态、材料、校验、CAD 编译、版本、发布、错误、远端同步和冲突处理。
- `draftSyncChannel.ts`：通过 `EventSource` 订阅后端 SSE `draft.changed` 事件，替代固定间隔轮询。
- `stagePreflight.ts`：在 CAD 编译和发布前按顺序执行阶段检查，汇总失败阶段和诊断。
- `useDraftWorkspace.test.ts`：工作区加载、保存、Agent 同步和冲突处理测试。
- `draftSyncChannel.test.ts`：SSE 事件解析和修订判断测试。
- `stagePreflight.test.ts`：阶段预检流程测试。

实时同步规则：

```text
后端产生新 revision
    ↓
写入 draft_events 并推送 SSE
    ↓
GUI 收到 draft.changed
    ├─ 无本地修改：自动加载远端新修订
    └─ 有本地修改：保留本地内容并提示冲突
```

### 3.5 作者工具 `src/features/authoring`

- `authoringUtils.ts`：参数命名、作用域、约束标签、引用改写和作者侧通用规则。

### 3.6 草图基础能力 `src/features/sketch`

这些文件保存与页面相对独立的草图算法，便于单独测试和复用：

- `sketchAuthoringCore.ts`：草图复制、拓扑整理、端点传播等核心操作。
- `sketchArc.ts`：圆弧几何计算。
- `sketchBoxSelection.ts`：框选范围和选中判定。
- `sketchEntityEditing.ts`：图元属性修改和编辑规则。
- `sketchGeometryCommit.ts`：把交互编辑结果提交回草图模型和参数。
- `sketchLineInference.ts`：线段绘制时的水平、垂直、共线等推断。
- `sketchLineMath.ts`：线段向量、投影和距离计算。
- `sketchNumberNormalization.ts`：数值精度和输入归一化。
- `sketchObjectSnap.ts`：端点、中点和几何对象捕捉。
- `sketchPointerInteraction.ts`：鼠标/指针按下、移动、释放的交互状态。
- `sketchPolyline.ts`：连续折线绘制状态和提交逻辑。
- `sketchTangency.ts`：相切关系计算。
- `sketchThinwallOffset.ts`：中心线薄壁轮廓偏移。
- `sketchViewport.ts`：屏幕坐标、草图坐标、缩放和平移转换。
- `sweepPathTopology.ts`：扫掠路径连接性和拓扑检查。
- `*.test.ts`：对应草图算法的单元测试。

### 3.7 七阶段配置 `src/features/workflow`

- `stageConfig.ts`：定义七阶段的 ID、顺序、标题、说明和图标。

### 3.8 定义阶段 `src/features/stages/workflow/template`

- `TemplateInfo.tsx`：编辑模板名称、编码、描述、制造分类、几何原型和第一阶段工程信息。

### 3.9 材料阶段 `src/features/stages/material`

- `MaterialStage.tsx`：材料阶段总装配。
- `MaterialScopePanel.tsx`：设置材料类别、材料族和适用范围。
- `MaterialSupplyBlankPanel.tsx`：设置供料形态、毛坯、准备工序、尺寸和余量。
- `MaterialValidationMatrix.tsx`：维护最小、标称、最大和特殊材料验证样例。

### 3.10 几何阶段 `src/features/stages/geometry`

- `index.ts`：几何模块公共导出入口。
- `GeometryStage.tsx`：几何阶段总装配；管理几何配方、草图模式、扫掠路径和各编辑面板之间的状态。
- `semanticFaceMarkers.ts`：生成和维护草图/三维语义面标记。
- `semanticFaceMarkers.test.ts`：语义面标记测试。
- `semanticFaceLocator.test.ts`：语义面定位行为测试。

#### `geometry/hooks`

- `useGeometryEditFlow.ts`：几何编辑流程 Hook；连接拖动、撤销/重做、预览、提交和修订冲突处理。
- `index.ts`：Hook 聚合导出。

#### `geometry/logic`

- `geometryStageLogic.ts`：几何阶段默认值、配方常量和公共转换逻辑。
- `index.ts`：逻辑模块聚合导出。

#### `geometry/canvas`

- `ParametricSketchCanvas.tsx`：参数化草图画布；负责图元渲染、绘制预览、选择、拖动、捕捉、框选、尺寸和视口交互。
- `canvasLogic.ts`：从画布组件中抽出的交互辅助逻辑。
- `index.ts`：画布模块聚合导出。

#### `geometry/panels/constraints`

- `SketchConstraintList.tsx`：草图约束列表和约束编辑。
- `SketchEntityList.tsx`：草图图元列表和选中入口。
- `SketchSelectedEntityEditor.tsx`：编辑当前选中图元。
- `index.ts`：约束面板聚合导出。

#### `geometry/panels/dimension`

- `DimensionCreationBar.tsx`：尺寸创建入口。
- `SketchDimensionPanel.tsx`：尺寸、驱动参数和参数绑定编辑。
- `index.ts`：尺寸面板聚合导出。

#### `geometry/panels/intent`

- `SketchIntentEditor.tsx`：草图编辑意图主面板。
- `SketchIntentTabs.tsx`：草图编辑标签页切换。
- `SketchIntentConfirmation.tsx`：修改内容确认。
- `SketchEditConflictDialog.tsx`：本地草图编辑与远端新修订冲突处理。
- `index.ts`：意图面板聚合导出。

#### `geometry/panels/regions`

- `SketchRegionPanel.tsx`：加材区、减材区和材料区域配置。
- `index.ts`：区域面板聚合导出。

#### `geometry/panels/diagnostics`

- `SketchDiagnosticsPanel.tsx`：显示求解、约束、自由度和区域拓扑诊断。
- `index.ts`：诊断面板聚合导出。

#### `geometry/panels/workspace`

- `GeometryAuthoringPanel.tsx`：几何编辑工作区总装配。
- `GeometryRecipePanel.tsx`：拉伸、扫掠等几何配方设置。
- `SketchModePanel.tsx`：区域轮廓、中心线薄壁等草图模式切换。
- `SketchWorkspaceToolbar.tsx`：绘制、选择、撤销和视图工具栏。
- `SketchWorkspaceStatusBar.tsx`：当前工具、选择和求解状态。
- `GeometryRecipePanel.test.tsx`：几何配方面板测试。
- `index.ts`：工作区组件聚合导出。

### 3.11 规则阶段 `src/features/stages/rules`

- `RulesStage.tsx`：制造特征规则总页面；负责规则创建、特征类型切换、条件、定位和参数绑定。
- `RuleParameterPanel.tsx`：显示当前规则所需参数并提供创建入口。
- `ruleDefaultParameters.ts`：按特征类型生成默认参数，并维护参数与规则表达式绑定。
- `ruleParameterVisibility.ts`：没有规则时隐藏规则参数；存在规则时按特征类型显示对应参数。
- `RuleParameterPanel.test.tsx`：规则参数面板测试。
- `ruleDefaultParameters.test.ts`：默认参数 ID、冲突递增和表达式绑定测试。
- `ruleParameterVisibility.test.ts`：规则参数可见性测试。

内置参数直接使用业务名，例如 `holeDiameter`、`slotWidth`、`cutoutHeight`；重复时生成 `_2`、`_3` 后缀。

### 3.12 契约阶段 `src/features/stages/contract`

- `ContractStage.tsx`：契约阶段总装配。
- `ContractParametersPanel.tsx`：正式参数契约列表和编辑入口。
- `ContractOverridesPanel.tsx`：参数覆盖关系编辑。
- `ContractSimulationWorkspace.tsx`：模拟不同参数输入和变体覆盖结果。
- `ContractStage.test.tsx`：契约阶段页面测试。

原先独立的“参数辅助”界面已移除，参数查看和修改统一在正式参数区完成。

### 3.13 契约子组件 `src/features/stages/workflow`

- `contracts/ParameterContractCard.tsx`：单个参数契约卡片。
- `contracts/ParameterContractList.tsx`：参数契约列表。
- `contracts/ParameterCreateCard.tsx`：参数创建卡片。
- `interface/InterfaceEditor.tsx`：零部件接口定义编辑。
- `variant/VariantEditor.tsx`：变体和参数覆盖编辑。

### 3.14 验证阶段 `src/features/stages/review/compile`

- `ReviewStage.tsx`：阶段预检、CAD 编译和结果展示主入口。
- `RuleLocalPreview.tsx`：单条规则局部预览。
- `RulesSimulationPanel.tsx`：规则和参数组合模拟。
- `sweepPreviewAdmission.ts`：扫掠预览的前端准入检查。
- `sweepPreviewAdmission.test.ts`：扫掠准入测试。

### 3.15 发布阶段 `src/features/stages/review/admission`

- `AdmissionStage.tsx`：最终准入、发布说明、版本发布和历史版本展示。

## 4. 模板 API `services/template-api`

后端使用 FastAPI。路由层只负责 HTTP 输入输出和安全边界，具体业务放在 `app/services`。

### 4.1 API 顶层文件

- `app/__init__.py`：Python 包标记。
- `app/main.py`：FastAPI 入口；注册路由、中间件、身份绑定、草稿访问检查、写入审计、附件和产物静态目录。
- `app/config.py`：项目根目录、平台数据库、材料库、附件和 CAD 产物路径配置。
- `app/errors.py`：统一错误码和响应结构，输出 `code`、`message`、`action`、`fields`、`traceId`、`retryable` 和 `context`。
- `app/security.py`：签名 GUI Cookie、Agent Bearer Token、用户身份和共享工作区上下文。
- `app/repository.py`：SQLite Repository；管理草稿、历史修订、事件、材料绑定、编译记录、发布版本、工作区、审计和草稿归属。
- `app/events.py`：草稿差异摘要、进程内事件订阅和发布。
- `app/event_stream.py`：SSE 草稿事件流，支持断线后的事件补发和 keep-alive。
- `app/ai_actions.py`：结构化工程提案命令解析、候选草稿构造和差异生成；不调用外部大模型。

### 4.2 业务服务 `app/services`

- `__init__.py`：业务服务公共导出。
- `_common.py`：草稿查询、保存、修订检查、模板编码和附件路径等公共功能。
- `operations.py`：业务服务兼容聚合入口，供路由层统一导入。
- `draft.py`：草稿创建、命名创建、更新、复制、归档、恢复、回滚、附件和阶段完成。
- `workspace.py`：当前零部件选择、当前工程状态和工作区聚合查询。
- `context.py`：阶段校验所需的材料、编译和工程上下文组装。
- `material.py`：材料库查询、材料绑定创建和 reference/copy 解析。
- `material_assistance.py`：材料匹配预览、确认绑定、厚度参数同步和材料/几何复核。
- `parameters.py`：参数契约读取、批量值校验、修改预览、可接受性判断、确认写入和下游阶段复核。
- `sketch.py`：草图图元、约束、区域和设置的预览式修改、确定性求解和确认写入。
- `agent.py`：Agent 结构化提案预览和应用。
- `proposal.py`：提案应用过程中的草图坐标同步等辅助逻辑。
- `orchestration.py`：目标任务计划与执行；组合阶段完成、参数/草图/材料修复、CAD 编译和发布检查。
- `compile.py`：CAD Worker 进程调用、编译产物处理和 `.rwpart` 源包生成。
- `workflow.py`：CAD 编译、编译预览、规则试算、发布版本和发布准入流程。
- `write_context.py`：解析经过认证的 GUI/Agent 写入上下文，并对 Agent 强制检查 `baseRevision` 和 `confirmed`。

### 4.3 API 主要能力

```text
/template-drafts                     草稿创建、读取、更新、复制和归档
/workspace/current-draft             当前工作区零部件
/template-drafts/{id}/events         SSE 实时修订事件
/parameters                          参数契约、校验、预览和应用
/sketch                              草图求解、预览和应用
/material-binding                    材料预览和确认绑定
/stages/{stage}                      阶段校验和阶段完成
/assistant/tasks                     Agent 目标任务计划和执行
/compile                             CAD 编译
/evaluate                            参数和规则试算
/proposals                           结构化提案预览和应用
/publish                             发布
/rollback                            回滚为新修订
/audit-logs                          操作审计
```

## 5. 领域内核 `libs/python/template_core`

领域层不依赖 React、FastAPI 或 MCP，负责平台真正的工程语义和确定性规则。

- `__init__.py`：领域对象公共导出。
- `models.py`：模板草稿、阶段、参数、材料、草图、特征、编译和发布核心模型。
- `metamodel.py`：模板元模型、语义草图、语义面、特征操作和 CAD 计划数据结构。
- `material.py`：RuiWare 材料库只读访问、材料校验、有效厚度域和记录校验和。
- `rules.py`：表达式求值、参数解析、特征规则执行、语义面定位和接口解析。
- `sketch_solver.py`：确定性草图求解；处理几何约束、尺寸约束、自由度和最小/标称/最大工况。
- `lowering.py`：把高层模板语义转换为 CAD Worker 可执行的 `CanonicalPlan`。
- `registries.py`：制造分类、几何原型、参数类型等作者注册表。
- `stage1.py`：定义阶段校验、模板指纹和附件要求。
- `stages.py`：七阶段顺序、依赖和确定性校验规则。
- `sweep_path.py`：扫掠路径语义解析和拓扑定义。
- `sweep_path_sampling.py`：扫掠路径采样。
- `sweep_frames.py`：扫掠路径局部坐标系和截面姿态计算。

领域主数据流：

```text
TemplateDraft
    ↓ 参数和规则求值
语义草图 / 特征规则 / 材料上下文
    ↓ lowering.py
CanonicalPlan
    ↓ CAD Worker
OpenCascade B-Rep
```

## 6. CAD 执行器 `services/cad-worker`

### 6.1 执行入口

- `cad_worker/__init__.py`：Python 包标记。
- `cad_worker/cli.py`：独立进程命令行入口，读取执行计划并返回编译结果。
- `cad_worker/geometry.py`：几何执行总调度；构造基体、依次应用特征、检查语义面并导出结果。
- `cad_worker/exporters.py`：输出 STEP、STL、静态计划、诊断和语义映射。
- `cad_worker/postcheck.py`：B-Rep 有效性、实体数量和正体积后置检查。

### 6.2 几何算子 `cad_worker/operators`

- `__init__.py`：算子公共导出。
- `base_entities.py`：点、方向、Wire、Face、区域轮廓和基础切削实体构造。
- `body_ops.py`：拉伸、旋转、放样、折弯、中心线薄壁基体和语义面映射。
- `feature_ops.py`：圆孔、长圆孔、矩形孔、多边形切口和布尔加工特征。
- `sweep_ops.py`：直线/圆弧路径解析、局部坐标系、拐角延伸和截面扫掠。
- `legacy.py`：旧版算子兼容实现；新功能不应继续加入此文件。

### 6.3 兼容导入文件

- `cad_worker/base_entities.py`
- `cad_worker/body_ops.py`
- `cad_worker/feature_ops.py`
- `cad_worker/sweep_ops.py`

以上文件只转发旧导入路径，实际实现位于 `cad_worker/operators/`。

## 7. MCP 服务 `services/ruiware-mcp`

MCP 服务把外部 Agent 接入平台已经存在的业务能力，本身不保存模板，也不直接操作数据库。

### 7.1 顶层文件

- `README.md`：MCP 启动、环境变量、共享工作区和工具说明。
- `pyproject.toml`：MCP 包配置和命令行入口。
- `ruiware_mcp/__init__.py`：Python 包标记。
- `ruiware_mcp/server.py`：stdio MCP 服务入口、工具注册、契约准入和工具分发。
- `ruiware_mcp/api_client.py`：调用模板 API；重写受保护来源头，附加 Agent Token、共享工作区、修订和确认信息，并处理重试和结构化错误。

### 7.2 核心层 `ruiware_mcp/core`

- `__init__.py`：核心包标记。
- `contracts.py`：工具名称、必填参数、只读/写入属性和 MCP 协议版本兼容基线。
- `additional_tools.py`：扩展工具的 MCP 描述和输入 Schema。
- `protocol.py`：JSON-RPC 初始化、工具列表、工具调用和协议错误处理。
- `responses.py`：统一包装成功结果、API 错误和非法工具输入。

### 7.3 只读工具 `ruiware_mcp/tools/read`

- `__init__.py`：只读工具聚合导出。
- `draft_context.py`：读取指定草稿的完整工程上下文。
- `current_draft.py`：读取 GUI 当前选中的零部件及聚合工程状态。
- `attachments.py`：读取并校验草稿附件。
- `validation.py`：读取指定阶段的校验结果。
- `audit.py`：读取操作审计记录。

### 7.4 编辑工具 `ruiware_mcp/tools/authoring`

- `__init__.py`：编辑工具聚合导出。
- `parameters.py`：参数契约读取、参数校验、修改预览和确认应用。
- `sketch.py`：草图确定性求解，不保存草稿。
- `phase3.py`：草图编辑和材料绑定的预览/应用，以及材料搜索。
- `proposals.py`：结构化工程提案预览和确认提交。

### 7.5 工作流工具 `ruiware_mcp/tools/workflow`

- `__init__.py`：工作流工具聚合导出。
- `create_template.py`：按名称创建或复用模板，并切换共享工作区当前零部件。
- `compile.py`：触发 CAD 编译、读取最近编译、B-Rep 摘要和产物。
- `evaluation.py`：执行参数和规则试算，不保存草稿。
- `stages.py`：确认后完成阶段。
- `tasks.py`：目标任务计划和执行。
- `publish.py`：确认后发布当前修订。
- `rollback.py`：把历史修订恢复为一个新的当前修订。

### 7.6 指导工具 `ruiware_mcp/tools/guidance`

- `__init__.py`：指导工具聚合导出。
- `parameter_help.py`：解释参数定义、范围、单位和变体覆盖。
- `next_actions.py`：根据当前阶段和失败校验生成下一步工具建议。
- `explain_error.py`：把结构化错误转换成用户可执行的处理建议。

### 7.7 资源目录 `ruiware_mcp/resources`

- `__init__.py`：资源包标记；当前没有正式资源内容，后续可存放阶段指南和参数 Schema 说明。

### 7.8 MCP 数据流

```text
用户目标
    ↓
Agent / MCP 客户端
    ↓ JSON-RPC
server.py / core/protocol.py
    ↓ 工具契约检查
tools/read | authoring | workflow | guidance
    ↓
api_client.py
    ↓ Bearer Token + source=mcp + workspace + write context
Template API
    ↓
与 GUI 相同的业务服务、领域校验和 Repository
```

## 8. GUI 与 Agent 协作边界

### 8.1 身份和工作区

- GUI 使用签名 `ruiware_session` Cookie。
- Agent 使用 `Authorization: Bearer <RUIWARE_AGENT_TOKEN>`。
- GUI 和 MCP 默认使用工作区 `ruiware-main`。
- MCP 可通过 `RUIWARE_WORKSPACE_ID` 指定工作区。
- 工作区只负责定位当前零部件，不替代身份认证。
- Repository 使用 `owner_id:workspace_id` 作为工作区键，避免跨用户共享选择。

### 8.2 Agent 写入保护

- MCP 客户端剥离调用方伪造的来源头，再写入可信的 `actor=agent`、`source=mcp` 和 Bearer Token。
- API 不信任调用方直接声明的 Agent 来源；没有合法 Token 的伪造请求返回 `AUTHENTICATION_REQUIRED`。
- 受保护的 Agent 写入要求 `baseRevision` 和 `confirmed=true`。
- 业务服务先检查当前修订，Repository 在 `BEGIN IMMEDIATE` 事务内重新读取并再次检查修订。
- 过期写入统一返回 `DRAFT_REVISION_CONFLICT`。
- 参数、草图、材料和工程提案提供“预览 → 确认应用”能力，预览不落盘。

### 8.3 统一错误结构

```json
{
  "code": "DRAFT_REVISION_CONFLICT",
  "message": "草稿已被其他操作更新。",
  "action": "请刷新当前草稿，再重新提交你的修改。",
  "fields": [],
  "traceId": "...",
  "retryable": true,
  "context": {
    "expectedRevision": 10,
    "currentRevision": 11
  }
}
```

## 9. 数据存储

### 9.1 平台数据库 `data/platform.db`

主要表：

- `template_drafts`：当前草稿快照。
- `draft_revisions`：不可覆盖的历史修订。
- `draft_events`：SSE 断线补发使用的草稿变更事件。
- `material_bindings`：材料引用或复制绑定。
- `compile_runs`：CAD 编译记录。
- `template_versions`：不可变发布版本。
- `workspace_context`：每个用户工作区当前选择的零部件。
- `operation_audit`：GUI/Agent 操作审计。
- `draft_access`：草稿与所有者关系。

### 9.2 材料数据库 `ruiware.db`

- 平台通过 `RuiWareMaterialLibrary` 查询材料记录。
- `reference` 模式每次解析当前材料库记录并检查漂移。
- `copy` 模式保存冻结快照，便于复现历史结果。
- 模板草稿、修订和发布信息不写入 RuiWare 材料数据库。

### 9.3 文件存储

- `data/attachments/`：用户附件。
- `artifacts/<inputHash>/`：STEP、STL、计划、诊断和语义映射。
- `artifacts/packages/`：发布或下载使用的 `.rwpart` 源包。

## 10. 跨模块契约 `packages/contracts`

- `template-draft.schema.json`：模板草稿 JSON Schema。
- `material-binding.schema.json`：材料绑定 Schema。
- `source-attachment.schema.json`：附件 Schema。
- `stage-validation.schema.json`：阶段校验结果 Schema。

这些文件用于描述跨语言和跨进程数据格式，目前运行时的主要强类型校验仍由 Pydantic 和 TypeScript 类型承担。

## 11. 示例与脚本

### `examples`

- `generic-parametric-profile-3.0.json`：通用参数化型材示例，覆盖模板、草图、参数、材料、规则和阶段数据。

### `scripts`

- `seed_demo.py`：初始化演示数据。
- `reset-to-generic-sketch.py`：把指定模板重置为通用草图基线。

## 12. 测试结构 `tests`

后端测试由 `pyproject.toml` 配置，覆盖领域、API、CAD、MCP、安全和并发。

- `test_stage1.py`、`test_stage1_api.py`：定义阶段和附件流程。
- `test_rules.py`、`test_rules_semantic_face_locator.py`：参数规则和语义面规则。
- `test_geometry.py`、`test_lowering.py`：几何与 Lowering。
- `test_sweep_arc.py`、`test_sweep_frames.py`、`test_sweep_path_topology.py`：扫掠路径和坐标系。
- `test_semantic_face_locator.py`、`test_semantic_face_topology.py`、`test_semantic_face_final_acceptance.py`：语义面定位和最终准入。
- `test_cad_through_penetration.py`、`test_cad_legacy_locator_warning.py`：CAD 切削和兼容诊断。
- `test_materials.py`：材料库、材料绑定和漂移。
- `test_parameter_assistance.py`：参数契约、校验、预览和应用。
- `test_proposal_api.py`：结构化提案预览和应用。
- `test_orchestration.py`：Agent 目标任务计划与执行。
- `test_template_creation_api.py`、`test_create_template_mcp.py`：模板创建闭环。
- `test_workspace_context.py`：GUI/MCP 共享工作区和当前零部件。
- `test_draft_events.py`：草稿事件、差异摘要和 SSE。
- `test_agent_write_security.py`、`test_security_boundaries.py`、`test_write_context.py`：身份、来源和 Agent 写入保护。
- `test_audit_and_rollback.py`：审计和回滚。
- `test_phase5_api.py`、`test_phase5_mcp.py`：第五阶段 API/MCP 能力。
- `test_phase6_stability.py`：并发修订和稳定性。
- `test_mcp_retry.py`、`test_ruiware_mcp.py`：MCP 契约、请求上下文和重试。
- `test_api_errors.py`：统一错误格式。
- `test_full_workflow.py`：七阶段端到端流程。
- `test_config.py`、`test_registries.py`：路径配置和作者注册表。

前端测试与被测模块放在同一目录，主要覆盖草图交互、规则参数、契约页面、几何配方、SSE 同步和工作区状态。

## 13. 三条核心数据流

### 13.1 GUI 主线

```text
用户操作阶段页面
    ↓
阶段组件
    ↓
useDraftWorkspace / api/client.ts
    ↓
Template API
    ↓
业务服务
    ↓
template_core + Repository
    ↓
platform.db / artifacts
```

### 13.2 Agent 辅助线

```text
用户描述目标
    ↓
Agent 读取当前工程状态
    ↓
MCP 只读或预览工具
    ↓
返回差异、校验、风险和下一步建议
    ↓ 用户确认
MCP 写入工具（baseRevision + confirmed）
    ↓
Template API 统一业务流程
    ↓
新修订 + SSE 通知 GUI
```

### 13.3 CAD 编译线

```text
TemplateDraft
    ↓ rules.py / sketch_solver.py
已求值工程语义
    ↓ lowering.py
CanonicalPlan
    ↓ CAD Worker 独立进程
OpenCascade 几何算子
    ↓ postcheck.py
B-Rep 检查
    ↓ exporters.py
STEP / STL / diagnostics / semantic-map
```

## 14. 当前结构状态

已经形成的边界：

- `App.tsx` 主要负责阶段编排，具体业务已进入阶段目录。
- GUI 和 Agent 共用后端业务服务、领域规则和数据存储。
- 领域层不依赖界面和协议。
- CAD 算子已按基础实体、基体、加工特征和扫掠分类。
- GUI/Agent 修改通过 SSE 实时同步，不再依赖固定周期轮询。
- Agent 写入具备身份验证、确认、修订冲突、事务二次检查和审计。

当前仍较集中的文件：

- `features/stages/geometry/canvas/ParametricSketchCanvas.tsx`：同时承担画布渲染和多类指针交互。
- `features/stages/geometry/GeometryStage.tsx`：几何阶段状态和配方编排仍较多。
- `features/draft/useDraftWorkspace.ts`：草稿生命周期、同步、编译和发布集中在同一 Hook。
- `features/stages/rules/RulesStage.tsx`：规则列表、特征配置和参数绑定仍在同一阶段组件。
- `App.tsx` 和 `features/workflow/stageConfig.ts`：七阶段展示配置仍有重复。

## 15. 推荐阅读顺序

1. `README.md`：先了解平台目标和能力边界。
2. `apps/studio-web/src/App.tsx`：了解七阶段 GUI 主线。
3. `apps/studio-web/src/features/draft/useDraftWorkspace.ts`：了解前端状态、保存和同步。
4. `services/template-api/app/main.py`：了解 API 路由和安全中间件。
5. `services/template-api/app/services/`：了解业务动作如何实现。
6. `services/template-api/app/repository.py`：了解数据存储、修订和并发控制。
7. `libs/python/template_core/models.py`、`rules.py`、`sketch_solver.py`、`lowering.py`：了解工程规则。
8. `services/cad-worker/cad_worker/geometry.py` 和 `operators/`：了解三维生成。
9. `services/ruiware-mcp/ruiware_mcp/server.py` 和 `tools/`：了解 Agent 辅助线。

## 16. 本次文档更新

- 按 2026-09-19 当前目录重新整理前端、API、领域层、CAD Worker 和 MCP 文件职责。
- 将 GUI/Agent 同步机制从旧的定时轮询说明改为当前 SSE 事件流。
- 删除已经不存在的 `ParameterAssistancePanel` 描述，说明参数编辑统一进入正式契约参数区。
- 补充共享工作区、身份分离、双重修订检查和统一错误结构。
- 补充 `draft_events`、`draft_access`、`operation_audit` 等当前数据库表职责。
- 补充 `sweep_path*`、语义面、CAD 算子分类、MCP 创建/回滚/审计工具和当前测试分布。
