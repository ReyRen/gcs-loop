# 基于评测实验优化 Prompt：前端接入说明

本文对应 Loop 官网“智能优化 → 基于评测实验优化 Prompt”。GCS Loop 只实现这一种优化来源，不提供“基于需求描述优化”。接口、字段名和状态值按官网调用方式定义，不再兼容旧的实验级 `prompt_optimizations` 接口。

部署地址：`http://172.18.36.230:8082`。浏览器同源场景可继续使用项目已有 `/promptApi` 代理。所有接口使用当前登录态，业务成功必须同时满足 HTTP 200 和响应 `code === 0`。JavaScript 中所有 ID 均按字符串保存。

## 1. 官网一致的调用流程

1. 前端从实验列表中选择“成功完成、评测对象为当前 Prompt 已提交版本、配置了评估器”的实验。
2. 读取实验结果，选择 20～500 个 `item_id`。全是满分的样本不能用于优化。
3. 配置 Prompt 变量、参考答案和模型实际输出的字段映射。
4. 先调用资源预估，再使用相同参数创建异步任务。
5. 创建成功后跳转 `/pe/prompts/{prompt_id}/optimization/{task_id}`，每 2 秒查询任务。
6. `Running` 且已有评测结果时展示部分 `optimize_result`，持续更新当前最佳 Prompt、指标和已完成迭代；`Success` 后展示最终结果。用户点击“提交新版本”时，前端把优化结果显式保存为 Prompt 草稿。
7. 用户在原 Prompt 编辑器中检查草稿，再调用已有 `drafts/commit` 创建正式版本。优化任务不会自动写草稿，也不会自动发布。

```mermaid
sequenceDiagram
    participant UI as 前端
    participant EXP as 实验接口
    participant OPT as 优化任务接口
    participant P as Prompt接口
    UI->>EXP: 查询成功实验和实验结果
    UI->>OPT: POST optimize_tasks/evaluate
    OPT-->>UI: 资源用量范围
    UI->>OPT: POST optimize_tasks
    OPT-->>UI: optimize_task
    loop Created 或 Running，每2秒
        UI->>OPT: POST optimize_tasks/{task_id}
        OPT-->>UI: 状态、进度、结果
    end
    UI->>P: POST drafts/save（显式应用优化结果）
    UI->>P: POST drafts/commit（用户确认后发布版本）
```

## 2. 优化任务接口清单

| 用途 | Method | Path |
|---|---|---|
| 预估资源 | POST | `/api/prompt/v1/prompts/{prompt_id}/optimize_tasks/evaluate` |
| 创建任务 | POST | `/api/prompt/v1/prompts/{prompt_id}/optimize_tasks` |
| 查询任务 | POST | `/api/prompt/v1/prompts/{prompt_id}/optimize_tasks/{task_id}` |
| 终止任务 | POST | `/api/prompt/v1/prompts/{prompt_id}/optimize_tasks/{task_id}/terminate` |
| 当前 Prompt 的优化列表 | POST | `/api/prompt/v1/prompts/{prompt_id}/optimize_tasks/list` |

旧的 `/api/evaluation/v1/experiments/{expt_id}/prompt_optimizations/**` 路由已经删除。官网的 `prompt_pilot_auth_token/get` 只用于其 PromptPilot 外部 iframe；GCS Loop 使用本地优化引擎和本地结果页，不调用该外部服务，因此不提供伪造的 token 接口。

## 3. 预估与创建的公共参数

```ts
interface PromptOptimizeFieldMapping {
  from_field_name?: string; // 评测集或实验输出字段
  field_name?: string;      // Prompt变量名；输出映射固定为 output/actual_output
  const_value?: string;
}

interface OptimizeTaskParams {
  workspace_id: string;
  target_type?: 'Prompt';
  target_version: string;
  dataset_type: 'Experiment';
  related_eval_set_id: string;
  related_eval_set_version_id: string;
  related_expt_id: string;
  selected_item_id_list: string[]; // 20～500个实验 item_id
  eval_set_to_target: PromptOptimizeFieldMapping[];
  eval_set_to_reference?: PromptOptimizeFieldMapping;
  eval_set_to_actual_output: PromptOptimizeFieldMapping;
  engine?: 'Ark';
  optimize_factor?: number; // 0～1，默认0.5
  optimize_task_type?: 'Score';
}
```

