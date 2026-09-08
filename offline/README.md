# GCS Loop 离线发布与部署

`offline/` 是 GCS Loop 在 AMD64 和 ARM64 服务器上共用的离线发布入口。230 上的 x86 源码作为主要功能更新和 x86 发布基线；43/44 上的 ARM 环境保存对应适配版本，GCS Loop 同时保留源码、Compose 和初始化文件。需要离线交付时，在目标架构已经验证的服务器上制作该架构的包。

当前目录长期保留以下文件：

- `PROMPT.md`：交给后续执行人员或 Codex 的完整离线打包需求。
- `manage.sh`：镜像导出、可选数据备份、离线安装、启动和验收入口。
- `site.env.example`：现场必须复制并填写的配置模板。

本次只建立离线目录与流程时，不需要编译、导出镜像或生成发布包。真正提出离线交付要求后，再在对应架构服务器执行打包命令。

## 发布包结构

脚本根据 `uname -m` 自动选择 `amd64.env` 或 `arm64.env`，发布包解压后保持以下结构：

```text
gcs-loop/
├── offline/
│   ├── PROMPT.md
│   ├── manage.sh
│   ├── site.env.example
│   ├── manifest.txt
│   ├── gcs-loop-images-<amd64|arm64>.tar.gz
│   └── gcs-loop-data.tar.gz             # 要求携带源服务器数据时存在
├── release/deployment/docker-compose/
└── ...                                  # 与镜像对应的完整源码和部署文件
```

镜像文件是一个 `docker save` 压缩归档，包含当前 Compose 所需的全部运行镜像。数据文件包含 Redis、MySQL、ClickHouse、MinIO 和 RocketMQ 的 7 个持久化 named volume。Nginx 静态资源卷和两个 FaaS 临时工作卷由镜像重新生成。

Docker 负责选择 named volume 的实际存储位置。脚本不会读取、复制或写死 `/var/lib/docker`，所以 Docker 把数据放在系统盘或其他挂载磁盘都可以。所有项目文件路径都根据 `manage.sh` 自身位置计算，`gcs-loop` 解压到 `/opt`、`/data` 或其他目录均可。

## 现场必须准备

- Linux 架构必须与发布包一致：`x86_64/amd64` 使用 AMD64 包，`aarch64/arm64` 使用 ARM64 包。
- 已启动的 Docker Engine，以及 `docker compose` v2 插件。
- 至少 15 GB 可用磁盘空间，用于压缩包、已加载镜像、容器可写层和业务数据增长。
- 默认端口无冲突：Web/API `8082`、后端 OpenAPI `8888`、MySQL 宿主机端口 `13306`。
- 浏览器与其他 GCS 服务可访问的 HTTP/HTTPS 地址。

NPU、Ascend Runtime 和模型推理驱动不是 GCS Loop 基础栈的启动依赖。模型调用仍需要现场可访问的模型服务。

## 现场单独配置

1. 复制站点配置：

   ```bash
   cp offline/site.env.example offline/site.env
   vi offline/site.env
   ```

2. 将 `COZE_LOOP_PUBLIC_BASE_URL` 改为用户实际访问地址，例如 `https://gcs-loop.example.local`。如果使用外层 Nginx/TLS，也填写外层最终地址。
3. 如默认端口冲突，在 `offline/site.env` 中启用相应端口覆盖。
4. 根据现场模型服务编辑 `release/deployment/docker-compose/conf/model_config.yaml`，填写本地模型 Endpoint、模型名和 API Key。
5. 如使用外层反向代理，由现场配置 TLS 证书及到本机 `8082` 的转发，并确保 `/api`、`/v1` 和对象文件路径均转发到 GCS Loop Nginx。

公共环境文件中已经包含整套内部服务一致使用的数据库和对象存储凭据。携带源服务器数据恢复时不要只改单侧密码；如现场必须更换，应同时修改存储服务账号与应用连接配置。

## 解压和安装

压缩包可以解压到任意目录：

```bash
mkdir -p /data/apps
tar -xzf gcs-loop-offline-<amd64|arm64>-YYYYMMDD.tar.gz -C /data/apps
cd /data/apps/gcs-loop
cp offline/site.env.example offline/site.env
vi offline/site.env
```

恢复包内的源服务器数据并启动：

```bash
./offline/manage.sh install --restore-data
```

只初始化一套空白环境：

```bash
./offline/manage.sh install
```

数据恢复只允许写入空的 named volume，避免误覆盖现场已有数据。如果目标主机已有同名 GCS Loop 数据卷，应先备份并清理旧部署，或另行制定数据合并方案。

安装结束时脚本会验证 10 个常驻容器健康、4 个初始化容器退出码为 0，并通过 Nginx 读取后端 OpenAPI 文档以检查网关链路。

## 运维命令

```bash
./offline/manage.sh status
./offline/manage.sh logs
./offline/manage.sh verify
./offline/manage.sh stop
./offline/manage.sh start
```

`start` 永远使用包内镜像，带 `--pull never`，不会构建或联网拉取。`stop` 删除容器和网络但保留 named volume 数据。

## 制作发布包

在已经完成对应架构编译、部署和业务验证的源服务器执行：

```bash
# 只打包程序、部署文件和镜像
./offline/manage.sh bundle /root/images

# 同时携带当前服务器的持久化业务数据
./offline/manage.sh bundle /root/images --include-data
```

脚本不会编译代码。它导出当前 Compose 解析并已经存在的运行镜像；使用 `--include-data` 时会短暂停止服务以取得一致的数据快照，然后重新启动原服务。最终生成：

```text
/root/images/gcs-loop-offline-<amd64|arm64>-YYYYMMDD.tar.gz
```

镜像归档、可选数据归档和清单同时保留在当前源码的 `offline/` 目录，均被 Git 忽略，不会提交到源码仓库。
