// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @coze-arch/max-line-per-function -- 表格列定义与筛选逻辑集中在组件内 */
/* eslint-disable @typescript-eslint/no-magic-numbers -- 分页与进度渲染中的魔法数字 */
/* eslint-disable security/detect-object-injection -- 状态映射表的静态键查找 */
import { useState } from 'react';

import { useShallow } from 'zustand/react/shallow';
import { debounce } from 'lodash-es';
import { usePagination } from 'ahooks';
import { I18n } from '@cozeloop/i18n-adapter';
import {
  DEFAULT_PAGE_SIZE,
  TableWithPagination,
  TableColActions,
} from '@cozeloop/components';
import type { PromptOptimizeTask } from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi } from '@cozeloop/api-schema';
import { IconCozIllusEmpty } from '@coze-arch/coze-design/illustrations';
import {
  type ColumnProps,
  type SearchProps,
  EmptyState,
  Search,
  Select,
  Tag,
  Typography,
} from '@coze-arch/coze-design';

import { usePromptStore } from '@/store/use-prompt-store';

import { usePromptDevProviderContext } from '../prompt-provider';
import { OptimizationDetailDrawer } from './optimization-detail-drawer';

type TagColor = 'primary' | 'green' | 'red' | 'blue' | 'yellow';

const TASK_STATUS_MAP: Record<string, { label: string; color: TagColor }> = {
  Created: {
    label: I18n.t('prompt_optimization_queued', {}, '等待执行'),
    color: 'primary',
  },
  Running: {
    label: I18n.t('prompt_optimization_running', {}, '优化进行中'),
    color: 'blue',
  },
  Success: {
    label: I18n.t('success'),
    color: 'green',
  },
  Failed: {
    label: I18n.t('failure'),
    color: 'red',
  },
  Terminated: {
    label: I18n.t('prompt_optimization_canceled', {}, '任务已取消'),
    color: 'yellow',
  },
};

const STATUS_FILTER_OPTIONS = [
  {
    label: I18n.t('prompt_optimization_running', {}, '优化进行中'),
    value: 'Running',
  },
  {
    label: I18n.t('success'),
    value: 'Success',
  },
  {
    label: I18n.t('failure'),
    value: 'Failed',
  },
  {
    label: I18n.t('prompt_optimization_queued', {}, '等待执行'),
    value: 'Created',
  },
];

const BALANCE_MODE_MAP: Record<string, string> = {
  EffectFirst: I18n.t('prompt_optimization_effect_first', {}, '效果优先'),
  CostEffectiveFirst: I18n.t(
    'prompt_optimization_cost_effective_first',
    {},
    '成本优先',
  ),
};

function formatScore(v?: number): string {
  if (v === undefined || v === null) {
    return '-';
  }
  return (Math.round(v * 100) / 100).toString();
}

function formatScoreChange(task: PromptOptimizeTask): string {
  const baseline = task.optimize_result?.baseline_metrics?.average_score;
  const best = task.optimize_result?.best_metrics?.average_score;
  if (baseline === undefined && best === undefined) {
    return '-';
  }
  if (baseline === undefined) {
    return formatScore(best);
  }
  return `${formatScore(baseline)} → ${formatScore(best)}`;
}

function formatOptimizeMode(task: PromptOptimizeTask): string {
  const balanceMode = task.optimize_engine_config?.balance_mode ?? '';
  const taskType = task.optimize_engine_config?.optimize_task_type ?? '';
  const modeLabel = BALANCE_MODE_MAP[balanceMode] ?? balanceMode;
  if (taskType && modeLabel) {
    return `${taskType} / ${modeLabel}`;
  }
  return modeLabel || taskType || '-';
}

function formatDataCount(task: PromptOptimizeTask): string {
  const selected = task.optimize_task_data_set?.selected_item_id_list?.length;
  if (selected !== undefined && selected > 0) {
    return String(selected);
  }
  const sampleCount = task.optimize_result?.best_metrics?.sample_count;
  return sampleCount !== undefined ? String(sampleCount) : '-';
}

function formatTime(ts?: string): string {
  if (!ts) {
    return '-';
  }
  const num = Number(ts);
  // created_at 为毫秒级时间戳
  return new Date(Number.isFinite(num) ? num : ts).toLocaleString();
}

