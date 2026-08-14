# 基于评测实验优化 Prompt：前端接入说明

本文描述 GCS Loop 后端对“智能优化 → 基于评测实验优化 Prompt”的支持。该能力只处理已经成功完成、评测对象为已提交 Prompt 版本的实验；不会处理“基于需求描述生成 Prompt”等其他智能优化入口。

所有接口均使用浏览器登录态 `session_key`，响应沿用项目统一包络：

```json
{
  "code": 0,
  "msg": "",
  "...": "业务字段"
}
```

所有 ID 均按 JSON 字符串处理，避免 JavaScript `number` 精度丢失。

## 1. 与官方页面一致的产品流程

官方页面的核心流程是：

1. 在一个已经运行成功的 Prompt 实验中点击“智能优化”。
2. 选择“基于评测实验优化 Prompt”。
3. 从实验结果中选择样本，最多 20 条。
4. 将 Prompt 变量映射到评测集字段；选择模型回答字段和可选的参考答案字段。
5. 选择“效果优先”或“性价比优先”，启动异步优化。
6. 后端反复执行“分析评测结果 → 生成候选 Prompt → 使用同一模型运行候选 Prompt → 使用原实验评估器重新评分 → 保留更优候选”。
7. 完成页显示原 Prompt/优化后 Prompt、每轮候选、逐条原回答/新回答/得分/理由，以及平均分、提升/下降/不变数量。
8. 用户显式选择“应用到草稿”，再沿用已有 Prompt 提交新版本流程。优化任务本身绝不直接覆盖已提交版本，也绝不自动发布。

优化任务是持久化异步任务。页面刷新或后端重启后仍能继续查询；重启时处于 `queued`/`running` 的任务会重新排队恢复。

## 2. 前端完整调用时序

```mermaid
sequenceDiagram
    participant UI as 前端
    participant EXP as 实验接口
    participant OPT as 优化接口
    participant PROMPT as Prompt接口

    UI->>OPT: GET prepare
    OPT-->>UI: 资格、Prompt版本、变量、字段、评估器、模式
    UI->>EXP: POST results/batch_get
    EXP-->>UI: 实验结果行
    UI->>OPT: POST create（样本+字段映射）
    OPT-->>UI: task(status=queued)
    loop 每 1~2 秒
        UI->>OPT: GET task?with_iterations=true
        OPT-->>UI: status/stage/progress/metrics/iterations
    end
    UI->>OPT: GET task?with_iterations=true&with_sample_results=true
    OPT-->>UI: 最终 Prompt Diff、指标和逐条对比
    UI->>OPT: POST apply_to_draft
    OPT-->>UI: prompt_id + draft_base_version + next_action
    UI->>PROMPT: GET Prompt(with_draft=true)
    PROMPT-->>UI: 已应用的优化草稿
    UI->>PROMPT: POST drafts/commit（已有版本提交接口）
```

## 3. 准备优化

```http
GET /api/evaluation/v1/experiments/{expt_id}/prompt_optimizations/prepare?workspace_id={workspace_id}
```

示例响应：

```json
{
  "eligible": true,
  "experiment_id": "7590117729999098882",
  "experiment_name": "提示词优化实验",
  "prompt_id": "7590116429134035714",
  "prompt_key": "proposal_writer",
  "prompt_name": "招标方案撰写",
  "source_prompt_version": "0.0.1",
  "prompt_variables": [
    {
      "key": "tender_requirements",
      "type": "string",
      "description": "招标需求与评分标准"
    }
  ],
  "dataset_fields": [
    "tender_requirements",
    "reference_output"
  ],
  "target_output_fields": [
    "actual_output"
  ],
  "suggested_variable_mappings": {
    "tender_requirements": "tender_requirements"
  },
  "suggested_model_answer_field": "actual_output",
  "suggested_reference_answer_field": "reference_output",
  "mode_options": [
    {
      "mode": "effect_first",
      "display_name": "效果优先",
      "default_max_iterations": 8
    },
    {
      "mode": "cost_effective",
      "display_name": "性价比优先",
      "default_max_iterations": 3
    }
  ],
  "max_sample_count": 20,
  "default_sample_count": 20,
  "code": 0,
  "msg": ""
}
```

