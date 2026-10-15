# RuiWare 模板工程平台：清理、交付与部署

## 1. 是否可以直接压缩复制

可以交付为压缩包，但推荐交付“**源码 + 业务数据**”包，而不是把开发电脑上的全部目录（特别是 `.venv` 与 `node_modules`）直接压缩过去。

直接复制整个目录只有在以下条件同时满足时才可能直接运行：目标电脑同为 64 位 Windows、Python 与二进制 CAD 依赖完全兼容、Bun 已可用，并且材料库路径仍正确。虚拟环境可能包含绝对路径和本机二进制依赖；`node_modules` 体积大且可由锁文件重建。因此它不是可靠的交付方式。

## 2. 必须交付的内容

压缩包应包含当前目录中的：

```text
apps/
docs/
examples/
libs/
packages/
scripts/
services/
tests/                         # 需要可复现验证时保留
data/platform.db               # 模板草稿、修订、版本元数据
data/attachments/              # 模板引用的图片、图纸等证据
ruiware.db                     # 只读材料库（默认从平台根目录读取）
bun.lock
package.json
pyproject.toml
start-dev.ps1
README.md
CONVERSATION-HANDOFF.md
```

还必须提供平台根目录中的材料库：

```text
template-engineering-platform/
├─ ruiware.db
├─ data/platform.db
└─ data/attachments/
```

也可以把材料库放在任意位置，并在启动前设置：

```powershell
$env:RUIWARE_MATERIAL_DB = 'D:\RuiWare-data\ruiware.db'
```

没有材料库时，平台可能可以打开已有模板，但材料搜索、材料绑定和完整材料校验不能正常使用。

## 3. 不应交付的可再生内容

以下内容不包含业务真值，可在目标机器重新生成：

```text
.venv/
node_modules/
apps/studio-web/dist/
.pytest_cache/
.pytest-tmp/
**/__pycache__/
*.pyc
*.log
artifacts/                     # 无已发布版本引用时可删除；编译后会再生成
data/pytest-*/
data/test-runs/
data/assistant-settings.json   # 已移除平台内置 AI 后不再使用
```

注意：若 `data/platform.db` 中已有发布版本，先检查其 `source_package_url` 是否仍引用 `artifacts/` 下的源包；这类产物必须一并交付。当前清理前已检查，本地数据库中没有发布版本和编译记录，所以历史调试 `artifacts/` 可安全删除。

## 4. 目标电脑安装与启动

前提：Windows 64 位、Python 3.12 或更高版本、Bun 已安装并在 `PATH` 中。建议安装 Microsoft Visual C++ Runtime，以确保 OpenCascade 相关二进制依赖可加载。

解压后，在平台根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
bun install
.\start-dev.ps1
```

默认地址：

- Studio：`http://127.0.0.1:5173`
- API 文档：`http://127.0.0.1:8010/docs`

首次启动后建议打开 Studio、选择一个模板、运行“阶段检查”；需要验证 CAD 时，再运行“B-Rep 编译”。

## 5. 建议的交付前检查

```powershell
.\.venv\Scripts\python.exe -m pytest -q
bun --cwd apps/studio-web run build
```

将以下信息随压缩包交接：

1. Python 与 Bun 版本；
2. `ruiware.db` 的实际位置和校验值；
3. `data/platform.db` 的备份日期；
4. 是否存在发布版本及需要保留的 `artifacts/`；
5. `docs/PLATFORM-DEVELOPMENT-HANDBOOK.md` 和 `CONVERSATION-HANDOFF.md`。
