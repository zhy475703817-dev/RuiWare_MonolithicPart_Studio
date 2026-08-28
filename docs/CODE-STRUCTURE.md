# 当前项目代码结构说明

> 说明：这份文档按当前仓库的实际源码整理，重点放在“GUI 主线 + Agent 辅助线”的运行结构。  
> 其中 `docs/` 下的文件属于说明文档，不参与业务运行。

## 1. 总体分层

- `apps/studio-web`：前端工作台，负责 GUI 交互、阶段页面和草图编辑。
- `services/template-api`：后端主 API，负责草稿、材料、阶段、编译、发布和统一错误。
- `services/cad-worker`：隔离的 CAD 执行进程，负责把计划真正落到几何结果。
- `libs/python/template_core`：纯领域层，放模型、规则、阶段校验、草图求解和 Lowering。
- `services/ruiware-mcp`：面向外部 Agent / MCP 的接入桥接。
- `docs`：架构、开发、发布和流程说明。

## 2. 前端 `apps/studio-web`

### 2.1 顶层文件

- `src/main.tsx`：前端入口，挂载 React 应用。
- `src/App.tsx`：主界面总装配，组织工作台、阶段切换和页面级交互。
- `src/styles.css`：全局样式。
- `src/types.ts`：前端共享类型定义。
- `src/api.ts`：前端 API 对外统一出口。

### 2.2 API 层

- `src/api/client.ts`：HTTP 客户端封装，负责和后端通信。
- `src/api/errors.ts`：前端统一错误结构和错误提示转换。

### 2.3 布局与通用 UI

- `src/components/layout/WorkspaceShell.tsx`：工作台外壳布局。
- `src/components/review/CadViewer.tsx`：编译结果 / 几何结果查看器。
- `src/components/ui/FormParts.tsx`：表单基础组件。
- `src/components/ui/Toast.tsx`：轻量提示组件。

### 2.4 工作流与草稿状态

- `src/features/workflow/stageConfig.ts`：七个阶段的固定顺序和展示配置。
- `src/features/draft/useDraftWorkspace.ts`：跨阶段状态管理、草稿加载、保存、发布、统一错误展示。

### 2.5 语义建模与参数规则

- `src/features/authoring/authoringUtils.ts`：参数命名、作用域、约束标签和作者侧规则。

### 2.6 草图域

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

### 2.8 阶段页面

- `src/features/stages/AdmissionStage.tsx`：发布准入阶段。
- `src/features/stages/ContractOverridesPanel.tsx`：契约覆盖项编辑。
- `src/features/stages/ContractParametersPanel.tsx`：契约参数编辑。
- `src/features/stages/ContractSimulationWorkspace.tsx`：契约模拟工作区。
- `src/features/stages/DimensionCreationBar.tsx`：尺寸创建入口。
- `src/features/stages/InterfaceEditor.tsx`：接口编辑。
- `src/features/stages/MaterialScopePanel.tsx`：材料适用范围。
- `src/features/stages/MaterialSupplyBlankPanel.tsx`：毛坯与供料信息。
- `src/features/stages/MaterialValidationMatrix.tsx`：材料验证矩阵。
- `src/features/stages/ParameterContractCard.tsx`：单个参数契约卡片。
- `src/features/stages/ParameterContractList.tsx`：参数契约列表。
- `src/features/stages/ParameterCreateCard.tsx`：参数创建卡片。
- `src/features/stages/ReviewStage.tsx`：编译与验证阶段。
- `src/features/stages/RuleLocalPreview.tsx`：规则局部预览。
- `src/features/stages/RulesSimulationPanel.tsx`：规则模拟面板。
- `src/features/stages/SketchConstraintList.tsx`：草图约束列表。
- `src/features/stages/SketchDiagnosticsPanel.tsx`：草图诊断面板。
- `src/features/stages/SketchDimensionPanel.tsx`：草图尺寸面板。
- `src/features/stages/SketchEditConflictDialog.tsx`：草图编辑冲突对话框。
- `src/features/stages/SketchEntityList.tsx`：草图图元列表。
- `src/features/stages/SketchIntentConfirmation.tsx`：草图意图确认。
- `src/features/stages/SketchIntentEditor.tsx`：草图意图编辑主面板。
- `src/features/stages/SketchIntentTabs.tsx`：草图意图标签页。
- `src/features/stages/SketchModePanel.tsx`：草图模式切换。
- `src/features/stages/SketchRegionPanel.tsx`：草图区域面板。
- `src/features/stages/SketchSelectedEntityEditor.tsx`：选中图元编辑器。
- `src/features/stages/SketchWorkspaceStatusBar.tsx`：草图状态栏。
- `src/features/stages/SketchWorkspaceToolbar.tsx`：草图工具栏。
- `src/features/stages/TemplateInfo.tsx`：模板定义阶段。
- `src/features/stages/useGeometryEditFlow.ts`：几何编辑流程 hook，承载拖动、撤销、冲突和提交动作。
- `src/features/stages/VariantEditor.tsx`：变体编辑。

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
- `cad_worker/geometry.py`：几何执行实现，把计划变成结果。

## 6. MCP 接入 `services/ruiware-mcp`

- `README.md`：MCP 服务使用说明。
- `pyproject.toml`：该服务的 Python 构建配置。
- `ruiware_mcp/__init__.py`：包标记文件。
- `ruiware_mcp/api_client.py`：对外部 RuiWare API 的调用封装。
- `ruiware_mcp/server.py`：MCP 服务入口与工具暴露。

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

- 先看 `apps/studio-web/src/App.tsx` 和 `useDraftWorkspace.ts`，能最快理解 GUI 主线。
- 再看 `services/template-api/app/main.py`、`repository.py` 和 `services/operations.py`，能理解后端业务流。
- 最后看 `libs/python/template_core`，能理解参数、阶段、草图和 Lowering 的真正规则。