只有同时满足以下条件才能创建任务：

- 实验状态为成功完成；
- 评测对象是一个明确的、已提交的 Prompt 版本；
- 源 Prompt 版本仍然存在且有可用模型配置；
- 实验没有异步 Agent 评估器。

## 4. 获取并选择实验结果行

复用已有实验结果接口，不新增重复的样本列表接口：

```http
POST /api/evaluation/v1/experiments/results/batch_get?workspace_id={workspace_id}&page_number=1&page_size=20
Content-Type: application/json

{
  "experiment_ids": ["7590117729999098882"]
}
```

前端以响应中的 `item_results[].item_id` 与 `turn_results[].turn_id` 作为样本标识。最多选择 20 个实验结果行。数据字段、原模型回答、评估器原始得分和评分理由均由后端按照这些标识重新读取，前端不需要把大段结果内容回传给创建接口。

## 5. 创建异步优化任务

```http
POST /api/evaluation/v1/experiments/{expt_id}/prompt_optimizations
Content-Type: application/json

{
  "workspace_id": "7670078211023175681",
  "samples": [
    {
      "item_id": "10001",
      "turn_id": "20001"
    },
    {
      "item_id": "10002",
      "turn_id": "20002"
    }
  ],
  "variable_mappings": {
    "tender_requirements": "tender_requirements"
  },
  "model_answer_field": "actual_output",
  "reference_answer_field": "reference_output",
  "mode": "effect_first",
  "max_iterations": 8,
  "name": "招标方案提示词优化",
  "idempotency_key": "5e889d29-60cc-4f3f-953d-cd854da6fe36"
}
```

字段说明：

- `samples`：必填，1~20 条，不能重复。
- `variable_mappings`：`Prompt变量名 -> 评测集字段名`。Prompt 有变量时必须提供完整映射。
- `model_answer_field`：实验目标输出里代表模型回答的字段。
- `reference_answer_field`：可选，评测集里代表参考答案的字段。
- `mode`：`effect_first` 或 `cost_effective`；缺省为 `effect_first`。
- `max_iterations`：1~20；缺省分别为 8 或 3。
- `idempotency_key`：推荐每次用户点击启动时生成 UUID。网络重试必须复用同一个值；同一个 key 不能对应不同请求。

成功会立即返回 `queued` 任务，不会等待全部模型调用结束：

```json
{
  "task": {
    "id": "7600000000000000001",
    "workspace_id": "7670078211023175681",
    "experiment_id": "7590117729999098882",
    "prompt_id": "7590116429134035714",
    "prompt_key": "proposal_writer",
    "source_prompt_version": "0.0.1",
    "mode": "effect_first",
    "status": "queued",
    "stage": "preparing",
    "progress": 0
  },
  "code": 0,
  "msg": ""
}
```

## 6. 查询进度和实时结果

```http
GET /api/evaluation/v1/experiments/{expt_id}/prompt_optimizations/{optimization_id}?workspace_id={workspace_id}&with_iterations=true&with_sample_results=false
```

建议轮询策略：

- 页面可见且任务为 `queued`/`running` 时每 1~2 秒请求一次；
- 页面不可见时降低频率或暂停；
- 进入终态后停止轮询；
- 运行中先使用 `with_sample_results=false` 减少响应体；完成后再请求一次 `with_sample_results=true`。

`status`：

- `queued`：等待执行；
- `running`：正在执行；
- `succeeded`：完成；
- `failed`：失败，读取 `error_message`；
- `canceled`：已取消。

`stage`：

- `preparing`：读取 Prompt 和实验；
- `analyzing`：整理样本与原始指标；
- `optimizing`：生成候选 Prompt；
- `evaluating`：运行候选并调用原实验评估器；
- `finalizing`：汇总；
- `completed`：完成。

任务结果中的重要字段：

- `original_prompt_template` / `optimized_prompt_template`：前端做结构化 Prompt Diff；
- `baseline_metrics` / `best_metrics`：原始和当前最佳汇总指标；
- `iterations[]`：每轮候选、优化理由和指标；
- `iterations[].sample_results[]`：逐条原回答/优化回答、原得分/优化得分、各评估器分数和理由；
- `best_metrics.input_tokens/output_tokens`：优化模型、候选 Prompt 执行和评估器本轮产生的累计 Token。

