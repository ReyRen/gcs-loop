// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import type { PromptOptimizeTask } from '@cozeloop/api-schema/evaluation';
import {
  IconCozAiFill,
  IconCozCheckMarkCircleFill,
  IconCozCross,
  IconCozLoading,
} from '@coze-arch/coze-design/icons';
import {
  Button,
  Divider,
  Modal,
  Progress,
  Typography,
} from '@coze-arch/coze-design';

import { formatScore, renderMessages } from './helpers';

type StepStatus = 'completed' | 'processing' | 'waiting';

/** 接口返回的优化任务阶段（首字母大写） */
type OptimizationStage =
  | 'Preparing'
  | 'Analyzing'
  | 'Optimizing'
  | 'Evaluating'
  | 'Finalizing'
  | 'Completed';

interface OptimizationStep {
  id: number;
  title: string;
  extra?: string;
  description: string;
  /** 该步骤对应的后端 stage（多个 stage 归属同一步骤） */
  stages: OptimizationStage[];
}

/** 优化流程步骤：stages 为每个步骤对应的后端阶段 */
const OPTIMIZATION_STEPS: OptimizationStep[] = [
  {
    id: 1,
    title: '数据准备与分析',
    description:
      '准备当前版本的 Prompt、变量、回答，根据评分和评分理由分析回答效果',
    stages: ['Preparing', 'Analyzing'],
  },
  {
    id: 2,
    title: '确定评分标准',
    description: '评分标准用于大模型自动优化 Prompt',
    stages: ['Optimizing', 'Evaluating'],
  },
  {
    id: 3,
    title: '生成新的 Prompt',
    extra: '实时优化结果',
    description:
      '大模型优化生成新的 Prompt，根据测试数据生成新的回答并自动评分',
    stages: ['Finalizing'],
  },
  {
    id: 4,
    title: '查看优化结果',
    description: '查看和对比大模型优化后的 Prompt、回答和评分',
    stages: ['Completed'],
  },
];

/** 根据当前 stage 计算每个步骤的状态 */
function resolveStepStatus(
  step: OptimizationStep,
  currentStage: string | undefined,
): StepStatus {
  const stepIndex = OPTIMIZATION_STEPS.findIndex(s => s.id === step.id);
  const currentIndex = OPTIMIZATION_STEPS.findIndex(s =>
    s.stages.includes(currentStage as OptimizationStage),
  );
  // 未匹配到 stage 时（如任务刚创建），视为第一步进行中
  const activeIndex = currentIndex === -1 ? 0 : currentIndex;
  if (stepIndex < activeIndex) {
    return 'completed';
  }
  if (stepIndex === activeIndex) {
    return 'processing';
  }
  return 'waiting';
}

/** 构建实时指标列表 */
function buildRealtimeMetrics(
  task: PromptOptimizeTask,
): { label: string; value: string }[] {
  const result = task.optimize_result;
  const best = result?.best_metrics;
  const baseline = result?.baseline_metrics;
  const total = best?.sample_count ?? 0;
  return [
    {
      label: '满分回答数',
      value: `${best?.full_score_count ?? 0}/${total}`,
    },
    {
      label: '评分上升回答数',
      value: `${best?.improved_count ?? 0}/${total}`,
    },
    {
      label: '评分下降回答数',
      value: `${best?.regressed_count ?? 0}/${total}`,
    },
    {
      label: '模型回答评分',
      value: `${formatScore(baseline?.average_score)} -> ${formatScore(best?.average_score)}`,
    },
  ];
}

/** 「生成新的 Prompt」步骤 id，到达该步骤即展示实时优化结果 */
const REALTIME_RESULT_STEP_ID = 3;

/** 判断当前阶段是否已进入「生成新的 Prompt」（可展示实时优化结果） */
function isRealtimeResultStage(stage: string | undefined): boolean {
  const currentIndex = OPTIMIZATION_STEPS.findIndex(s =>
    s.stages.includes(stage as OptimizationStage),
  );
  // 到达「生成新的 Prompt」及之后即展示
  return (
    currentIndex >=
    OPTIMIZATION_STEPS.findIndex(s => s.id === REALTIME_RESULT_STEP_ID)
  );
}

/** 实时优化结果面板：展示最新 Prompt 与实时指标 */
function RealtimeResultPanel({
  task,
  onClose,
}: {
  task: PromptOptimizeTask;
  onClose?: () => void;
}) {
  const result = task.optimize_result;
  const messages = result?.optimized_prompt_message_list;
  const metrics = buildRealtimeMetrics(task);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Typography.Title heading={5} className="!mb-0">
          实时优化结果
        </Typography.Title>
        {onClose ? (
          <IconCozCross
            className="cursor-pointer text-base coz-fg-secondary"
            onClick={onClose}
          />
        ) : null}
      </div>

      {/* Prompt 块 */}
      <section>
        <Typography.Title heading={6} className="!mb-2">
          Prompt
        </Typography.Title>
        {renderMessages(messages)}
      </section>

      <Divider className="!my-0" />

      {/* 指标块 */}
      <section className="grid grid-cols-2 gap-3">
        {metrics.map(item => (
          <div
            key={item.label}
            className="flex flex-col items-center gap-1 rounded-lg coz-mg-secondary py-4"
          >
            <Typography.Text type="secondary" className="text-xs">
              {item.label}
            </Typography.Text>
            <Typography.Text strong className="text-sm">
              {item.value}
            </Typography.Text>
          </div>
        ))}
      </section>
    </div>
  );
}

