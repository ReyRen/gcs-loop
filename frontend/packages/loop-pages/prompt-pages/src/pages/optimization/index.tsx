// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable max-lines */
/* eslint-disable @coze-arch/max-line-per-function */
import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import { useBreadcrumb } from '@cozeloop/hooks';
import { PageLoading } from '@cozeloop/components';
import { useNavigateModule, useSpace } from '@cozeloop/biz-hooks-adapter';
import {
  type Message,
  type PromptDetail,
  type PromptTemplate,
} from '@cozeloop/api-schema/prompt';
import {
  PromptOptimizationStage,
  type PromptOptimizationMetrics,
  type PromptOptimizationSampleEvaluation,
  type PromptOptimizeTask,
} from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi, StonePromptApi } from '@cozeloop/api-schema';
import {
  Button,
  Divider,
  Modal,
  Spin,
  Tag,
  Typography,
} from '@coze-arch/coze-design';

interface DiffToken {
  type: 'equal' | 'delete' | 'insert';
  value: string;
}

const STAGE_LABELS: Record<string, string> = {
  [PromptOptimizationStage.Preparing]: 'stage_preparing',
  [PromptOptimizationStage.Analyzing]: 'stage_analyzing',
  [PromptOptimizationStage.Optimizing]: 'stage_optimizing',
  [PromptOptimizationStage.Evaluating]: 'stage_evaluating',
  [PromptOptimizationStage.Finalizing]: 'stage_finalizing',
  [PromptOptimizationStage.Completed]: 'stage_completed',
};

// 官网优化任务状态（字符串）
const STATUS_RUNNING = ['Created', 'Running'];

/** 将文本按「变量 / 单词 / 标点 / 空白」切分为 token，便于本地 diff */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const regex = /\{\{[^{}]+\}\}|\w+|[^\w\s]|\s+/g;
  let m = regex.exec(text);
  while (m !== null) {
    tokens.push(m[0]);
    m = regex.exec(text);
  }
  return tokens;
}

