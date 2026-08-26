// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @coze-arch/max-line-per-function -- 详情字段较多 */
import { useEffect, useState, type ReactNode } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import { CollapseCard } from '@cozeloop/components';
import type { Prompt, PromptTemplate } from '@cozeloop/api-schema/prompt';
import type { PromptOptimizeTask } from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi, StonePromptApi } from '@cozeloop/api-schema';
import { IconCozEqual } from '@coze-arch/coze-design/icons';
import {
  Divider,
  SideSheet,
  Spin,
  Tag,
  Typography,
} from '@coze-arch/coze-design';

const BALANCE_MODE_MAP: Record<string, string> = {
  EffectFirst: I18n.t('prompt_optimization_effect_first', {}, '效果优先'),
  CostEffectiveFirst: I18n.t(
    'prompt_optimization_cost_effective_first',
    {},
    '性价比优先',
  ),
};

function Row({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <Typography.Text className="coz-fg-secondary shrink-0">
        {label}
      </Typography.Text>
      <Typography.Text className="text-right break-all">
        {children ?? '-'}
      </Typography.Text>
    </div>
  );
}

function formatScore(v?: number): string {
  if (v === undefined || v === null) {
    return '-';
  }
  return (Math.round(v * 100) / 100).toString();
}

// 与新建智能优化页面的 ReadonlyItem / EqualItem 展示一致
function MappingReadonlyItem({
  title,
  value,
}: {
  title: string;
  value?: string;
}) {
  return (
    <div className="flex h-8 flex-1 basis-0 items-center gap-[6px] overflow-hidden rounded-[6px] border border-solid coz-stroke-plus text-sm">
      <div className="coz-fg-secondary ml-[10px] flex-shrink-0">{title}</div>
      <Typography.Text
        className="flex-1 !coz-fg-primary overflow-hidden"
        ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
      >
        {value ?? '-'}
      </Typography.Text>
    </div>
  );
}

function MappingEqualItem() {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[6px] border border-solid coz-stroke-plus coz-fg-primary">
      <IconCozEqual className="h-4 w-4 coz-fg-primary" />
    </div>
  );
}

function MappingRow({
  promptValue,
  evalSetValue,
}: {
  promptValue: string;
  evalSetValue?: string;
}) {
  return (
    <div className="flex flex-row items-center gap-2">
      <MappingReadonlyItem title="Prompt" value={promptValue} />
      <MappingEqualItem />
      <MappingReadonlyItem
        title={I18n.t('smart_optimization_eval_set', {}, '评测集')}
        value={evalSetValue}
      />
    </div>
  );
}

function renderMessages(messages?: PromptTemplate['messages']) {
  if (!messages?.length) {
    return (
      <Typography.Text className="coz-fg-secondary">
        {I18n.t('prompt_optimization_no_content', {}, '暂无内容')}
      </Typography.Text>
    );
  }
  return messages.map((msg, idx) => (
    <div key={idx} className="mb-3">
      <Tag size="small" className="mb-1">
        {String(msg.role)}
      </Tag>
      <div className="rounded border border-solid coz-stroke-primary bg-white p-3">
        <Typography.Text className="whitespace-pre-wrap break-words">
          {msg.content ?? ''}
        </Typography.Text>
      </div>
    </div>
  ));
}