/** 单个步骤节点图标 */
function StepIcon({ status, index }: { status: StepStatus; index: number }) {
  if (status === 'completed') {
    return <IconCozCheckMarkCircleFill className="text-[20px] coz-fg-hglt" />;
  }
  if (status === 'processing') {
    return (
      <IconCozLoading className="text-[20px] animate-spin coz-fg-hglt" spin />
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-solid coz-stroke-primary text-xs coz-fg-secondary">
      {index}
    </span>
  );
}

export function RunningStatus({
  task,
  onTerminate,
}: {
  task: PromptOptimizeTask;
  onTerminate?: () => void;
}) {
  /* eslint-disable-next-line @typescript-eslint/no-magic-numbers -- 进度值限定在 0-100 之间 */
  const progress = Math.min(100, Math.max(0, task.progress ?? 0));
  const [terminateVisible, setTerminateVisible] = useState(false);
  // 到达「生成新的 Prompt」阶段默认展示实时优化结果，支持关闭后点击重新打开
  const [resultVisible, setResultVisible] = useState(
    isRealtimeResultStage(task.stage),
  );

  return (
    <div className="mx-auto flex max-w-[1200px] gap-8 pt-12 pb-12">
      {/* 左侧：实时优化结果 */}
      <div className="flex flex-1 flex-col items-center">
        {/* 顶部 AI 优化图标 */}
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl coz-mg-hglt-secondary">
          <IconCozAiFill className="text-[32px] coz-fg-hglt" />
        </div>

        {/* 主标题 */}
        <Typography.Title heading={4} className="!mb-3 !mt-6">
          {I18n.t('prompt_optimization_running')}...
        </Typography.Title>

        {/* 说明文字 */}
        <div className="flex flex-col items-center text-center coz-fg-secondary">
          <Typography.Text type="secondary">
            大模型正在学习已有数据（回答、评分和评分原因），完成后你将获得：
          </Typography.Text>
          <Typography.Text type="secondary">
            1. 智能优化后的 Prompt；2. 使用新 Prompt 生成的回答与评分
          </Typography.Text>
        </div>

        {/* 进度条 */}
        <div className="mt-10 flex w-full items-center gap-3">
          <Progress
            percent={progress}
            showInfo={false}
            size="small"
            className="flex-1"
          />
          <Typography.Text className="w-12 shrink-0 text-right">
            {progress}%
          </Typography.Text>
        </div>

        {/* 当前优化提示 */}
        <Typography.Text type="secondary" className="mt-3">
          模型正在努力优化中，预计需要等待 10-30 分钟
        </Typography.Text>

        {/* 步骤列表 */}
        <div className="mt-10 w-full max-w-[680px] rounded-lg coz-mg-secondary px-8 py-6">
          {OPTIMIZATION_STEPS.map((step, idx) => {
            const stepStatus = resolveStepStatus(step, task.stage);
            return (
              <div key={step.id} className="flex">
                {/* 左侧节点 + 连接线 */}
                <div className="flex flex-col items-center">
                  <div className="flex h-6 items-center">
                    <StepIcon status={stepStatus} index={step.id} />
                  </div>
                  {idx < OPTIMIZATION_STEPS.length - 1 ? (
                    <div
                      className={`w-px flex-1 ${
                        stepStatus === 'completed'
                          ? 'bg-[rgba(82,100,154)]'
                          : 'bg-[rgba(75,74,88,.04)]'
                      }`}
                    />
                  ) : null}
                </div>

                {/* 右侧内容 */}
                <div className="flex-1 pb-8 pl-4">
                  <div className="flex items-center gap-2">
                    <Typography.Text strong>{step.title}</Typography.Text>
                    {step.extra && stepStatus === 'processing' ? (
                      <span
                        className="text-[12px] cursor-pointer text-[rgb(0,82,217)]"
                        onClick={() => setResultVisible(true)}
                      >
                        {step.extra}
                      </span>
                    ) : null}
                  </div>
                  <Typography.Text type="secondary" className="mt-1 text-xs">
                    {step.description}
                  </Typography.Text>
                </div>
              </div>
            );
          })}
        </div>

        {/* 终止优化 */}
        <Button
          type="tertiary"
          className="mt-8 !px-6"
          onClick={() => setTerminateVisible(true)}
        >
          {I18n.t('prompt_optimization_cancel')}
        </Button>

        {/* 终止确认弹窗 */}
        <Modal
          visible={terminateVisible}
          title={I18n.t('prompt_optimization_cancel')}
          okText={I18n.t('confirm')}
          cancelText={I18n.t('cancel')}
          onCancel={() => setTerminateVisible(false)}
          onOk={() => {
            setTerminateVisible(false);
            onTerminate?.();
          }}
        >
          <Typography.Text>
            {I18n.t('prompt_optimization_cancel_confirm')}
          </Typography.Text>
        </Modal>
      </div>
      {/* 右侧：优化流程内容 */}
      {resultVisible ? (
        <div className="w-[400px] shrink-0">
          <RealtimeResultPanel
            task={task}
            onClose={() => setResultVisible(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
