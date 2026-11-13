// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable max-lines */
import { useEffect, useMemo, useRef, useState } from 'react';
import './smart-optimization-modal.css';

import { PromptEditor } from '@cozeloop/prompt-components-v2';
import { I18n } from '@cozeloop/i18n-adapter';
import {
  EqualItem,
  ExperimentsSelect,
  PromptEvalTargetVersionSelect,
  ReadonlyItem,
} from '@cozeloop/evaluate-components';
import {
  InfoTooltip,
  OpenDetailButton,
  CollapseCard,
} from '@cozeloop/components';
import {
  useOpenWindow,
  useResourcePageJump,
  useNavigateModule,
  useSpace,
  useModelList,
} from '@cozeloop/biz-hooks-adapter';
import { type Prompt, Role, TemplateType } from '@cozeloop/api-schema/prompt';
import {
  EvalTargetType,
  FieldType,
  FilterLogicOp,
  FilterOperatorType,
  type EstimatePromptOptimizeTaskRequest,
  type Experiment,
  type Filters,
  type OptimizeTaskParams,
} from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi, StonePromptApi } from '@cozeloop/api-schema';
import {
  IconCozInfoCircle,
  IconCozLightbulb,
} from '@coze-arch/coze-design/icons';
import {
  Button,
  Form,
  type FormApi,
  Modal,
  Select,
  Tag,
  Toast,
  Tooltip,
  Typography,
  withField,
} from '@coze-arch/coze-design';

import { type ExperimentItem } from '@/types/experiment';
import ExperimentTable from '@/pages/experiment/detail/components/experiment-detail-table';

const FormExperimentsSelect = withField(ExperimentsSelect);
const FormPromptVersionSelect = withField(PromptEvalTargetVersionSelect);

interface FormValues {
  expt?: { value?: string; label?: string; detail?: Experiment };
  promptVersion?: string;
}

type Step = 'form' | 'table' | 'prompt_detail' | 'resource_confirm';

interface EstimateConfirmation {
  /** 本次预估使用的请求快照，创建任务时必须原样复用 */
  requestSnapshot: EstimatePromptOptimizeTaskRequest;
  minUsage: string;
  maxUsage: string;
  sampleCount: number;
}

/** 请求层抛出的通用错误码，无用户可读信息 */
const GENERIC_ERROR_MESSAGES = new Set([
  'NetworkError',
  'TimeoutError',
  'InternalServerError',
  'BadGateway',
  'RateLimitError',
  'Invalid JSON error',
  'AuthenticationError',
  'Unknown error',
]);

function resolveErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  return message && !GENERIC_ERROR_MESSAGES.has(message) ? message : fallback;
}

/** 预估结果为非负整数字符串，且下限不大于上限 */
function isValidResourceRange(min?: string, max?: string) {
  if (!min || !max) {
    return false;
  }
  if (!/^\d+$/.test(min) || !/^\d+$/.test(max)) {
    return false;
  }
  return Number(min) <= Number(max);
}