前端应使用结构化字段绘制比较，不要对后端文本做 HTML diff 猜测。Prompt 文本 Diff 在浏览器本地完成。

## 7. 历史任务列表

```http
POST /api/evaluation/v1/experiments/{expt_id}/prompt_optimizations/list
Content-Type: application/json

{
  "workspace_id": "7670078211023175681",
  "page_number": 1,
  "page_size": 20,
  "statuses": ["succeeded", "failed"]
}
```

响应：

```json
{
  "tasks": [],
  "total": "0",
  "code": 0,
  "msg": ""
}
```

## 8. 取消任务

```http
POST /api/evaluation/v1/experiments/{expt_id}/prompt_optimizations/{optimization_id}/cancel
Content-Type: application/json

{
  "workspace_id": "7670078211023175681"
}
```

只有创建者能取消。后端使用条件更新，任务若已成功或失败，不会被迟到的取消请求覆盖成 `canceled`。正在进行的单次模型请求可能会完成，但下一阶段不会继续。

## 9. 应用最佳结果到 Prompt 草稿

```http
POST /api/evaluation/v1/experiments/{expt_id}/prompt_optimizations/{optimization_id}/apply_to_draft
Content-Type: application/json

{
  "workspace_id": "7670078211023175681",
  "overwrite_existing_draft": false
}
```

只有创建者且任务状态为 `succeeded` 时允许应用。该接口：

- 读取实验使用的准确 Prompt 提交版本；
- 保留该版本的模型、工具、MCP 等全部配置；
- 只替换 Prompt Template；
- 将结果保存为当前用户的草稿；
- 不创建正式版本，不自动发布。

如果当前用户已经有草稿，`overwrite_existing_draft=false` 会返回非零业务错误。前端必须展示“现有草稿将被覆盖”的确认框，用户确认后再用 `true` 重试。

成功响应：

```json
{
  "prompt_id": "7590116429134035714",
  "source_prompt_version": "0.0.1",
  "draft_base_version": "0.0.1",
  "next_action": "open_prompt_editor_and_submit_new_version",
  "code": 0,
  "msg": ""
}
```

随后前端跳转 Prompt 编辑页，调用已有接口加载草稿：

```http
GET /api/prompt/v1/prompts/{prompt_id}?workspace_id={workspace_id}&with_draft=true&with_commit=true
```

用户确认新版本号、标签和描述后，复用已有提交接口：

```http
POST /api/prompt/v1/prompts/{prompt_id}/drafts/commit
Content-Type: application/json

{
  "commit_version": "0.0.2",
  "commit_description": "基于评测实验优化",
  "label_keys": []
}
```

如果优化期间 Prompt 最新版本已经变化，现有草稿/提交版本冲突保护仍然生效。前端按既有 `600501011` 流程重新加载最新版本、显示 Diff，并由用户决定是否 rebase；禁止自动覆盖新版本。

## 10. 前端页面建议

建议与官方页面保持以下结构：

- 实验详情右上角“智能优化”只保留“基于评测实验优化 Prompt”；
- 第一步：实验结果表格，可选 1~20 条；
- 第二步：变量映射、模型回答字段、参考答案字段、优化模式；
- 运行页：阶段进度、当前轮次、当前最佳平均分；
- 完成页：顶部原始/最佳汇总分，左侧原 Prompt，右侧优化 Prompt；
- 下方逐样本表展示原回答/优化回答、原分/新分、评分理由；
- 操作按钮：“取消”“应用到草稿”；不要写成“直接发布”；
- 应用成功后跳转 Prompt 编辑器，最终提交仍走已有版本控制。

## 11. Swagger 与持久化

上述六个新接口均已生成到：

- Swagger UI：`/api-docs`
- OpenAPI JSON：`/api-docs/openapi.json`

任务数据保存在：

- `prompt_optimization_task`：任务状态、源 Prompt、最佳 Prompt、汇总指标、应用状态；
- `prompt_optimization_iteration`：每轮候选、理由、指标和逐样本结果。

候选 Prompt 在评测时通过内部内存覆盖执行，不会在优化过程中创建草稿或污染正式 Prompt。只有显式调用 `apply_to_draft` 才会写入草稿。