/** 基于 token 的 LCS diff，返回分段结果 */
function diffTokens(oldText: string, newText: string): DiffToken[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'equal', value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'delete', value: a[i] });
      i++;
    } else {
      result.push({ type: 'insert', value: b[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: 'delete', value: a[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: 'insert', value: b[j] });
    j++;
  }
  return result;
}

function isVariable(token: string): boolean {
  return /^\{\{[^{}]+\}\}$/.test(token);
}

function DiffText({ diff }: { diff: DiffToken[] }) {
  return (
    <span className="break-words whitespace-pre-wrap">
      {diff.map((t, idx) => {
        const className =
          t.type === 'delete'
            ? 'bg-[rgba(255,77,79,0.15)] text-[#cf1322] line-through'
            : t.type === 'insert'
              ? 'bg-[rgba(82,196,26,0.15)] text-[#237804]'
              : '';
        if (isVariable(t.value)) {
          return (
            <span
              key={idx}
              className="mx-0.5 rounded bg-[#EFF1FF] px-1 text-[#4C5BD4]"
            >
              {t.value}
            </span>
          );
        }
        if (!className) {
          return <span key={idx}>{t.value}</span>;
        }
        return (
          <span key={idx} className={className}>
            {t.value}
          </span>
        );
      })}
    </span>
  );
}

function renderMessages(messages?: Message[]) {
  if (!messages?.length) {
    return (
      <Typography.Text>
        {I18n.t('prompt_optimization_no_content')}
      </Typography.Text>
    );
  }
  return messages.map((msg, idx) => (
    <div key={idx} className="mb-3">
      <Tag size="small" className="mb-1">
        {String(msg.role)}
      </Tag>
      <div className="rounded border border-solid coz-stroke-primary bg-white p-3">
        <Typography.Paragraph className="!mb-0 whitespace-pre-wrap break-words">
          {msg.content ?? ''}
        </Typography.Paragraph>
      </div>
    </div>
  ));
}

function renderDiffMessages(original: Message[], optimized: Message[]) {
  const maxLen = Math.max(original?.length ?? 0, optimized?.length ?? 0);
  if (!maxLen) {
    return (
      <Typography.Text>
        {I18n.t('prompt_optimization_no_content')}
      </Typography.Text>
    );
  }
  return Array.from({ length: maxLen }, (_, idx) => {
    const left = original?.[idx];
    const right = optimized?.[idx];
    const diff = diffTokens(left?.content ?? '', right?.content ?? '');
    return (
      <div key={idx} className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <Tag size="small" className="mb-1">
            {left ? String(left.role) : '-'}
          </Tag>
          <div className="rounded border border-solid coz-stroke-primary bg-white p-3">
            <DiffText diff={diff.filter(t => t.type !== 'insert')} />
          </div>
        </div>
        <div>
          <Tag size="small" className="mb-1">
            {right ? String(right.role) : '-'}
          </Tag>
          <div className="rounded border border-solid coz-stroke-primary bg-white p-3">
            <DiffText diff={diff.filter(t => t.type !== 'delete')} />
          </div>
        </div>
      </div>
    );
  });
}

function MetricItem({
  label,
  value,
  delta,
}: {
  label: string;
  value?: string | number;
  delta?: number;
}) {
  return (
    <div className="flex min-w-[120px] flex-1 flex-col gap-1 rounded border border-solid coz-stroke-primary p-3">
      <Typography.Text className="coz-fg-secondary">{label}</Typography.Text>
      <div className="flex items-center gap-2">
        <Typography.Text strong className="text-[16px]">
          {value ?? '-'}
        </Typography.Text>
        {delta !== undefined && delta !== 0 ? (
          <Typography.Text
            className={delta > 0 ? 'text-[#237804]' : 'text-[#cf1322]'}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
          </Typography.Text>
        ) : null}
      </div>
    </div>
  );
}

function formatScore(v?: number): string {
  if (v === undefined || v === null) {
    return '-';
  }
  return (Math.round(v * 100) / 100).toString();
}

export default function PromptOptimizationPage() {
  const { promptID, optimizationID } = useParams<{
    promptID: string;
    optimizationID: string;
  }>();
  const { spaceID } = useSpace();
  const navigate = useNavigateModule();

  const [task, setTask] = useState<PromptOptimizeTask>();
  const [loading, setLoading] = useState(true);
  const [applyingToDraft, setApplyingToDraft] = useState(false);
  const [overwriteVisible, setOverwriteVisible] = useState(false);
  // 源版本 Prompt 详情（用于 diff 左侧与构造草稿）
  const [sourceDetail, setSourceDetail] = useState<PromptDetail>();

  const timeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(1);
  const visibilityRef = useRef(true);

  // 源版本号：新接口无 original_prompt_template，原始 Prompt 取自 optimize_target.target_version
  const sourceVersion = task?.optimize_target?.target_version;

  useBreadcrumb({
    text: task?.task_name || I18n.t('prompt_optimization_title'),
  });

  // 拉取源版本 Prompt 详情（模型配置、工具、MCP 等用于构造草稿）
  const loadSourceDetail = useCallback(async () => {
    if (!spaceID || !promptID || !sourceVersion) {
      return;
    }
    try {
      const res = await StonePromptApi.GetPrompt({
        prompt_id: promptID,
        workspace_id: spaceID,
        commit_version: sourceVersion,
        with_commit: true,
      });
      setSourceDetail(res.prompt?.prompt_commit?.detail);
    } catch (e) {
      console.error('Load source prompt detail failed:', e);
    }
  }, [spaceID, promptID, sourceVersion]);

  const pollOnce = useCallback(async () => {
    if (!spaceID || !promptID || !optimizationID) {
      return;
    }
    try {
      const res = await StoneEvaluationApi.GetPromptOptimizeTask({
        workspace_id: spaceID,
        prompt_id: promptID,
        task_id: optimizationID,
      });
      backoffRef.current = 1;
      setLoading(false);
      const t = res.optimize_task;
      if (!t) {
        return;
      }
      setTask(t);
      if (t.status === 'Success') {
        // 终态后拉取源版本详情用于展示对比与构造草稿
        void loadSourceDetail();
        return;
      }
      if (STATUS_RUNNING.includes(t.status ?? '')) {
        timeoutRef.current = window.setTimeout(pollOnce, 2000);
      }
    } catch (e) {
      console.error('Poll prompt optimize task failed:', e);
      const delay = Math.min(30000, 2000 * backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, 15);
      timeoutRef.current = window.setTimeout(pollOnce, delay);
    }
  }, [spaceID, promptID, optimizationID, loadSourceDetail]);

  useEffect(() => {
    void pollOnce();
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [pollOnce]);

  // 页面隐藏时暂停轮询，重新可见时立即恢复（终态下 pollOnce 不会继续排下一次）
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      visibilityRef.current = visible;
      if (visible) {
        void pollOnce();
      } else if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pollOnce]);

  // 用户点击「提交新版本」：把优化结果显式保存为 Prompt 草稿，再跳转编辑器确认
  const handleSubmitNewVersion = async () => {
    if (!spaceID || !promptID || !task?.optimize_result) {
      return;
    }
    // 检查当前是否已有草稿，有则提示覆盖
    const promptRes = await StonePromptApi.GetPrompt({
      prompt_id: promptID,
      workspace_id: spaceID,
      with_draft: true,
      with_commit: true,
    });
    if (promptRes.prompt?.prompt_draft) {
      setOverwriteVisible(true);
      return;
    }
    await applyToDraft(false);
  };

  const applyToDraft = async (overwrite: boolean) => {
    if (!spaceID || !promptID || !task?.optimize_result || !sourceVersion) {
      return;
    }
    setApplyingToDraft(true);
    try {
      const optimizedMessages =
        task.optimize_result.optimized_prompt_message_list;
      // 组合优化结果 + 源 Prompt 的模型配置、工具、MCP 等
      const res = await StonePromptApi.SaveDraft({
        prompt_id: promptID,
        prompt_draft: {
          draft_info: { base_version: sourceVersion },
          detail: {
            prompt_template: {
              messages: optimizedMessages ?? [],
              template_type:
                sourceDetail?.prompt_template?.template_type ?? 'normal',
              variable_defs: sourceDetail?.prompt_template?.variable_defs,
            },
            model_config: sourceDetail?.model_config ?? {},
            tools: sourceDetail?.tools ?? [],
            tool_call_config: sourceDetail?.tool_call_config ?? {},
            mcp_config: sourceDetail?.mcp_config ?? {},
          },
        },
      });
      console.log('res', res);
      if (!overwrite) {
        setOverwriteVisible(false);
      }
      // 保存成功后跳转 Prompt 编辑器，由用户确认版本后自行 commit
      navigate(`pe/prompts/${promptID}`);
    } catch (e) {
      console.error('Save draft failed:', e);
    } finally {
      setApplyingToDraft(false);
    }
  };

  const result = task?.optimize_result;
  const bestMetrics: PromptOptimizationMetrics | undefined =
    result?.best_metrics;
  const baselineMetrics: PromptOptimizationMetrics | undefined =
    result?.baseline_metrics;

  const bestIteration = useMemo(() => {
    const iterations = result?.iterations ?? [];
    if (!iterations.length) {
      return undefined;
    }
    return [...iterations].sort(
      (a, b) =>
        (b.metrics?.average_score ?? -Infinity) -
        (a.metrics?.average_score ?? -Infinity),
    )[0];
  }, [result?.iterations]);

  const improved =
    baselineMetrics?.average_score !== undefined &&
    bestMetrics?.average_score !== undefined &&
    bestMetrics.average_score > baselineMetrics.average_score;

  const sampleResults = (bestIteration?.sample_results ??
    []) as PromptOptimizationSampleEvaluation[];

  if (loading) {
    return <PageLoading className="h-full w-full" />;
  }

  const status = task?.status;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Typography.Title heading={4} className="!mb-1">
              {task?.task_name || I18n.t('prompt_optimization_title')}
            </Typography.Title>
            <Typography.Text className="coz-fg-secondary">
              {I18n.t('prompt_optimization_source_version')}:{' '}
              {sourceVersion ?? '-'}
            </Typography.Text>
          </div>
          {status === 'Failed' ? (
            <Button
              onClick={() =>
                navigate(
                  `evaluation/experiments/${task?.optimize_task_data_set?.related_expt_id}`,
                )
              }
            >
              {I18n.t('prompt_optimization_back_to_experiment')}
            </Button>
          ) : null}
        </div>

        {/* 运行中 / 排队中 */}
        {status === 'Created' || status === 'Running' ? (
          <div className="rounded border border-solid coz-stroke-primary p-6">
            <div className="mb-4 flex items-center gap-2">
              <Spin size="small" />
              <Typography.Text strong>
                {status === 'Created'
                  ? I18n.t('prompt_optimization_queued')
                  : I18n.t('prompt_optimization_running')}
              </Typography.Text>
              {task?.stage ? (
                <Tag size="small">
                  {I18n.t(STAGE_LABELS[task.stage] ?? task.stage)}
                </Tag>
              ) : null}
            </div>

            <div className="mb-1 flex justify-between">
              <Typography.Text className="coz-fg-secondary">
                {I18n.t('prompt_optimization_progress')}
              </Typography.Text>
              <Typography.Text>{task?.progress ?? 0}%</Typography.Text>
            </div>
            <div className="mb-6 h-2 w-full overflow-hidden rounded bg-[#EEF0F6]">
              <div
                className="h-full rounded bg-[#4C5BD4] transition-all"
                style={{ width: `${Math.min(100, task?.progress ?? 0)}%` }}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <MetricItem
                label={I18n.t('prompt_optimization_iterations')}
                value={`${result?.iterations?.length ?? 0}`}
              />
              <MetricItem
                label={I18n.t('prompt_optimization_best_score')}
                value={formatScore(bestMetrics?.average_score)}
              />
              <MetricItem
                label={I18n.t('prompt_optimization_tokens')}
                value={`${bestMetrics?.input_tokens ?? '-'} / ${bestMetrics?.output_tokens ?? '-'}`}
              />
            </div>
          </div>
        ) : null}

        {/* 失败 */}
        {status === 'Failed' ? (
          <div className="rounded border border-solid coz-stroke-primary p-6">
            <Typography.Text className="text-[#cf1322]" strong>
              {I18n.t('prompt_optimization_failed')}
            </Typography.Text>
            {task?.error_message ? (
              <div className="mt-3 rounded bg-[rgba(255,77,79,0.08)] p-3">
                <Typography.Text>{task.error_message}</Typography.Text>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 终止 */}
        {status === 'Terminated' ? (
          <div className="rounded border border-solid coz-stroke-primary p-6">
            <Typography.Text className="coz-fg-secondary">
              {I18n.t('prompt_optimization_canceled')}
            </Typography.Text>
          </div>
        ) : null}

        {/* 结果 */}
        {status === 'Success' ? (
          <>
            {/* 7.1 顶部汇总 */}
            <div className="mb-6 rounded border border-solid coz-stroke-primary p-6">
              {!improved ? (
                <div className="mb-4 rounded bg-[rgba(255,247,184,0.4)] p-3">
                  <Typography.Text>
                    {I18n.t('prompt_optimization_no_improvement')}
                  </Typography.Text>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <MetricItem
                  label={I18n.t('prompt_optimization_baseline_score')}
                  value={formatScore(baselineMetrics?.average_score)}
                />
                <MetricItem
                  label={I18n.t('prompt_optimization_best_score_lbl')}
                  value={formatScore(bestMetrics?.average_score)}
                />
                <MetricItem
                  label={I18n.t('prompt_optimization_sample_count')}
                  value={bestMetrics?.sample_count}
                />
                <MetricItem
                  label={I18n.t('prompt_optimization_improved_count')}
                  value={bestMetrics?.improved_count}
                />
                <MetricItem
                  label={I18n.t('prompt_optimization_regressed_count')}
                  value={bestMetrics?.regressed_count}
                />
                <MetricItem
                  label={I18n.t('prompt_optimization_unchanged_count')}
                  value={bestMetrics?.unchanged_count}
                />
                <MetricItem
                  label={I18n.t('prompt_optimization_input_tokens')}
                  value={bestMetrics?.input_tokens}
                />
                <MetricItem
                  label={I18n.t('prompt_optimization_output_tokens')}
                  value={bestMetrics?.output_tokens}
                />
              </div>
            </div>

            {/* 7.2 Prompt 对比 */}
            <div className="mb-6 rounded border border-solid coz-stroke-primary p-6">
              <Typography.Title heading={5}>
                {I18n.t('prompt_optimization_prompt_comparison')}
              </Typography.Title>
              <Divider />
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Typography.Text strong>
                  {I18n.t('prompt_optimization_original_prompt')}
                </Typography.Text>
                <Typography.Text strong>
                  {I18n.t('prompt_optimization_optimized_prompt')}
                </Typography.Text>
              </div>
              {result?.optimized_prompt_message_list?.length
                ? renderDiffMessages(
                    (
                      sourceDetail?.prompt_template as
                        | PromptTemplate
                        | undefined
                    )?.messages ?? [],
                    result.optimized_prompt_message_list,
                  )
                : renderMessages(
                    (
                      sourceDetail?.prompt_template as
                        | PromptTemplate
                        | undefined
                    )?.messages ?? [],
                  )}
            </div>

            {/* 7.3 样本对比表 */}
            <div className="mb-6 rounded border border-solid coz-stroke-primary p-6">
              <Typography.Title heading={5}>
                {I18n.t('prompt_optimization_sample_comparison')}
              </Typography.Title>
              <Divider />
              {!improved ? (
                <div className="mb-4">
                  <Tag>{I18n.t('prompt_optimization_no_better_candidate')}</Tag>
                </div>
              ) : null}
              <SampleComparisonTable data={sampleResults} />
            </div>

            {/* 提交新版本 */}
            <div className="flex justify-end">
              <Button
                type="primary"
                loading={applyingToDraft}
                onClick={() => void handleSubmitNewVersion()}
              >
                {I18n.t('prompt_optimization_submit_new_version')}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {/* 覆盖草稿确认框 */}
      <Modal
        visible={overwriteVisible}
        title={I18n.t('prompt_optimization_submit_new_version')}
        okText={I18n.t('confirm')}
        cancelText={I18n.t('cancel')}
        onCancel={() => setOverwriteVisible(false)}
        onOk={() => void applyToDraft(true)}
        confirmLoading={applyingToDraft}
      >
        <Typography.Text>
          {I18n.t('prompt_optimization_draft_overwrite_confirm')}
        </Typography.Text>
      </Modal>
    </div>
  );
}

function SampleComparisonTable({
  data,
}: {
  data: PromptOptimizationSampleEvaluation[];
}) {
  return (
    <div
      style={{ width: '100%' }}
      className="rounded-lg border border-solid coz-stroke-primary"
    >
      {data.map((item, idx) => (
        <table key={idx} className="w-full border-collapse text-left">
          <thead>
            <tr className="coz-bg-primary">
              <th className="border-b border-r border-solid coz-stroke-primary p-2">
                {I18n.t('prompt_optimization_input_variable')}
              </th>
              <th className="border-b border-r border-solid coz-stroke-primary p-2">
                {I18n.t('prompt_optimization_reference_answer')}
              </th>
              <th className="border-b border-r border-solid coz-stroke-primary p-2">
                {I18n.t('prompt_optimization_original_answer')}
              </th>
              <th className="border-b border-r border-solid coz-stroke-primary p-2">
                {I18n.t('prompt_optimization_optimized_answer')}
              </th>
              <th className="border-b border-r border-solid coz-stroke-primary p-2">
                {I18n.t('prompt_optimization_original_score')}
              </th>
              <th className="border-b border-r border-solid coz-stroke-primary p-2">
                {I18n.t('prompt_optimization_optimized_score')}
              </th>
              <th className="border-b border-solid coz-stroke-primary p-2">
                {I18n.t('prompt_optimization_evaluator_detail')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b border-r border-solid coz-stroke-primary p-2 align-top">
                {item.variables ? JSON.stringify(item.variables) : '-'}
              </td>
              <td className="border-b border-r border-solid coz-stroke-primary p-2 align-top break-all">
                {item.reference_answer ?? '-'}
              </td>
              <td className="border-b border-r border-solid coz-stroke-primary p-2 align-top break-all">
                {item.original_answer ?? '-'}
              </td>
              <td className="border-b border-r border-solid coz-stroke-primary p-2 align-top break-all">
                {item.optimized_answer ?? '-'}
              </td>
              <td className="border-b border-r border-solid coz-stroke-primary p-2 align-top">
                {formatScore(item.original_score)}
              </td>
              <td className="border-b border-r border-solid coz-stroke-primary p-2 align-top">
                {formatScore(item.optimized_score)}
              </td>
              <td className="border-b border-solid coz-stroke-primary p-2 align-top">
                {renderEvaluatorDetail(item)}
              </td>
            </tr>
          </tbody>
        </table>
      ))}
    </div>
  );
}

function renderEvaluatorDetail(record: PromptOptimizationSampleEvaluation) {
  const origScores = record.original_evaluator_scores ?? {};
  const optScores = record.optimized_evaluator_scores ?? {};
  const origReasons = record.original_evaluator_reasons ?? {};
  const optReasons = record.optimized_evaluator_reasons ?? {};
  const keys = Array.from(
    new Set([
      ...Object.keys(origScores),
      ...Object.keys(optScores),
      ...Object.keys(origReasons),
      ...Object.keys(optReasons),
    ]),
  );
  if (!keys.length) {
    return '-';
  }
  return keys.map(key => (
    <div key={key} className="mb-2">
      <Typography.Text strong>{key}</Typography.Text>
      <div className="coz-fg-secondary">
        {I18n.t('prompt_optimization_original_answer')}:{' '}
        {origScores[key] ?? '-'}
        {origReasons[key] ? `（${origReasons[key]}）` : ''}
      </div>
      <div className="coz-fg-secondary">
        {I18n.t('prompt_optimization_optimized_answer')}:{' '}
        {optScores[key] ?? '-'}
        {optReasons[key] ? `（${optReasons[key]}）` : ''}
      </div>
    </div>
  ));
}