映射示例：

```json
{
  "workspace_id": "7670078211023175681",
  "target_type": "Prompt",
  "target_version": "0.0.4",
  "dataset_type": "Experiment",
  "related_eval_set_id": "7671000000000000001",
  "related_eval_set_version_id": "7671000000000000002",
  "related_expt_id": "7675204169145253889",
  "selected_item_id_list": ["7675000000000000001", "7675000000000000002"],
  "eval_set_to_target": [
    {"from_field_name": "question", "field_name": "query"}
  ],
  "eval_set_to_reference": {
    "from_field_name": "reference_answer",
    "field_name": "output"
  },
  "eval_set_to_actual_output": {
    "from_field_name": "actual_output",
    "field_name": "actual_output"
  },
  "engine": "Ark",
  "optimize_factor": 0.5,
  "optimize_task_type": "Score"
}
```

`eval_set_to_target` 必须完整覆盖 Prompt 的全部变量；没有参考答案时省略 `eval_set_to_reference`。`selected_item_id_list` 中的 ID 来自实验结果的 `item_id`，不能提交行号、实验 ID 或其他 ID。

## 4. 预估资源

```http
POST /api/prompt/v1/prompts/{prompt_id}/optimize_tasks/evaluate
Content-Type: application/json
```

请求体使用上一节公共参数。响应：

```json
{
  "min_total_resource_usage": "21",
  "max_total_resource_usage": "168",
  "code": 0,
  "msg": ""
}
```

GCS Loop 不做积分扣费，这两个值表示预计模型调用量下限和上限，用于前端确认弹窗。

## 5. 创建任务

```http
POST /api/prompt/v1/prompts/{prompt_id}/optimize_tasks
Content-Type: application/json
```

请求体在公共参数基础上增加预估结果：

```json
{
  "...": "与预估请求相同",
  "estimate_resource_usage": {
    "min_credit_usage": "21",
    "max_credit_usage": "168"
  }
}
```

成功响应字段为 `optimize_task`。创建接口立即返回，任务通常处于 `Created`；不能等待任务结束后才跳转。

## 6. 查询任务和轮询

```http
POST /api/prompt/v1/prompts/{prompt_id}/optimize_tasks/{task_id}
Content-Type: application/json

{"workspace_id":"7670078211023175681"}
```

仅在 `Created`、`Running` 时每 2 秒轮询；进入 `Success`、`Failed` 或 `Terminated` 后停止。

主要返回结构：

```ts
interface PromptOptimizeTask {
  id?: string;
  task_name?: string;
  status?: 'Created' | 'Running' | 'Success' | 'Failed' | 'Terminated';
  stage?: 'Preparing' | 'Analyzing' | 'Optimizing' | 'Evaluating' | 'Finalizing' | 'Completed';
  progress?: number;
  error_message?: string;
  optimize_target?: {
    target_id?: string;
    target_name?: string;
    target_key?: string;
    target_version?: string;
    target_type?: string;
  };
  optimize_task_data_set?: {
    dataset_type?: string;
    related_eval_set_id?: string;
    related_eval_set_version_id?: string;
    related_expt_id?: string;
    selected_item_id_list?: string[];
    eval_set_to_target?: PromptOptimizeFieldMapping[];
    eval_set_to_reference?: PromptOptimizeFieldMapping;
    eval_set_to_actual_output?: PromptOptimizeFieldMapping;
    estimate_resource_usage?: {
      min_credit_usage?: string;
      max_credit_usage?: string;
    };
  };
  optimize_engine_config?: {
    engine?: string;
    optimize_factor?: number;
    balance_mode?: 'EffectFirst' | 'CostEffectiveFirst';
    optimize_task_type?: string;
  };
  optimize_result?: {
    optimized_prompt_message_list?: unknown[];
    optimized_tool_list?: unknown[];
    baseline_metrics?: unknown;
    best_metrics?: unknown;
    iterations?: unknown[];
  };
}
```

`Running` 状态下，只要后端已经完成基线分析或至少一轮候选评测，详情接口就会返回当前可用的 `optimize_result`：

- `optimized_prompt_message_list`：当前最佳 Prompt；
- `baseline_metrics`：源 Prompt 的基线指标；
- `best_metrics`：当前最佳候选指标；
- `iterations`：已经完成的迭代及样本结果。

