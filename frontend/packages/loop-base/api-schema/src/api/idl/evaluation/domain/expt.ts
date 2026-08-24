// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import * as observability_task from './../../observability/domain/task';
export { observability_task };
import * as observability_filter from './../../observability/domain/filter';
export { observability_filter };
import * as data_data_filter from './../../data/domain/data_filter';
export { data_data_filter };
import * as data_dataset from './../../data/domain/dataset';
export { data_dataset };
import * as data_tag from './../../data/domain/tag';
export { data_tag };
import * as eval_set from './eval_set';
export { eval_set };
import * as evaluator from './evaluator';
export { evaluator };
import * as eval_target from './eval_target';
export { eval_target };
import * as common from './common';
export { common };
export enum ExptStatus {
  Unknown = 0,
  /** Awaiting execution */
  Pending = 2,
  /** In progress */
  Processing = 3,
  /** Execution succeeded */
  Success = 11,
  /** Execution failed */
  Failed = 12,
  /** User terminated */
  Terminated = 13,
  /** System terminated */
  SystemTerminated = 14,
  /** Terminating */
  Terminating = 15,
  /** online expt draining */
  Draining = 21,
}
export enum ExptType {
  Offline = 1,
  Online = 2,
}
/** 离线实验分析状态（与表字段 offline_expt_analysis_status 一致） */
export enum OfflineExptAnalysisStatus {
  /** 未开始 */
  NotStarted = 0,
  /** 进行中 */
  Processing = 1,
  /** 成功 */
  Success = 2,
  /** 失败 */
  Failed = 3,
  /** 已被新版本/新分析取代 */
  Superseded = 4,
}
export enum SourceType {
  Evaluation = 1,
  AutoTask = 2,
  Workflow = 3,
  /** 智能生成 */
  IntelligentGen = 4,
}
export enum Visibility {
  Hidden = "hidden",
}
export enum ExptTriggerType {
  Manual = "manual",
  OpenAPI = "openapi",
  Schedule = "schedule",
}
export interface Experiment {
  id?: string,
  name?: string,
  desc?: string,
  creator_by?: string,
  status?: ExptStatus,
  status_message?: string,
  start_time?: string,
  end_time?: string,
  item_concur_num?: number,
  /** 实验可见性，默认为空，可见 */
  visibility?: Visibility,
  /** 实验创建时间（秒），来源 experiment.created_at */
  create_time?: string,
  eval_set_version_id?: string,
  target_version_id?: string,
  evaluator_version_ids?: string[],
  eval_set?: eval_set.EvaluationSet,
  eval_target?: eval_target.EvalTarget,
  evaluators?: evaluator.Evaluator[],
  eval_set_id?: string,
  target_id?: string,
  base_info?: common.BaseInfo,
  expt_stats?: ExptStatistics,
  target_field_mapping?: TargetFieldMapping,
  evaluator_field_mapping?: EvaluatorFieldMapping[],
  target_runtime_param?: common.RuntimeParam,
  expt_type?: ExptType,
  max_alive_time?: number,
  source_type?: SourceType,
  source_id?: string,
  item_retry_num?: number,
  /** 补充的评估器id+version关联评估器方式，和evaluator_version_ids共同使用，兼容老逻辑 */
  evaluator_id_version_list?: evaluator.EvaluatorIDVersionItem[],
  expt_template_meta?: ExptTemplateMeta,
  /** 评估器得分加权配置 */
  score_weight_config?: ExptScoreWeight,
  enable_weighted_score?: boolean,
  /**
   * 智能评测相关
   * 关联的智能评测会话ID
  */
  thread_id?: string,
  enable_extract_trajectory?: boolean,
  /** 触发方式 */
  trigger_type?: ExptTriggerType,
  expt_source?: ExptSource,
  /** 实验分组 key；不填时后端默认为实验 id */
  experiment_group_key?: string,
  /** 通知配置 */
  notification_conf?: ExptNotificationConf,
  ext?: {
    [key: string | number]: string
  },
  /** 离线实验分析状态 */
  offline_expt_analysis_status?: OfflineExptAnalysisStatus,
  /**
   * ★ 新增段位 110~119: 多评测集读视图
   * 读接口分流开关: SingleSet=1(老实验) / MultiSetConfig=2(新实验); 直读 experiment 表同名列
  */
  eval_set_source_type?: ExptEvalSetSourceType,
  /** 权威配置回显: 从 experiment.eval_conf 反序列化, 与 Create 入参同构 */
  eval_set_configs?: EvalSetConfig[],
  /** enrichment: per-set 评测集详情 + item 数 (Get 全填; List 只填 id/count) */
  eval_set_details?: ExptEvalSetDetail[],
  /** 补齐回显缺口: DTO 平铺调度字段独缺此项 */
  evaluators_concur_num?: number,
  /** 实验绑定 item 总数; 首跑前可能缺省 */
  total_item_count?: string,
}
/** 实验模板基础信息 */
export interface ExptTemplateMeta {
  id?: string,
  workspace_id?: string,
  name?: string,
  desc?: string,
  /** 模板对应的实验类型，当前主要为 Offline */
  expt_type?: ExptType,
  /** 实验模板可见性，默认为空，可见 */
  visibility?: Visibility,
}
/** 实验三元组配置 */
export interface ExptTuple {
  eval_set_id?: string,
  eval_set_version_id?: string,
  target_id?: string,
  target_version_id?: string,
  evaluator_id_version_items?: evaluator.EvaluatorIDVersionItem[],
  eval_set?: eval_set.EvaluationSet,
  eval_target?: eval_target.EvalTarget,
  evaluators?: evaluator.Evaluator[],
}
/** 实验字段映射和运行时参数配置 */
export interface ExptFieldMapping {
  target_field_mapping?: TargetFieldMapping,
  evaluator_field_mapping?: EvaluatorFieldMapping[],
  target_runtime_param?: common.RuntimeParam,
  item_concur_num?: number,
  item_retry_num?: number,
}
/** 实验评估器得分加权配置 */
export interface ExptScoreWeight {
  enable_weighted_score?: boolean,
  evaluator_score_weights?: {
    [key: string | number]: number
  },
}
export interface ExptTemplate {
  meta?: ExptTemplateMeta,
  triple_config?: ExptTuple,
  field_mapping_config?: ExptFieldMapping,
  score_weight_config?: ExptScoreWeight,
  expt_info?: ExptInfo,
  expt_source?: ExptSource,
  enable_extract_trajectory?: boolean,
  /** 通知配置 */
  notification_conf?: ExptNotificationConf,
  base_info?: common.BaseInfo,
}
export interface TaskTimeRange {
  /** 生效开始时间（时间戳，毫秒） */
  start_time?: string,
  /** 生效结束时间（时间戳，毫秒） */
  end_time?: string,
}
export interface ExptSource {
  source_type?: SourceType,
  source_id?: string,
  /** 不同source里的源数据结构 */
  span_filter_fields?: observability_filter.SpanFilterFields,
  scheduler?: Scheduler,
  /** 采样配置，与 pipeline 节点 task.rule.sampler（见 pipeline.json）及 task.Sampler 对齐 */
  sampler?: observability_task.Sampler,
  time_range?: TaskTimeRange,
}
export enum Frequency {
  FrequencyEveryday = "every_day",
  FrequencyMonday = "monday",
  FrequencyTuesday = "tuesday",
  FrequencyWednesday = "wednesday",
  FrequencyThursday = "thursday",
  FrequencyFriday = "friday",
  FrequencySaturday = "saturday",
  FrequencySunday = "sunday",
  FrequencyEveryHour = "every_hour",
  FrequencyEveryMinute = "every_minute",
}
export interface Scheduler {
  /** 定时触发器开关，默认关闭 */
  enabled?: boolean,
  /** 触发频次 */
  frequency?: Frequency,
  /** 触发时间（时间戳，秒。只使用时间，不使用日期） */
  trigger_at?: string,
  /** 生效开始时间（时间戳，秒） */
  start_time?: string,
  /** 生效结束时间（时间戳，秒） */
  end_time?: string,
  /** 触发间隔（every_minute时为分钟数，every_hour时为小时数） */
  trigger_interval?: number,
}
export interface ExptInfo {
  created_expt_count?: number,
  latest_expt_id?: string,
  latest_expt_status?: ExptStatus,
  /** 最新实验开始时间（时间戳，毫秒） */
  latest_expt_start_time?: string,
  /** 是否开启定时触发 */
  cron_activate?: boolean,
}
export interface TokenUsage {
  input_tokens?: string,
  output_tokens?: string,
}
export interface ExptStatistics {
  evaluator_aggregate_results?: EvaluatorAggregateResult[],
  token_usage?: TokenUsage,
  credit_cost?: number,
  pending_turn_cnt?: number,
  success_turn_cnt?: number,
  fail_turn_cnt?: number,
  terminated_turn_cnt?: number,
  processing_turn_cnt?: number,
}
export interface EvaluatorFmtResult {
  name?: string,
  score?: number,
}
export const PromptUserQueryFieldKey = "builtin_prompt_user_query";
export interface TargetFieldMapping {
  from_eval_set?: FieldMapping[]
}
export interface EvaluatorFieldMapping {
  evaluator_version_id: string,
  from_eval_set?: FieldMapping[],
  from_target?: FieldMapping[],
  evaluator_id_version_item?: evaluator.EvaluatorIDVersionItem,
}
export interface FieldMapping {
  field_name?: string,
  const_value?: string,
  from_field_name?: string,
}
/**
 * ===============================
 * 通知配置相关结构定义
 * ===============================
 * 通知配置（公共触发条件 + 各渠道独立开关/参数）
*/
export interface ExptNotificationConf {
  /** 公共触发条件（统一，前端只需配一份 filter） */
  filter?: Filters,
  /** Webhook 渠道配置 */
  webhook?: WebhookNotificationConf,
  /** 飞书渠道配置 */
  feishu_notification?: FeishuNotificationConf,
}
export enum WebhookEnvironment {
  /** 默认，不加任何路由 header */
  Prod = 1,
  PPE = 2,
  BOE = 3,
}
export interface WebhookNotificationConf {
  enable: boolean,
  /** Webhook URL 列表，多个用逗号分隔 */
  urls?: string,
  /** 缺省 => Prod（向后兼容） */
  environment?: WebhookEnvironment,
  /** ppe/boe 泳道名；prod 时忽略 */
  lane?: string,
}
export interface FeishuNotificationConf {
  enable: boolean,
  /** 通知目标用户 ID（为空时默认用实验创建者） */
  user_id?: string,
}
export interface ExptFilterOption {
  fuzzy_name?: string,
  /**
   * 评测集来源模式筛选: 不传 = 默认仅返回 SingleSet(老实验), 排除 MultiSetConfig(新实验);
   * 显式传 (含 MultiSetConfig) 才返回新实验。与 fuzzy_name 同级, 不走 filters。
  */
  eval_set_source_types?: ExptEvalSetSourceType[],
  filters?: Filters,
}
export enum ExptRetryMode {
  Unknown = 0,
  RetryAll = 1,
  RetryFailure = 2,
  RetryTargetItems = 3,
}
export enum ItemRunState {
  Unknown = -1,
  /** Queuing */
  Queueing = 0,
  /** Processing */
  Processing = 1,
  /** Success */
  Success = 2,
  /** Failure */
  Fail = 3,
  /** Terminated */
  Terminal = 5,
}
export enum TurnRunState {
  /** Not started */
  Queueing = 0,
  /** Execution succeeded */
  Success = 1,
  /** Execution failed */
  Fail = 2,
  /** In progress */
  Processing = 3,
  /** Terminated */
  Terminal = 4,
}
export interface ItemSystemInfo {
  run_state?: ItemRunState,
  log_id?: string,
  error?: RunError,
}
export interface ExptColumnEvaluator {
  experiment_id: string,
  column_evaluators?: ColumnEvaluator[],
}
export interface ColumnEvaluator {
  evaluator_version_id: string,
  evaluator_id: string,
  evaluator_type: evaluator.EvaluatorType,
  name?: string,
  version?: string,
  description?: string,
  builtin?: boolean,
}
export interface ExptColumnEvalTarget {
  experiment_id?: string,
  column_eval_targets?: ColumnEvalTarget[],
}
export const ColumnEvalTargetName_ActualOutput = "actual_output";
export const ColumnEvalTargetName_Trajectory = "trajectory";
export const ColumnEvalTargetName_EvalTargetTotalLatency = "eval_target_total_latency";
export const ColumnEvalTargetName_EvaluatorInputTokens = "eval_target_input_tokens";
export const ColumnEvalTargetName_EvaluatorOutputTokens = "eval_target_output_tokens";
export const ColumnEvalTargetName_EvaluatorTotalTokens = "eval_target_total_tokens";
export interface ColumnEvalTarget {
  name?: string,
  description?: string,
  label?: string,
  content_type?: common.ContentType,
  text_schema?: string,
  schema_key?: data_dataset.SchemaKey,
}
export interface ColumnEvalSetField {
  key?: string,
  name?: string,
  description?: string,
  content_type?: common.ContentType,
  /** 5: optional datasetv3.FieldDisplayFormat DefaultDisplayFormat */
  text_schema?: string,
  schema_key?: data_dataset.SchemaKey,
}
export interface ItemResult {
  item_id: string,
  /** row粒度实验结果详情 */
  turn_results?: TurnResult[],
  system_info?: ItemSystemInfo,
  item_index?: string,
  ext?: {
    [key: string | number]: string
  },
}
/** 行级结果 可能包含多个实验 */
export interface TurnResult {
  turn_id: string,
  /** 参与对比的实验序列，对于单报告序列长度为1 */
  experiment_results?: ExperimentResult[],
  turn_index?: string,
}
export interface ExperimentResult {
  experiment_id: string,
  payload?: ExperimentTurnPayload,
}
export interface TurnSystemInfo {
  turn_run_state?: TurnRunState,
  log_id?: string,
  error?: RunError,
}
export interface RunError {
  code: string,
  message?: string,
  detail?: string,
}
export interface TurnEvalSet {
  turn: eval_set.Turn
}
export interface TurnTargetOutput {
  eval_target_record?: eval_target.EvalTargetRecord
}
export interface TurnEvaluatorOutput {
  evaluator_records: {
    [key: string | number]: evaluator.EvaluatorRecord
  },
  /** 加权汇总得分 */
  weighted_score?: number,
}
export interface TurnAnnotateResult {
  /** tag_key_id -> annotate_record */
  annotate_records: {
    [key: string | number]: AnnotateRecord
  }
}
export interface AnnotateRecord {
  annotate_record_id?: string,
  /** 标签ID */
  tag_key_id?: string,
  score?: string,
  boolean_option?: string,
  categorical_option?: string,
  plain_text?: string,
  tag_content_type?: data_tag.TagContentType,
  /** 标签选项值ID */
  tag_value_id?: string,
}
/** 实际行级payload */
export interface ExperimentTurnPayload {
  turn_id: string,
  /** 评测数据集数据 */
  eval_set?: TurnEvalSet,
  /** 评测对象结果 */
  target_output?: TurnTargetOutput,
  /** 评测规则执行结果 */
  evaluator_output?: TurnEvaluatorOutput,
  /** 评测系统相关数据日志、error */
  system_info?: TurnSystemInfo,
  /** 人工标注结果结果 */
  annotate_result?: TurnAnnotateResult,
  /** 轨迹分析结果 */
  trajectory_analysis_result?: TrajectoryAnalysisResult,
}
export interface TrajectoryAnalysisResult {
  record_id?: string,
  Status?: InsightAnalysisStatus,
}
export interface KeywordSearch {
  keyword?: string,
  filter_fields?: FilterField[],
}
export interface ExperimentFilter {
  filters?: Filters,
  keyword_search?: KeywordSearch,
}
/** 实验模板筛选器，字段设计复用实验的 Filters / KeywordSearch 能力 */
export interface ExperimentTemplateFilter {
  filters?: Filters,
  keyword_search?: KeywordSearch,
}
export interface Filters {
  filter_conditions?: FilterCondition[],
  logic_op?: FilterLogicOp,
}
export enum FilterLogicOp {
  Unknown = 0,
  And = 1,
  Or = 2,
}
export interface FilterField {
  field_type: FieldType,
  /** 二级key放此字段里 */
  field_key?: string,
}
export enum FieldType {
  Unknown = 0,
  /** 评估器得分, FieldKey为evaluatorVersionID,value为score */
  EvaluatorScore = 1,
  CreatorBy = 2,
  ExptStatus = 3,
  TurnRunState = 4,
  TargetID = 5,
  EvalSetID = 6,
  EvaluatorID = 7,
  TargetType = 8,
  SourceTarget = 9,
  EvaluatorVersionID = 20,
  TargetVersionID = 21,
  EvalSetVersionID = 22,
  ExptType = 30,
  SourceType = 31,
  SourceID = 32,
  KeywordSearch = 41,
  /** 使用二级key，column_key */
  EvalSetColumn = 42,
  /** 使用二级key, Annotation_key（具体参考人工标注设计） */
  Annotation = 43,
  /** 使用二级key，目前使用固定key：content */
  ActualOutput = 44,
  EvaluatorScoreCorrected = 45,
  /** 使用二级key，evaluator_version_id */
  Evaluator = 46,
  ItemID = 47,
  ItemRunState = 48,
  /** 使用二级key, field_key为tag_key_id, value为score */
  AnnotationScore = 49,
  /** 使用二级key, field_key为tag_key_id, value为文本 */
  AnnotationText = 50,
  /** 使用二级key, field_key为tag_key_id, value为tag_value_id */
  AnnotationCategorical = 51,
  /** 目前使用固定key：total_latency */
  TotalLatency = 60,
  /** 目前使用固定key：input_tokens */
  InputTokens = 61,
  /** 目前使用固定key：output_tokens */
  OutputTokens = 62,
  /** 目前使用固定key：total_tokens */
  TotalTokens = 63,
  ExperimentTemplateID = 70,
  EvaluatorWeightedScore = 71,
  UpdatedBy = 72,
  CronActivate = 73,
  TriggerType = 74,
}
/** 字段过滤器 */
export interface FilterCondition {
  /** 过滤字段，比如评估器ID */
  field: FilterField,
  /** 操作符，比如等于、包含、大于、小于等 */
  operator: FilterOperatorType,
  /** 操作值;支持多种类型的操作值； */
  value: string,
  source_target?: SourceTarget,
}
export interface SourceTarget {
  eval_target_type?: eval_target.EvalTargetType,
  source_target_ids?: string[],
}
export enum FilterOperatorType {
  Unknown = 0,
  /** 等于 */
  Equal = 1,
  /** 不等于 */
  NotEqual = 2,
  /** 大于 */
  Greater = 3,
  /** 大于等于 */
  GreaterOrEqual = 4,
  /** 小于 */
  Less = 5,
  /** 小于等于 */
  LessOrEqual = 6,
  /** 包含 */
  In = 7,
  /** 不包含 */
  NotIn = 8,
  /** 全文搜索 */
  Like = 9,
  /** 全文搜索反选 */
  NotLike = 10,
  /** 为空 */
  IsNull = 11,
  /** 非空 */
  IsNotNull = 12,
}
export enum ExptAggregateCalculateStatus {
  Unknown = 0,
  Idle = 1,
  Calculating = 2,
}
/** 实验粒度聚合结果 */
export interface ExptAggregateResult {
  experiment_id: string,
  evaluator_results?: {
    [key: string | number]: EvaluatorAggregateResult
  },
  status?: ExptAggregateCalculateStatus,
  /** tag_key_id -> result */
  annotation_results?: {
    [key: string | number]: AnnotationAggregateResult
  },
  eval_target_aggr_result?: EvalTargetAggregateResult,
  /** timestamp in seconds */
  update_time?: number,
  weighted_results?: AggregatorResult[],
}
export interface EvalTargetAggregateResult {
  target_id?: string,
  target_version_id?: string,
  latency?: AggregatorResult[],
  input_tokens?: AggregatorResult[],
  output_tokens?: AggregatorResult[],
  total_tokens?: AggregatorResult[],
}
/** 评估器版本粒度聚合结果 */
export interface EvaluatorAggregateResult {
  evaluator_version_id: string,
  aggregator_results?: AggregatorResult[],
  name?: string,
  version?: string,
  /**
   * alias 多实例别名 (default/judge_b 等); 同 version 多实例时区分, 老数据为空串。
   * 注意: evaluator_results 为 map<i64> 时同 version 多 alias 会撞 key 只保留一个, 要拿全部 alias 走 list 出口。
  */
  alias?: string,
}
/** 人工标注项粒度聚合结果 */
export interface AnnotationAggregateResult {
  tag_key_id: string,
  aggregator_results?: AggregatorResult[],
  name?: string,
}
/** 一种聚合器类型的聚合结果 */
export interface AggregatorResult {
  aggregator_type: AggregatorType,
  data?: AggregateData,
}
/** 聚合器类型 */
export enum AggregatorType {
  Average = 1,
  Sum = 2,
  Max = 3,
  Min = 4,
  /** 得分的分布情况 */
  Distribution = 5,
}
export enum DataType {
  /** 默认，有小数的浮点数值类型 */
  Double = 0,
  /** 得分分布 */
  ScoreDistribution = 1,
  /** 选项分布 */
  OptionDistribution = 2,
}
export interface ScoreDistribution {
  score_distribution_items?: ScoreDistributionItem[]
}
export interface ScoreDistributionItem {
  score: string,
  count: string,
  percentage: number,
}
export interface AggregateData {
  data_type: DataType,
  value?: number,
  score_distribution?: ScoreDistribution,
  option_distribution?: OptionDistribution,
}
export interface OptionDistribution {
  option_distribution_items?: OptionDistributionItem[]
}
export interface OptionDistributionItem {
  /** 值为tag_value_id,或`其他` */
  option: string,
  count: string,
  percentage: number,
}
export interface ExptStatsInfo {
  expt_id?: number,
  source_id?: string,
  expt_stats?: ExptStatistics,
}
export interface ExptColumnAnnotation {
  experiment_id: string,
  column_annotations?: ColumnAnnotation[],
}
/** 标签信息，沿用数据基座Tag定义 */
export interface ColumnAnnotation {
  tag_key_id?: string,
  /** tag key name */
  tag_key_name?: string,
  /** 描述 */
  description?: string,
  status?: data_tag.TagStatus,
  /** 标签选项值 */
  tag_values?: data_tag.TagValue[],
  /** 标签内容类型 */
  content_type?: data_tag.TagContentType,
  /** 标签内容限制 */
  content_spec?: data_tag.TagContentSpec,
}
export enum ExptResultExportType {
  CSV = "CSV",
}
export enum CSVExportStatus {
  Unknown = "Unknown",
  Running = "Running",
  Success = "Success",
  Failed = "Failed",
}
export interface ExptResultExportRecord {
  export_id: string,
  workspace_id: string,
  expt_id: string,
  csv_export_status: CSVExportStatus,
  base_info?: common.BaseInfo,
  start_time?: string,
  end_time?: string,
  /** deprecated, cause not match snake name */
  URL?: string,
  expired?: boolean,
  error?: RunError,
  url?: string,
}
/** 分析任务状态 */
export enum InsightAnalysisStatus {
  Unknown = "Unknown",
  Running = "Running",
  Success = "Success",
  Failed = "Failed",
}
/** 投票类型 */
export enum InsightAnalysisReportVoteType {
  /** 未投票 */
  None = "None",
  /** 点赞 */
  Upvote = "Upvote",
  /** 点踩 */
  Downvote = "Downvote",
}
/** 洞察分析记录 */
export interface ExptInsightAnalysisRecord {
  record_id: string,
  workspace_id: string,
  expt_id: string,
  analysis_status: InsightAnalysisStatus,
  analysis_report_id?: string,
  analysis_report_content?: string,
  expt_insight_analysis_feedback?: ExptInsightAnalysisFeedback,
  base_info?: common.BaseInfo,
  analysis_report_index?: ExptInsightAnalysisIndex[],
}
export interface ExptInsightAnalysisIndex {
  id?: string,
  title?: string,
}
/** 洞察分析反馈统计 */
export interface ExptInsightAnalysisFeedback {
  upvote_cnt?: number,
  downvote_cnt?: number,
  /** 当前用户点赞状态，用于展示用户是否已点赞点踩 */
  current_user_vote_type?: InsightAnalysisReportVoteType,
}
/** 洞察分析反馈评论 */
export interface ExptInsightAnalysisFeedbackComment {
  comment_id: string,
  workspace_id: string,
  expt_id: string,
  record_id: string,
  content: string,
  base_info?: common.BaseInfo,
}
export interface ExptInsightAnalysisFeedbackVote {
  comment_id?: string,
  feedback_action_type?: FeedbackActionType,
}
/** 反馈动作 */
export enum FeedbackActionType {
  Upvote = "Upvote",
  Cancel_Upvote = "Cancel_Upvote",
  Downvote = "Downvote",
  Cancel_Downvote = "Cancel_Downvote",
  Create_Comment = "Create_Comment",
  Update_Comment = "Update_Comment",
  Delete_Comment = "Delete_Comment",
}
/**
 * =====================================================================================
 * ★ item-centric 实验改版新增定义 (2026-06)
 * =====================================================================================
 * 实验评测集来源模式: 读接口和创建接口的分流依据
*/
export enum ExptEvalSetSourceType {
  /** 老实验: 单评测集, 配置在平铺老字段 */
  SingleSet = 1,
  /** 新实验: 多评测集+配置, 权威源 eval_conf.eval_set_configs */
  MultiSetConfig = 2,
}
/**
 * 说明: item 圈选 / evaluator 行级过滤复用 data/domain/data_filter.thrift 的 Filter/FilterField
 * (别名 data_filter, 与 observability filter 区分以便 BAM/thriftgo 无歧义解析)
 * 用法: 全集 = 不传; 点选 = item_id in [...]; 条件圈选 = tag 条件
 * 校验白名单(应用层): query_type ∈ {eq,not_eq,in,not_in}; 单层不嵌套(sub_filter 必空); field_name ∈ {item_id, tag key}; field_type ∈ {long, tag}
 * per-set target 运行配置; 本期 len<=1, alias 恒空 (多 target 实例预留口子)
*/
export interface ExptTargetConf {
  target_id?: string,
  target_version_id?: string,
  target_type?: eval_target.EvalTargetType,
  /** 本评测集字段 → target 输入 */
  field_mapping?: TargetFieldMapping,
  runtime_param?: common.RuntimeParam,
  /** 多实例标识, 本期恒空串 */
  alias?: string,
  ext?: {
    [key: string | number]: string
  },
}
/** per-set 的一个 evaluator binding */
export interface ExptEvaluatorConf {
  evaluator_id: string,
  evaluator_version_id: string,
  evaluator_type?: evaluator.EvaluatorType,
  /** 多实例区分(judge_A/judge_B); 缺省 '' 默认实例 */
  alias?: string,
  /** 评测集字段 → evaluator 输入 */
  from_eval_set?: FieldMapping[],
  /** target 输出 → evaluator 输入 */
  from_target?: FieldMapping[],
  /** 行级过滤: 命中才执行本 binding (复用 data data_filter.Filter) */
  filter?: data_data_filter.Filter,
  /** 0 None / 1 Include / 2 Exclude */
  filter_mode?: number,
  /** alias 多实例核心动机: 同 version 不同参数 */
  runtime_param?: common.RuntimeParam,
  /** enable_weighted_score 开启时参与加权 */
  score_weight?: number,
  ext?: {
    [key: string | number]: string
  },
}
/** 一个评测集 + 该集的完整配置包 */
export interface EvalSetConfig {
  eval_set_id: string,
  /** 版本锁定, 不允许滚动 latest */
  eval_set_version_id: string,
  /** 不传=全集; 点选=item_id in [...]; 条件圈选=tag 条件 (复用 data data_filter.Filter) */
  item_filter?: data_data_filter.Filter,
  /** 本期 len<=1; 不传=继承 request 顶层 target */
  target_confs?: ExptTargetConf[],
  /** (evaluator_version_id, alias) 在 set 内唯一 */
  evaluator_confs?: ExptEvaluatorConf[],
  /** 跨空间: 该 set 评测集来源空间; nil/!is_shared=同空间 */
  shared_option?: common.SharedResourceOption,
  /** 跨空间: 该 set 评测对象来源空间 */
  target_shared_option?: common.SharedResourceOption,
  ext?: {
    [key: string | number]: string
  },
}
/** per-set 运行期增量信息 (纯读模型, 不进 Create 入参) */
export interface ExptEvalSetDetail {
  eval_set_id?: string,
  eval_set_version_id?: string,
  /** 主集(封面), 与 experiment.eval_set_id 列一致 */
  is_primary?: boolean,
  /** 该 set 选入实验的 item 数; 来源 expt_item_ref, 首跑前不填 */
  item_count?: number,
  /** Get 填充详情; List 不填 */
  eval_set?: eval_set.EvaluationSet,
  /** 评测集业务唯一键; 便于 GetExperiment 直接展示/定位 */
  dataset_key?: string,
}
