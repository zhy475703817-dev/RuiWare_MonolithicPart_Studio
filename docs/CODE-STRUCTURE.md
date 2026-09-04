# 当前代码结构说明

> 这份文档按当前仓库真实目录整理，重点是“GUI-first 为主，Agent 辅助为辅”的运行结构。
> `docs/` 下的内容都是说明文档，不参与业务运行。

## 1. 总体分层

- `apps/studio-web`：前端工作台，负责 GUI 交互、阶段页面、草图编辑和结果查看。
- `services/template-api`：后端主 API，负责草稿、材料、阶段、编译、发布和统一错误。
- `services/cad-worker`：独立 CAD 执行进程，负责把计划真正落成几何结果。
- `libs/python/template_core`：纯领域层，放模型、规则、阶段校验、草图求解和 Lowering。
- `services/ruiware-mcp`：面向外部 Agent / MCP 的接入桥接。
- `docs`：架构、开发、发布和流程说明。

## 2. 前端 `apps/studio-web`

### 2.1 顶层文件

- `src/main.tsx`：前端入口，挂载 React 应用。
- `src/App.tsx`：主界面总装配，组织工作台、阶段切换、草稿状态和页面级交互。
- `src/styles.css`：全局样式。
- `src/types.ts`：前端共享类型定义。
- `src/api.ts`：前端 API 的兼容出口，向上层屏蔽具体请求实现。

### 2.2 API 层

- `src/api/client.ts`：HTTP 客户端封装，负责和后端通信。
- `src/api/errors.ts`：前端统一错误结构、错误码转换和提示文案。

### 2.3 通用组件

- `src/components/layout/WorkspaceShell.tsx`：工作台外壳布局。
- `src/components/review/CadViewer.tsx`：编译结果 / 几何结果查看器。
- `src/components/ui/FormParts.tsx`：表单基础组件。
- `src/components/ui/Toast.tsx`：轻量提示组件。

### 2.4 工作流与草稿状态

- `src/features/workflow/stageConfig.ts`：七个阶段的固定顺序和展示配置。
- `src/features/draft/useDraftWorkspace.ts`：跨阶段状态管理、草稿加载、保存、发布和统一提示。

### 2.5 语义建模与参数规则

- `src/features/authoring/authoringUtils.ts`：参数命名、作用域、约束标签、引用改写和作者侧规则。

### 2.6 草图核心

- `src/features/sketch/sketchAuthoringCore.ts`：草图克隆、拓扑整理、端点传播等核心工具。
- `src/features/sketch/sketchArc.ts`：圆弧计算和圆弧相关几何。
- `src/features/sketch/sketchBoxSelection.ts`：框选逻辑。
- `src/features/sketch/sketchEntityEditing.ts`：图元编辑逻辑。
- `src/features/sketch/sketchGeometryCommit.ts`：草图编辑提交与参数回写。
- `src/features/sketch/sketchLineInference.ts`：线段推断逻辑。
- `src/features/sketch/sketchLineMath.ts`：线段几何数学。
- `src/features/sketch/sketchNumberNormalization.ts`：数字归一化与精度处理。
- `src/features/sketch/sketchObjectSnap.ts`：对象捕捉与吸附。
- `src/features/sketch/sketchPointerInteraction.ts`：鼠标 / 指针交互状态机。
- `src/features/sketch/sketchPolyline.ts`：折线绘制状态。
- `src/features/sketch/sketchThinwallOffset.ts`：中心线薄壁偏移生成。
- `src/features/sketch/sketchViewport.ts`：视图坐标、缩放和平移。

### 2.7 草图测试

- `src/features/sketch/*.test.ts`：对应草图模块的单元测试，用于校验交互和几何行为。

### 2.8 阶段页面总览

当前阶段页面已经按职责拆分，不再把所有内容堆在 `App.tsx` 里：

- `src/features/stages/geometry/*`：草图、尺寸、约束、诊断和几何编辑主线。
- `src/features/stages/material/*`：材料范围、毛坯和验证矩阵。
- `src/features/stages/contract/*`：参数契约、覆盖项和模拟工作区。
- `src/features/stages/workflow/*`：模板信息、接口、变体和参数契约的子模块。
- `src/features/stages/review/*`：编译验证与准入发布。

### 2.9 `geometry` 目录

