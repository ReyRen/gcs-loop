# gcs-loop 的 GCS 部署覆盖说明

> 本文说明如何通过 Docker Compose/环境变量接入 GCS 统一 MySQL/Redis/ClickHouse/对象存储，同时不破坏本地测试配置。

## 当前配置形态

`backend/cmd/main.go` 通过环境变量读取运行时依赖地址：

| 依赖 | 环境变量 |
| --- | --- |
| Redis | `COZE_LOOP_REDIS_DOMAIN`、`COZE_LOOP_REDIS_PORT`、`COZE_LOOP_REDIS_PASSWORD` |
| MySQL | `COZE_LOOP_MYSQL_DOMAIN`、`COZE_LOOP_MYSQL_PORT`、`COZE_LOOP_MYSQL_USER`、`COZE_LOOP_MYSQL_PASSWORD`、`COZE_LOOP_MYSQL_DATABASE` |
| ClickHouse | `COZE_LOOP_CLICKHOUSE_DOMAIN`、`COZE_LOOP_CLICKHOUSE_PORT`、`COZE_LOOP_CLICKHOUSE_USER`、`COZE_LOOP_CLICKHOUSE_PASSWORD`、`COZE_LOOP_CLICKHOUSE_DATABASE` |
| Object Storage | `COZE_LOOP_OSS_PROTOCOL`、`COZE_LOOP_OSS_DOMAIN`、`COZE_LOOP_OSS_PORT`、`COZE_LOOP_OSS_REGION`、`COZE_LOOP_OSS_USER`、`COZE_LOOP_OSS_PASSWORD`、`COZE_LOOP_OSS_BUCKET` |
| RocketMQ | `COZE_LOOP_RMQ_NAMESRV_DOMAIN`、`COZE_LOOP_RMQ_NAMESRV_PORT` |
| FaaS | `COZE_LOOP_PYTHON_FAAS_DOMAIN`、`COZE_LOOP_PYTHON_FAAS_PORT`、`COZE_LOOP_JS_FAAS_DOMAIN`、`COZE_LOOP_JS_FAAS_PORT` |

`backend/conf/infrastructure.yaml` 是本地/测试最小配置，不应作为 GCS 生产配置源。

## MySQL

GCS 服务通常共用 `ai_market` MySQL。`gcs-loop` 接入时，把 Coze Loop MySQL 环境变量指向同一个实例：

```env
COZE_LOOP_MYSQL_DOMAIN=172.18.127.67
COZE_LOOP_MYSQL_PORT=3306
COZE_LOOP_MYSQL_USER=root
COZE_LOOP_MYSQL_PASSWORD=<from secret manager or env file>
COZE_LOOP_MYSQL_DATABASE=ai_market
```

Coze Loop 会创建 `prompt_basic`、`prompt_commit`、`space`、`user`、观测相关表等。接入已有 `ai_market` 前必须检查表名冲突；如果已有系统占用了这些表名，应改用独立库如 `gcs_loop`，不要随意重命名生成代码或仓储代码。

## Redis

有统一 GCS Redis 时直接复用：

```env
COZE_LOOP_REDIS_DOMAIN=<gcs-redis-host>
COZE_LOOP_REDIS_PORT=6379
COZE_LOOP_REDIS_PASSWORD=<redis-password>
```

生产环境不能关闭 Redis；ID 生成、Prompt cache、label-version cache 和分布式限流都依赖它。

## ClickHouse

只做 prompt 管理时，本地极简模式可以弱化 ClickHouse；生产环境如果启用 trace/观测页面，就必须配置真实 ClickHouse：

```env
COZE_LOOP_CLICKHOUSE_DOMAIN=<clickhouse-host>
COZE_LOOP_CLICKHOUSE_PORT=9000
COZE_LOOP_CLICKHOUSE_USER=default
COZE_LOOP_CLICKHOUSE_PASSWORD=<clickhouse-password>
COZE_LOOP_CLICKHOUSE_DATABASE=<database-name>
```

## Object Storage

对象存储按 GCS 统一策略接入。S3 兼容端点示例：

```env
COZE_LOOP_OSS_PROTOCOL=http
COZE_LOOP_OSS_DOMAIN=<s3-host>
COZE_LOOP_OSS_PORT=<s3-port>
COZE_LOOP_OSS_REGION=us-east-1
COZE_LOOP_OSS_USER=<access-key>
COZE_LOOP_OSS_PASSWORD=<secret-key>
COZE_LOOP_OSS_BUCKET=<bucket>
```

Prompt 文本存 MySQL；对象存储主要用于文件和多模态资产。

## Docker Compose 覆盖

如果 GCS 环境使用外部 MySQL/Redis/ClickHouse/Object Storage，不启动仓库内置依赖 profile，只启动 app/nginx/faas 等需要的服务，并通过外部 env file 覆盖环境变量：

```bash
cd release/deployment/docker-compose
docker compose --profile app --profile nginx up -d
```

生产密钥放在仓库外的环境文件或密钥系统里。`release/deployment/docker-compose/.env` 保持为本地示例，除非整个部署目标已切换。

## Schema 同步

后续如果需要改 prompt-factory schema，必须同步这些路径：

| 路径 | 用途 |
| --- | --- |
| `release/deployment/docker-compose/bootstrap/mysql-init/init-sql/` | Docker Compose 全新安装 |
| `release/deployment/docker-compose/bootstrap/mysql-init/patch-sql/` | Docker Compose 存量升级 |

如果最终只维护 Docker Compose/普通服务部署，则不要新增其他部署形态的交付物。

## 生产检查项

- MySQL 指向目标 GCS 数据库，且表名无冲突。
- Redis 可访问，密码正确。
- 启用 trace/观测页面时 ClickHouse 可访问。
- Object Storage bucket 已存在，凭据可读写。
- RocketMQ nameserver 可访问，consumer worker 能启动。
- 非本地部署设置 `COZE_LOOP_SESSION_HMAC_KEY`。
- PAT OpenAPI 至少验证 `/v1/loop/prompts/mget` 和 `/v1/loop/prompts/execute`。
