# RuiWare MCP

本地 MCP 服务将外部工程助手接入 RuiWare 模板 API，平台本身不再配置或调用任何大模型。

启动前先运行模板 API（默认 `http://127.0.0.1:8010/api/v1`），然后以 stdio 方式启动：

```powershell
$env:RUIWARE_API_URL = "http://127.0.0.1:8010/api/v1"
# GUI 与 Agent 需要读取同一个当前零部件时使用相同工作区；默认值就是 ruiware-main
$env:RUIWARE_WORKSPACE_ID = "ruiware-main"
python -m ruiware_mcp.server
```

将 `services/ruiware-mcp` 加入 MCP 客户端的 Python 模块搜索路径，或安装为本地包后使用 `ruiware-mcp` 命令。

可用工具：读取模板上下文和附件、确定性草图求解、提案预览、确认后提交提案、读取阶段校验、CAD 编译与结果检查、规则试算、阶段推进和 Agent 指引。所有 MCP POST/PUT 请求都会固定标记为 Agent 来源，不能伪装成 GUI 请求。

提案提交、参数/草图/材料写入、阶段完成、任务执行、CAD 编译、发布和回滚均必须传入当前 `baseRevision` 与 `confirmed=true`。创建模板必须传入 `name` 与 `confirmed=true`，随后切换 GUI 当前零部件时会继续透传确认状态。模板 API 会在业务执行前拒绝未确认或版本过期的请求；GUI 既有调用方式保持不变。

当前 MCP 工具的名称、必填参数和读写属性记录在 `ruiware_mcp/core/contracts.py`，用于保证内部重构不破坏已有 Agent 调用。

当 Agent 需要读取 GUI 当前选中的零部件时，调用 `ruiware_get_current_draft_status`。该工具读取模板 API 的工作区选择；没有选择时会明确返回未选择，不会按最近更新时间猜测。

GUI 和 MCP 默认共享工作区 `ruiware-main`。工作区只用于定位当前零部件，不代替身份认证：GUI 仍使用签名 `ruiware_session` Cookie，MCP 仍必须使用 Agent Bearer Token。不同用户的数据仍按用户和工作区隔离；旧的 `RUIWARE_SESSION_ID` 仍可作为兼容回退。

只读工具的实现位于 `ruiware_mcp/tools/read/`，包括草稿上下文、附件和阶段校验；`server.py` 仅保留兼容分发入口。
