# 构件成果与同步

`components/` 保存八个构件的最新 `.rwpart` 源包，`manifest.json` 记录名称、修订及 SHA-256。模板包可作为 ZIP 检查其参数、草图、材料快照及重建说明；它不等于完整的运行数据库，也不自动包含 STEP/STL 文件。

在 D 盘项目完成一轮修改并验证后，双击根目录 `sync-github.bat`，或执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/sync-github.ps1
```

只预览：加 `-Preview`。脚本先核对当前数据库中的八个构件修订与已有模板包是否一致；缺包时停止，请先在 RuiWare 重新导出模板包。不会上传陈旧修订冒充最新成果。

代码和成果只提交到 `en888-jpg`，不修改 `master`。运行时数据库、材料库、缓存、日志、备份及对话记录不上传。GitHub 仓库是公开的，因此被提交的代码和构件包可被公众下载。同步不等于工程设计复核或正式发布。

已为本项目配置 `127.0.0.1:7897` GitHub 代理；使用时须保持该代理可用。网络失败时，本地提交保留，再次运行即可重试推送。不会强制覆盖远程修改；遇到冲突应人工处理。
