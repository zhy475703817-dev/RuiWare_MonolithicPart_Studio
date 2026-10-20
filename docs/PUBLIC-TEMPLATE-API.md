# 组件平台连接已发布零部件库

零部件 API 提供三个只读接口，均要求 `X-RuiWare-API-Key` 请求头：

- `GET /api/public/v1/templates?limit=1000` 返回 `{items, count}`，limit 范围为 1–1000。
- `GET /api/public/v1/templates/{publicationId}` 返回单条发布信息。
- `GET /api/public/v1/templates/{publicationId}/download` 返回经过 SHA256 校验的原始发布包。

发布信息只包含 publicationId、templateId、version、code、name、createdAt、sha256、size、downloadUrl，不返回共享存储对象路径或凭据。共享存储沿用 `RUIWARE_MINIO_*` 配置，不写入或修改已发布包。

API 密钥优先读取环境变量 `RUIWARE_PUBLIC_API_KEY`，也可存入本机 `data/public-api.key`（UTF-8 文本，无 BOM）。该文件受 `*.key` 忽略规则保护，禁止提交。未配置返回 503，缺失或错误密钥返回 401。

组件平台根目录的本机 `.env.local` 使用相同密钥：

```dotenv
RUIWARE_TEMPLATE_API_URL=http://127.0.0.1:8010
RUIWARE_PUBLIC_API_KEY=<本机密钥>
```

修改组件平台配置后重启组件后端。密钥只保存在后端，不发送给浏览器。两个 API 默认仅监听本机地址；连接共享存储的 API 进程需要访问 MinIO 的网络权限。
