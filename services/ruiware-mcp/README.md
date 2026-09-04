# RuiWare MCP

本地 MCP 服务将外部工程助手接入 RuiWare 模板 API，平台本身不再配置或调用任何大模型。

启动前先运行模板 API（默认 `http://127.0.0.1:8010/api/v1`），然后以 stdio 方式启动：

```powershell
$env:RUIWARE_API_URL = "http://127.0.0.1:8010/api/v1"
python -m ruiware_mcp.server
```

将 `services/ruiware-mcp` 加入 MCP 客户端的 Python 模块搜索路径，或安装为本地包后使用 `ruiware-mcp` 命令。

可用工具：读取模板上下文和附件、确定性草图求解、提案预览、确认后提交提案、读取阶段校验、CAD 编译与结果检查、规则试算、阶段推进和 Agent 指引。提案提交与阶段推进会写入草稿，CAD 编译会记录编译结果；写入类工具仅在用户明确确认后调用。

当前 MCP 工具的名称、必填参数和读写属性记录在 `ruiware_mcp/core/contracts.py`，用于保证内部重构不破坏已有 Agent 调用。

当 Agent 需要读取 GUI 当前选中的零部件时，调用 `ruiware_get_current_draft_status`。该工具读取模板 API 的工作区选择；没有选择时会明确返回未选择，不会按最近更新时间猜测。

只读工具的实现位于 `ruiware_mcp/tools/read/`，包括草稿上下文、附件和阶段校验；`server.py` 仅保留兼容分发入口。
