# 部署与环境配置指南

> 本文档汇总 Docker Compose 部署方式的配置细节和常用操作。
> 快速开始见 [`../../README.md`](../../README.md)。

## Docker Compose 部署

### 目录结构

```
release/deployment/docker-compose/
├── docker-compose.yml            # AMD64/ARM64 共用服务定义
├── docker-compose-build.yml      # 本地源码构建覆盖
├── env/
│   ├── common.env                # 两种架构共用参数
│   ├── amd64.env                 # AMD64 镜像选择
│   └── arm64.env                 # ARM64 镜像选择
├── .env.local                    # 当前服务器私有覆盖，不提交 Git
├── conf/
│   └── model_config.yaml         # LLM 模型配置
└── bootstrap/                    # 初始化脚本
```

首次部署先从 `.env.local.example` 复制本机覆盖文件，再填写本机地址和凭据。`make start` 通过 `uname -m` 自动加载 `common.env` 以及对应的 `amd64.env` 或 `arm64.env`，最后加载 `.env.local`。

### 常用 Makefile 命令

| 命令 | 说明 |
|------|------|
| `make start` | 自动识别 AMD64/ARM64，编译镜像并后台部署 |
| `make stop` | 停止服务并保留数据卷 |
| `make restart` | 无构建地协调常驻容器配置，并重启后端应用；不重复执行初始化容器 |
| `make logs` | 查看最近 200 行并持续跟踪日志 |
| `make status` | 查看全部容器状态 |
| `make config` | 显示识别到的架构并校验最终 Compose 配置 |

### AMD64/ARM64 离线部署

无互联网现场使用仓库根目录的 `offline/manage.sh`。脚本根据源服务器的 `x86_64/amd64` 或 `aarch64/arm64` 架构选择对应配置；发布包内含一个包含全部运行镜像的压缩归档，可选包含源服务器的持久化数据快照。脚本只通过 Docker API 操作 named volume，不依赖 `/var/lib/docker` 或其他固定 Docker `data-root`。制作、现场配置、恢复和验收步骤见 [`../../offline/README.md`](../../offline/README.md)。

### 访问地址

- 应用: `http://localhost:8082`

### 公开 API Base URL

生产环境应在 `.env.local` 中显式设置用户真正能够访问的地址：

```dotenv
COZE_LOOP_PUBLIC_BASE_URL=https://gcs.example.com
```

该值只包含协议、域名和可选端口，不带结尾 `/`、`/v1`、query 或 fragment。后端通过 `GET /api/auth/v1/public_api_config` 返回该地址，并将它写入已发布 Prompt 的 cURL 示例。

留空时，简单 Docker Compose 部署会从当前请求的 `Host` 推导，Nginx 使用 `$http_host` 保留外部端口。TLS 终止、多层反向代理或多域名生产部署不要依赖自动推导，应显式配置该变量。

## 镜像构建

| 命令 | 说明 |
|------|------|
| `make image-<version>` | 构建并推送应用镜像（多架构） |
| `make image-python-faas-bpush-<version>` | 构建并推送 Python FaaS 镜像 |
| `make image--login` | 登录镜像仓库 |

### 镜像信息

- Registry: `docker.io`
- Repository: `cozedev`
- 应用镜像: `cozedev/coze-loop`
- Python FaaS 镜像: `cozedev/coze-loop-python-faas`

## 模型配置

编辑 `release/deployment/docker-compose/conf/model_config.yaml`：

- `api_key`: LLM 服务的 API Key
- `model`: 模型 Endpoint ID

支持的模型服务:
- Volcengine Ark（国内）
- BytePlus ModelArk（海外）
- OpenAI 兼容接口
