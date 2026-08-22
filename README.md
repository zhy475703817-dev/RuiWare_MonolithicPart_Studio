# RuiWare 单体零部件模板生成平台

这是一个面向模板开发人员的单体零部件模板生成平台。设计平台和产品配置器只消费已发布版本，不直接使用本平台界面。

当前固定 `templateKind = monolithicPart`。焊接、铆接、粘接形成的组合零部件以及可拆装组件不在本平台建模。

## 当前可运行能力

1. 模板信息：草稿、附件、修订、复制、归档、回滚和 `.rwpart` 源包。
2. 材料与毛坯：只读接入现有 `ruiware.db` 材料库，支持引用/复制、来源校验、毛坯形态和制造路线。
3. 基准草图：通用二维参数化草图编辑器，支持点、直线、圆、圆弧、拖动、撤销/重做、参数尺寸、约束选取契约、加/减材区域和中心线＋厚度薄壁模式。
4. 约束求解：`parametric-sketch-3.0` 同时求解几何与尺寸约束，用雅可比矩阵秩计算自由度，并验证最小/标称/最大工况的区域拓扑。
5. 制造特征：圆孔、直长圆孔、矩形通孔均为可变数量集合，不需要条件化几何节点。
6. 三维审查：进程隔离的 OpenCascade B-Rep 编译，把闭合材料区域或连续薄壁中心线路径直接构造为权威实体，输出 STEP、STL、静态计划、诊断和语义映射。
7. 准入发布：当前输入哈希校验、单实体/正体积检查、复核人和版本说明、不可变发布版本。

平台不再内置 AI 聊天或外部模型配置。需要外部协作时，使用本地 MCP 读取工程上下文、预览结构化提案，并在工程师确认后写入新修订；见 [services/ruiware-mcp/README.md](services/ruiware-mcp/README.md)。

## 启动

Windows 用户可以直接双击项目根目录下的 `start-dev.bat`，脚本会后台启动 API 和前端，并自动打开工作台。

```powershell
cd G:\2026年科研\货架项目开发\RuiWare\template-engineering-platform
.\start-dev.ps1
```

- 工作台：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:8010/docs>

首次安装：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
bun install
```

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest -q
bun --cwd apps/studio-web run build
```

端到端测试真实生成参数化实心、带内腔圆环和集合特征 STEP/STL，同时覆盖七阶段完成、上游失效传播、修订恢复和不可变发布。

## 实现边界

当前生产基线包含直线/圆/圆弧约束草图、多环材料区域拉伸、连续直线段中心线＋厚度薄壁拉伸，以及圆孔/长圆孔/矩形通孔。中心线圆弧偏置、样条 B-Rep、折弯展开、车削、任意路径扫掠和多截面放样尚未进入稳定算子包，界面或求解器会明确阻断未支持的模式。

详细说明见 [docs/PLATFORM-DEVELOPMENT-HANDBOOK.md](docs/PLATFORM-DEVELOPMENT-HANDBOOK.md)、[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 和 [docs/UNIFIED-METAMODEL.md](docs/UNIFIED-METAMODEL.md)；可执行示例见 [examples/generic-parametric-profile-3.0.json](examples/generic-parametric-profile-3.0.json)。

交付到其他电脑时，请按 [docs/DELIVERY-AND-DEPLOYMENT.md](docs/DELIVERY-AND-DEPLOYMENT.md) 打包与安装；不要依赖直接复制当前开发机的 `.venv` 或 `node_modules`。