export function OptimizationArea() {
  const { spaceID } = usePromptDevProviderContext();
  const { promptInfo } = usePromptStore(
    useShallow(state => ({ promptInfo: state.promptInfo })),
  );
  const promptID = promptInfo?.id;
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>('Success');
  const [visibleTask, setVisibleTask] = useState<PromptOptimizeTask>();

  const service = usePagination(
    ({ current, pageSize }) =>
      StoneEvaluationApi.ListPromptOptimizeTasks({
        workspace_id: spaceID,
        prompt_id: promptID ?? '',
        name: keyword || undefined,
        status: status ? [status] : undefined,
        page_num: current,
        page_size: pageSize,
      })
        .then(res => ({
          list: res.optimize_tasks ?? [],
          total: Number(res.total ?? 0),
        }))
        .catch(() => ({
          list: [],
          total: 0,
        })),
    {
      defaultPageSize: DEFAULT_PAGE_SIZE,
      ready: Boolean(spaceID && promptID),
      refreshDeps: [spaceID, promptID, keyword, status],
    },
  );

  const columns: ColumnProps<PromptOptimizeTask>[] = [
    {
      title: I18n.t('prompt_optimization_task_name'),
      dataIndex: 'task_name',
      key: 'task_name',
      width: 200,
      ellipsis: true,
      render: (_, task) => (
        <Typography.Text strong title={task.task_name}>
          {task.task_name || '-'}
        </Typography.Text>
      ),
    },
    {
      title: I18n.t('status'),
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (_, task) => {
        const taskStatus = task.status ?? '';
        const statusInfo = TASK_STATUS_MAP[taskStatus] ?? {
          label: taskStatus || '-',
          color: 'primary' as TagColor,
        };
        return <Tag color={statusInfo.color}>{statusInfo.label}</Tag>;
      },
    },
    {
      title: I18n.t('prompt_optimization_data_count'),
      dataIndex: 'data_count',
      key: 'data_count',
      width: 100,
      render: (_, task) => formatDataCount(task),
    },
    {
      title: I18n.t('prompt_optimization_mode'),
      dataIndex: 'optimize_mode',
      key: 'optimize_mode',
      width: 180,
      ellipsis: true,
      render: (_, task) => formatOptimizeMode(task),
    },
    {
      title: I18n.t('prompt_optimization_score_change'),
      dataIndex: 'score_change',
      key: 'score_change',
      width: 140,
      render: (_, task) => formatScoreChange(task),
    },
    {
      title: I18n.t('prompt_optimization_eval_set'),
      dataIndex: 'eval_set',
      key: 'eval_set',
      width: 160,
      ellipsis: true,
      render: (_, task) => (
        <Typography.Text
          title={task.optimize_task_data_set?.related_eval_set_name}
        >
          {task.optimize_task_data_set?.related_eval_set_name || '-'}
        </Typography.Text>
      ),
    },
    {
      title: I18n.t('prompt_optimization_expt'),
      dataIndex: 'expt',
      key: 'expt',
      width: 160,
      ellipsis: true,
      render: (_, task) => (
        <Typography.Text title={task.optimize_task_data_set?.related_expt_name}>
          {task.optimize_task_data_set?.related_expt_name || '-'}
        </Typography.Text>
      ),
    },
    {
      title: I18n.t('create_time'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (_, task) => formatTime(task.created_at),
    },
    {
      title: I18n.t('operation'),
      dataIndex: 'operation',
      key: 'operation',
      fixed: 'right',
      width: 150,
      render: (_, task) => {
        const targetId = task.optimize_target?.target_id ?? '';
        const exptId = task.optimize_task_data_set?.related_expt_id ?? '';
        const reportUrl =
          `/console/enterprise/personal/space/${spaceID}` +
          `/pe/prompts/${targetId}/optimization/${task.id}?expt_id=${exptId}`;
        return (
          <TableColActions
            actions={[
              {
                label: I18n.t('detail'),
                onClick: () => setVisibleTask(task),
              },
              {
                label: I18n.t('prompt_optimization_report'),
                onClick: () => {
                  window.location.href = reportUrl;
                },
              },
            ]}
          />
        );
      },
    },
  ];

  const onSearch: SearchProps['onSearch'] = debounce(value => {
    setKeyword((value as string)?.trim() ?? '');
  }, 300);

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6">
      <div className="flex items-center gap-3 pb-3">
        <div className="w-60">
          <Search
            className="box-border !w-full"
            placeholder={I18n.t(
              'prompt_optimization_search_task',
              {},
              '搜索任务名称',
            )}
            onSearch={onSearch}
            showClear
            autoComplete="off"
          />
        </div>
        <Select
          className="box-border w-[220px]"
          placeholder={I18n.t(
            'prompt_optimization_filter_status',
            {},
            '筛选状态',
          )}
          optionList={STATUS_FILTER_OPTIONS}
          value={status}
          onChange={value => setStatus(value as string)}
          showClear
        />
      </div>

      <TableWithPagination<PromptOptimizeTask>
        heightFull
        service={service}
        tableProps={{
          columns,
          sticky: { top: 0 },
          rowKey: 'id',
        }}
        empty={
          keyword ? (
            <EmptyState
              size="full_screen"
              icon={<IconCozIllusEmpty />}
              title={I18n.t('no_results_found')}
              description={I18n.t('try_other_keywords')}
            />
          ) : (
            <EmptyState
              size="full_screen"
              icon={<IconCozIllusEmpty />}
              title={I18n.t('prompt_optimization_no_task', {}, '暂无优化任务')}
              description={I18n.t(
                'prompt_optimization_no_task_desc',
                {},
                '基于评测实验对当前 Prompt 进行自动化优化，优化任务将展示在这里。',
              )}
            />
          )
        }
      />

      <OptimizationDetailDrawer
        spaceID={spaceID}
        promptID={promptID}
        task={visibleTask}
        visible={Boolean(visibleTask)}
        onCancel={() => setVisibleTask(undefined)}
      />
    </div>
  );
}
