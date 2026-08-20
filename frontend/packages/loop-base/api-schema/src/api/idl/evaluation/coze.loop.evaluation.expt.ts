// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import * as prompt_prompt from './../prompt/domain/prompt';
export { prompt_prompt };
import * as evaluator from './domain/evaluator';
export { evaluator };
import * as expt from './domain/expt';
export { expt };
import * as common from './domain/common';
export { common };
import * as coze_loop_evaluation_eval_target from './coze.loop.evaluation.eval_target';
export { coze_loop_evaluation_eval_target };
import * as eval_set from './domain/eval_set';
export { eval_set };
import * as data_dataset from './../data/domain/dataset';
export { data_dataset };
import * as base from './../../../base';
export { base };
import { createAPI } from './../../config';
export interface CreateExperimentRequest {
  workspace_id: string,
  eval_set_version_id?: string,
  target_version_id?: string,
  evaluator_version_ids?: string[],
  name?: string,
  desc?: string,
  eval_set_id?: string,
  target_id?: string,
  /** 实验模板可见性，默认为空，可见 */
  visibility?: expt.Visibility,
  target_field_mapping?: expt.TargetFieldMapping,
  evaluator_field_mapping?: expt.EvaluatorFieldMapping[],
  item_concur_num?: number,
  evaluators_concur_num?: number,
  create_eval_target_param?: coze_loop_evaluation_eval_target.CreateEvalTargetParam,
  target_runtime_param?: common.RuntimeParam,
  expt_type?: expt.ExptType,
  max_alive_time?: number,
  source_type?: expt.SourceType,
  source_id?: string,
  /** 补充的评估器id+version关联评估器方式，和evaluator_version_ids共同使用，兼容老逻辑 */
  evaluator_id_version_list?: evaluator.EvaluatorIDVersionItem[],
  /** 是否启用评估器得分加权汇总，以及各评估器的权重配置（key 为 evaluator_version_id，value 为权重） */
  enable_weighted_score?: boolean,
  evaluator_score_weights?: {
    [key: string | number]: number
  },
  expt_template_id?: string,
  item_retry_num?: number,
  /** 试运行行数 */
  trial_run_item_count?: number,
  enable_extract_trajectory?: boolean,
  /** 关联的智能评测会话ID */
  thread_id?: string,
  trigger_type?: expt.ExptTriggerType,
  /** ★ 多评测集配置 (item-centric 新路径权威源); 仅当 eval_set_source_type == MultiSetConfig(2) 时生效 */
  eval_set_configs?: expt.EvalSetConfig[],
  /**
   * ★ 新路径分流依据 (唯一开关): 仅 == MultiSetConfig(2) 走 item-centric 多评测集路径; 缺省/SingleSet(1) 走老路径。
   * 与 eval_set_configs 须一致: ==2 要求 configs 非空; !=2 要求 configs 为空, 否则硬校验报错。
  */
  eval_set_source_type?: expt.ExptEvalSetSourceType,
  /**
   * 单评测集(SingleSet)跨空间共享来源; 多评测集走 eval_set_configs 内每个 EvalSetConfig 的 shared_option
   * 评测集来源空间
  */
  eval_set_shared_option?: common.SharedResourceOption,
  /** 评测对象来源空间 */
  target_shared_option?: common.SharedResourceOption,
  /**
   * 实验分组 key 默认为实验 id；填写 ref_group_experiment_id 时复用该引用实验的 group key（归入同一分组）
   * 引用分组实验 id：填写时校验其为当前空间内的实验 id
  */
  ref_group_experiment_id?: string,
  /** 通知配置 */
  notification_conf?: expt.ExptNotificationConf,
  ext?: {
    [key: string | number]: string
  },
  session?: common.Session,
}
export interface CreateExperimentResponse {
  experiment?: expt.Experiment
}
export interface SubmitExperimentRequest {
  workspace_id: string,
  eval_set_version_id?: string,
  target_version_id?: string,
  evaluator_version_ids?: string[],
  name?: string,
  desc?: string,
  eval_set_id?: string,
  target_id?: string,
  /** 实验模板可见性，默认为空，可见 */
  visibility?: expt.Visibility,
  target_field_mapping?: expt.TargetFieldMapping,
  evaluator_field_mapping?: expt.EvaluatorFieldMapping[],
  item_concur_num?: number,
  evaluators_concur_num?: number,
  create_eval_target_param?: coze_loop_evaluation_eval_target.CreateEvalTargetParam,
  target_runtime_param?: common.RuntimeParam,
  expt_type?: expt.ExptType,
  max_alive_time?: number,
  source_type?: expt.SourceType,
  source_id?: string,
  /** 补充的评估器id+version关联评估器方式，和evaluator_version_ids共同使用，兼容老逻辑 */
  evaluator_id_version_list?: evaluator.EvaluatorIDVersionItem[],
  /** 是否启用评估器得分加权汇总，以及各评估器的权重配置（key 为 evaluator_version_id，value 为权重） */
  enable_weighted_score?: boolean,
  expt_template_id?: string,
  item_retry_num?: number,
  /** 试运行行数 */
  trial_run_item_count?: number,
  enable_extract_trajectory?: boolean,
  /** 提交实验时前端透传的发起人 user JWT，用于预下载 skill 入 TOS */
  "X-Jwt-Token"?: string,
  trigger_type?: expt.ExptTriggerType,
  time_range?: expt.TaskTimeRange,
  /**
   * 智能评测相关
   * 关联的智能评测会话ID
  */
  thread_id?: string,
  /** 指定执行的评测集条目ID列表 */
  item_ids?: string[],
  /**
   * ★ 多评测集配置 (item-centric 新路径权威源); 仅当 eval_set_source_type == MultiSetConfig(2) 时生效
   * 注: 70 号已被 item_ids 占用, 取 75
  */
  eval_set_configs?: expt.EvalSetConfig[],
  /**
   * ★ 新路径分流依据 (唯一开关): 仅 == MultiSetConfig(2) 走 item-centric 多评测集路径; 缺省/SingleSet(1) 走老路径。
   * 与 eval_set_configs 须一致: ==2 要求 configs 非空; !=2 要求 configs 为空, 否则硬校验报错。
  */
  eval_set_source_type?: expt.ExptEvalSetSourceType,
  /**
   * 单评测集(SingleSet)跨空间共享来源; 多评测集走 eval_set_configs 内每个 EvalSetConfig 的 shared_option
   * 评测集来源空间
  */
  eval_set_shared_option?: common.SharedResourceOption,
  /** 评测对象来源空间 */
  target_shared_option?: common.SharedResourceOption,
  ext?: {
    [key: string | number]: string
  },
  /**
   * 实验分组 key 默认为实验 id；填写 ref_group_experiment_id 时复用该引用实验的 group key（归入同一分组）
   * 引用分组实验 id：填写时校验其为当前空间内的实验 id
  */
  ref_group_experiment_id?: string,
  /** 通知配置 */
  notification_conf?: expt.ExptNotificationConf,
  session?: common.Session,
}
export interface SubmitExperimentResponse {
  experiment?: expt.Experiment,
  run_id?: string,
}
export interface ListExperimentsRequest {
  workspace_id: string,
  page_number?: number,
  page_size?: number,
  filter_option?: expt.ExptFilterOption,
  order_bys?: common.OrderBy[],
}
export interface ListExperimentsResponse {
  experiments?: expt.Experiment[],
  total?: number,
}
export interface BatchGetExperimentsRequest {
  workspace_id: string,
  expt_ids: string[],
}
export interface BatchGetExperimentsResponse {
  experiments?: expt.Experiment[]
}
export interface GetExperimentIDsByGroupRequest {
  workspace_id: string,
  experiment_group_key: string,
}
export interface GetExperimentIDsByGroupResponse {
  expt_ids?: string[],
  experiments?: expt.Experiment[],
}
export interface UpdateExperimentRequest {
  workspace_id: string,
  expt_id: string,
  name?: string,
  desc?: string,
  /** 通知配置（可选更新） */
  notification_conf?: expt.ExptNotificationConf,
}
export interface UpdateExperimentResponse {
  experiment?: expt.Experiment
}
/**
 * UpdateExptRunConfRequest 修改进行中实验的运行配置（并发度 / Item 重试次数）。
 * 仅对处于 Pending / Processing 状态的实验生效。
*/
export interface UpdateExptRunConfRequest {
  workspace_id: string,
  expt_id: string,
  /** 评测项并发度：不传或 0 表示不修改；范围 (0, MaxItemConcurNum] */
  item_concur_num?: number,
  /** 数据行 Item 最大重试次数：不传表示不修改；0 表示显式设为不重试；范围 [0, 10] */
  item_retry_num?: number,
}
export interface UpdateExptRunConfResponse {}
export interface DeleteExperimentRequest {
  workspace_id: string,
  expt_id: string,
}
export interface DeleteExperimentResponse {}
export interface BatchDeleteExperimentsRequest {
  workspace_id: string,
  expt_ids: string[],
}
export interface BatchDeleteExperimentsResponse {}
export interface RunExperimentRequest {
  workspace_id?: string,
  expt_id?: string,
  item_ids?: string[],
  expt_type?: expt.ExptType,
  item_retry_num?: number,
  /** 试运行行数 */
  trial_run_item_count?: number,
  ext?: {
    [key: string | number]: string
  },
  session?: common.Session,
}
export interface RunExperimentResponse {
  run_id?: string
}
export interface RetryExperimentRequest {
  retry_mode?: expt.ExptRetryMode,
  workspace_id?: string,
  expt_id?: string,
  item_ids?: string[],
  ext?: {
    [key: string | number]: string
  },
}
export interface RetryExperimentResponse {
  run_id?: string
}
export interface KillExperimentRequest {
  expt_id?: string,
  workspace_id?: string,
}
export interface KillExperimentResponse {}
export interface CloneExperimentRequest {
  expt_id?: string,
  workspace_id?: string,
}
export interface CloneExperimentResponse {
  experiment?: expt.Experiment
}
export interface BatchGetExperimentResultRequest {
  workspace_id: string,
  experiment_ids: string[],
  /** Baseline experiment ID for experiment comparison */
  baseline_experiment_id?: string,
  /** key: experiment_id */
  filters?: {
    [key: string | number]: expt.ExperimentFilter
  },
  page_number?: number,
  page_size?: number,
  use_accelerator?: boolean,
  /** 是否包含轨迹 */
  full_trajectory?: boolean,
}
export interface BatchGetExperimentResultResponse {
  /** 数据集表头信息 */
  column_eval_set_fields: expt.ColumnEvalSetField[],
  /** 评估器表头信息 */
  column_evaluators?: expt.ColumnEvaluator[],
  expt_column_evaluators?: expt.ExptColumnEvaluator[],
  /** 人工标注标签表头信息 */
  expt_column_annotations?: expt.ExptColumnAnnotation[],
  expt_column_eval_target?: expt.ExptColumnEvalTarget[],
  /** item粒度实验结果详情 */
  item_results?: expt.ItemResult[],
  total?: number,
}
export interface StandardEvalOutputFullContent {
  provider?: string,
  uri?: string,
  url?: string,
  bytes?: number,
  sha256?: string,
}
export interface StandardEvalOutputContent {
  text?: string,
  content_omitted?: boolean,
  full_content?: StandardEvalOutputFullContent,
}
export interface MGetExperimentStandardEvalOutputsRequest {
  workspace_id: string,
  expt_id: string,
  item_ids: string[],
}
export interface ListExperimentStandardEvalOutputsRequest {
  workspace_id: string,
  expt_id: string,
  page_number?: number,
  page_size?: number,
  /**
   * item_id_only 为 true 时走精简查询：items 每项仅填 item_id（不加载轨迹 / evaluator / eval_target
   * 大对象、也不查 dataset_key 等），用于 MQ 回调补齐前先枚举实验下所有 item，省性能。
  */
  item_id_only?: boolean,
}
export interface ItemStandardEvalOutput {
  expt_id?: string,
  item_id?: string,
  dataset_key?: string,
  item_key?: string,
  status?: expt.ItemRunState,
  /** MQ 元信息：与 item-complete(success) MQ 消息体对齐，供回调补齐时携带。 */
  eval_target_workspace_id?: string,
  eval_target_id?: string,
  source_target_id?: string,
  expt_workspace_id?: string,
  expt_run_id?: string,
  dataset_workspace_id?: string,
  dataset_id?: string,
  dataset_version_id?: string,
  dataset_version_name?: string,
  experiment_group_key?: string,
  /** 实验创建时间（秒），来源 experiment.created_at */
  experiment_create_time?: string,
  /** item 执行结束时间（秒），来源 expt_item_result.updated_at */
  item_end_time?: string,
  /** 实验创建人 userID，来源 experiment.created_by（实验级恒定） */
  created_by?: string,
  /** 标准化评测输出内容块：小内容 inline，大内容通过各 section 的 full_content 引用。 */
  detail?: StandardEvalOutputContent,
  rounds?: StandardEvalOutputContent,
  agent?: StandardEvalOutputContent,
  output?: StandardEvalOutputContent,
  eval?: StandardEvalOutputContent,
  extra?: StandardEvalOutputContent,
}
export interface MGetExperimentStandardEvalOutputsResponse {
  items?: ItemStandardEvalOutput[]
}
export interface ListExperimentStandardEvalOutputsResponse {
  items?: ItemStandardEvalOutput[],
  total?: number,
}
export interface BatchGetExperimentAggrResultRequest {
  workspace_id: string,
  experiment_ids: string[],
}
export interface BatchGetExperimentAggrResultResponse {
  expt_aggregate_result?: expt.ExptAggregateResult[]
}
export interface CalculateExperimentAggrResultRequest {
  workspace_id: string,
  expt_id: string,
}
export interface CalculateExperimentAggrResultResponse {}
export interface CheckExperimentNameRequest {
  workspace_id: string,
  name?: string,
}
export interface CheckExperimentNameResponse {
  pass?: boolean,
  message?: string,
}
export interface InvokeExperimentRequest {
  workspace_id: number,
  evaluation_set_id: number,
  items?: eval_set.EvaluationSetItem[],
  /** items 中存在无效数据时，默认不会写入任何数据；设置 skipInvalidItems=true 会跳过无效数据，写入有效数据 */
  skip_invalid_items?: boolean,
  /** 批量写入 items 如果超出数据集容量限制，默认不会写入任何数据；设置 partialAdd=true 会写入不超出容量限制的前 N 条 */
  allow_partial_add?: boolean,
  experiment_id?: number,
  experiment_run_id?: number,
  ext?: {
    [key: string | number]: string
  },
  session?: common.Session,
}
export interface InvokeExperimentResponse {
  /** key: item 在 items 中的索引 */
  added_items?: {
    [key: string | number]: number
  },
  errors?: data_dataset.ItemErrorGroup[],
  item_outputs?: data_dataset.CreateDatasetItemOutput[],
}
export interface FinishExperimentRequest {
  workspace_id?: number,
  experiment_id?: number,
  experiment_run_id?: number,
  cid?: string,
  session?: common.Session,
}
export interface FinishExperimentResponse {}
export interface ListExperimentStatsRequest {
  workspace_id: number,
  page_number?: number,
  page_size?: number,
  filter_option?: expt.ExptFilterOption,
  session?: common.Session,
}
export interface ListExperimentStatsResponse {
  expt_stats_infos?: expt.ExptStatsInfo[],
  total?: number,
}
/**
 * =========================
 * 实验模板相关接口
 * =========================
*/
export interface CreateExperimentTemplateRequest {
  workspace_id: string,
  /** 模板结构，与 ExptTemplate 保持一致 */
  meta?: expt.ExptTemplateMeta,
  triple_config?: expt.ExptTuple,
  field_mapping_config?: expt.ExptFieldMapping,
  /** 创建评估对象参数（不在 ExptTemplate 结构中，保留在顶层） */
  create_eval_target_param?: coze_loop_evaluation_eval_target.CreateEvalTargetParam,
  /** 默认评估器并发数（不在 ExptTemplate 结构中，保留在顶层） */
  default_evaluators_concur_num?: number,
  /** 调度配置（不在 ExptTemplate 结构中，保留在顶层） */
  schedule_cron?: string,
  /** 模板运行态信息（如是否开启定时触发）；创建时可只填 cron_activate */
  expt_info?: expt.ExptInfo,
  enable_extract_trajectory?: boolean,
  expt_source?: expt.ExptSource,
  /** 通知配置 */
  notification_conf?: expt.ExptNotificationConf,
  session?: common.Session,
}
export interface CreateExperimentTemplateResponse {
  experiment_template?: expt.ExptTemplate
}
export interface BatchGetExperimentTemplateRequest {
  workspace_id: string,
  template_ids: string[],
}
export interface BatchGetExperimentTemplateResponse {
  experiment_templates?: expt.ExptTemplate[]
}
export interface UpdateExperimentTemplateMetaRequest {
  workspace_id: string,
  template_id: string,
  meta?: expt.ExptTemplateMeta,
}
export interface UpdateExperimentTemplateMetaResponse {
  meta?: expt.ExptTemplateMeta
}
export interface UpdateExperimentTemplateRequest {
  workspace_id: string,
  template_id: string,
  /**
   * 模板结构，与 ExptTemplate 保持一致
   * 注意：eval_set_id / target_id 不允许修改，仅允许调整版本与配置
  */
  meta?: expt.ExptTemplateMeta,
  triple_config?: expt.ExptTuple,
  field_mapping_config?: expt.ExptFieldMapping,
  /** 创建评估对象参数（不在 ExptTemplate 结构中，保留在顶层） */
  create_eval_target_param?: coze_loop_evaluation_eval_target.CreateEvalTargetParam,
  /** 默认评估器并发数（不在 ExptTemplate 结构中，保留在顶层） */
  default_evaluators_concur_num?: number,
  /** 调度配置（不在 ExptTemplate 结构中，保留在顶层） */
  schedule_cron?: string,
  expt_info?: expt.ExptInfo,
  enable_extract_trajectory?: boolean,
  /** 实验来源（含 Scheduler 等配置）；nil 表示不修改，保留 DB 中已有值 */
  expt_source?: expt.ExptSource,
  /** 通知配置 */
  notification_conf?: expt.ExptNotificationConf,
}
export interface UpdateExperimentTemplateResponse {
  experiment_template?: expt.ExptTemplate
}
export interface DeleteExperimentTemplateRequest {
  workspace_id: string,
  template_id: string,
}
export interface DeleteExperimentTemplateResponse {}
export interface ListExperimentTemplatesRequest {
  workspace_id: string,
  page_number?: number,
  page_size?: number,
  filter_option?: expt.ExperimentTemplateFilter,
  order_bys?: common.OrderBy[],
}
export interface ListExperimentTemplatesResponse {
  experiment_templates?: expt.ExptTemplate[],
  total?: number,
}
export interface CheckExperimentTemplateNameRequest {
  workspace_id: string,
  name: string,
  template_id?: string,
  /**
   * 实验类型；在线/离线模板独立判重，未指定时由后端基于 template_id 推导，
   * 若两者均未提供则跨类型查询以兼容旧调用
  */
  expt_type?: expt.ExptType,
}
export interface CheckExperimentTemplateNameResponse {
  is_available?: boolean
}
/** 根据 workspace_id 与实验模板 ID 提交实验（控制台/会话鉴权，逻辑对齐 SubmitExptFromTemplateOApi） */
export interface SubmitExptFromTemplateRequest {
  workspace_id: string,
  template_id: string,
  name?: string,
  /** 通知配置（可选覆盖模板配置） */
  notification_conf?: expt.ExptNotificationConf,
  session?: common.Session,
}
export interface SubmitExptFromTemplateResponse {
  experiment?: expt.Experiment,
  run_id?: string,
}
export enum UpsertExptTurnResultFilterType {
  /** 标签状态 */
  MANUAL = "manual",
  /** 启用 */
  AUTO = "auto",
  /** 禁用 */
  CHECK = "check",
}
/** 旧版本状态 */
export interface UpsertExptTurnResultFilterRequest {
  workspace_id?: number,
  experiment_id?: number,
  item_ids?: number[],
  filter_type?: UpsertExptTurnResultFilterType,
  retry_times?: number,
}
export interface UpsertExptTurnResultFilterResponse {}
export interface AssociateAnnotationTagReq {
  workspace_id: string,
  expt_id: string,
  tag_key_id?: string,
  session?: common.Session,
}
export interface AssociateAnnotationTagResp {}
export interface DeleteAnnotationTagReq {
  workspace_id: string,
  expt_id: string,
  tag_key_id?: string,
  session?: common.Session,
}
export interface DeleteAnnotationTagResp {}
export interface CreateAnnotateRecordReq {
  workspace_id: string,
  expt_id: string,
  annotate_record: expt.AnnotateRecord,
  item_id: string,
  turn_id: string,
  session?: common.Session,
}
export interface CreateAnnotateRecordResp {
  annotate_record_id: string
}
export interface UpdateAnnotateRecordReq {
  workspace_id: string,
  expt_id: string,
  annotate_records: expt.AnnotateRecord,
  annotate_record_id: string,
  item_id: string,
  turn_id: string,
  session?: common.Session,
}
export interface UpdateAnnotateRecordResp {}
/** 实验报告 CSV 导出列：多个一级分组，组内 list<string>。不传 export_columns：导出全部（含标注列等）。传 export_columns（含空 struct）：白名单模式，仅 item_id、status 等必填列 + 各分组非空 list 中的列；某一 list 未传（unset）与传 [] 对该组均表示不导出。人工标注列需在 tag_key_ids 中显式列出 TagKeyID（十进制字符串）才会在白名单导出中出现。 */
export interface ExptResultExportColumnSpec {
  /** 评测集字段：ColumnEvalSetField.Key */
  eval_set_fields?: string[],
  /** 评测对象输出（非性能指标）：ColumnEvalTarget.Name，如 actual_output、trajectory、自定义输出名 */
  eval_target_outputs?: string[],
  /** 性能指标：ColumnEvalTarget.Name（如 eval_target_total_latency、eval_target_input_tokens 等） */
  metrics?: string[],
  /** 评估器版本 ID 列表（字符串形式十进制）；每个 ID 导出该评估器的 score 与 reason 列 */
  evaluator_version_ids?: string[],
  /** 是否导出加权分数 */
  weighted_score?: boolean,
  /** 人工标注：每项为标注 TagKeyID（十进制字符串），与 ColumnAnnotation.TagKeyID 对应，导出该标注列 */
  tag_key_ids?: string[],
}
export interface ExportExptResultRequest {
  workspace_id: string,
  expt_id: string,
  export_columns?: ExptResultExportColumnSpec,
  export_type?: expt.ExptResultExportType,
  session?: common.Session,
}
export interface ExportExptResultResponse {
  export_id: string
}
export interface ListExptResultExportRecordRequest {
  workspace_id: string,
  expt_id: string,
  page_number?: number,
  page_size?: number,
  session?: common.Session,
}
export interface ListExptResultExportRecordResponse {
  expt_result_export_records: expt.ExptResultExportRecord[],
  total?: number,
}
export interface GetExptResultExportRecordRequest {
  workspace_id: string,
  expt_id: string,
  export_id: string,
  session?: common.Session,
}
export interface GetExptResultExportRecordResponse {
  expt_result_export_records?: expt.ExptResultExportRecord
}
export interface GetExptInsightAnalysisRecordRequest {
  workspace_id: string,
  expt_id: string,
  insight_analysis_record_id: string,
  session?: common.Session,
}
export interface GetExptInsightAnalysisRecordResponse {
  expt_insight_analysis_record?: expt.ExptInsightAnalysisRecord
}
export interface InsightAnalysisExperimentRequest {
  workspace_id: string,
  expt_id: string,
  session?: common.Session,
}
export interface InsightAnalysisExperimentResponse {
  insight_analysis_record_id: string
}
export interface ListExptInsightAnalysisRecordRequest {
  workspace_id: string,
  expt_id: string,
  page_number?: number,
  page_size?: number,
  session?: common.Session,
}
export interface ListExptInsightAnalysisRecordResponse {
  expt_insight_analysis_records: expt.ExptInsightAnalysisRecord[],
  total?: number,
}
export interface DeleteExptInsightAnalysisRecordRequest {
  workspace_id: string,
  expt_id: string,
  insight_analysis_record_id: string,
  session?: common.Session,
}
export interface DeleteExptInsightAnalysisRecordResponse {}
export interface FeedbackExptInsightAnalysisReportRequest {
  workspace_id: string,
  expt_id: string,
  insight_analysis_record_id: string,
  feedback_action_type: expt.FeedbackActionType,
  comment?: string,
  /** 用于更新comment */
  comment_id?: string,
  session?: common.Session,
}
export interface FeedbackExptInsightAnalysisReportResponse {}
export interface ListExptInsightAnalysisCommentRequest {
  workspace_id: string,
  expt_id: string,
  insight_analysis_record_id: string,
  page_number?: number,
  page_size?: number,
  session?: common.Session,
}
export interface ListExptInsightAnalysisCommentResponse {
  expt_insight_analysis_feedback_comments: expt.ExptInsightAnalysisFeedbackComment[],
  total?: number,
}
export interface GetAnalysisRecordFeedbackVoteRequest {
  workspace_id?: string,
  expt_id?: string,
  insight_analysis_record_id?: string,
  session?: common.Session,
}
export interface GetAnalysisRecordFeedbackVoteResponse {
  vote?: expt.ExptInsightAnalysisFeedbackVote
}
/**
 * Prompt optimization based on a completed evaluation experiment.
 * 
 * The optimization result is intentionally stored as a durable task. It does
 * not overwrite or publish the source Prompt. The user must explicitly apply
 * the result to a draft and then use the existing Prompt version submission
 * flow.
*/
export enum PromptOptimizationMode {
  EffectFirst = "effect_first",
  CostEffective = "cost_effective",
}
export enum PromptOptimizationStatus {
  Queued = "queued",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Canceled = "canceled",
}
export enum PromptOptimizationStage {
  Preparing = "preparing",
  Analyzing = "analyzing",
  Optimizing = "optimizing",
  Evaluating = "evaluating",
  Finalizing = "finalizing",
  Completed = "completed",
}
export interface PromptOptimizationSampleRef {
  item_id: string,
  turn_id?: string,
}
export interface PromptOptimizationVariable {
  key: string,
  type?: string,
  type_tags?: string[],
  description?: string,
}
export interface PromptOptimizationModeOption {
  mode: PromptOptimizationMode,
  display_name: string,
  description?: string,
  default_max_iterations?: number,
}
export interface PromptOptimizationMetrics {
  sample_count?: number,
  average_score?: number,
  full_score_count?: number,
  improved_count?: number,
  regressed_count?: number,
  unchanged_count?: number,
  evaluator_average_scores?: {
    [key: string | number]: number
  },
  input_tokens?: string,
  output_tokens?: string,
}
export interface PromptOptimizationSampleEvaluation {
  item_id?: string,
  turn_id?: string,
  variables?: {
    [key: string | number]: string
  },
  reference_answer?: string,
  original_answer?: string,
  optimized_answer?: string,
  original_score?: number,
  optimized_score?: number,
  original_evaluator_scores?: {
    [key: string | number]: number
  },
  optimized_evaluator_scores?: {
    [key: string | number]: number
  },
  original_evaluator_reasons?: {
    [key: string | number]: string
  },
  optimized_evaluator_reasons?: {
    [key: string | number]: string
  },
  error_message?: string,
}
export interface PromptOptimizationIteration {
  iteration?: number,
  candidate_prompt_template?: prompt_prompt.PromptTemplate,
  rationale?: string,
  metrics?: PromptOptimizationMetrics,
  sample_results?: PromptOptimizationSampleEvaluation[],
  created_at?: string,
}
export interface PromptOptimizationTask {
  id?: string,
  workspace_id?: string,
  experiment_id?: string,
  name?: string,
  prompt_id?: string,
  prompt_key?: string,
  source_prompt_version?: string,
  mode?: PromptOptimizationMode,
  status?: PromptOptimizationStatus,
  stage?: PromptOptimizationStage,
  progress?: number,
  baseline_metrics?: PromptOptimizationMetrics,
  best_metrics?: PromptOptimizationMetrics,
  original_prompt_template?: prompt_prompt.PromptTemplate,
  optimized_prompt_template?: prompt_prompt.PromptTemplate,
  iterations?: PromptOptimizationIteration[],
  error_message?: string,
  created_by?: string,
  created_at?: string,
  updated_at?: string,
  started_at?: string,
  ended_at?: string,
  applied_to_draft?: boolean,
  applied_at?: string,
}
export interface PreparePromptOptimizationRequest {
  workspace_id: string,
  expt_id: string,
}
export interface PreparePromptOptimizationResponse {
  eligible?: boolean,
  ineligible_reason?: string,
  experiment_id?: string,
  experiment_name?: string,
  prompt_id?: string,
  prompt_key?: string,
  prompt_name?: string,
  source_prompt_version?: string,
  prompt_variables?: PromptOptimizationVariable[],
  dataset_fields?: string[],
  target_output_fields?: string[],
  evaluators?: evaluator.Evaluator[],
  suggested_variable_mappings?: {
    [key: string | number]: string
  },
  suggested_model_answer_field?: string,
  suggested_reference_answer_field?: string,
  mode_options?: PromptOptimizationModeOption[],
  max_sample_count?: number,
  default_sample_count?: number,
}
export interface CreatePromptOptimizationRequest {
  workspace_id: string,
  expt_id: string,
  samples: PromptOptimizationSampleRef[],
  variable_mappings: {
    [key: string | number]: string
  },
  model_answer_field?: string,
  reference_answer_field?: string,
  mode?: PromptOptimizationMode,
  max_iterations?: number,
  name?: string,
  idempotency_key?: string,
}
export interface CreatePromptOptimizationResponse {
  task?: PromptOptimizationTask
}
export interface GetPromptOptimizationRequest {
  workspace_id: string,
  expt_id: string,
  optimization_id: string,
  with_iterations?: boolean,
  with_sample_results?: boolean,
}
export interface GetPromptOptimizationResponse {
  task?: PromptOptimizationTask
}
export interface ListPromptOptimizationsRequest {
  workspace_id: string,
  expt_id: string,
  page_number?: number,
  page_size?: number,
  statuses?: PromptOptimizationStatus[],
}
export interface ListPromptOptimizationsResponse {
  tasks?: PromptOptimizationTask[],
  total?: string,
}
export interface CancelPromptOptimizationRequest {
  workspace_id: string,
  expt_id: string,
  optimization_id: string,
}
export interface CancelPromptOptimizationResponse {
  task?: PromptOptimizationTask
}
export interface ApplyPromptOptimizationToDraftRequest {
  workspace_id: string,
  expt_id: string,
  optimization_id: string,
  /**
   * Applying replaces the current user's editable draft. Require an explicit
   * acknowledgement when a draft already exists to prevent silent data loss.
  */
  overwrite_existing_draft?: boolean,
}
export interface ApplyPromptOptimizationToDraftResponse {
  prompt_id?: string,
  source_prompt_version?: string,
  draft_base_version?: string,
  next_action?: string,
}
export const CheckExperimentName = /*#__PURE__*/createAPI<CheckExperimentNameRequest, CheckExperimentNameResponse>({
  "url": "/api/evaluation/v1/experiments/check_name",
  "method": "POST",
  "name": "CheckExperimentName",
  "reqType": "CheckExperimentNameRequest",
  "reqMapping": {
    "body": ["workspace_id", "name"]
  },
  "resType": "CheckExperimentNameResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** SubmitExperiment 创建并提交运行 */
export const SubmitExperiment = /*#__PURE__*/createAPI<SubmitExperimentRequest, SubmitExperimentResponse>({
  "url": "/api/evaluation/v1/experiments/submit",
  "method": "POST",
  "name": "SubmitExperiment",
  "reqType": "SubmitExperimentRequest",
  "reqMapping": {
    "body": ["workspace_id", "eval_set_version_id", "target_version_id", "evaluator_version_ids", "name", "desc", "eval_set_id", "target_id", "visibility", "target_field_mapping", "evaluator_field_mapping", "item_concur_num", "evaluators_concur_num", "create_eval_target_param", "target_runtime_param", "expt_type", "max_alive_time", "source_type", "source_id", "evaluator_id_version_list", "enable_weighted_score", "expt_template_id", "item_retry_num", "trial_run_item_count", "enable_extract_trajectory", "trigger_type", "time_range", "thread_id", "item_ids", "eval_set_configs", "eval_set_source_type", "eval_set_shared_option", "target_shared_option", "ext", "ref_group_experiment_id", "notification_conf", "session"],
    "header": ["X-Jwt-Token"]
  },
  "resType": "SubmitExperimentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const BatchGetExperiments = /*#__PURE__*/createAPI<BatchGetExperimentsRequest, BatchGetExperimentsResponse>({
  "url": "/api/evaluation/v1/experiments/batch_get",
  "method": "POST",
  "name": "BatchGetExperiments",
  "reqType": "BatchGetExperimentsRequest",
  "reqMapping": {
    "body": ["workspace_id", "expt_ids"]
  },
  "resType": "BatchGetExperimentsResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const GetExperimentIDsByGroup = /*#__PURE__*/createAPI<GetExperimentIDsByGroupRequest, GetExperimentIDsByGroupResponse>({
  "url": "/api/evaluation/v1/experiments/group_ids/batch_get",
  "method": "POST",
  "name": "GetExperimentIDsByGroup",
  "reqType": "GetExperimentIDsByGroupRequest",
  "reqMapping": {
    "body": ["workspace_id", "experiment_group_key"]
  },
  "resType": "GetExperimentIDsByGroupResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const ListExperiments = /*#__PURE__*/createAPI<ListExperimentsRequest, ListExperimentsResponse>({
  "url": "/api/evaluation/v1/experiments/list",
  "method": "POST",
  "name": "ListExperiments",
  "reqType": "ListExperimentsRequest",
  "reqMapping": {
    "body": ["workspace_id", "page_number", "page_size", "filter_option", "order_bys"]
  },
  "resType": "ListExperimentsResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const UpdateExperiment = /*#__PURE__*/createAPI<UpdateExperimentRequest, UpdateExperimentResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id",
  "method": "PATCH",
  "name": "UpdateExperiment",
  "reqType": "UpdateExperimentRequest",
  "reqMapping": {
    "body": ["workspace_id", "name", "desc", "notification_conf"],
    "path": ["expt_id"]
  },
  "resType": "UpdateExperimentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** UpdateExptRunConf 修改进行中实验的运行配置（并发度 / Item 重试次数） */
export const UpdateExptRunConf = /*#__PURE__*/createAPI<UpdateExptRunConfRequest, UpdateExptRunConfResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/run_conf",
  "method": "PATCH",
  "name": "UpdateExptRunConf",
  "reqType": "UpdateExptRunConfRequest",
  "reqMapping": {
    "body": ["workspace_id", "item_concur_num", "item_retry_num"],
    "path": ["expt_id"]
  },
  "resType": "UpdateExptRunConfResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const DeleteExperiment = /*#__PURE__*/createAPI<DeleteExperimentRequest, DeleteExperimentResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id",
  "method": "DELETE",
  "name": "DeleteExperiment",
  "reqType": "DeleteExperimentRequest",
  "reqMapping": {
    "body": ["workspace_id"],
    "path": ["expt_id"]
  },
  "resType": "DeleteExperimentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const BatchDeleteExperiments = /*#__PURE__*/createAPI<BatchDeleteExperimentsRequest, BatchDeleteExperimentsResponse>({
  "url": "/api/evaluation/v1/experiments/batch_delete",
  "method": "DELETE",
  "name": "BatchDeleteExperiments",
  "reqType": "BatchDeleteExperimentsRequest",
  "reqMapping": {
    "body": ["workspace_id", "expt_ids"]
  },
  "resType": "BatchDeleteExperimentsResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const CloneExperiment = /*#__PURE__*/createAPI<CloneExperimentRequest, CloneExperimentResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/clone",
  "method": "POST",
  "name": "CloneExperiment",
  "reqType": "CloneExperimentRequest",
  "reqMapping": {
    "path": ["expt_id"],
    "body": ["workspace_id"]
  },
  "resType": "CloneExperimentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const RetryExperiment = /*#__PURE__*/createAPI<RetryExperimentRequest, RetryExperimentResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/retry",
  "method": "POST",
  "name": "RetryExperiment",
  "reqType": "RetryExperimentRequest",
  "reqMapping": {
    "body": ["retry_mode", "workspace_id", "item_ids", "ext"],
    "path": ["expt_id"]
  },
  "resType": "RetryExperimentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const KillExperiment = /*#__PURE__*/createAPI<KillExperimentRequest, KillExperimentResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/kill",
  "method": "POST",
  "name": "KillExperiment",
  "reqType": "KillExperimentRequest",
  "reqMapping": {
    "path": ["expt_id"],
    "body": ["workspace_id"]
  },
  "resType": "KillExperimentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** MGetExperimentResult 获取实验结果 */
export const BatchGetExperimentResult = /*#__PURE__*/createAPI<BatchGetExperimentResultRequest, BatchGetExperimentResultResponse>({
  "url": "/api/evaluation/v1/experiments/results/batch_get",
  "method": "POST",
  "name": "BatchGetExperimentResult",
  "reqType": "BatchGetExperimentResultRequest",
  "reqMapping": {
    "query": ["workspace_id", "page_number", "page_size", "use_accelerator", "full_trajectory"],
    "body": ["experiment_ids", "baseline_experiment_id", "filters"]
  },
  "resType": "BatchGetExperimentResultResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** 智能优化：基于已完成的评测实验优化该实验所使用的 Prompt。 */
export const PreparePromptOptimization = /*#__PURE__*/createAPI<PreparePromptOptimizationRequest, PreparePromptOptimizationResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/prompt_optimizations/prepare",
  "method": "GET",
  "name": "PreparePromptOptimization",
  "reqType": "PreparePromptOptimizationRequest",
  "reqMapping": {
    "query": ["workspace_id"],
    "path": ["expt_id"]
  },
  "resType": "PreparePromptOptimizationResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const CreatePromptOptimization = /*#__PURE__*/createAPI<CreatePromptOptimizationRequest, CreatePromptOptimizationResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/prompt_optimizations",
  "method": "POST",
  "name": "CreatePromptOptimization",
  "reqType": "CreatePromptOptimizationRequest",
  "reqMapping": {
    "body": ["workspace_id", "samples", "variable_mappings", "model_answer_field", "reference_answer_field", "mode", "max_iterations", "name", "idempotency_key"],
    "path": ["expt_id"]
  },
  "resType": "CreatePromptOptimizationResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const GetPromptOptimization = /*#__PURE__*/createAPI<GetPromptOptimizationRequest, GetPromptOptimizationResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/prompt_optimizations/:optimization_id",
  "method": "GET",
  "name": "GetPromptOptimization",
  "reqType": "GetPromptOptimizationRequest",
  "reqMapping": {
    "query": ["workspace_id", "with_iterations", "with_sample_results"],
    "path": ["expt_id", "optimization_id"]
  },
  "resType": "GetPromptOptimizationResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const ListPromptOptimizations = /*#__PURE__*/createAPI<ListPromptOptimizationsRequest, ListPromptOptimizationsResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/prompt_optimizations/list",
  "method": "POST",
  "name": "ListPromptOptimizations",
  "reqType": "ListPromptOptimizationsRequest",
  "reqMapping": {
    "body": ["workspace_id", "page_number", "page_size", "statuses"],
    "path": ["expt_id"]
  },
  "resType": "ListPromptOptimizationsResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const CancelPromptOptimization = /*#__PURE__*/createAPI<CancelPromptOptimizationRequest, CancelPromptOptimizationResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/prompt_optimizations/:optimization_id/cancel",
  "method": "POST",
  "name": "CancelPromptOptimization",
  "reqType": "CancelPromptOptimizationRequest",
  "reqMapping": {
    "body": ["workspace_id"],
    "path": ["expt_id", "optimization_id"]
  },
  "resType": "CancelPromptOptimizationResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const ApplyPromptOptimizationToDraft = /*#__PURE__*/createAPI<ApplyPromptOptimizationToDraftRequest, ApplyPromptOptimizationToDraftResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/prompt_optimizations/:optimization_id/apply_to_draft",
  "method": "POST",
  "name": "ApplyPromptOptimizationToDraft",
  "reqType": "ApplyPromptOptimizationToDraftRequest",
  "reqMapping": {
    "body": ["workspace_id", "overwrite_existing_draft"],
    "path": ["expt_id", "optimization_id"]
  },
  "resType": "ApplyPromptOptimizationToDraftResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const CalculateExperimentAggrResult = /*#__PURE__*/createAPI<CalculateExperimentAggrResultRequest, CalculateExperimentAggrResultResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/aggr_results",
  "method": "POST",
  "name": "CalculateExperimentAggrResult",
  "reqType": "CalculateExperimentAggrResultRequest",
  "reqMapping": {
    "body": ["workspace_id"],
    "path": ["expt_id"]
  },
  "resType": "CalculateExperimentAggrResultResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const BatchGetExperimentAggrResult = /*#__PURE__*/createAPI<BatchGetExperimentAggrResultRequest, BatchGetExperimentAggrResultResponse>({
  "url": "/api/evaluation/v1/experiments/aggr_results/batch_get",
  "method": "POST",
  "name": "BatchGetExperimentAggrResult",
  "reqType": "BatchGetExperimentAggrResultRequest",
  "reqMapping": {
    "query": ["workspace_id"],
    "body": ["experiment_ids"]
  },
  "resType": "BatchGetExperimentAggrResultResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** 人工标注 */
export const AssociateAnnotationTag = /*#__PURE__*/createAPI<AssociateAnnotationTagReq, AssociateAnnotationTagResp>({
  "url": "/api/evaluation/v1/experiments/:expt_id/associate_tag",
  "method": "POST",
  "name": "AssociateAnnotationTag",
  "reqType": "AssociateAnnotationTagReq",
  "reqMapping": {
    "body": ["workspace_id", "tag_key_id", "session"],
    "path": ["expt_id"]
  },
  "resType": "AssociateAnnotationTagResp",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const DeleteAnnotationTag = /*#__PURE__*/createAPI<DeleteAnnotationTagReq, DeleteAnnotationTagResp>({
  "url": "/api/evaluation/v1/experiments/:expt_id/delete_tag",
  "method": "DELETE",
  "name": "DeleteAnnotationTag",
  "reqType": "DeleteAnnotationTagReq",
  "reqMapping": {
    "body": ["workspace_id", "tag_key_id", "session"],
    "path": ["expt_id"]
  },
  "resType": "DeleteAnnotationTagResp",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const CreateAnnotateRecord = /*#__PURE__*/createAPI<CreateAnnotateRecordReq, CreateAnnotateRecordResp>({
  "url": "/api/evaluation/v1/experiments/:expt_id/annotate_record/create",
  "method": "POST",
  "name": "CreateAnnotateRecord",
  "reqType": "CreateAnnotateRecordReq",
  "reqMapping": {
    "body": ["workspace_id", "annotate_record", "item_id", "turn_id", "session"],
    "path": ["expt_id"]
  },
  "resType": "CreateAnnotateRecordResp",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const UpdateAnnotateRecord = /*#__PURE__*/createAPI<UpdateAnnotateRecordReq, UpdateAnnotateRecordResp>({
  "url": "/api/evaluation/v1/experiments/:expt_id/annotate_record/update",
  "method": "POST",
  "name": "UpdateAnnotateRecord",
  "reqType": "UpdateAnnotateRecordReq",
  "reqMapping": {
    "body": ["workspace_id", "annotate_records", "annotate_record_id", "item_id", "turn_id", "session"],
    "path": ["expt_id"]
  },
  "resType": "UpdateAnnotateRecordResp",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** 报告下载 */
export const ExportExptResult = /*#__PURE__*/createAPI<ExportExptResultRequest, ExportExptResultResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/results/export",
  "method": "POST",
  "name": "ExportExptResult",
  "reqType": "ExportExptResultRequest",
  "reqMapping": {
    "body": ["workspace_id", "export_columns", "export_type", "session"],
    "path": ["expt_id"]
  },
  "resType": "ExportExptResultResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const ListExptResultExportRecord = /*#__PURE__*/createAPI<ListExptResultExportRecordRequest, ListExptResultExportRecordResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/export_records/list",
  "method": "POST",
  "name": "ListExptResultExportRecord",
  "reqType": "ListExptResultExportRecordRequest",
  "reqMapping": {
    "body": ["workspace_id", "page_number", "page_size", "session"],
    "path": ["expt_id"]
  },
  "resType": "ListExptResultExportRecordResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const GetExptResultExportRecord = /*#__PURE__*/createAPI<GetExptResultExportRecordRequest, GetExptResultExportRecordResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/export_records/:export_id",
  "method": "POST",
  "name": "GetExptResultExportRecord",
  "reqType": "GetExptResultExportRecordRequest",
  "reqMapping": {
    "body": ["workspace_id", "session"],
    "path": ["expt_id", "export_id"]
  },
  "resType": "GetExptResultExportRecordResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** 报告分析 */
export const InsightAnalysisExperiment = /*#__PURE__*/createAPI<InsightAnalysisExperimentRequest, InsightAnalysisExperimentResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/insight_analysis",
  "method": "POST",
  "name": "InsightAnalysisExperiment",
  "reqType": "InsightAnalysisExperimentRequest",
  "reqMapping": {
    "body": ["workspace_id", "session"],
    "path": ["expt_id"]
  },
  "resType": "InsightAnalysisExperimentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const ListExptInsightAnalysisRecord = /*#__PURE__*/createAPI<ListExptInsightAnalysisRecordRequest, ListExptInsightAnalysisRecordResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/insight_analysis_records/list",
  "method": "POST",
  "name": "ListExptInsightAnalysisRecord",
  "reqType": "ListExptInsightAnalysisRecordRequest",
  "reqMapping": {
    "body": ["workspace_id", "page_number", "page_size", "session"],
    "path": ["expt_id"]
  },
  "resType": "ListExptInsightAnalysisRecordResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const DeleteExptInsightAnalysisRecord = /*#__PURE__*/createAPI<DeleteExptInsightAnalysisRecordRequest, DeleteExptInsightAnalysisRecordResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/insight_analysis_records/:insight_analysis_record_id",
  "method": "DELETE",
  "name": "DeleteExptInsightAnalysisRecord",
  "reqType": "DeleteExptInsightAnalysisRecordRequest",
  "reqMapping": {
    "body": ["workspace_id", "session"],
    "path": ["expt_id", "insight_analysis_record_id"]
  },
  "resType": "DeleteExptInsightAnalysisRecordResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const GetExptInsightAnalysisRecord = /*#__PURE__*/createAPI<GetExptInsightAnalysisRecordRequest, GetExptInsightAnalysisRecordResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/insight_analysis_records/:insight_analysis_record_id",
  "method": "POST",
  "name": "GetExptInsightAnalysisRecord",
  "reqType": "GetExptInsightAnalysisRecordRequest",
  "reqMapping": {
    "body": ["workspace_id", "session"],
    "path": ["expt_id", "insight_analysis_record_id"]
  },
  "resType": "GetExptInsightAnalysisRecordResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const FeedbackExptInsightAnalysisReport = /*#__PURE__*/createAPI<FeedbackExptInsightAnalysisReportRequest, FeedbackExptInsightAnalysisReportResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/insight_analysis_records/:insight_analysis_record_id/feedback",
  "method": "POST",
  "name": "FeedbackExptInsightAnalysisReport",
  "reqType": "FeedbackExptInsightAnalysisReportRequest",
  "reqMapping": {
    "body": ["workspace_id", "feedback_action_type", "comment", "comment_id", "session"],
    "path": ["expt_id", "insight_analysis_record_id"]
  },
  "resType": "FeedbackExptInsightAnalysisReportResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const ListExptInsightAnalysisComment = /*#__PURE__*/createAPI<ListExptInsightAnalysisCommentRequest, ListExptInsightAnalysisCommentResponse>({
  "url": "/api/evaluation/v1/experiments/:expt_id/insight_analysis_records/:insight_analysis_record_id/comments/list",
  "method": "POST",
  "name": "ListExptInsightAnalysisComment",
  "reqType": "ListExptInsightAnalysisCommentRequest",
  "reqMapping": {
    "body": ["workspace_id", "page_number", "page_size", "session"],
    "path": ["expt_id", "insight_analysis_record_id"]
  },
  "resType": "ListExptInsightAnalysisCommentResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const GetAnalysisRecordFeedbackVote = /*#__PURE__*/createAPI<GetAnalysisRecordFeedbackVoteRequest, GetAnalysisRecordFeedbackVoteResponse>({
  "url": "/api/evaluation/v1/experiments/insight_analysis_records/:insight_analysis_record_id/feedback_vote",
  "method": "GET",
  "name": "GetAnalysisRecordFeedbackVote",
  "reqType": "GetAnalysisRecordFeedbackVoteRequest",
  "reqMapping": {
    "query": ["workspace_id", "expt_id", "session"],
    "path": ["insight_analysis_record_id"]
  },
  "resType": "GetAnalysisRecordFeedbackVoteResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** 实验模板 */
export const CreateExperimentTemplate = /*#__PURE__*/createAPI<CreateExperimentTemplateRequest, CreateExperimentTemplateResponse>({
  "url": "/api/evaluation/v1/experiment_templates",
  "method": "POST",
  "name": "CreateExperimentTemplate",
  "reqType": "CreateExperimentTemplateRequest",
  "reqMapping": {
    "body": ["workspace_id", "meta", "triple_config", "field_mapping_config", "create_eval_target_param", "default_evaluators_concur_num", "schedule_cron", "expt_info", "enable_extract_trajectory", "expt_source", "notification_conf", "session"]
  },
  "resType": "CreateExperimentTemplateResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const BatchGetExperimentTemplate = /*#__PURE__*/createAPI<BatchGetExperimentTemplateRequest, BatchGetExperimentTemplateResponse>({
  "url": "/api/evaluation/v1/experiment_templates/batch_get",
  "method": "POST",
  "name": "BatchGetExperimentTemplate",
  "reqType": "BatchGetExperimentTemplateRequest",
  "reqMapping": {
    "body": ["workspace_id", "template_ids"]
  },
  "resType": "BatchGetExperimentTemplateResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const UpdateExperimentTemplateMeta = /*#__PURE__*/createAPI<UpdateExperimentTemplateMetaRequest, UpdateExperimentTemplateMetaResponse>({
  "url": "/api/evaluation/v1/experiment_templates/update_meta",
  "method": "POST",
  "name": "UpdateExperimentTemplateMeta",
  "reqType": "UpdateExperimentTemplateMetaRequest",
  "reqMapping": {
    "body": ["workspace_id", "template_id", "meta"]
  },
  "resType": "UpdateExperimentTemplateMetaResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const UpdateExperimentTemplate = /*#__PURE__*/createAPI<UpdateExperimentTemplateRequest, UpdateExperimentTemplateResponse>({
  "url": "/api/evaluation/v1/experiment_templates/:template_id",
  "method": "PATCH",
  "name": "UpdateExperimentTemplate",
  "reqType": "UpdateExperimentTemplateRequest",
  "reqMapping": {
    "body": ["workspace_id", "meta", "triple_config", "field_mapping_config", "create_eval_target_param", "default_evaluators_concur_num", "schedule_cron", "expt_info", "enable_extract_trajectory", "expt_source", "notification_conf"],
    "path": ["template_id"]
  },
  "resType": "UpdateExperimentTemplateResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
/** 更新实验模板（不允许修改关联的评测对象 / 评测集，仅允许修改默认版本、映射、评估器与配置） */
export const DeleteExperimentTemplate = /*#__PURE__*/createAPI<DeleteExperimentTemplateRequest, DeleteExperimentTemplateResponse>({
  "url": "/api/evaluation/v1/experiment_templates/:template_id",
  "method": "DELETE",
  "name": "DeleteExperimentTemplate",
  "reqType": "DeleteExperimentTemplateRequest",
  "reqMapping": {
    "body": ["workspace_id"],
    "path": ["template_id"]
  },
  "resType": "DeleteExperimentTemplateResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const ListExperimentTemplates = /*#__PURE__*/createAPI<ListExperimentTemplatesRequest, ListExperimentTemplatesResponse>({
  "url": "/api/evaluation/v1/experiment_templates/list",
  "method": "POST",
  "name": "ListExperimentTemplates",
  "reqType": "ListExperimentTemplatesRequest",
  "reqMapping": {
    "body": ["workspace_id", "page_number", "page_size", "filter_option", "order_bys"]
  },
  "resType": "ListExperimentTemplatesResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});
export const CheckExperimentTemplateName = /*#__PURE__*/createAPI<CheckExperimentTemplateNameRequest, CheckExperimentTemplateNameResponse>({
  "url": "/api/evaluation/v1/experiment_templates/check_name",
  "method": "POST",
  "name": "CheckExperimentTemplateName",
  "reqType": "CheckExperimentTemplateNameRequest",
  "reqMapping": {
    "body": ["workspace_id", "name", "template_id", "expt_type"]
  },
  "resType": "CheckExperimentTemplateNameResponse",
  "schemaRoot": "api://schemas/evaluation_coze.loop.evaluation.expt",
  "service": "evaluationExpt"
});