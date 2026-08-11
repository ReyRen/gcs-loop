# PAT 与公开 API 地址前端接入说明

本文供 GCS Loop 左侧“API 授权”页面接入。页面使用登录态管理 Personal Access Token（PAT），用户自己的服务再使用 PAT 调用 `/v1/loop/**`。前端代码不需要、也不应保存用户创建出的密钥。

## 1. 页面初始化

页面并行请求公开 API 地址和 PAT 列表：

```http
GET /api/auth/v1/public_api_config
POST /api/auth/v1/personal_access_tokens/list?page_number=1&page_size=100
```

两个接口都使用当前登录会话，跨域部署时必须携带 Cookie：

```ts
const requestOptions: RequestInit = { credentials: 'include' };

const [configResponse, tokenListResponse] = await Promise.all([
  fetch('/api/auth/v1/public_api_config', requestOptions),
  fetch('/api/auth/v1/personal_access_tokens/list?page_number=1&page_size=100', {
    ...requestOptions,
    method: 'POST',
  }),
]);
```

公开 API 地址响应：

```json
{
  "base_url": "http://192.168.1.100:8082",
  "code": 0,
  "msg": ""
}
```

前端直接展示 `base_url`。它是不带结尾 `/` 和 `/v1` 路径的 HTTP Origin。Prompt 版本页的 `invoke_info.base_url` 与这里使用同一来源。

PAT 列表响应：

```json
{
  "personal_access_tokens": [
    {
      "id": "7670000000000000001",
      "name": "production-service",
      "created_at": "1786410000",
      "updated_at": "1786410000",
      "last_used_at": "0",
      "expire_at": "1789002000"
    }
  ],
  "code": 0,
  "msg": ""
}
```

时间字段是 Unix 秒，IDL 为 JavaScript 安全将 i64 序列化成字符串。当前创建响应使用 `last_used_at = "0"`，持久化列表中的未使用值可能为 `"-1"`；前端按 `<= 0` 统一显示“尚未使用”。

## 2. 创建并复制密钥

```http
POST /api/auth/v1/personal_access_tokens
Content-Type: application/json
```

```json
{
  "name": "production-service",
  "duration_day": "90"
}
```

`duration_day` 可取 `1`、`30`、`60`、`90`、`180`、`365`、`permanent`。也可以改传 Unix 秒字段 `expire_at`；前端一次只传一种过期方式。

成功响应：

```json
{
  "personal_access_token": {
    "id": "7670000000000000001",
    "name": "production-service",
    "created_at": "1786410000",
    "updated_at": "1786410000",
    "last_used_at": "0",
    "expire_at": "1789002000"
  },
  "token": "<64位十六进制密钥>",
  "code": 0,
  "msg": ""
}
```

只有创建响应返回 `token`。前端应立即打开“一次性查看”弹窗，提供复制按钮；弹窗关闭后不能再从列表或详情接口取回密钥，只能删除并重新创建。不要将 `token` 写入 localStorage、埋点、错误日志或 URL。

## 3. 改名与撤销

改名：

```http
PUT /api/auth/v1/personal_access_tokens/{id}
Content-Type: application/json
```

```json
{
  "name": "renamed-service"
}
```

撤销：

```http
DELETE /api/auth/v1/personal_access_tokens/{id}
```

撤销后该密钥不能再认证。删除按钮必须二次确认，并在成功后重新加载列表。

如页面需要单条元数据，可调用：

```http
GET /api/auth/v1/personal_access_tokens/{id}
```

该接口同样不会返回明文 `token`。

## 4. 用户如何使用

用户将创建时复制的 PAT 放入自己的服务端环境变量：

```bash
export GCS_LOOP_API_TOKEN='<创建时复制的密钥>'
```

Prompt 版本页调用 `invoke_info` 后，后端返回的 cURL 已包含 `base_url`、固定 Prompt 版本以及该版本对应的动态变量；用户只需替换变量示例值并提供 PAT：

```bash
curl --request POST \
  'http://192.168.1.100:8082/v1/loop/prompts/execute' \
  --header "Authorization: Bearer ${GCS_LOOP_API_TOKEN}" \
  --header "Content-Type: application/json" \
  --data-binary '<invoke_info 返回的 request_body>'
```

后端验证 PAT 未撤销、未过期，并按 PAT 所属用户继续检查工作空间和 Prompt 执行权限。

## 5. 页面验收

- 页面初始化能同时显示公开 Base URL 和 PAT 列表。
- 创建成功后明文密钥只显示一次，复制按钮不触发任何日志或埋点。
- 列表和详情均不显示、不请求明文密钥。
- 改名后列表刷新；撤销二次确认且撤销后调用立即失败。
- 所有管理请求都使用 `credentials: 'include'`，不使用 Bearer PAT 管理 PAT 本身。
- 页面明确提示 PAT 只能放在用户自己的服务端或 Secret 管理中。
