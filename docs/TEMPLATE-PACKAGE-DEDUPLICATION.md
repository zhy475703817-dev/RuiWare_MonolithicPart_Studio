# 模板包判重与安全替换

点击发布时，后端先生成待发布包、读取 MinIO 中所有零件发布记录并校验下载完整性。无候选时直接冻结发布；发现候选时返回 `409 PUBLISH_DUPLICATES_FOUND`，本地草稿和发布历史不改变，待发布临时包会清理。页面先显示候选提示，点击“查看比较信息”后打开比较弹窗。取消不发布。

## 内容评分

整包 SHA-256 相同是完全重复。其余比较提取定义 JSON，不依赖名称、包内文件排列、ZIP 时间戳或构建产物。参数和几何中的内部 ID、表达式及引用关系保留；显示名称、说明、审核状态、发布身份和生成哈希忽略。查找表、参数覆盖及其他行为字典中的键始终保留，即使键名为 `name`、`version` 或 `revision`。

| 分组 | 权重 | 定义文件 |
| --- | --- | --- |
| 几何 | 55% | constraints、geometry-recipe、sweep-path |
| 参数 | 25% | parameters、parameter-dependencies |
| 特征与接口 | 12% | feature-rules、variants、interfaces |
| 制造与材料 | 8% | classification、material-requirements |

每类的文件等权，文件内按语义叶节点的匹配比例计分。有内部 ID 的无序集合按 ID 对齐；操作、点、轮廓边及端点引用保序。缺失文件按 0 分计。该分数衡量定义的结构一致程度，不执行 CAD 拓扑等价证明，也不证明两个不同表达式在数学上等价。

总分至少 90%、几何至少 95%、参数至少 90% 为高度相似；总分至少 80% 未满足强候选门槛，或几何及参数达到门槛但其他定义明显不同，为疑似相似。其余不提示。缺损或不支持的旧定义不作为语义重复证据；远程下载失败或校验失败则阻止本次检查。

## 确认协议

`POST /api/v1/template-drafts/{id}/publish` 保留 `baseRevision`、`confirmed`，新增可选 `duplicateDecision`：

```json
{
  "baseRevision": 7,
  "duplicateDecision": {
    "action": "replace",
    "reviewToken": "候选报告中的64位令牌",
    "publicationIds": ["用户选中的旧发布ID"]
  }
}
```

新增使用 `action: "add"`，无需 `publicationIds`。令牌绑定待发布定义和所有候选包的 ID/SHA。重试重新扫描；内容或候选变化会重新要求确认。页面编辑或切换草稿会使待确认报告失效。MCP `ruiware_publish_template` 同样支持此字段，必须先展示比较并获得用户明确决定。

替换只允许完全重复或高度相似的当前成员包。新包上传后重新下载并校验，随后才执行清理。上传失败保留本地发布和旧远程包；清理失败在 `remoteSync.cleanupFailures` 返回详情，不撤销新发布。

## 跨平台引用服务

本仓库没有组件平台的权威引用数据库，因此未配置服务或服务不具备删除协调能力时，替换禁用，仍可新增。

管理员配置 `RUIWARE_REFERENCE_CHECK_URL` 为按发布 ID 查询的服务根路径，可选 `RUIWARE_REFERENCE_CHECK_TOKEN` 通过 Bearer 请求头认证。这些值只在后端使用。该服务必须覆盖所有成员和所有固定版本引用；不能仅查询当前用户、本地数据库或把包自身元数据当作无人引用证明。

`GET {URL}/{publicationId}` 应返回：

```json
{
  "authoritative": true,
  "publicationId": "旧发布ID",
  "sha256": "旧包完整SHA256",
  "references": [],
  "deletionGuardSupported": true
}
```

删除前，平台发送 `POST {URL}/{publicationId}/deletion-guard`，请求体为 `{"sha256":"旧包完整SHA256"}`。服务必须在同一事务中检查现有引用并建立持久删除预留。已有引用时拒绝；成功时返回上述身份字段、空 `references`、`reserved: true` 和非空 `deletionToken`。

**所有新增引用都必须在引用服务内检查预留状态并拒绝已预留或已删除的版本。预留不能因超时自动失效。** 仅查询空引用后直接删除，或依赖会自动过期的锁，无法避免并发新增引用导致的断链。

平台在预留后再次核对旧包 SHA，并删除旧 `template.rwpart` 和 `metadata.json`，再发送 `POST {URL}/{publicationId}/deletion-guard/complete`，请求体为 `{"sha256":"旧包完整SHA256","deletionToken":"预留令牌"}`。服务将版本标记为已删除并持续阻止新引用，响应包含匹配的身份、`deletionToken` 和 `completed: true`。

清理中途失败时保留预留，禁止新引用，管理员应核对包和元数据实际状态后重试或恢复；平台不会自动解除预留。实际引用服务需要在组件平台或统一引用服务中实现，当前仓库只提供客户端接入。

## 组件平台分组读取

新增只读 `GET /api/public/v1/template-groups`，沿用 `X-RuiWare-API-Key` 鉴权。响应 `groups` 根据实际下载包的完整 SHA 分组，`publicationIds` 保留每个原始发布 ID；`similarities` 返回代表包之间的高度/疑似相似关系、四项分数及差异。分组不会删除包，包内元数据字段不对外暴露存储路径。

原 `/api/public/v1/templates` 列表以及按发布 ID 的详情、下载继续可用。组件平台需接入新接口并实现展开比较。分组接口当前需要读取所有包并比较代表包两两关系，适用于目前的团队规模；较大共享库应先建立受校验的定义索引。