export function OptimizationDetailDrawer({
  spaceID,
  promptID,
  task,
  visible,
  onCancel,
}: {
  spaceID?: string;
  promptID?: string;
  task?: PromptOptimizeTask;
  visible: boolean;
  onCancel: () => void;
}) {
  const [detail, setDetail] = useState<PromptOptimizeTask>();
  const [promptDetail, setPromptDetail] = useState<Prompt>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !task?.id || !spaceID || !promptID) {
      return;
    }
    let canceled = false;
    setLoading(true);
    StoneEvaluationApi.GetPromptOptimizeTask({
      workspace_id: spaceID,
      prompt_id: promptID,
      task_id: task.id,
    })
      .then(res => {
        if (!canceled) {
          setDetail(res.optimize_task);
          // 用源版本拉取 Prompt 详情（消息、变量定义、模型配置）
          const commitVersion =
            res.optimize_task?.optimize_target?.target_version;
          if (commitVersion) {
            return StonePromptApi.GetPrompt({
              prompt_id: promptID,
              workspace_id: spaceID,
              commit_version: commitVersion,
              with_commit: true,
            });
          }
        }
        return undefined;
      })
      .then(promptRes => {
        if (!canceled && promptRes) {
          setPromptDetail(promptRes.prompt);
        }
      })
      .catch(() => {
        if (!canceled) {
          setDetail(undefined);
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [visible, task, spaceID, promptID]);

  const data = detail ?? task;
  const dataSet = data?.optimize_task_data_set;
  const engineConfig = data?.optimize_engine_config;
  const optimizeResult = data?.optimize_result;
  const target = data?.optimize_target;

  const targetType = target?.target_type ?? '';
  const targetVersion = target?.target_version ?? '';
  const balanceMode = engineConfig?.balance_mode ?? '';
  const optimizeFactor = engineConfig?.optimize_factor;

  const evalSetToTarget = dataSet?.eval_set_to_target ?? [];
  const evalSetToActualOutput = dataSet?.eval_set_to_actual_output;
  const evalSetToReference = dataSet?.eval_set_to_reference;

  // Prompt 详情（来自 GetPrompt，按 source version 拉取）
  const promptTemplate = promptDetail?.prompt_commit?.detail?.prompt_template;
  const modelConfig = promptDetail?.prompt_commit?.detail?.model_config;

  return (
    <SideSheet
      title={
        <Typography.Title heading={5} className="!mb-0">
          {I18n.t('prompt_optimization_detail', {}, '优化任务详情')}
        </Typography.Title>
      }
      visible={visible}
      onCancel={onCancel}
      width={560}
      closable
      maskClosable
    >
      <div className="h-full overflow-auto styled-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Spin size="small" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* 评测实验 */}
            <section>
              <Typography.Title heading={6} className="!mb-1">
                {I18n.t('prompt_optimization_expt', {}, '评测实验')}
              </Typography.Title>
              <Divider className="!my-2" />
              <Row label={I18n.t('name')}>{dataSet?.related_expt_name}</Row>
              <Row label={I18n.t('score', {}, '数值')}>
                {formatScore(optimizeResult?.best_metrics?.average_score)}
              </Row>
            </section>

            {/* 关联评测对象 */}
            <section>
              <Typography.Title heading={6} className="!mb-1">
                {I18n.t('prompt_optimization_eval_target', {}, '关联评测对象')}
              </Typography.Title>
              <Divider className="!my-2" />
              <Row label={I18n.t('target_type', {}, '类型')}>
                {targetType || '-'}
              </Row>
              <Row label={I18n.t('prompt_version', {}, '版本')}>
                {targetVersion || '-'}
              </Row>
            </section>

            {/* Prompt 详情（可展开收起） */}
            <CollapseCard
              title={
                <Typography.Text strong>
                  {I18n.t('prompt_detail', {}, 'Prompt 详情')}
                </Typography.Text>
              }
            >
              <div className="flex flex-col gap-3">
                {/* 消息内容 */}
                <div>
                  <div className="mb-1">
                    <Typography.Text strong>
                      {I18n.t('prompt_optimization_messages', {}, '消息')}
                    </Typography.Text>
                  </div>
                  {renderMessages(promptTemplate?.messages)}
                </div>

                {/* 模型配置 */}
                <div>
                  <div className="mb-1">
                    <Typography.Text strong>
                      {I18n.t('model_config', {}, '模型配置')}
                    </Typography.Text>
                  </div>
                  {modelConfig ? (
                    <div className="flex flex-col gap-1">
                      <Row label={I18n.t('model', {}, '模型')}>
                        {modelConfig.model_id}
                      </Row>
                      {modelConfig.temperature !== undefined &&
                      modelConfig.temperature !== null ? (
                        <Row label="Temperature">{modelConfig.temperature}</Row>
                      ) : null}
                      {modelConfig.max_tokens !== undefined &&
                      modelConfig.max_tokens !== null ? (
                        <Row label="Max Tokens">{modelConfig.max_tokens}</Row>
                      ) : null}
                    </div>
                  ) : (
                    <Typography.Text className="coz-fg-secondary">
                      {I18n.t('prompt_optimization_no_config', {}, '暂无配置')}
                    </Typography.Text>
                  )}
                </div>
              </div>
            </CollapseCard>

            {/* 问题变量（映射：Prompt变量 = 评测集字段） */}
            <div>
              <div className="mb-2">
                <Typography.Text strong>
                  {I18n.t(
                    'prompt_optimization_problem_variables',
                    {},
                    '问题变量',
                  )}
                </Typography.Text>
              </div>
              <div className="flex flex-col gap-2">
                {evalSetToTarget.length ? (
                  evalSetToTarget.map((mapping, idx) => (
                    <MappingRow
                      key={idx}
                      promptValue={mapping.field_name ?? ''}
                      evalSetValue={mapping.from_field_name}
                    />
                  ))
                ) : (
                  <Typography.Text className="coz-fg-secondary">
                    {I18n.t('prompt_optimization_no_variables', {}, '暂无变量')}
                  </Typography.Text>
                )}
              </div>
            </div>

            {/* 模型回答映射 */}
            <div>
              <div className="mb-2">
                <Typography.Text strong>
                  {I18n.t('prompt_optimization_model_answer', {}, '模型回答')}
                </Typography.Text>
              </div>
              <MappingRow
                promptValue={
                  evalSetToActualOutput?.field_name ?? 'actual_output'
                }
                evalSetValue={evalSetToActualOutput?.from_field_name}
              />
            </div>

            {/* 参考回答映射 */}
            <div>
              <div className="mb-2">
                <Typography.Text strong>
                  {I18n.t(
                    'prompt_optimization_reference_answer',
                    {},
                    '参考回答',
                  )}
                </Typography.Text>
              </div>
              {evalSetToReference ? (
                <MappingRow
                  promptValue={evalSetToReference.field_name ?? 'output'}
                  evalSetValue={evalSetToReference.from_field_name}
                />
              ) : (
                <Typography.Text className="coz-fg-secondary">
                  {I18n.t(
                    'prompt_optimization_no_reference_answer',
                    {},
                    '未配置参考回答',
                  )}
                </Typography.Text>
              )}
            </div>

            {/* Prompt 优化设置 */}
            <section>
              <Typography.Title heading={6} className="!mb-1">
                {I18n.t('prompt_optimization_settings', {}, 'Prompt 优化设置')}
              </Typography.Title>
              <Divider className="!my-2" />
              <Row label={I18n.t('prompt_optimization_mode', {}, '优化模式')}>
                {BALANCE_MODE_MAP[balanceMode] ?? balanceMode ?? '-'}
              </Row>
              <Row label={I18n.t('optimize_factor', {}, '优化因子')}>
                {optimizeFactor !== undefined ? String(optimizeFactor) : '-'}
              </Row>
            </section>

            {/* 真实值：消耗资源点 */}
            <section>
              <Typography.Title heading={6} className="!mb-1">
                {I18n.t('actual_value', {}, '真实值')}
              </Typography.Title>
              <Divider className="!my-2" />
              <Row
                label={I18n.t(
                  'prompt_optimization_credit_usage',
                  {},
                  '消耗资源点',
                )}
              >
                {optimizeResult?.ark_job_credit_usage ?? '-'}
              </Row>
            </section>
          </div>
        )}
      </div>
    </SideSheet>
  );
}
