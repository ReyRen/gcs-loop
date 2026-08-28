// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import type { PromptDetail, PromptTemplate } from '@cozeloop/api-schema/prompt';
import type {
  PromptOptimizationMetrics,
  PromptOptimizationSampleEvaluation,
  PromptOptimizeTask,
} from '@cozeloop/api-schema/evaluation';

import { SampleDetailSection } from './sample-detail-section';
import { formatScore, renderMessages } from './helpers';
import { buildCompareData } from './compare/build-compare-data';
import { PromptOptimizationCompare } from './compare';

interface SuccessStatusProps {
  task: PromptOptimizeTask;
  sourceDetail?: PromptDetail;
}

export function SuccessStatus({ task, sourceDetail }: SuccessStatusProps) {
  const result = task.optimize_result;
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

  const sampleResults = (bestIteration?.sample_results ??
    []) as PromptOptimizationSampleEvaluation[];

  // 版本对比数据：左侧源版本 vs 右侧智能优化版本
  const sourceVersion = task.optimize_target?.target_version ?? '';
  const sourceMessages =
    (sourceDetail?.prompt_template as PromptTemplate | undefined)?.messages ??
    [];
  const optimizedMessages = result?.optimized_prompt_message_list ?? [];

  const compareData = useMemo(
    () =>
      buildCompareData({
        baseVersion: sourceVersion,
        currentVersion: sourceVersion,
        baseMessages: sourceMessages,
        currentMessages: optimizedMessages,
        currentScore: bestMetrics?.average_score,
        currentScoreLabel: formatScore(bestMetrics?.average_score),
        currentQualityTag: I18n.t('prompt_optimization_quality_good'),
        baseScore: baselineMetrics?.average_score,
        baseScoreLabel: formatScore(baselineMetrics?.average_score),
        baseQualityTag: I18n.t('prompt_optimization_quality_common'),
      }),
    [
      sourceVersion,
      sourceMessages,
      optimizedMessages,
      bestMetrics,
      baselineMetrics,
    ],
  );

  return (
    <>
      {/* 7.2 Prompt 对比 */}
      <div className="mb-6 ">
        {optimizedMessages.length ? (
          <PromptOptimizationCompare data={compareData} />
        ) : (
          renderMessages(sourceMessages)
        )}
      </div>

      {/* 7.3 样本数据详情 */}
      <SampleDetailSection
        sampleResults={sampleResults}
        bestMetrics={bestMetrics}
      />
    </>
  );
}