任务刚进入 `Running`、尚未产生任何指标时，`optimize_result` 可以为空。前端应继续按 2 秒间隔轮询，不能把空结果当作任务失败。

## 7. 终止任务

```http
POST /api/prompt/v1/prompts/{prompt_id}/optimize_tasks/{task_id}/terminate
Content-Type: application/json

{"workspace_id":"7670078211023175681"}
```

仅 `Created`、`Running` 状态可终止。成功响应返回最新的 `optimize_task`，其 `status` 为 `Terminated`；对已经是 `Terminated` 的任务重复调用仍成功。`Success`、`Failed` 等其他终态不能再终止。

## 8. 当前 Prompt 的优化任务列表

```http
POST /api/prompt/v1/prompts/{prompt_id}/optimize_tasks/list
Content-Type: application/json

{
  "workspace_id": "7670078211023175681",
  "status": ["Created", "Running", "Success", "Failed", "Terminated"],
  "name": "",
  "relation_type": "",
  "page_num": 1,
  "page_size": 20
}
```

响应字段为 `optimize_tasks` 和 `total`。Prompt 详情页“优化”标签只能使用这个 Prompt 级接口，不能再按实验 ID 查询。

## 9. 将结果应用到草稿并提交版本

官网没有独立的 `apply_to_draft` 优化接口。`Success` 后，前端取：

- `optimize_result.optimized_prompt_message_list`
- `optimize_result.optimized_tool_list`
- 源 Prompt 版本原有的模型配置、MCP、工具调用配置等

组合成已有 `PromptDraft`，调用：

```http
POST /api/prompt/v1/prompts/{prompt_id}/drafts/save
Content-Type: application/json

{
  "prompt_draft": {
    "draft_info": {"base_version": "0.0.4"},
    "detail": {
      "prompt_template": {
        "messages": ["使用 optimize_result.optimized_prompt_message_list"],
        "template_type": "normal"
      },
      "model_config": {},
      "tools": [],
      "tool_call_config": {},
      "mcp_config": {}
    }
  }
}
```

保存成功后跳转 Prompt 编辑器。用户确认版本信息后才调用：

```http
POST /api/prompt/v1/prompts/{prompt_id}/drafts/commit
Content-Type: application/json

{
  "commit_version": "0.0.5",
  "commit_description": "基于评测实验优化",
  "label_keys": []
}
```

不要在任务完成时自动保存草稿；不要把 `drafts/save` 显示成“发布成功”；只有 `drafts/commit` 成功才产生新版本。

## 10. Swagger

- UI：`http://172.18.36.230:8082/api-docs`
- JSON：`http://172.18.36.230:8082/api-docs/openapi.json`

Swagger 中应只出现本文件列出的五个 `optimize_tasks` 接口，不应再出现旧 `prompt_optimizations` 路由。

## 11. 执行并发与评分说明

接口及轮询方式不变，前端不需要传并发参数。部署配置位于 `release/deployment/docker-compose/.env`：

- `COZE_LOOP_PROMPT_OPTIMIZATION_WORKERS=6`：同时运行的优化任务数。
- `COZE_LOOP_PROMPT_OPTIMIZATION_SAMPLE_CONCURRENCY=4`：每个任务每一轮同时评估的样本数，默认 4，范围 1–32；设置 1 即串行。修改后重新创建 app 容器生效。

轮次仍依次执行，每条样本内先运行 Prompt，再逐个运行评估器。样本可乱序完成，但返回的样本结果顺序不变，进度按完成数量递增。两个并发配置共同决定上游压力；当前上限是 6×4 条样本链路，并非只增加任务数就能加速单个任务。

评估器不再从 `reasoning_content` 猜测评分，也不接受被 Token 上限截断的输出。当前 DeepSeek 评估器通过已有 `evaluation.yaml / evaluator_prompt_mapping` 使用结构化工具评分。智能优化要求评分为 0–1 的有限数值；缺失、越界评分会报错，不会截断成 1 或计作成功。通用评估器在智能优化之外仍可使用自定义评分尺度。

历史错误评分不会被自动改写。已有错误优化结果应重新创建优化任务；若源实验本身存在错误评分，应先重新运行实验。应用服务重启时，未完成任务会重新排队执行，并非从样本断点续跑。
