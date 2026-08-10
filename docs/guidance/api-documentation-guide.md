# 后端 API 文档与前端对接指南

GCS Loop 后端会从 Thrift IDL 的 HTTP 注解生成 OpenAPI 3.0 文档，并由 Hertz
服务直接提供 Swagger UI。前端同事只需要使用 HTTP API 文档，不需要了解或调用
后端内部的 Thrift/Kitex RPC 接口。

## 文档入口

启动后端后可访问：

- Swagger UI：`http://<backend-host>/api-docs`
- OpenAPI JSON：`http://<backend-host>/api-docs/openapi.json`

Swagger UI 的静态资源来自 jsDelivr CDN；即使开发环境无法访问 CDN，OpenAPI JSON
仍然可以下载并导入 Apifox、Postman、Insomnia 等工具。

API 文档默认启用。如需在生产环境关闭，设置：

```bash
COZE_LOOP_API_DOCS_ENABLED=false
```

## 文档包含什么

文档只包含生成后的 Hertz Router 中真实注册的 HTTP 路由：

- `/api/**`：Web 端接口，使用 `session_key` Cookie 鉴权。
- `/v1/**`：OpenAPI 接口，使用 Bearer Personal Access Token 鉴权。
- 登录、注册和重置密码等公开接口不要求 Cookie。
- 响应中的 `code = 0` 表示成功；业务错误通常仍返回 HTTP 200，并通过非零
  `code` 和 `msg` 表达。
- 标注 `api.js_conv = "true"` 的 `i64` 字段在 JSON 中按字符串展示，避免
  JavaScript 整数精度丢失。

Thrift 中没有 HTTP 注解的内部 RPC 不会出现在 OpenAPI 文档中。它们是后端模块
之间的调用契约，不是提供给浏览器前端的 API。

## 后端新增接口的流程

以“提示词优化”接口为例，后端开发顺序如下：

1. 在对应 Prompt Thrift 文件中定义 Request、Response 和 Service 方法，并添加
   `api.post` 等 HTTP 注解。
2. 按 `docs/guidance/idl-codegen-guide.md` 生成 Hertz/Kitex 代码。
3. 实现 Handler、Application 和 Domain 逻辑及相应测试。
4. 重新生成并校验 OpenAPI 文档：

   ```bash
   make openapi-gen
   make openapi-test
   make openapi-check
   make openapi-lint
   ```

   Windows 没有 `python3` 命令时可以使用 `make PYTHON=python openapi-gen`，或直接
   执行 `python backend/script/openapi/generate.py`。

5. 将接口路径、鉴权方式和 OpenAPI JSON 地址交给前端同事联调。

`backend/api/apidocs/openapi.json` 是生成产物，不应手工编辑。IDL 或生成后的
Router 发生变化却没有同步文档时，GitHub Actions 会使检查失败。

`make compose-up-dev`、`make compose-up-dev-d` 和 `make compose-up-debug` 会在
构建调试镜像前自动重新生成 OpenAPI 文档。生成失败时 Compose 不会继续启动，
避免 Swagger UI 提供过期接口。普通 `make compose-up` 使用发布镜像及镜像内已
生成的文档，不在启动时重新生成。

## 前端联调注意事项

- 同源部署时，浏览器会自动携带登录后的 `session_key` Cookie。
- 前后端分域时，需要双方正确配置 CORS 和凭证 Cookie；Swagger UI 已将请求的
  `credentials` 设置为 `include`。
- 前端应同时处理 HTTP 状态码和响应体中的业务 `code`，不能只把 HTTP 200
  当作业务成功。
- 前端生成 TypeScript Client 时，以 `/api-docs/openapi.json` 为输入即可；不要
  直接依赖 Thrift 生成代码。
