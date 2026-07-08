# 提示词工厂分阶段实施计划

> 目标：在不伪造数据、不重复造模块的前提下，把 `gcs-loop` 二开成 GCS 系列提示词工厂后端，并给 UI/前端/部署提供稳定契约。

## 总体原则

- 先复用现有 Prompt 能力，再补真实缺口。
- 任何 API 变更先改 Thrift IDL，再生成代码。
- 任何 MySQL schema 变更必须同步 Docker Compose 的 init SQL 和 patch SQL。
- 生产数据只进 MySQL/Redis/ClickHouse/Object Storage，不用本地假数据或内存替代。
- `workspace_id` 是提示词工厂第一阶段的业务隔离键；GCS `uid` 通过认证/网关/空间映射接入。

## Phase 1：产品契约和 UI 交接

状态：已完成第一批文档。

交付物：

| 文件 | 用途 |
| --- | --- |
| `docs/reference/prompt-factory-architecture.md` | 后端架构边界、领域模型、存储和 GCS 对齐原则 |
| `docs/guidance/prompt-factory-ui-handoff.md` | 前端/UI 页面、控件、状态、功能页参考图和真实 API 对接表 |
| `docs/guidance/gcs-deployment-overrides.md` | GCS MySQL/Redis/ClickHouse/Object Storage 覆盖部署说明 |

校验项：

- 文档里的 API 路径必须能在 `idl/thrift/coze/loop` 中找到。
- UI 文档不得出现本地假数据、静态样例 prompt 或未实现接口。
- 部署文档必须说明 `workspace_id` 与 GCS `uid` 的边界。

## Phase 2：GCS 基础设施接入

目标：让 `gcs-loop` 能接入 GCS 统一基础设施。

任务：

1. 确认生产 MySQL 是共用 `ai_market` 还是独立 `gcs_loop`。
2. 在目标库执行表名冲突检查，重点检查 `user`、`space`、`space_user`、`prompt_*`、`tool_*`、观测表。
3. 准备外部 Redis、ClickHouse、Object Storage、RocketMQ 的连接信息。
4. 用 Docker Compose env file 或普通服务环境变量覆盖生产地址。
5. 设置 `COZE_LOOP_SESSION_HMAC_KEY`，避免生产使用默认 session 签名 key。

验收：

- App 启动后能连接 MySQL、Redis、ClickHouse、Object Storage、RocketMQ。
- `POST /api/foundation/v1/spaces/list` 能返回真实 workspace。
- `POST /api/prompt/v1/prompts/list` 能访问真实 MySQL 数据。
- PAT 创建后能调用 `/v1/loop/prompts/mget`。

## Phase 3：前端联调闭环

目标：不新增后端 API 的情况下，让 UI 能跑通完整 prompt 生命周期。

任务：

1. 登录后调用 `POST /api/foundation/v1/spaces/list` 获取 `workspace_id`。
2. Prompt 列表接入 `POST /api/prompt/v1/prompts/list`。
3. 新建 prompt 接入 `POST /api/prompt/v1/prompts`。
4. 编辑器详情接入 `GET /api/prompt/v1/prompts/:prompt_id`，带 `with_draft=true`、`with_commit=true`。
5. 草稿保存接入 `POST /api/prompt/v1/prompts/:prompt_id/drafts/save`。
6. 版本发布接入 `POST /api/prompt/v1/prompts/:prompt_id/drafts/commit`。
7. Snippet 列表和引用接入 `filter_prompt_types=["snippet"]` 与 `list_parent`。
8. Tool 管理接入 `/api/prompt/v1/tools/*`。
9. Debug 面板接入 debug context、debug history 和 `debug_streaming`。
10. 外部调用页接入 PAT 管理和 `/v1/loop/prompts/*`。

验收：

- UI 中每个列表数据都来自后端响应。
- 不出现客户端写死的 prompt、version、label、tool。
- 保存草稿后刷新页面仍能从 MySQL 读回。
- 发布版本后 `latest_version` 和版本列表一致。
- Debug history 能看到真实调试记录。

## Phase 4：确认真实后端缺口

目标：只在产品确认缺口后新增后端能力。

候选缺口：

| 缺口 | 判断标准 | 推荐实现 |
| --- | --- | --- |
| 工厂分类/目录树 | UI 需要跨 prompt 的稳定分类、排序、筛选 | 新增 optional metadata 或独立表，先定 schema |
| Prompt 市场/模板库 | 需要公开/私有发布流和安装流 | 新增 marketplace API，不污染 Prompt CRUD |
| GCS SSO | 不希望使用 Coze Loop 原生注册/登录 | 增加 foundation/session adapter 或网关注入用户 |
| 审计 | 需要进入 `gcs-audit` | 实现 `audit.IAuditService` 的真实 client |
| 密钥管理 | OpenAPI 执行需要引用统一密钥 | 增加 secret reference 解析，禁止明文写 prompt |
| 导入/导出 | UI 需要批量迁移 prompt | 新增 import/export API，文件走 object storage |

实施顺序：

1. 产品确认字段和权限语义。
2. 修改 Thrift IDL。
3. 运行后端和前端代码生成。
4. 新增 domain entity/repo/service/application。
5. 同步 Docker Compose init SQL 和 patch SQL。
6. 补单测、接口测试和部署文档。

## Phase 5：测试和上线

后端测试：

```bash
cd backend
go test -gcflags="all=-N -l" ./modules/prompt/...
go test -gcflags="all=-N -l" ./modules/foundation/...
```

部署检查：

```bash
cd release/deployment/docker-compose
docker compose --profile app --profile nginx config
```

上线验收：

- 登录/空间列表正常。
- Prompt 新建、保存草稿、发布版本、标签更新、回滚正常。
- Snippet 引用和展开正常。
- Tool 新建、保存草稿、发布正常。
- Debug streaming 能返回增量和 usage。
- OpenAPI PAT 能执行 `/v1/loop/prompts/execute`。
- Trace/Debug history 能回查。

## 当前说明

后续部署以 Docker Compose、systemd 或普通进程环境变量为准。
