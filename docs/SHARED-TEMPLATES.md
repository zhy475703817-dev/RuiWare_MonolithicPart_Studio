# 共享模板库

入口：平台左侧“发布”阶段 → “共享模板库”。GitHub 的构件文件目录、本地版本历史和共享库是三个不同的存储位置。

## 安装与配置

在所选 Python 环境执行 `python -m pip install -e .[test]`。共享库需要 `minio` 依赖。
API 进程启动前应配置以下环境变量（凭据不得写入 Git）：

- `RUIWARE_MINIO_ENDPOINT`、`RUIWARE_MINIO_ACCESS_KEY`、`RUIWARE_MINIO_SECRET_KEY`
- `RUIWARE_MINIO_BUCKET`、`RUIWARE_MINIO_PREFIX`（个人发布命名空间）
- `RUIWARE_MINIO_READ_PREFIX`（团队读取范围）、`RUIWARE_MINIO_SECURE`

`GET /api/v1/health` 返回正在运行的 `workspaceRoot` 和 `sharedTemplatesAvailable`。后者只说明配置和依赖可用，不代表网络检查成功；应继续检查 `GET /api/v1/shared-templates`。

启动脚本不会关闭占用端口的服务，也不会复制数据库。若提示端口属于其他工作区，请先确认该工作区的数据，不要误以为新目录的代码已加载。Git 克隆不包含被忽略的数据库、材料库、附件和运行环境。

## 发布与补同步

正常发布会返回 `remoteSync.status`：`uploaded`、`failed` 或 `disabled`。本地发布成功不代表共享上传成功，界面会分别提示。

补同步现有八个构件，不必重新发布或修改草稿：

```powershell
python scripts/sync-shared-components.py
python scripts/sync-shared-components.py --upload
```

必须对含有实际构件数据的工作区执行，或通过 `--root` 指定它。脚本先验证所有已发布包、检查共享 ID 冲突，再上传缺失包并重新下载核验 SHA256。存在不同文件或其他命名空间的同 ID 时会拒绝覆盖；重复执行不会生成重复发布版本。不会修改平台数据库。
