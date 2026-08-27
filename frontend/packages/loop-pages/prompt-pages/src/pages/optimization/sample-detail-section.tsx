// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import { LoopTabs } from '@cozeloop/components';
import type {
  PromptOptimizationMetrics,
  PromptOptimizationSampleEvaluation,
} from '@cozeloop/api-schema/evaluation';
import { Tabs, Tag, Typography } from '@coze-arch/coze-design';

import { ReactComponent as UnchangedIcon } from '../../assets/unchanged.svg';
import { ReactComponent as SampleCountIcon } from '../../assets/sample-count.svg';
import { ReactComponent as RegressedIcon } from '../../assets/regressed.svg';
import { ReactComponent as ImprovedIcon } from '../../assets/improved.svg';
import {
  EvaluatorScoreTable,
  MetricItem,
  SampleComparisonTable,
} from './helpers';

/** 样本数据筛选维度 */
type SampleFilterKey = 'sample_count' | 'improved' | 'regressed' | 'unchanged';

/** 数据详情 tab */
type SampleDetailTabKey = 'overall' | 'evaluator';

interface SampleDetailSectionProps {
  /** 最优迭代的样本评估结果 */
  sampleResults: PromptOptimizationSampleEvaluation[];
  /** 最优迭代的汇总指标 */
  bestMetrics?: PromptOptimizationMetrics;
}

/**
 * 样本数据详情区：
 * - 顶部四个可点击指标卡片（全部/提升/回退/不变），默认选中「全部」
 * - 点击切换下方样本对比表的数据筛选
 */
export function SampleDetailSection({
  sampleResults,
  bestMetrics,
}: SampleDetailSectionProps) {
  const [sampleFilter, setSampleFilter] =
    useState<SampleFilterKey>('sample_count');
  const [activeTab, setActiveTab] = useState<SampleDetailTabKey>('overall');

  const filteredSampleResults = useMemo(() => {
    if (sampleFilter === 'sample_count') {
      return sampleResults;
    }
    console.log('sampleResults', sampleResults);
    return sampleResults.filter(item => {
      const delta = (item.optimized_score ?? 0) - (item.original_score ?? 0);
      if (sampleFilter === 'improved') {
        return delta > 0;
      }
      if (sampleFilter === 'regressed') {
        return delta < 0;
      }
      return delta === 0;
    });
  }, [sampleResults, sampleFilter]);

  const metricCards: {
    key: SampleFilterKey;
    label: string;
    value?: number;
    icon: ReactNode;
    iconColor: string;
    iconBackground: string;
  }[] = [
    {
      key: 'sample_count',
      label: I18n.t('prompt_optimization_sample_count'),
      value: bestMetrics?.sample_count,
      icon: <SampleCountIcon />,
      iconColor: 'rgb(255, 115, 0)',
      iconBackground: 'rgba(240, 174, 120, 0.3)',
    },
    {
      key: 'improved',
      label: I18n.t('prompt_optimization_improved_count'),
      value: bestMetrics?.improved_count,
      icon: <ImprovedIcon />,
      iconColor: 'rgb(0, 178, 60)',
      iconBackground: 'rgba(116, 212, 149, 0.23)',
    },
    {
      key: 'regressed',
      label: I18n.t('prompt_optimization_regressed_count'),
      value: bestMetrics?.regressed_count,
      icon: <RegressedIcon />,
      iconColor: 'rgb(229, 50, 65)',
      iconBackground: 'rgba(255, 173, 180, 0.23)',
    },
    {
      key: 'unchanged',
      label: I18n.t('prompt_optimization_unchanged_count'),
      value: bestMetrics?.unchanged_count,
      icon: <UnchangedIcon />,
      iconColor: 'rgb(66, 70, 78)',
      iconBackground: 'rgb(240, 240, 247)',
    },
  ];

  return (
    <>
      <div className="mb-4">
        <Typography.Title heading={5}>
          {I18n.t('prompt_optimization_data_details')}
        </Typography.Title>
      </div>
      <LoopTabs
        type="card"
        activeKey={activeTab}
        onChange={key => setActiveTab(key as SampleDetailTabKey)}
      >
        {/* 综合得分 */}
        <Tabs.TabPane
          tab={I18n.t('prompt_optimization_overall_score')}
          itemKey="overall"
        >
          <div className="mb-2 mt-2 grid grid-cols-4 gap-x-3">
            {metricCards.map(card => (
              <MetricItem
                key={card.key}
                label={card.label}
                value={card.value}
                icon={card.icon}
                iconColor={card.iconColor}
                iconBackground={card.iconBackground}
                selected={sampleFilter === card.key}
                onClick={() => setSampleFilter(card.key)}
              />
            ))}
          </div>

          {!filteredSampleResults.length ? (
            <div className="mb-4">
              <Tag>{I18n.t('prompt_optimization_no_better_candidate')}</Tag>
            </div>
          ) : null}
          <SampleComparisonTable data={filteredSampleResults} />
        </Tabs.TabPane>

        {/* 评估器得分 */}
        <Tabs.TabPane
          tab={I18n.t('prompt_optimization_evaluator_score')}
          itemKey="evaluator"
        >
          <EvaluatorScoreTable data={sampleResults} />
        </Tabs.TabPane>
      </LoopTabs>
    </>
  );
}
