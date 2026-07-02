# 提示词工厂 API 对接表

> 本文是前端联调用的真实 API 映射。契约源头是 `idl/thrift/coze/loop/prompt` 下的 Thrift IDL。

## 基础概念

| 概念 | 后端字段 |
| --- | --- |
| 工作空间 | `workspace_id` |
| Prompt 主键 | `prompt_id` 或 `prompt.id` |
| Prompt 稳定标识 | `prompt_key` |
| 草稿 | `prompt_draft` |
| 发布版本 | `commit_version` 或 `prompt_commit.commit_info.version` |
| 标签 | `label.key` |
| Prompt 类型 | `normal`、`snippet` |

所有带 `api.js_conv='true'` 的 ID，前端如果通过 IDL 生成器转成 string，就按 string 处理。

## UI 必需 Foundation API

| 功能 | Method 和路径 | 说明 |
| --- | --- | --- |
| 注册 | `POST /api/foundation/v1/users/register` | 写入 session cookie |
| 登录 | `POST /api/foundation/v1/users/login_by_password` | 写入 session cookie |
| 当前会话 | `GET /api/foundation/v1/users/session` | 读取 cookie |
| 用户空间 | `POST /api/foundation/v1/spaces/list` | 选择 `workspace_id` |
| PAT 列表 | `POST /api/auth/v1/personal_access_tokens/list` | OpenAPI 凭据页 |
| 创建 PAT | `POST /api/auth/v1/personal_access_tokens` | 明文 token 仅返回一次 |

## Prompt 管理链路

### 列表

```http
POST /api/prompt/v1/prompts/list
```

请求字段：

| 字段 | 类型 | 必填 |
| --- | --- | --- |
| `workspace_id` | i64 | 是 |
| `key_word` | string | 否 |
| `created_bys` | list<string> | 否 |
| `committed_only` | bool | 否 |
| `filter_prompt_types` | list<PromptType> | 否 |
| `page_num` | i32 | 是 |
| `page_size` | i32，最大 100 | 是 |
| `order_by` | `created_at` 或 `committed_at` | 否 |
| `asc` | bool | 否 |

响应字段：`prompts`、`users`、`total`、`BaseResp`。

### 新建

```http
POST /api/prompt/v1/prompts
```

请求字段：`workspace_id`、`prompt_name`、`prompt_key`、`prompt_description`、`prompt_type`、`security_level`、`draft_detail`。

响应字段：`prompt_id`、`BaseResp`。

### 详情

```http
GET /api/prompt/v1/prompts/:prompt_id
```

Query 字段：

| 字段 | 含义 |
| --- | --- |
| `workspace_id` | 工作空间保护 |
| `with_commit` | 返回已发布详情 |
| `commit_version` | 指定版本；支持处为空时取最新版本 |
| `with_draft` | 返回当前用户草稿 |
| `with_default_config` | 返回默认 prompt 配置 |
| `expand_snippet` | 展开 snippet 引用 |

响应字段：`prompt`、`default_config`、`total_parent_references`、`BaseResp`。

### 更新基础信息

```http
PUT /api/prompt/v1/prompts/:prompt_id
```

请求字段：`prompt_name`、`prompt_description`、`security_level`、`downgrade_reason`。

### 保存草稿

```http
POST /api/prompt/v1/prompts/:prompt_id/drafts/save
```

核心请求字段：

| 字段 | 类型 |
| --- | --- |
| `prompt_draft.detail.prompt_template` | 消息、变量、metadata |
| `prompt_draft.detail.tools` | 绑定工具 |
| `prompt_draft.detail.tool_call_config` | 工具选择 |
| `prompt_draft.detail.model_config` | 模型配置 |
| `prompt_draft.detail.mcp_config` | MCP 配置 |

响应字段：`draft_info`、`BaseResp`。

### 提交版本

```http
POST /api/prompt/v1/prompts/:prompt_id/drafts/commit
```

请求字段：`commit_version`、`commit_description`、`label_keys`。

### 版本列表

```http
POST /api/prompt/v1/prompts/:prompt_id/commits/list
```

请求字段：`with_commit_detail`、`page_size`、`page_token`、`asc`。

响应字段：`prompt_commit_infos`、`commit_version_label_mapping`、`parent_references_mapping`、`prompt_commit_detail_mapping`、`users`、`has_more`、`next_page_token`。

### 版本维护

| 操作 | Method 和路径 | 关键字段 |
| --- | --- | --- |
| 从版本回滚草稿 | `POST /api/prompt/v1/prompts/:prompt_id/drafts/revert_from_commit` | `commit_version_reverting_from` |
| 更新标签 | `POST /api/prompt/v1/prompts/:prompt_id/commits/:commit_version/labels_update` | `workspace_id`、`label_keys` |
| 删除 prompt | `DELETE /api/prompt/v1/prompts/:prompt_id` | path `prompt_id` |

