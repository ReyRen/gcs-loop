// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import {
  IconCozCheckMarkCircleFill,
  IconCozLoading,
} from '@coze-arch/coze-design/icons';
import { Progress, Typography } from '@coze-arch/coze-design';

import { ReactComponent as OptimizeIcon } from '../../assets/optimize.svg';

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
export function TerminatedStatus() {
  const progress = 0;

  return (
    <div className="mx-auto flex max-w-[1200px] gap-8 pt-12 pb-12">
      {/* 左侧：实时优化结果 */}
      <div className="flex flex-1 flex-col items-center">
        {/* 顶部 AI 优化图标 */}
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl coz-mg-hglt-secondary">
          <OptimizeIcon className="text-[32px] coz-fg-hglt" />
        </div>

        {/* 主标题 */}
        <Typography.Title heading={4} className="!mb-3 !mt-6">
          优化已取消
        </Typography.Title>

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

        {/* 步骤列表 */}
        <div className="mt-10 w-full max-w-[680px] rounded-lg coz-mg-secondary px-8 py-6">
          {OPTIMIZATION_STEPS.map((step, idx) => (
            <div key={step.id} className="flex">
              {/* 左侧节点 + 连接线 */}
              <div className="flex flex-col items-center">
                <div className="flex h-6 items-center">
                  <StepIcon status="waiting" index={step.id} />
                </div>
                {idx < OPTIMIZATION_STEPS.length - 1 ? (
                  <div className="w-px flex-1 bg-[rgba(75,74,88,.04)]" />
                ) : null}
              </div>

              {/* 右侧内容 */}
              <div className="flex-1 pb-8 pl-4">
                <div className="flex items-center gap-2">
                  <Typography.Text strong>{step.title}</Typography.Text>
                </div>
                <Typography.Text type="secondary" className="mt-1 text-xs">
                  {step.description}
                </Typography.Text>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