- `index.ts`：geometry 目录聚合出口，对外统一暴露阶段入口与常用 Hook。
- `GeometryStage.tsx`：几何阶段总装配层，只做页面编排和组件组合。
- `hooks/useGeometryEditFlow.ts`：几何编辑流程 Hook，承载拖动、撤销、冲突和提交动作。
- `logic/geometryStageLogic.ts`：几何阶段公共逻辑、配方常量和工具函数。
- `canvas/ParametricSketchCanvas.tsx`：参数化草图画布。
- `canvas/canvasLogic.ts`：草图画布交互逻辑。
- `panels/workspace/GeometryAuthoringPanel.tsx`：几何阶段主面板，总装配草图编辑相关模块。
- `panels/workspace/GeometryRecipePanel.tsx`：几何配方编辑入口。
- `panels/workspace/SketchModePanel.tsx`：草图模式切换。
- `panels/workspace/SketchWorkspaceToolbar.tsx`：草图工具栏。
- `panels/workspace/SketchWorkspaceStatusBar.tsx`：草图状态栏。
- `panels/constraints/SketchConstraintList.tsx`：草图约束列表和编辑。
- `panels/constraints/SketchEntityList.tsx`：草图图元列表。
- `panels/constraints/SketchSelectedEntityEditor.tsx`：选中图元编辑器。
- `panels/intent/SketchIntentEditor.tsx`：草图意图编辑主面板。
- `panels/intent/SketchIntentTabs.tsx`：草图意图标签页切换。
- `panels/intent/SketchIntentConfirmation.tsx`：草图意图确认。
- `panels/intent/SketchEditConflictDialog.tsx`：草图编辑冲突处理对话框。
- `panels/dimension/SketchDimensionPanel.tsx`：尺寸、参数创建和参数契约入口。
- `panels/dimension/DimensionCreationBar.tsx`：尺寸创建入口。
- `panels/regions/SketchRegionPanel.tsx`：草图区域面板。
- `panels/diagnostics/SketchDiagnosticsPanel.tsx`：草图诊断信息展示。
- `panels/*/index.ts`：各子目录出口文件，方便按功能聚合导入。

### 2.10 `material` 目录

- `MaterialScopePanel.tsx`：材料适用范围设置。
- `MaterialSupplyBlankPanel.tsx`：毛坯和供料信息编辑。
- `MaterialValidationMatrix.tsx`：材料验证矩阵。

### 2.11 `contract` 目录

- `ContractParametersPanel.tsx`：参数契约总面板。
- `ContractOverridesPanel.tsx`：契约覆盖项编辑。
- `ContractSimulationWorkspace.tsx`：契约模拟工作区。

### 2.12 `workflow` 目录

- `template/TemplateInfo.tsx`：模板信息阶段。
- `interface/InterfaceEditor.tsx`：接口编辑。
- `variant/VariantEditor.tsx`：变体编辑。
- `contracts/ParameterContractCard.tsx`：单个参数契约卡片。
- `contracts/ParameterContractList.tsx`：参数契约列表。
- `contracts/ParameterCreateCard.tsx`：参数创建卡片。

### 2.13 `review` 目录

- `compile/ReviewStage.tsx`：编译与验证阶段主入口。
- `compile/RuleLocalPreview.tsx`：规则局部预览。
- `compile/RulesSimulationPanel.tsx`：规则模拟面板。
- `admission/AdmissionStage.tsx`：发布准入阶段。

## 3. 后端 `services/template-api`

### 3.1 顶层入口

- `app/main.py`：FastAPI 入口，路由、启动装配、静态资源挂载。
- `app/config.py`：路径、数据库和运行配置。
- `app/errors.py`：统一错误码、错误响应和异常处理。
- `app/repository.py`：SQLite 持久层，管理草稿、绑定、编译记录和版本。
- `app/ai_actions.py`：AI 提案解析、比对和应用。

### 3.2 业务服务层

- `app/services/_common.py`：公共服务辅助函数，如草稿保存、附件路径、ID 生成。
- `app/services/agent.py`：Agent 侧动作封装。
- `app/services/compile.py`：编译与预览流程。
- `app/services/context.py`：上下文汇总与查询。
- `app/services/draft.py`：草稿生命周期操作。
- `app/services/material.py`：材料绑定、解析和查询。
- `app/services/operations.py`：对外业务操作总入口。
- `app/services/proposal.py`：提案预览与应用。
- `app/services/workflow.py`：阶段流转与阶段校验。

## 4. 领域层 `libs/python/template_core`

- `__init__.py`：对外导出核心领域对象。
- `models.py`：模板、阶段、编译和草图的核心数据模型。
- `metamodel.py`：模板元模型与语义对象定义。
- `material.py`：材料域、有效厚度域和材料匹配逻辑。
- `lowering.py`：把模板语义下沉为可执行 CAD 计划。
- `rules.py`：表达式、规则和参数求值。
- `registries.py`：模板作者注册表。
- `stage1.py`：第一阶段模板信息校验与指纹。
- `stages.py`：整条阶段链路的校验规则。
- `sketch_solver.py`：确定性草图求解器。

## 5. CAD 执行器 `services/cad-worker`

