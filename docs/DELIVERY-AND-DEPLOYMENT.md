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

## 共享模板 MinIO 配置

每台电脑只配置自己的 MinIO 账号，密钥只保存在本机环境变量中，不写入 Git、前端代码或文档。

```powershell
$env:RUIWARE_MINIO_ENDPOINT = '100.94.35.61:9000'
$env:RUIWARE_MINIO_ACCESS_KEY = 'JJM'
$env:RUIWARE_MINIO_SECRET_KEY = '本机账号密钥'
$env:RUIWARE_MINIO_BUCKET = 'ruiware-templates'
$env:RUIWARE_MINIO_PREFIX = 'publishers/JJM'
$env:RUIWARE_MINIO_READ_PREFIX = 'publishers'
$env:RUIWARE_MINIO_SECURE = 'false'
```

将 `JJM` 和密钥替换为当前成员自己的账号。程序先完成本地发布，再尝试上传远程包；远程不可用时，本地发布仍然保留。

远程对象为 `publishers/<成员>/<publicationId>/template.rwpart` 和同目录下的 `metadata.json`。下载时会校验 SHA-256，校验失败不会返回文件。

## 对外模板接口

平台需要读取共享模板时，不要直接连接 MinIO，也不要向平台发放成员或管理员的 MinIO 密钥。模板 API 提供只读接口，外部平台只保存单独的 API Key。

在运行 API 服务的机器上配置：

```powershell
$env:RUIWARE_PUBLIC_API_KEY = '由管理员生成的一串随机密钥'
```

接口如下：

```text
GET /api/public/v1/templates
GET /api/public/v1/templates/{publicationId}
GET /api/public/v1/templates/{publicationId}/download
```

请求头：

```text
X-RuiWare-API-Key: 由管理员发放的 API Key
```

列表响应只返回模板编号、版本、名称、SHA-256、大小和下载地址，不暴露 MinIO 的对象路径。下载接口返回 `.rwpart` 文件，并通过 `X-RuiWare-SHA256` 返回完整性摘要。

开发机默认只监听 `127.0.0.1`。如果需要让局域网或反向代理访问，可在启动 API 前设置 `$env:RUIWARE_API_HOST = '0.0.0.0'`；正式环境仍应使用 HTTPS 反向代理，并只开放 API 端口，不开放 MinIO 的 `9000/9001`。

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
