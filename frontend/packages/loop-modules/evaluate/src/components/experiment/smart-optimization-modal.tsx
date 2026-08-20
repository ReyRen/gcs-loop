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
  PromptOptimizationMode,
  type Experiment,
  type Filters,
  type PreparePromptOptimizationResponse,
} from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi, StonePromptApi } from '@cozeloop/api-schema';
import { IconCozLightbulb } from '@coze-arch/coze-design/icons';
import {
  Button,
  Form,
  type FormApi,
  InputNumber,
  Modal,
  Select,
  Slider,
  Tag,
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
  const [step, setStep] = useState<'form' | 'table' | 'prompt_detail'>('form');
  const [tableRefreshKey, setTableRefreshKey] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [promptDetail, setPromptDetail] = useState<Prompt | undefined>();
  const [promptDetailLoading, setPromptDetailLoading] = useState(false);
  const [optimizeMode, setOptimizeMode] = useState(50);
  const [referenceAnswerField, setReferenceAnswerField] =
    useState('reference_output');
  const [selectedRows, setSelectedRows] = useState<ExperimentItem[]>([]);
  const [createTaskLoading, setCreateTaskLoading] = useState(false);
  const [prepareData, setPrepareData] = useState<
    PreparePromptOptimizationResponse | undefined
  >();
  const idempotencyKeyRef = useRef('');
  const lastConfigFingerprintRef = useRef('');

  // 拉取优化资格与建议映射；suggested_variable_mappings 仅基于 Prompt 变量生成，
  // 不会包含 builtin_prompt_user_query 等内置输入字段
  useEffect(() => {
    const exptId = selectedExperiment?.id;
    if (!exptId || !spaceID) {
      setPrepareData(undefined);
      return;
    }
    let canceled = false;
    StoneEvaluationApi.PreparePromptOptimization({
      workspace_id: spaceID,
      expt_id: exptId,
    })
      .then(res => {
        if (!canceled) {
          setPrepareData(res);
        }
      })
      .catch((err: unknown) => {
        if (!canceled) {
          console.error('Prepare prompt optimization failed:', err);
          setPrepareData(undefined);
        }
      });
    return () => {
      canceled = true;
    };
  }, [selectedExperiment, spaceID]);

  // prepare 建议的参考回答字段作为默认值
  useEffect(() => {
    const suggested = prepareData?.suggested_reference_answer_field;
    if (suggested) {
      setReferenceAnswerField(suggested);
    }
  }, [prepareData]);

  // 从 selectedExperiment 中提取评测集字段选项
  const evalSetFieldSchemas = useMemo(
    () =>
      selectedExperiment?.eval_set?.evaluation_set_version
        ?.evaluation_set_schema?.field_schemas ?? [],
    [selectedExperiment],
  );

  // 评测集字段选项（用于 Select 下拉）
  const evalSetFieldOptions = useMemo(
    () =>
      evalSetFieldSchemas.map(f => ({
        value: f.key ?? '',
        label: f.name ?? f.key ?? '',
      })),
    [evalSetFieldSchemas],
  );

  // 从 prepare 的建议映射提取问题变量映射（仅真实 Prompt 变量）
  const problemVariableMappings = useMemo(
    () =>
      Object.entries(prepareData?.suggested_variable_mappings ?? {})
        .filter(([fieldName, fromFieldName]) => !!fieldName && !!fromFieldName)
        .map(([fieldName, fromFieldName]) => ({
          field_name: fieldName,
          from_field_name: fromFieldName,
        })),
    [prepareData],
  );

  // 优先使用 prepare 建议的模型回答字段，回退到 output_schemas 提取
  const modelAnswerFieldName = useMemo(() => {
    if (prepareData?.suggested_model_answer_field) {
      return prepareData.suggested_model_answer_field;
    }
    const outputSchemas =
      selectedExperiment?.eval_target?.eval_target_version?.eval_target_content
        ?.output_schemas ?? [];
    const actualOutput = outputSchemas.find(
      s => s.key === 'actual_output' || s.key?.includes('output'),
    );
    return actualOutput?.key ?? 'actual_output';
  }, [selectedExperiment, prepareData]);

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
    setStep('table');
    setSelectedRows([]);
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

  // 配置变更时重置幂等键
  const configFingerprint = `${optimizeMode}_${referenceAnswerField}_${selectedRowKeys.join(',')}`;
  if (lastConfigFingerprintRef.current !== configFingerprint) {
    lastConfigFingerprintRef.current = configFingerprint;
    idempotencyKeyRef.current = '';
  }

  const handleCreateTask = async () => {
    const exptId = selectedExperiment?.id;
    if (!exptId || !spaceID || selectedRows.length === 0) {
      return;
    }
    setCreateTaskLoading(true);
    try {
      // 首次点击或配置变更后生成新的幂等键
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = crypto.randomUUID();
      }
      const samples = selectedRows.map(row => ({
        item_id: String(row.groupID),
        turn_id: String(row.turnID),
      }));
      const variableMappings: Record<string, string> = {};
      for (const [fieldName, fromFieldName] of Object.entries(
        prepareData?.suggested_variable_mappings ?? {},
      )) {
        if (fieldName && fromFieldName) {
          variableMappings[fieldName] = fromFieldName;
        }
      }
      const mode =
        optimizeMode <= 50
          ? PromptOptimizationMode.EffectFirst
          : PromptOptimizationMode.CostEffective;
      const experimentName = selectedExperiment?.name ?? '';
      const resp = await StoneEvaluationApi.CreatePromptOptimization({
        workspace_id: spaceID,
        expt_id: exptId,
        samples,
        variable_mappings: variableMappings,
        model_answer_field: modelAnswerFieldName,
        reference_answer_field: referenceAnswerField,
        mode,
        max_iterations: 8,
        name: `${experimentName}_${I18n.t('smart_optimization_optimize')}`,
        idempotency_key: idempotencyKeyRef.current,
      });
      const { task } = resp;
      if (!task?.id || !task.prompt_id) {
        throw new Error('missing task id in create response');
      }
      const createdPromptId = task.prompt_id;
      const taskId = task.id;
      handleClose();
      navigate(
        `pe/prompts/${createdPromptId}/optimization/${taskId}?expt_id=${exptId}`,
      );
    } catch (e: unknown) {
      console.error('Create prompt optimization failed:', e);
    } finally {
      setCreateTaskLoading(false);
    }
  };

  const handleClose = () => {
    setStep('form');
    setSelectedRowKeys([]);
    setSelectedRows([]);
    setPromptDetail(undefined);
    idempotencyKeyRef.current = '';
    onClose?.();
  };

  // 从 prompt_commit 中提取数据
  const promptTemplate =
    promptDetail?.prompt_commit?.detail?.prompt_template ||
    promptDetail?.prompt_draft?.detail?.prompt_template;
  const messages = promptTemplate?.messages ?? [];
  const variableDefs = promptTemplate?.variable_defs ?? [];
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
        disabled
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
        disabled
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
                <div key={msg?.id || msg?.key || idx} className="mb-3">
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
                  {getFieldExample(mapping.from_field_name ?? '', 'eval_set') ||
                    '--'}
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
      <div className="mt-4">
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
      </div>
    </div>
  );

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
              content={I18n.t('smart_optimization_min_selection_tip')}
              disabled={selectedRowKeys.length >= 20}
            >
              <Button
                type="primary"
                disabled={selectedRowKeys.length < 20}
                onClick={handleNextStep}
              >
                {I18n.t('next_step_mapping_optimization')}
              </Button>
            </Tooltip>
          </div>
        ) : step === 'prompt_detail' ? (
          <div className="flex justify-end gap-2">
            <Button onClick={handleBackToTable}>{I18n.t('prev_step')}</Button>
            <Button
              type="primary"
              loading={createTaskLoading}
              onClick={handleCreateTask}
            >
              {I18n.t('smart_optimization_create_task')}
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
            onSelectedRowKeysChange={setSelectedRowKeys}
            onSelectedRowsChange={setSelectedRows}
          />
        </div>
      ) : (
        promptDetailView
      )}
    </Modal>
  );
}
