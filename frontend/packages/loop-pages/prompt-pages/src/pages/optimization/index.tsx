// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable max-lines */
/* eslint-disable @coze-arch/max-line-per-function */
import { useParams, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import { useBreadcrumb } from '@cozeloop/hooks';
import { PageLoading } from '@cozeloop/components';
import { useNavigateModule, useSpace } from '@cozeloop/biz-hooks-adapter';
import { type Message, type PromptTemplate } from '@cozeloop/api-schema/prompt';
import {
  PromptOptimizationStage,
  PromptOptimizationStatus,
  type PromptOptimizationMetrics,
  type PromptOptimizationSampleEvaluation,
  type PromptOptimizationTask,
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
  const { optimizationID } = useParams<{
    promptID: string;
    optimizationID: string;
  }>();
  const [searchParams] = useSearchParams();
  const { spaceID } = useSpace();
  const navigate = useNavigateModule();

  const [task, setTask] = useState<PromptOptimizationTask>();
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [applyingToDraft, setApplyingToDraft] = useState(false);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [overwriteVisible, setOverwriteVisible] = useState(false);

  const timeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(1);
  const visibilityRef = useRef(true);

  const exptId = searchParams.get('expt_id') ?? task?.experiment_id ?? '';

  useBreadcrumb({
    text: task?.name || I18n.t('prompt_optimization_title'),
  });

  const loadFullResult = useCallback(async () => {
    try {
      const res = await StoneEvaluationApi.GetPromptOptimization({
        workspace_id: spaceID,
        expt_id: exptId,
        optimization_id: optimizationID ?? '',
        with_iterations: true,
        with_sample_results: true,
      });
      if (res.task) {
        setTask(res.task);
      }
    } catch (e) {
      console.error('Load prompt optimization result failed:', e);
    }
  }, [spaceID, exptId, optimizationID]);

  const pollOnce = useCallback(async () => {
    if (!spaceID || !exptId || !optimizationID) {
      return;
    }
    try {
      const res = await StoneEvaluationApi.GetPromptOptimization({
        workspace_id: spaceID,
        expt_id: exptId,
        optimization_id: optimizationID,
        with_iterations: true,
        with_sample_results: false,
      });
      backoffRef.current = 1;
      setLoading(false);
      const t = res.task;
      if (!t) {
        return;
      }
      setTask(t);
      if (t.status === PromptOptimizationStatus.Succeeded) {
        // 终态后拉取一次完整样本数据
        void loadFullResult();
        return;
      }
      if (
        t.status === PromptOptimizationStatus.Queued ||
        t.status === PromptOptimizationStatus.Running
      ) {
        timeoutRef.current = window.setTimeout(pollOnce, 2000);
      }
    } catch (e) {
      console.error('Poll prompt optimization failed:', e);
      const delay = Math.min(30000, 2000 * backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, 15);
      timeoutRef.current = window.setTimeout(pollOnce, delay);
    }
  }, [spaceID, exptId, optimizationID, loadFullResult]);

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

  const handleCancel = async () => {
    if (!spaceID || !exptId || !optimizationID) {
      return;
    }
    setCanceling(true);
    try {
      const res = await StoneEvaluationApi.CancelPromptOptimization({
        workspace_id: spaceID,
        expt_id: exptId,
        optimization_id: optimizationID,
      });
      // 以响应中的 task.status 覆盖本地状态
      if (res.task) {
        setTask(res.task);
      }
      setCancelVisible(false);
    } catch (e) {
      console.error('Cancel prompt optimization failed:', e);
    } finally {
      setCanceling(false);
    }
  };

  const handleSubmitNewVersion = async () => {
    if (!spaceID || !exptId || !optimizationID || !task?.prompt_id) {
      return;
    }
    setApplyingToDraft(true);
    try {
      // 8.1 检查当前草稿
      const promptRes = await StonePromptApi.GetPrompt({
        prompt_id: task.prompt_id,
        workspace_id: spaceID,
        with_draft: true,
        with_commit: true,
      });
      if (promptRes.prompt?.prompt_draft) {
        setOverwriteVisible(true);
        setApplyingToDraft(false);
        return;
      }
      await applyToDraft(false);
    } catch (e) {
      console.error('Check draft failed:', e);
      setApplyingToDraft(false);
    }
  };

  const recheckDraftOnApplyError = async () => {
    if (!task?.prompt_id) {
      return;
    }
    try {
      const promptRes = await StonePromptApi.GetPrompt({
        prompt_id: task.prompt_id,
        workspace_id: spaceID,
        with_draft: true,
        with_commit: true,
      });
      if (promptRes.prompt?.prompt_draft) {
        setOverwriteVisible(true);
      }
    } catch (err) {
      console.error('Recheck draft failed:', err);
    }
  };

  const applyToDraft = async (overwrite: boolean) => {
    if (!spaceID || !exptId || !optimizationID) {
      return;
    }
    setApplyingToDraft(true);
    try {
      const res = await StoneEvaluationApi.ApplyPromptOptimizationToDraft({
        workspace_id: spaceID,
        expt_id: exptId,
        optimization_id: optimizationID,
        overwrite_existing_draft: overwrite,
      });
      setOverwriteVisible(false);
      // 8.3 跳转 Prompt 编辑器，不显示「发布成功」
      navigate(`pe/prompts/${res.prompt_id ?? task?.prompt_id}`);
    } catch (e) {
      console.error('Apply to draft failed:', e);
      // 8.2：检查草稿后到写入前，另一标签页可能已新建草稿，首次写请求会返回非零业务错误。
      // 此时重新读取 Prompt 并让用户确认，禁止静默把 overwrite_existing_draft 改为 true。
      if (!overwrite) {
        const code = (e as { code?: number | string })?.code;
        if (code !== undefined && code !== 0) {
          await recheckDraftOnApplyError();
        }
      }
    } finally {
      setApplyingToDraft(false);
    }
  };

  const bestMetrics: PromptOptimizationMetrics | undefined = task?.best_metrics;
  const baselineMetrics: PromptOptimizationMetrics | undefined =
    task?.baseline_metrics;

  const bestIteration = useMemo(() => {
    const iterations = task?.iterations ?? [];
    if (!iterations.length) {
      return undefined;
    }
    return [...iterations].sort(
      (a, b) =>
        (b.metrics?.average_score ?? -Infinity) -
        (a.metrics?.average_score ?? -Infinity),
    )[0];
  }, [task?.iterations]);

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
            <Typography.Title level={4} className="!mb-1">
              {task?.name || I18n.t('prompt_optimization_title')}
            </Typography.Title>
            <Typography.Text className="coz-fg-secondary">
              {I18n.t('prompt_optimization_source_version')}:{' '}
              {task?.source_prompt_version ?? '-'}
            </Typography.Text>
          </div>
          {status === PromptOptimizationStatus.Failed ? (
            <Button
              onClick={() => navigate(`evaluation/experiments/${exptId}`)}
            >
              {I18n.t('prompt_optimization_back_to_experiment')}
            </Button>
          ) : null}
        </div>

        {/* 运行中 / 排队中 */}
        {status === PromptOptimizationStatus.Queued ||
        status === PromptOptimizationStatus.Running ? (
          <div className="rounded border border-solid coz-stroke-primary p-6">
            <div className="mb-4 flex items-center gap-2">
              <Spin size="small" />
              <Typography.Text strong>
                {status === PromptOptimizationStatus.Queued
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
                value={`${task?.iterations?.length ?? 0}`}
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

            <div className="mt-6">
              <Button
                loading={canceling}
                onClick={() => setCancelVisible(true)}
              >
                {I18n.t('prompt_optimization_cancel')}
              </Button>
            </div>
          </div>
        ) : null}

        {/* 失败 */}
        {status === PromptOptimizationStatus.Failed ? (
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

        {/* 已取消 */}
        {status === PromptOptimizationStatus.Canceled ? (
          <div className="rounded border border-solid coz-stroke-primary p-6">
            <Typography.Text className="coz-fg-secondary">
              {I18n.t('prompt_optimization_canceled')}
            </Typography.Text>
          </div>
        ) : null}

        {/* 结果 */}
        {status === PromptOptimizationStatus.Succeeded ? (
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
              <Typography.Title level={5}>
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
              {task.optimized_prompt_template
                ? renderDiffMessages(
                    (
                      task.original_prompt_template as
                        | PromptTemplate
                        | undefined
                    )?.messages ?? [],
                    task.optimized_prompt_template.messages ?? [],
                  )
                : renderMessages(
                    (
                      task.original_prompt_template as
                        | PromptTemplate
                        | undefined
                    )?.messages ?? [],
                  )}
            </div>

            {/* 7.3 样本对比表 */}
            <div className="mb-6 rounded border border-solid coz-stroke-primary p-6">
              <Typography.Title level={5}>
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
                onClick={handleSubmitNewVersion}
              >
                {I18n.t('prompt_optimization_submit_new_version')}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {/* 取消确认框 */}
      <Modal
        visible={cancelVisible}
        title={I18n.t('prompt_optimization_cancel')}
        okText={I18n.t('confirm')}
        cancelText={I18n.t('cancel')}
        onCancel={() => setCancelVisible(false)}
        onOk={handleCancel}
        confirmLoading={canceling}
      >
        <Typography.Text>
          {I18n.t('prompt_optimization_cancel_confirm')}
        </Typography.Text>
      </Modal>

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