- `cad_worker/__init__.py`：包标记文件。
- `cad_worker/cli.py`：命令行入口，读取计划并执行。
- `cad_worker/geometry.py`：几何执行总入口，负责调度整个执行链。
- `cad_worker/body_ops.py`：基础实体生成、放样、折弯、薄壁中心线等实体算子。
- `cad_worker/feature_ops.py`：加工特征与布尔切削算子。
- `cad_worker/sweep_ops.py`：扫掠相关算子与路径处理。
- `cad_worker/exporters.py`：STEP / STL / 语义图 / 诊断文件导出。
- `cad_worker/postcheck.py`：B-Rep 后置检查与实体数量统计。

## 6. MCP 接入 `services/ruiware-mcp`

- `README.md`：MCP 服务启动方式、依赖的模板 API 和当前工具说明。
- `pyproject.toml`：MCP 服务的 Python 包配置和 `ruiware-mcp` 启动命令。
- `ruiware_mcp/__init__.py`：MCP Python 包标记文件。
- `ruiware_mcp/api_client.py`：调用模板 API 的 HTTP 客户端；负责请求发送、JSON 解析和 API 错误转换。
- `ruiware_mcp/server.py`：MCP stdio 启动入口和兼容分发入口；保留现有工具名称与业务调用方式。

### 6.1 MCP 核心层 `ruiware_mcp/core`

- `__init__.py`：核心基础设施包说明。
- `contracts.py`：MCP 对外接口兼容基线，记录协议版本、服务信息、工具名称、必填参数以及只读 / 写入属性。
- `additional_tools.py`：后三阶段新增工具的 MCP 描述，集中维护 CAD、试算、Agent 指引和阶段推进工具的名称及输入 Schema。
- `protocol.py`：处理 JSON-RPC 的初始化、工具列表、工具调用、未知方法和非法 JSON 请求。
- `responses.py`：统一包装成功结果、API 错误和工具输入错误，保证 Agent 能读取结构化错误。

### 6.2 MCP 工具层 `ruiware_mcp/tools`

- `__init__.py`：工具层包说明。
- `read/__init__.py`：只读工具的统一导出入口。
- `read/draft_context.py`：调用模板 API 读取指定草稿的完整工程上下文；不修改数据。
- `read/current_draft.py`：读取 GUI 通过工作区上下文保存的当前零部件；没有当前选择时明确返回未选择，不按更新时间兜底。
- `read/attachments.py`：读取草稿附件列表并筛选指定附件；附件不属于当前草稿时返回结构化错误。
- `read/validation.py`：读取指定模板阶段的确定性校验结果；不修改数据。
- `authoring/__init__.py`：编辑和提案工具的统一导出入口。
- `authoring/sketch.py`：调用草图确定性求解接口，不保存草稿。
- `authoring/proposals.py`：调用提案预览和提案提交接口；提交操作会产生新修订。
- `workflow/__init__.py`：CAD、规则试算和阶段推进工具的统一导出入口。
- `workflow/compile.py`：调用 CAD 编译、读取最近编译、提取 B-Rep 摘要和导出产物地址。
- `workflow/evaluation.py`：调用模板规则试算接口，不保存草稿。
- `workflow/stages.py`：调用阶段完成接口，由 API 再次校验通过后更新阶段状态。
- `guidance/__init__.py`：Agent 指引工具的统一导出入口。
- `guidance/parameter_help.py`：从当前草稿读取参数契约和变体覆盖，帮助 Agent 补全输入。
- `guidance/next_actions.py`：根据阶段状态和校验结果给出下一步工具建议，不擅自修改数据。
- `guidance/explain_error.py`：把结构化错误整理成用户可理解的处理建议。

### 6.3 MCP 资源层 `ruiware_mcp/resources`

- `__init__.py`：Agent 资源包说明；后续用于放置工具能力目录、阶段指南和参数 Schema 说明。

### 6.4 当前 MCP 数据流

```text
Agent / MCP 客户端
        ↓ JSON-RPC
server.py
        ↓
core/protocol.py
        ↓
McpApplication.call_tool()
        ↓
tools/read/*
        ↓
api_client.py
        ↓ HTTP
services/template-api
        ↓
业务服务 / Repository / 领域层
```

当前已经完成 MCP 接口冻结、核心协议拆分、只读工具拆分，以及编辑提案、CAD 工作流和 Agent 指引工具接入。`resources` 目录仍作为后续工具目录、阶段指南和参数 Schema 资源的扩展位置。

GUI 切换零部件时调用 `/api/v1/workspace/current-draft` 保存 `draftId`；MCP 工具 `ruiware_get_current_draft_status` 读取同一工作区选择，因此 Agent 返回的工程状态与 GUI 当前选中项保持一致。

### 6.5 Agent 辅助线现状