## Label API

| 功能 | Method 和路径 | 关键字段 |
| --- | --- | --- |
| 创建 label | `POST /api/prompt/v1/labels` | `workspace_id`、`label.key` |
| 列出 label | `POST /api/prompt/v1/labels/list` | `workspace_id`、`label_key_like`、`with_prompt_version_mapping`、`prompt_id`、`page_size`、`page_token` |
| 批量获取 label | `POST /api/prompt/v1/labels/batch_get` | `workspace_id`、`label_keys` |

## Snippet API

Snippet 复用 Prompt API，区别是 `prompt_type="snippet"`。

```http
POST /api/prompt/v1/prompts/list_parent
```

请求字段：`workspace_id`、`prompt_id`、`commit_versions`。

响应字段：`parent_prompts`，key 为 snippet version。

## Debug API

### 流式 Debug

```http
POST /api/prompt/v1/prompts/:prompt_id/debug_streaming
```

请求字段：

| 字段 | 含义 |
| --- | --- |
| `prompt` | 待调试的完整 prompt 对象 |
| `messages` | 运行时消息 |
| `variable_vals` | `variable_defs` 对应的变量值 |
| `mock_tools` | 工具 mock 输出 |
| `single_step_debug` | 必填 bool |
| `debug_trace_key` | 继续或关联调试 trace |

流式响应字段：`delta`、`finish_reason`、`usage`、`debug_id`、`debug_trace_key`、`BaseResp`。

### Debug Context

| 功能 | Method 和路径 |
| --- | --- |
| 保存 | `POST /api/prompt/v1/prompts/:prompt_id/debug_context/save` |
| 获取 | `GET /api/prompt/v1/prompts/:prompt_id/debug_context/get` |
| 历史 | `GET /api/prompt/v1/prompts/:prompt_id/debug_history/list` |

历史查询字段：`workspace_id`、`days_limit`、`page_size`、`page_token`。

## Tool API

| 功能 | Method 和路径 |
| --- | --- |
| 创建 | `POST /api/prompt/v1/tools` |
| 详情 | `GET /api/prompt/v1/tools/:tool_id` |
| 列表 | `POST /api/prompt/v1/tools/list` |
| 保存草稿 | `POST /api/prompt/v1/tools/:tool_id/drafts/save` |
| 提交版本 | `POST /api/prompt/v1/tools/:tool_id/drafts/commit` |
| 版本列表 | `POST /api/prompt/v1/tools/:tool_id/commits/list` |
| 批量获取 | `POST /api/prompt/v1/tools/mget` |

## OpenAPI 运行时 API

这些接口用于服务间调用或 SDK 调用。

| 功能 | Method 和路径 |
| --- | --- |
| 按 key 批量获取 | `POST /v1/loop/prompts/mget` |
| 执行 | `POST /v1/loop/prompts/execute` |
| 流式执行 | `POST /v1/loop/prompts/execute_streaming` |
| 列出基础信息 | `POST /v1/loop/prompts/list` |
| 新建 prompt | `POST /v1/loop/prompts` |
| 删除 prompt | `DELETE /v1/loop/prompts/:prompt_id` |
| 获取 prompt | `GET /v1/loop/prompts/:prompt_id` |
| 保存草稿 | `POST /v1/loop/prompts/:prompt_id/drafts/save` |
| 版本列表 | `POST /v1/loop/prompts/:prompt_id/commits/list` |
| 提交版本 | `POST /v1/loop/prompts/:prompt_id/drafts/commit` |

执行请求核心字段：

| 字段 | 含义 |
| --- | --- |
| `workspace_id` | 工作空间 |
| `prompt_identifier.prompt_key` | Prompt key |
| `prompt_identifier.version` | 指定版本 |
| `prompt_identifier.label` | 版本标签；传了 `version` 时会被忽略 |
| `variable_vals` | 运行时变量 |
| `messages` | 额外运行时消息 |
| `custom_tools` | 单次调用工具覆盖 |
| `custom_tool_call_config` | 单次调用工具策略覆盖 |
| `custom_model_config` | 单次调用模型配置覆盖 |
| `response_api_config` | Response API session/cache 字段 |
| `usage_scenario` | `default`、`evaluation`、`prompt_as_a_service`、`ai_annotate`、`ai_score`、`ai_tag` |

## 错误处理

Web API 都有 `BaseResp`；OpenAPI 响应还会暴露 `code` 和 `msg`。前端应直接展示后端错误信息，不要在客户端自造错误分类。
