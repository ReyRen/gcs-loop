// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/no-magic-numbers */
import { useMemo } from 'react';

import { useShallow } from 'zustand/react/shallow';
import { useRequest } from 'ahooks';
import { I18n } from '@cozeloop/i18n-adapter';
import {
  AggregatorType,
  ExptStatus,
  FieldType,
  FilterLogicOp,
  FilterOperatorType,
  type ExptFilterOption,
} from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi } from '@cozeloop/api-schema';
import { IconCozIllusEmpty } from '@coze-arch/coze-design/illustrations';
import { Button, Empty, Spin, Tag, Typography } from '@coze-arch/coze-design';

import { usePromptStore } from '@/store/use-prompt-store';

import { usePromptDevProviderContext } from '../prompt-provider';

/** 实验状态 -> 展示信息 */
const EXPT_STATUS_MAP: Record<number, { label: string; color: string }> = {
  [ExptStatus.Success]: { label: I18n.t('success'), color: 'green' },
  [ExptStatus.Failed]: { label: I18n.t('failure'), color: 'red' },
  [ExptStatus.Processing]: {
    label: I18n.t('status_running', {}, '执行中'),
    color: 'blue',
  },
  [ExptStatus.Pending]: {
    label: I18n.t('to_be_executed', {}, '待执行'),
    color: 'primary',
  },
  [ExptStatus.Terminated]: { label: I18n.t('terminate'), color: 'yellow' },
  [ExptStatus.Terminating]: { label: I18n.t('terminating'), color: 'yellow' },
};

function formatTime(ts?: string) {
  if (!ts) {
    return '-';
  }
  return new Date(Number(ts) * 1000).toLocaleString();
}

export function EvaluationArea() {
  const { spaceID } = usePromptDevProviderContext();
  const { promptInfo } = usePromptStore(
    useShallow(state => ({ promptInfo: state.promptInfo })),
  );
  const promptID = promptInfo?.id;

  // 按当前 Prompt 过滤评测实验
  const filterOption = useMemo<ExptFilterOption>(
    () => ({
      filters: {
        logic_op: FilterLogicOp.And,
        filter_conditions: [
          {
            field: { field_type: FieldType.SourceTarget },
            operator: FilterOperatorType.Equal,
            value: promptID ?? '',
            source_target: {
              eval_target_type: undefined,
              source_target_ids: promptID ? [promptID] : [],
            },
          },
        ],
      },
    }),
    [promptID],
  );

  const service = useRequest(
    () =>
      StoneEvaluationApi.ListExperiments({
        workspace_id: spaceID,
        page_number: 1,
        page_size: 100,
        filter_option: filterOption,
      }),
    {
      ready: Boolean(spaceID && promptID),
      refreshDeps: [spaceID, promptID, filterOption],
    },
  );

  const experiments = service.data?.experiments ?? [];

  return (
    <div className="flex flex-1 overflow-auto styled-scrollbar">
      <div className="w-full p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Typography.Title heading={5} className="!mb-1">
              {I18n.t('evaluation')}
            </Typography.Title>
            <Typography.Text type="secondary">
              {I18n.t(
                'prompt_evaluation_area_desc',
                {},
                '查看当前 Prompt 相关的评测实验与效果得分。',
              )}
            </Typography.Text>
          </div>
        </div>

        <Spin spinning={service.loading}>
          {experiments.length === 0 ? (
            <Empty
              description={I18n.t('no_data', {}, '暂无评测实验')}
              image={<IconCozIllusEmpty width="160" height="160" />}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {experiments.map(expt => {
                const statusInfo = EXPT_STATUS_MAP[
                  expt.status ?? ExptStatus.Unknown
                ] ?? {
                  label: '-',
                  color: 'primary',
                };
                return (
                  <div
                    key={expt.id}
                    className="flex items-center justify-between rounded-lg border border-solid coz-stroke-primary bg-white p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Typography.Text strong className="!max-w-[300px]">
                          {expt.name || '-'}
                        </Typography.Text>
                        <Tag size="mini" color={statusInfo.color}>
                          {statusInfo.label}
                        </Tag>
                      </div>
                      <div className="mt-1 flex items-center gap-4">
                        <Typography.Text type="secondary" size="small">
                          {I18n.t('version')}:{' '}
                          {expt.eval_target?.eval_target_version
                            ?.source_target_version || '-'}
                        </Typography.Text>
                        <Typography.Text type="secondary" size="small">
                          {I18n.t('score')}: {formatScore(getAvgScore(expt))}
                        </Typography.Text>
                        <Typography.Text type="secondary" size="small">
                          {I18n.t('time', {}, '创建时间')}:{' '}
                          {formatTime(expt.create_time)}
                        </Typography.Text>
                      </div>
                    </div>
                    <Button
                      size="small"
                      color="primary"
                      onClick={() =>
                        window.open(
                          `/evaluation/experiments/${expt.id}`,
                          '_blank',
                        )
                      }
                    >
                      {I18n.t('view_detail', {}, '查看详情')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Spin>
      </div>
    </div>
  );
}

function formatScore(score?: number): string {
  if (score === undefined || score === null) {
    return '-';
  }
  return (Math.round(score * 100) / 100).toString();
}

/** 取实验平均得分 */
function getAvgScore(expt: {
  expt_stats?: {
    evaluator_aggregate_results?: Array<{
      aggregator_results?: Array<{
        aggregator_type: AggregatorType;
        data?: { value?: number };
      }>;
    }>;
  };
}): number | undefined {
  const aggResults = expt.expt_stats?.evaluator_aggregate_results ?? [];
  const values = aggResults
    .flatMap(
      agg =>
        agg.aggregator_results?.filter(
          r => r.aggregator_type === AggregatorType.Average,
        ) ?? [],
    )
    .map(r => r.data?.value)
    .filter((v): v is number => v !== undefined && v !== null);
  if (!values.length) {
    return undefined;
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}