/** 新建智能优化 Dialog */
// eslint-disable-next-line @coze-arch/max-line-per-function -- 弹窗表单字段较多，函数体较长
export default function SmartOptimizationModal({
  baseExperiment,
  visible,
  onOk,
  onClose,
}: {
  baseExperiment?: Experiment;
  visible?: boolean;
  onOk?: (params: {
    exptId?: string;
    promptId?: string;
    promptVersion?: string;
  }) => void;
  onClose?: () => void;
}) {
  const { spaceID } = useSpace();
  const { getPromptDetailURL } = useResourcePageJump();
  const { getURL } = useOpenWindow();
  const navigate = useNavigateModule();
  const formRef = useRef<FormApi<FormValues>>();
  const modelListService = useModelList(spaceID);

  const [selectedExperiment, setSelectedExperiment] = useState<
    Experiment | undefined
  >(baseExperiment);
  const [step, setStep] = useState<Step>('form');
  const [tableRefreshKey, setTableRefreshKey] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [promptDetail, setPromptDetail] = useState<Prompt | undefined>();
  const [promptDetailLoading, setPromptDetailLoading] = useState(false);
  const [optimizeMode] = useState(50);
  const [referenceAnswerField, setReferenceAnswerField] =
    useState('reference_output');
  const [selectedRows, setSelectedRows] = useState<ExperimentItem[]>([]);
  const [createTaskLoading, setCreateTaskLoading] = useState(false);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const [createTaskError, setCreateTaskError] = useState('');
  const [estimateConfirmation, setEstimateConfirmation] =
    useState<EstimateConfirmation>();
  // 预估请求序号，用于忽略关闭弹窗或返回修改后到达的迟到响应
  const estimateRequestIdRef = useRef(0);
  // 用户可编辑的问题变量 → 评测集字段映射
  const [variableMappings, setVariableMappings] = useState<
    Record<string, string>
  >({});
  // 创建任务最多支持的样本数（官网接口上限 500）
  const maxSampleCount = 500;
  // 为保证优化效果最少选择的数据条数（官网接口下限 20）
  const minSelectedSamples = 20;

  // 选择数据时限制数量不超过上限
  const handleSelectedRowKeysChange = (keys: string[]) => {
    if (keys.length > maxSampleCount) {
      Toast.warning({
        content: I18n.t('smart_optimization_max_selection_tip'),
        top: 80,
      });
      return;
    }
    // 清空选择时同步清空缓存的数据行，保持勾选状态与数据一致
    if (!keys.length) {
      setSelectedRows([]);
    }
    setSelectedRowKeys(keys);
  };

  const handleSelectedRowsChange = (rows: ExperimentItem[]) => {
    if (rows.length > maxSampleCount) {
      return;
    }
    setSelectedRows(rows);
  };

  // 从 selectedExperiment 中提取评测集字段选项
  const evalSetFieldSchemas = useMemo(
    () =>
      selectedExperiment?.eval_set?.evaluation_set_version
        ?.evaluation_set_schema?.field_schemas ?? [],
    [selectedExperiment],
  );

  // 评测集字段选项（官网接口无 prepare 步骤，字段选项仅来自评测集 schema）
  const evalSetFieldOptions = useMemo(() => {
    const options = evalSetFieldSchemas.map(f => ({
      value: f.key ?? '',
      label: f.name ?? f.key ?? '',
    }));
    // 补充 output/actual_output 等实验结果字段，保证模型输出映射可选
    const existingKeys = new Set(options.map(o => o.value));
    for (const field of ['actual_output', 'output', 'reference_output']) {
      if (!existingKeys.has(field)) {
        options.push({ value: field, label: field });
        existingKeys.add(field);
      }
    }
    return options;
  }, [evalSetFieldSchemas]);

  // 从 prompt_commit / prompt_draft 中提取 Prompt 变量
  const promptTemplate =
    promptDetail?.prompt_commit?.detail?.prompt_template ||
    promptDetail?.prompt_draft?.detail?.prompt_template;
  const variableDefs = promptTemplate?.variable_defs ?? [];

  // 用启发式建议映射初始化问题变量映射：变量名与评测集字段名相等时自动匹配，
  // 否则默认映射到评测集第一个字段
  useEffect(() => {
    const defaultField = evalSetFieldOptions[0]?.value ?? '';
    const optionKeys = new Set(evalSetFieldOptions.map(o => o.value));
    setVariableMappings(prev => {
      let changed = false;
      const next = { ...prev };
      for (const variable of variableDefs) {
        const key = variable?.key;
        if (!key) {
          continue;
        }
        const target = optionKeys.has(key) ? key : defaultField;
        if (next[key] === undefined && target) {
          next[key] = target;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [variableDefs, evalSetFieldOptions]);

  // 问题变量映射：以 Prompt 变量为准展示全部变量，
  // 映射值来自 variableMappings state
  const problemVariableMappings = useMemo(
    () =>
      variableDefs
        .filter((variable): variable is { key: string } => !!variable?.key)
        .map(variable => ({
          field_name: variable.key,
          from_field_name: variableMappings[variable.key] ?? '',
        })),
    [variableDefs, variableMappings],
  );

  // 模型输出字段：从 output_schemas 提取 actual_output
  const modelAnswerFieldName = useMemo(() => {
    const outputSchemas =
      selectedExperiment?.eval_target?.eval_target_version?.eval_target_content
        ?.output_schemas ?? [];
    const actualOutput = outputSchemas.find(
      s => s.key === 'actual_output' || s.key?.includes('output'),
    );
    return actualOutput?.key ?? 'actual_output';
  }, [selectedExperiment]);

  // 从 ExperimentTable 选择的第一条数据提取示例值
  const exampleData = useMemo(() => {
    const firstRow = selectedRows[0];
    if (!firstRow) {
      return null;
    }

    // 评测集字段数据（datasetRow 中每个字段的 content.text）
    const evalSetFields: Record<string, string> = {};
    for (const [key, fd] of Object.entries(firstRow.datasetRow ?? {})) {
      if (fd?.content?.text) {
        evalSetFields[key] = fd.content.text;
      }
    }

    // 模型输出数据
    const outputData: Record<string, string> = {};
    if (firstRow.actualOutput?.text) {
      outputData[modelAnswerFieldName] = firstRow.actualOutput.text;
    }

    return { evalSetFields, outputData };
  }, [selectedRows, modelAnswerFieldName]);

  // 获取指定字段的示例文本
  const getFieldExample = (
    fieldName: string,
    source: 'eval_set' | 'output',
  ) => {
    if (!exampleData) {
      return '';
    }
    if (source === 'eval_set') {
      return exampleData.evalSetFields[fieldName] ?? '';
    }
    return exampleData.outputData[fieldName] ?? '';
  };

  // 当前选中的参考回答字段对应的示例
  const referenceAnswerExample = useMemo(
    () => getFieldExample(referenceAnswerField, 'eval_set'),
    [referenceAnswerField, exampleData],
  );

  const promptId = selectedExperiment?.eval_target?.source_target_id;
  const currentPromptVersion =
    selectedExperiment?.eval_target?.eval_target_version?.source_target_version;

  // 仅展示可优化 Prompt 的实验（评测对象为 Prompt）
  const promptExptFilters = useMemo<Filters>(
    () => ({
      logic_op: FilterLogicOp.And,
      filter_conditions: [
        {
          field: { field_type: FieldType.TargetType },
          operator: FilterOperatorType.Equal,
          value: String(EvalTargetType.CozeLoopPrompt),
        },
      ],
    }),
    [],
  );

  // 默认选中的实验可能不在第一页数据中，通过 id 回捞保证正常展示
  const loadExptOptionByIds = useMemo(
    () => async (ids: (string | number)[]) => {
      const res = await StoneEvaluationApi.BatchGetExperiments({
        workspace_id: spaceID,
        expt_ids: ids as string[],
      });
      return (res.experiments ?? []).map(item => ({
        value: item.id,
        label: item.name,
        detail: item,
      }));
    },
    [spaceID],
  );

  const handleExperimentChange = (v: unknown) => {
    const option = v as { detail?: Experiment };
    const experiment = option?.detail;
    setSelectedExperiment(experiment);
    // 切换实验后，上一个实验的勾选数据不再适用
    setSelectedRowKeys([]);
    setSelectedRows([]);
    formRef.current?.setValue(
      'promptVersion',
      experiment?.eval_target?.eval_target_version?.source_target_version ?? '',
    );
  };

  const handleSubmit = (values: FormValues) => {
    onOk?.({
      exptId: selectedExperiment?.id,
      promptId: selectedExperiment?.eval_target?.source_target_id,
      promptVersion: values.promptVersion,
    });
    setTableRefreshKey(Date.now().toString());
    setSelectedRowKeys([]);
    setSelectedRows([]);
    setStep('table');
  };

  const handleBackToTable = () => {
    // 勾选状态由 selectedRowKeys 驱动，返回表格时不能清空 selectedRows，
    // 否则会出现“界面仍勾选、提交时却提示不足”的不一致
    setStep('table');
  };

  const handleTableRefreshPage = () => {
    setTableRefreshKey(Date.now().toString());
  };

  const handleNextStep = async () => {
    if (!promptId || !spaceID || !selectedExperiment?.id) {
      return;
    }
    setPromptDetailLoading(true);
    try {
      const promptRes = await StonePromptApi.GetPrompt({
        prompt_id: promptId,
        workspace_id: spaceID,
        commit_version: currentPromptVersion,
        with_commit: true,
      });
      setPromptDetail(promptRes.prompt);
      setStep('prompt_detail');
    } finally {
      setPromptDetailLoading(false);
    }
  };

  /** 校验并构建创建/预估共用的业务参数 */
  const buildCommonParams = (): OptimizeTaskParams | undefined => {
    const exptId = selectedExperiment?.id;
    if (!exptId || !spaceID || !promptId) {
      return undefined;
    }
    // 勾选数量与已缓存的数据行必须一致，避免用不完整的数据创建任务
    if (selectedRows.length !== selectedRowKeys.length) {
      Toast.error({
        content: I18n.t('smart_optimization_selection_changed_tip'),
        top: 80,
      });
      return undefined;
    }
    if (
      selectedRows.length < minSelectedSamples ||
      selectedRows.length > maxSampleCount
    ) {
      Toast.warning({
        content:
          selectedRows.length > maxSampleCount
            ? I18n.t('smart_optimization_max_selection_tip')
            : I18n.t('smart_optimization_min_selection_tip'),
        top: 80,
      });
      return undefined;
    }
    // 所有问题变量必须配置评测集字段映射，后端会强制校验
    const unmapped = problemVariableMappings.filter(
      mapping => !mapping.from_field_name,
    );
    if (unmapped.length > 0) {
      Toast.error({
        content: I18n.t('smart_optimization_problem_variables_required'),
        top: 80,
      });
      return undefined;
    }
    // 实验 item_id 列表
    const selectedItemIdList = selectedRows.map(row => String(row.groupID));
    // eval_set_to_target 完整覆盖 Prompt 全部变量
    const evalSetToTarget = problemVariableMappings.map(mapping => ({
      from_field_name: mapping.from_field_name,
      field_name: mapping.field_name,
    }));
    // 模型实际输出映射，field_name 固定为 actual_output
    const evalSetToActualOutput = {
      from_field_name: modelAnswerFieldName,
      field_name: 'actual_output',
    };
    // 没有参考答案时省略 eval_set_to_reference
    const evalSetToReference = referenceAnswerField
      ? { from_field_name: referenceAnswerField, field_name: 'output' }
      : undefined;
    return {
      workspace_id: spaceID,
      target_type: 'Prompt',
      target_version: currentPromptVersion ?? '',
      dataset_type: 'Experiment',
      related_eval_set_id: selectedExperiment?.eval_set_id ?? '',
      related_eval_set_version_id:
        selectedExperiment?.eval_set_version_id ?? '',
      related_expt_id: exptId,
      selected_item_id_list: selectedItemIdList,
      eval_set_to_reference: evalSetToReference,
      eval_set_to_target: evalSetToTarget,
      eval_set_to_actual_output: evalSetToActualOutput,
      engine: 'Ark',
      optimize_factor: optimizeMode / 100,
      optimize_task_type: 'Score',
    };
  };

  /** 第一步：只预估资源用量，成功后进入确认视图，此时不创建任务 */
  const handleEstimate = async () => {
    const commonParams = buildCommonParams();
    if (!commonParams || !promptId || estimateLoading) {
      return;
    }
    const requestId = ++estimateRequestIdRef.current;
    // 冻结本次请求参数，创建任务时必须使用同一份快照
    const requestSnapshot: EstimatePromptOptimizeTaskRequest = {
      ...commonParams,
      prompt_id: promptId,
    };
    setEstimateError('');
    setCreateTaskError('');
    setEstimateLoading(true);
    try {
      const estimateRes =
        await StoneEvaluationApi.EstimatePromptOptimizeTaskResourceUsage(
          requestSnapshot,
        );
      if (requestId !== estimateRequestIdRef.current) {
        return;
      }
      const minUsage = estimateRes.min_total_resource_usage ?? '';
      const maxUsage = estimateRes.max_total_resource_usage ?? '';
      if (!isValidResourceRange(minUsage, maxUsage)) {
        setEstimateError(I18n.t('smart_optimization_estimate_invalid'));
        return;
      }
      setEstimateConfirmation({
        requestSnapshot,
        minUsage,
        maxUsage,
        sampleCount: requestSnapshot.selected_item_id_list?.length ?? 0,
      });
      setStep('resource_confirm');
    } catch (e: unknown) {
      if (requestId !== estimateRequestIdRef.current) {
        return;
      }
      console.error('Estimate prompt optimize resource failed:', e);
      setEstimateError(
        resolveErrorMessage(e, I18n.t('smart_optimization_estimate_failed')),
      );
    } finally {
      if (requestId === estimateRequestIdRef.current) {
        setEstimateLoading(false);
      }
    }
  };

  /** 第二步：用户确认后，使用同一份请求快照创建任务 */
  const handleConfirmCreate = async () => {
    const confirmation = estimateConfirmation;
    if (!confirmation || createTaskLoading) {
      return;
    }
    setCreateTaskError('');
    setCreateTaskLoading(true);
    try {
      const resp = await StoneEvaluationApi.CreatePromptOptimizeTask({
        ...confirmation.requestSnapshot,
        estimate_resource_usage: {
          min_credit_usage: confirmation.minUsage,
          max_credit_usage: confirmation.maxUsage,
        },
      });
      const task = resp.optimize_task;
      if (!task?.id || !task.optimize_target?.target_id) {
        throw new Error('missing task id in create response');
      }
      const createdPromptId = task.optimize_target.target_id;
      const taskId = task.id;
      const { related_expt_id: exptId } = confirmation.requestSnapshot;
      handleClose();
      navigate(
        `pe/prompts/${createdPromptId}/optimization/${taskId}?expt_id=${exptId}`,
      );
    } catch (e: unknown) {
      console.error('Create prompt optimize task failed:', e);
      // 创建结果不确定时不自动重发，提示用户先确认任务是否已创建
      setCreateTaskError(
        resolveErrorMessage(e, I18n.t('smart_optimization_create_failed')),
      );
    } finally {
      setCreateTaskLoading(false);
    }
  };

  /** 从确认视图返回字段映射，保留样本与映射，清空本次预估结果 */
  const handleBackToMapping = () => {
    // 使进行中的预估请求失效，避免迟到响应重新打开确认视图
    estimateRequestIdRef.current += 1;
    setEstimateConfirmation(undefined);
    setEstimateError('');
    setEstimateLoading(false);
    setCreateTaskError('');
    setStep('prompt_detail');
  };

  const handleClose = () => {
    // 取消/忽略未完成的预估响应，避免关闭后仍创建任务
    estimateRequestIdRef.current += 1;
    setStep('form');
    setSelectedRowKeys([]);
    setSelectedRows([]);
    setPromptDetail(undefined);
    setEstimateConfirmation(undefined);
    setEstimateLoading(false);
    setEstimateError('');
    setCreateTaskError('');
    onClose?.();
  };

  // 从 prompt_commit 中提取数据
  const messages = promptTemplate?.messages ?? [];
  const modelConfig = promptDetail?.prompt_commit?.detail?.model_config;
  const templateType = promptTemplate?.template_type ?? TemplateType.Normal;
  // 查找模型名称
  const modelName =
    modelListService.data?.models?.find(
      m => `${m.model_id}` === `${modelConfig?.model_id}`,
    )?.name ?? modelConfig?.model_id;

  const form = (
    <Form<FormValues>
      getFormApi={formApi => (formRef.current = formApi)}
      initValues={{
        expt: baseExperiment
          ? {
              value: baseExperiment.id,
              label: baseExperiment.name,
              detail: baseExperiment,
            }
          : undefined,
        promptVersion: currentPromptVersion,
      }}
      onSubmit={handleSubmit}
    >
      <div className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[rgba(181,191,255,0.23)]">
        <IconCozLightbulb className="mt-[2px] flex-shrink-0 text-brand-9" />
        <span className="text-[13px] leading-5 coz-fg-secondary">
          {I18n.t('smart_optimization_tip')}
        </span>
      </div>

      <FormExperimentsSelect
        className="w-full"
        field="expt"
        label={{
          text: I18n.t('select_evaluation_experiment'),
          extra: (
            <InfoTooltip
              content={I18n.t('smart_optimization_select_experiment_tip')}
            />
          ),
        }}
        disabled={Boolean(baseExperiment)}
        placeholder={I18n.t('prompt_optimizable_experiment')}
        filters={promptExptFilters}
        loadOptionByIds={loadExptOptionByIds}
        onChangeWithObject
        onChange={handleExperimentChange}
        rules={[
          {
            required: true,
            message: I18n.t('evaluate_please_select_evaluation_experiment'),
          },
        ]}
      />

      <FormPromptVersionSelect
        className="w-full"
        field="promptVersion"
        promptId={promptId}
        disabled={Boolean(baseExperiment)}
        label={{
          text: I18n.t('prompt_version'),
          className: 'justify-between pr-0',
          extra: (
            <>
              <InfoTooltip
                content={I18n.t('smart_optimization_prompt_version_tip')}
              />
              {promptId && currentPromptVersion ? (
                <OpenDetailButton
                  url={getURL(
                    getPromptDetailURL(promptId, currentPromptVersion),
                  )}
                />
              ) : null}
            </>
          ),
        }}
        rules={[{ required: true, message: I18n.t('select_version') }]}
      />
    </Form>
  );

  // 根据 step 计算弹窗宽度
  const modalWidth =
    step === 'table' ? 1200 : step === 'prompt_detail' ? 800 : 560;

  // Role 显示名称
  const roleLabelMap: Record<string, string> = {
    [Role.System]: 'System',
    [Role.User]: 'User',
    [Role.Assistant]: 'Assistant',
  };

  // Prompt 详情视图
  const promptDetailView = (
    <div className="h-[60vh] overflow-auto pr-1 styled-scrollbar">
      {promptDetailLoading ? (
        <div className="text-sm coz-fg-secondary py-4">
          {I18n.t('smart_optimization_prompt_loading')}
        </div>
      ) : null}

      <CollapseCard
        title={
          <Typography.Text strong>
            {I18n.t('smart_optimization_prompt_detail')}
          </Typography.Text>
        }
        defaultVisible={false}
      >
        <div className="flex flex-col gap-4">
          {/* 提示词消息 */}
          <div>
            {messages.length ? (
              messages.map((msg, idx) => (
                <div key={idx} className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Typography.Text strong>
                      {roleLabelMap[msg?.role ?? ''] ?? msg?.role}{' '}
                      {I18n.t('prompt')}
                    </Typography.Text>
                  </div>
                  <PromptEditor
                    message={msg}
                    disabled
                    messageTypeDisabled
                    optimizeBtnHidden
                    snippetBtnHidden
                    modalVariableBtnHidden
                    variables={variableDefs}
                    isJinja2Template={templateType === TemplateType.Jinja2}
                    isGoTemplate={templateType === TemplateType.GoTemplate}
                    linePlaceholder=" "
                  />
                </div>
              ))
            ) : promptDetailLoading ? null : (
              <div className="text-sm coz-fg-secondary py-4">
                {I18n.t('smart_optimization_no_system_prompt')}
              </div>
            )}
          </div>

          {/* 变量 */}
          <div>
            <div className="mb-2">
              <Typography.Text strong>
                {I18n.t('prompt_variable')}
                <span className="ml-1 coz-fg-secondary font-normal">
                  ({variableDefs.length})
                </span>
              </Typography.Text>
            </div>
            {variableDefs.length ? (
              <div className="flex flex-wrap gap-2">
                {variableDefs.map(item => (
                  <Tag key={item.key} color="blue">
                    {item.key}
                    {item.type ? `（${item.type}）` : ''}
                    {item.desc ? `：${item.desc}` : ''}
                  </Tag>
                ))}
              </div>
            ) : (
              <Typography.Text type="tertiary">
                {I18n.t('smart_optimization_no_variables')}
              </Typography.Text>
            )}
          </div>

          {/* 模型配置 */}
          <div>
            <div className="mb-2">
              <Typography.Text strong>{I18n.t('model_config')}</Typography.Text>
            </div>
            {modelConfig ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="coz-fg-secondary">{I18n.t('model')}：</span>
                  <span className="coz-fg-primary font-medium">
                    {modelName || modelConfig.model_id || '--'}
                  </span>
                </div>
                <div className="text-sm font-medium coz-fg-primary mt-1">
                  {I18n.t('parameter_config')}
                </div>
                {modelConfig.temperature !== null &&
                modelConfig.temperature !== undefined ? (
                  <div className="flex items-center justify-between text-xs coz-fg-secondary">
                    <span>Temperature</span>
                    <span className="coz-fg-primary">
                      {modelConfig.temperature}
                    </span>
                  </div>
                ) : null}
                {modelConfig.max_tokens !== null &&
                modelConfig.max_tokens !== undefined ? (
                  <div className="flex items-center justify-between text-xs coz-fg-secondary">
                    <span>Max Tokens</span>
                    <span className="coz-fg-primary">
                      {modelConfig.max_tokens}
                    </span>
                  </div>
                ) : null}
                {modelConfig.top_p !== null &&
                modelConfig.top_p !== undefined ? (
                  <div className="flex items-center justify-between text-xs coz-fg-secondary">
                    <span>Top P</span>
                    <span className="coz-fg-primary">{modelConfig.top_p}</span>
                  </div>
                ) : null}
                {modelConfig.top_k !== null &&
                modelConfig.top_k !== undefined ? (
                  <div className="flex items-center justify-between text-xs coz-fg-secondary">
                    <span>Top K</span>
                    <span className="coz-fg-primary">{modelConfig.top_k}</span>
                  </div>
                ) : null}
                {modelConfig.frequency_penalty !== null &&
                modelConfig.frequency_penalty !== undefined ? (
                  <div className="flex items-center justify-between text-xs coz-fg-secondary">
                    <span>Frequency Penalty</span>
                    <span className="coz-fg-primary">
                      {modelConfig.frequency_penalty}
                    </span>
                  </div>
                ) : null}
                {modelConfig.presence_penalty !== null &&
                modelConfig.presence_penalty !== undefined ? (
                  <div className="flex items-center justify-between text-xs coz-fg-secondary">
                    <span>Presence Penalty</span>
                    <span className="coz-fg-primary">
                      {modelConfig.presence_penalty}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <Typography.Text type="tertiary">
                {I18n.t('smart_optimization_no_config')}
              </Typography.Text>
            )}
          </div>
        </div>
      </CollapseCard>

      {/* 问题变量 */}
      <div className="mt-4">
        <div className="flex items-center gap-1 mb-2">
          <Typography.Text strong>
            {I18n.t('smart_optimization_problem_variables')}
          </Typography.Text>
          <InfoTooltip
            content={I18n.t('smart_optimization_problem_variables_tip')}
          />
        </div>
        <div className="flex flex-col gap-2">
          {problemVariableMappings.map((mapping, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <ReadonlyItem
                className="flex-1 min-w-0"
                title="Prompt"
                value={mapping.field_name}
                showType={false}
              />
              <EqualItem />
              <ReadonlyItem
                className="flex-1 min-w-0"
                title={I18n.t('smart_optimization_eval_set')}
                value={mapping.from_field_name}
                showType={false}
              />
              <div className="flex items-center gap-1 flex-shrink-0 min-w-0 max-w-[200px]">
                <span className="text-sm coz-fg-secondary flex-shrink-0">
                  {I18n.t('smart_optimization_example')}
                </span>
                <Typography.Text
                  className="!coz-fg-primary flex-1 min-w-0"
                  ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
                >
                  {getFieldExample(
                    mapping.from_field_name || mapping.field_name,
                    'eval_set',
                  ) || '--'}
                </Typography.Text>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 模型回答 */}
      <div className="mt-4">
        <div className="flex items-center gap-1 mb-2">
          <Typography.Text strong>
            {I18n.t('smart_optimization_model_answer')}
          </Typography.Text>
          <InfoTooltip
            content={I18n.t('smart_optimization_model_answer_tip')}
          />
        </div>
        <div className="flex items-center gap-2">
          <ReadonlyItem
            className="flex-1 min-w-0"
            title="Prompt"
            value={I18n.t('smart_optimization_model_answer_value')}
            showType={false}
          />
          <EqualItem />
          <ReadonlyItem
            className="flex-1 min-w-0"
            title={I18n.t('smart_optimization_eval_set')}
            value={modelAnswerFieldName}
            showType={false}
          />
          <div className="flex items-center gap-1 flex-shrink-0 min-w-0 max-w-[240px]">
            <span className="text-sm coz-fg-secondary flex-shrink-0">
              {I18n.t('smart_optimization_example')}
            </span>
            <Typography.Text
              className="!coz-fg-primary flex-1 min-w-0"
              ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
            >
              {getFieldExample(modelAnswerFieldName, 'output') || '--'}
            </Typography.Text>
          </div>
        </div>
      </div>

      {/* 参考回答 */}
      <div className="mt-4">
        <div className="flex items-center gap-1 mb-2">
          <Typography.Text strong>
            {I18n.t('smart_optimization_reference_answer')}
          </Typography.Text>
          <InfoTooltip
            content={I18n.t('smart_optimization_reference_answer_tip')}
          />
        </div>
        <div className="flex items-center gap-2">
          <ReadonlyItem
            className="flex-1 min-w-0"
            title="Prompt"
            value={I18n.t('smart_optimization_reference_answer_value')}
            showType={false}
          />
          <EqualItem />
          <div className="flex-1 min-w-0">
            <Select
              className="w-full"
              value={referenceAnswerField}
              disabled={estimateLoading}
              onChange={v => setReferenceAnswerField(v as string)}
              prefix={I18n.t('smart_optimization_eval_set')}
              style={{ height: 32 }}
            >
              {evalSetFieldOptions.map(option => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 min-w-0 max-w-[240px]">
            <span className="text-sm coz-fg-secondary flex-shrink-0">
              {I18n.t('smart_optimization_example')}
            </span>
            <Typography.Text
              className="!coz-fg-primary flex-1 min-w-0"
              ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
            >
              {referenceAnswerExample || '--'}
            </Typography.Text>
          </div>
        </div>
      </div>

      {/* 优化设置 */}
      {/* <div className="mt-4">
        <div className="mb-2">
          <Typography.Text strong>
            {I18n.t('smart_optimization_settings')}
          </Typography.Text>
        </div>
        <div>
          <div className="mb-3">
            <Typography.Text strong>
              {I18n.t('smart_optimization_mode')}
            </Typography.Text>
            <span className="text-[rgb(255,0,0)] ml-1">*</span>
          </div>
          <div className="flex items-center gap-4">
            <Typography.Text type="tertiary" size="small">
              {I18n.t('smart_optimization_effect_first')}
            </Typography.Text>
            <InputNumber
              value={optimizeMode}
              onChange={v => setOptimizeMode(v as number)}
              min={0}
              max={100}
              style={{ width: 120 }}
            />
            <Slider
              className="optimization-create-wUJy4j"
              value={optimizeMode}
              onChange={v => setOptimizeMode(v as number)}
              min={0}
              max={100}
              step={1}
              style={{ width: 150 }}
            />
            <InputNumber
              value={100 - optimizeMode}
              onChange={v => setOptimizeMode(100 - (v as number))}
              min={0}
              max={100}
              style={{ width: 120 }}
            />
            <Typography.Text type="tertiary" size="small">
              {I18n.t('smart_optimization_cost_first')}
            </Typography.Text>
          </div>
        </div>
      </div> */}
    </div>
  );

  // 模型调用量预估确认视图
  const resourceConfirmView = estimateConfirmation ? (
    <div className="h-[60vh] overflow-auto pr-1 styled-scrollbar">
      <Typography.Text strong className="text-[15px]">
        {I18n.t('smart_optimization_estimate_title')}
      </Typography.Text>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm coz-fg-secondary w-[72px] flex-shrink-0">
            {I18n.t('smart_optimization_estimate_prompt')}
          </span>
          <Typography.Text
            className="!coz-fg-primary flex-1 min-w-0"
            ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
          >
            {promptDetail?.prompt_basic?.display_name || promptId}
          </Typography.Text>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm coz-fg-secondary w-[72px] flex-shrink-0">
            {I18n.t('smart_optimization_estimate_source_version')}
          </span>
          <Typography.Text
            className="!coz-fg-primary flex-1 min-w-0"
            ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
          >
            {estimateConfirmation.requestSnapshot.target_version || '--'}
          </Typography.Text>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm coz-fg-secondary w-[72px] flex-shrink-0">
            {I18n.t('smart_optimization_estimate_source_expt')}
          </span>
          <Typography.Text
            className="!coz-fg-primary flex-1 min-w-0"
            ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
          >
            {selectedExperiment?.name || '--'}
          </Typography.Text>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm coz-fg-secondary w-[72px] flex-shrink-0">
            {I18n.t('smart_optimization_estimate_sample_count')}
          </span>
          <Typography.Text className="!coz-fg-primary">
            {I18n.t('smart_optimization_estimate_sample_value', {
              count: estimateConfirmation.sampleCount,
            })}
          </Typography.Text>
        </div>
      </div>

      <div className="mt-6 p-4 rounded-[8px] bg-[rgba(181,191,255,0.23)]">
        <div className="text-sm coz-fg-secondary">
          {I18n.t('smart_optimization_estimate_range_title')}
        </div>
        <div className="mt-1 text-[20px] font-medium leading-7 coz-fg-plus">
          {I18n.t('smart_optimization_estimate_range', {
            min: estimateConfirmation.minUsage,
            max: estimateConfirmation.maxUsage,
          })}
        </div>
      </div>

      <div className="mt-3 flex items-start gap-1 text-[13px] leading-5 coz-fg-secondary">
        <IconCozInfoCircle className="mt-[3px] flex-shrink-0" />
        <span>{I18n.t('smart_optimization_estimate_desc')}</span>
      </div>

      {createTaskError ? (
        <Typography.Text
          type="danger"
          className="mt-3 block text-[13px] leading-5"
        >
          {createTaskError}
        </Typography.Text>
      ) : null}
    </div>
  ) : null;

  return (
    <Modal
      visible={visible}
      title={I18n.t('new_smart_optimization')}
      okText={I18n.t('confirm')}
      cancelText={I18n.t('cancel')}
      onOk={() => formRef.current?.submitForm()}
      onCancel={handleClose}
      width={modalWidth}
      hasScroll={false}
      footer={
        step === 'table' ? (
          <div className="flex justify-end gap-2">
            <Tooltip
              content={
                selectedRowKeys.length > maxSampleCount
                  ? I18n.t('smart_optimization_max_selection_tip')
                  : I18n.t('smart_optimization_min_selection_tip')
              }
              disabled={
                selectedRowKeys.length >= minSelectedSamples &&
                selectedRowKeys.length <= maxSampleCount
              }
            >
              <Button
                type="primary"
                disabled={
                  selectedRowKeys.length < minSelectedSamples ||
                  selectedRowKeys.length > maxSampleCount
                }
                onClick={handleNextStep}
              >
                {I18n.t('next_step_mapping_optimization')}
              </Button>
            </Tooltip>
          </div>
        ) : step === 'prompt_detail' ? (
          <div className="flex items-center justify-end gap-2">
            {estimateError ? (
              <Typography.Text type="danger" className="mr-auto text-[13px]">
                {estimateError}
              </Typography.Text>
            ) : null}
            <Button disabled={estimateLoading} onClick={handleBackToTable}>
              {I18n.t('prev_step')}
            </Button>
            <Button
              loading={estimateLoading}
              disabled={estimateLoading}
              onClick={handleEstimate}
            >
              {I18n.t('smart_optimization_create_task')}
            </Button>
          </div>
        ) : step === 'resource_confirm' ? (
          <div className="flex justify-end gap-2">
            <Button disabled={createTaskLoading} onClick={handleBackToMapping}>
              {I18n.t('smart_optimization_estimate_back')}
            </Button>
            <Button
              type="primary"
              loading={createTaskLoading}
              disabled={createTaskLoading}
              onClick={handleConfirmCreate}
            >
              {I18n.t('smart_optimization_estimate_confirm')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {step === 'form' ? (
        form
      ) : step === 'table' ? (
        <div className="h-[60vh] overflow-hidden">
          <ExperimentTable
            spaceID={spaceID}
            experimentID={selectedExperiment?.id ?? ''}
            refreshKey={tableRefreshKey}
            experiment={selectedExperiment}
            onRefreshPage={handleTableRefreshPage}
            selectable
            selectedRowKeys={selectedRowKeys}
            onSelectedRowKeysChange={handleSelectedRowKeysChange}
            onSelectedRowsChange={handleSelectedRowsChange}
          />
        </div>
      ) : step === 'resource_confirm' ? (
        resourceConfirmView
      ) : (
        promptDetailView
      )}
    </Modal>
  );
}
