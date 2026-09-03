# RuiWare MCP

本地 MCP 服务将外部工程助手接入 RuiWare 模板 API，平台本身不再配置或调用任何大模型。

启动前先运行模板 API（默认 `http://127.0.0.1:8010/api/v1`），然后以 stdio 方式启动：

```powershell
$env:RUIWARE_API_URL = "http://127.0.0.1:8010/api/v1"
python -m ruiware_mcp.server
```

将 `services/ruiware-mcp` 加入 MCP 客户端的 Python 模块搜索路径，或安装为本地包后使用 `ruiware-mcp` 命令。

可用工具：读取模板上下文和附件、确定性草图求解、提案预览、确认后提交提案、读取阶段校验。只有 `ruiware_submit_proposal` 会写入平台并创建新修订。

当前 MCP 工具的名称、必填参数和读写属性记录在 `ruiware_mcp/core/contracts.py`，用于保证内部重构不破坏已有 Agent 调用。

只读工具的实现位于 `ruiware_mcp/tools/read/`，包括草稿上下文、附件和阶段校验；`server.py` 仅保留兼容分发入口。
