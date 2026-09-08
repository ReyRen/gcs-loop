# GCS Loop 离线发布与部署

`offline/` 是完整交付单元。制作完成后只需要带走整个 `offline` 目录，不需要同时复制源服务器外层的 `gcs-loop` 目录。

230 上的 x86 源码是主要功能更新和 x86 发布基线；43/44 上的 ARM 环境保存对应适配版本。需要离线交付时，在已经完成部署和业务验证的目标架构服务器上执行打包。脚本不会重新编译代码，只收集当前已经验证的源码、镜像和数据。

## 完成后的目录

```text
offline/
├── runtime/                           # 与当前提交一致的完整可部署 GCS Loop 文件
├── gcs-loop-images-<amd64|arm64>.tar.gz
├── gcs-loop-data.tar.gz               # 要求携带数据时存在
├── manifest.txt
├── manage.sh
├── site.env.example
├── PROMPT.md
└── README.md
```

镜像文件是一个 `docker save` gzip 归档，包含当前 Compose 实际需要的全部运行镜像。数据文件包含该栈使用的全部 10 个 Docker named volume：Redis、MySQL、ClickHouse、MinIO 数据与配置、RocketMQ NameServer 与 Broker、Nginx 资源，以及 Python/JavaScript FaaS 工作卷。

镜像和数据是两套独立内容：`docker load` 只加载镜像，不会恢复 named volume。执行 `install --restore-data` 时，脚本会按 Compose 使用的固定卷名创建空卷，再把 `gcs-loop-data.tar.gz` 中备份的实际文件恢复到对应卷中。

`runtime/` 来自当前 Git 提交，排除 `.git` 和嵌套的 `offline/`，包含运行所需的源码、Compose、配置和初始化脚本。现场的 `manage.sh` 只使用同目录下的 `runtime/`、镜像归档和数据归档，不依赖原服务器上的任何其他文件。

Docker 负责选择 named volume 的实际存储位置。脚本不会读取、复制或写死 `/var/lib/docker`，所以 Docker 的 `data-root` 位于系统盘、`/data` 或其他挂载磁盘都可以。所有文件路径都根据 `manage.sh` 自身位置计算，整个 `offline` 放到任意绝对路径均可。

## 制作 ARM64 离线目录

在已经验证的 ARM64 GCS Loop 源码根目录执行：

```bash
./offline/manage.sh bundle --include-data
```

执行过程：

1. 根据 `uname -m` 选择 `arm64.env`。
2. 将 Compose 需要的全部 ARM64 运行镜像导出成一个压缩文件。
3. 短暂停止服务，完整备份 10 个 named volume，然后重新启动并验证源服务。
4. 从当前 Git 提交生成自包含的 `offline/runtime/`。
5. 写入镜像、数据、源码提交和架构清单。

完成后直接复制整个 `offline/` 目录。

## 现场必须准备

- Linux 架构必须与包一致：ARM64 包要求 `uname -m` 为 `aarch64` 或 `arm64`。
- 已启动的 Docker Engine，以及 `docker compose` v2 插件。
- 至少 15 GB 可用磁盘空间，用于离线目录、已加载镜像、容器可写层和数据增长。
- 默认端口无冲突：Web/API `8082`、后端 OpenAPI `8888`、MySQL 宿主机端口 `13306`。
- 浏览器与其他 GCS 服务能够访问现场配置的 HTTP/HTTPS 地址。

NPU、Ascend Runtime 和模型推理驱动不是 GCS Loop 基础栈的启动依赖。模型调用仍需要现场可访问的模型服务。

## 现场单独配置

进入复制后的 `offline` 目录：

```bash
cp site.env.example site.env
vi site.env
```

现场人员需要处理：

1. 模板沿用 43 当前已经验证的 `COZE_LOOP_PUBLIC_BASE_URL=http://172.18.127.43:8082` 作为示例。现场地址不同才修改 IP、域名或协议。
2. 默认端口冲突时，在 `site.env` 中启用相应端口覆盖。
3. `runtime/release/deployment/docker-compose/conf/model_config.yaml` 默认完整沿用制作服务器已经验证的模型配置。本 ARM 包与 43 当前运行配置一致；现场无法访问其中的模型 Endpoint，或者模型名称、API Key 不同时才修改。
4. 使用外层 Nginx/TLS 时，配置证书以及到本机 `8082` 的转发，确保 `/api`、`/v1` 和对象文件路径都转发到 GCS Loop Nginx。
5. 确认现场时钟正确，避免 MinIO 签名 URL 因时间偏差失效。

公共环境文件包含整套内部服务一致使用的数据库和对象存储凭据。恢复源服务器数据时不要只改单侧密码；如现场必须更换，应同时修改存储服务账号与应用连接配置。

## 现场恢复和启动

`offline` 可以放在任何目录，例如：

```bash
cd /data/apps/gcs-loop-offline
cp site.env.example site.env
vi site.env
./manage.sh install --restore-data
```

安装过程先用 `docker load` 加载镜像，再创建 Compose 使用的 named volume，并从 `gcs-loop-data.tar.gz` 恢复卷内数据，最后执行 `docker compose up --pull never`。它不会构建或联网拉取。数据恢复只允许写入空的 named volume，避免覆盖现场已有数据。

安装结束时会验证：

- 镜像架构与现场主机一致。
- 10 个常驻容器全部健康。
- 4 个初始化容器退出码为 0。
- Nginx 到后端 API 的网关链路正常。

## 运维命令

```bash
./manage.sh status
./manage.sh logs
./manage.sh verify
./manage.sh stop
./manage.sh start
```

`start` 使用 `--pull never`，不会构建或联网拉取。`stop` 删除容器和网络，但保留全部 named volume 数据。

## x86 离线目录

在 230 的 x86 环境执行同一命令即可生成 AMD64 版本：

```bash
./offline/manage.sh bundle --include-data
```

脚本会自动改用 `amd64.env`，镜像文件名为 `gcs-loop-images-amd64.tar.gz`。AMD64 和 ARM64 的 `offline` 目录必须分别从对应架构服务器生成，不能混用。