当前项目采用“GUI-first、Agent 辅助”的双线结构：GUI 负责主要编辑流程和人工确认，Agent 通过 MCP 读取上下文、分析问题、生成建议，并在用户确认后调用写入工具。Agent 不直接操作数据库，也不绕过模板 API 和领域校验。

当前 Agent 辅助线已经具备以下能力：

- 读取 GUI 当前选中的零部件及完整工程状态。
- 读取指定草稿、附件和阶段校验结果。
- 查询参数定义、参数范围和变体覆盖关系。
- 进行草图确定性求解和规则试算，不直接保存结果。
- 生成工程提案并预览参数、草图和结构差异。
- 在用户确认后提交提案并生成新修订。
- 执行 CAD 编译，读取编译结果、B-Rep 摘要和导出产物。
- 根据阶段校验结果解释错误并提供下一步建议。
- 在校验通过后推进阶段状态。

当前 Agent 数据流如下：

```text
用户自然语言目标
        ↓
Agent / MCP 客户端
        ↓ 读取
当前 GUI 选择 / 草稿上下文 / 参数契约 / 阶段校验
        ↓ 分析
参数建议 / 草图提案 / 材料建议 / 下一步计划
        ↓ 预览
差异、影响范围、风险和校验结果
        ↓ 用户确认
MCP 写入工具
        ↓
模板 API 业务服务
        ↓
Repository + 领域模型 + 阶段校验
        ↓
新修订 / 编译结果 / GUI 刷新
```

### 6.6 Agent 辅助线尚待完善的部分

以下内容是后续完善重点，不改变 GUI 主线的业务入口：

1. **GUI 与 Agent 修改后的状态同步**
   - Agent 写入新修订后，GUI 自动刷新当前零部件。
   - GUI 显示“Agent 已修改，请查看变更”的提示。
   - GUI 和 Agent 同时编辑时显示版本冲突，而不是静默覆盖。

2. **参数辅助操作闭环**
   - 增加批量读取参数、参数值校验、参数修改预览和确认提交能力。
   - 让 Agent 能直接完成“把长度改为 2000 mm”这类业务动作，而不必自行拼装底层提案。
   - 修改后自动重新检查受影响的草图、规则、契约和验证阶段。

3. **草图和材料业务工具**
   - 增加草图图元、约束、闭合关系和尺寸的预览式编辑能力。
   - 增加材料搜索、材料匹配、材料绑定预览和确认提交能力。
   - 材料变化后重新计算壁厚并触发相关几何校验。

4. **面向目标的业务动作编排**
   - 在底层工具之上增加“检查当前阶段”“修复当前错误”“准备 CAD 编译”等组合动作。
   - `get_next_actions` 返回可直接执行的工具名和完整参数，而不仅是文字建议。
   - Agent 可以按照阶段依赖自动组织读取、预览、确认、提交和验证流程。

5. **确认、并发和审计机制**
   - 所有写操作统一经过预览和用户确认。
   - 所有写操作携带 `baseRevision`，统一处理版本冲突和重试。
   - 记录操作来源、修改前后差异、操作者、时间和关联修订。
   - 支持 Agent 修改的撤销和重新读取后重试。

6. **Agent 资源和稳定性测试**
   - 在 `ruiware_mcp/resources` 中补充阶段指南、参数 Schema 和工具使用说明。
   - 增加 MCP 契约、GUI 刷新、并发修改、参数越界、草图退化和 CAD 失败恢复测试。

因此，当前 MCP 线已经完成“读取 → 分析 → 建议 → 预览 → 确认 → 写入 → 校验”的基础骨架；下一步的核心是补齐“写入后 GUI 自动同步”，形成真正可用的 Agent 参数辅助闭环。

## 7. 现有文档

- `docs/ARCHITECTURE.md`：当前架构说明。
- `docs/DEVELOPMENT.md`：开发说明。
- `docs/DELIVERY-AND-DEPLOYMENT.md`：交付与部署说明。
- `docs/GEOMETRY-STUDIO-USER-GUIDE.md`：几何工作台使用说明。
- `docs/PHASE-1.md`：阶段一说明。
- `docs/PLATFORM-DEVELOPMENT-HANDBOOK.md`：平台开发手册。
- `docs/TEMPLATE-GENERATION-FLOW.md`：模板生成流程说明。
- `docs/UNIFIED-METAMODEL.md`：统一元模型说明。
- `docs/USER-GUIDE.md`：用户说明。
- `docs/adr/*.md`：架构决策记录。

## 8. 读法建议

- 先看 `apps/studio-web/src/App.tsx` 和 `src/features/draft/useDraftWorkspace.ts`，能最快理解 GUI 主线。
- 再看 `services/template-api/app/main.py`、`app/repository.py` 和 `app/services/operations.py`，能理解后端业务流。
- 最后看 `libs/python/template_core`，能理解参数、阶段、草图和 Lowering 的真正规则。
