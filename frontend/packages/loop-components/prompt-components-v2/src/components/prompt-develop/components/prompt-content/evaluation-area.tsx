// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useCallback } from 'react';

import { useShallow } from 'zustand/react/shallow';
import { I18n } from '@cozeloop/i18n-adapter';
import {
  ExperimentNameSearch,
  ExperimentStatusSelect,
  ExperimentEvaluatorLogicFilter,
  ExperimentListEmptyState,
  ColumnsManage,
  RefreshButton,
  useExperimentListStore,
  type SemiTableSort,
} from '@cozeloop/evaluate-components';
import { TableWithPagination } from '@cozeloop/components';
import { useNavigateModule } from '@cozeloop/biz-hooks-adapter';
import {
  type ExptStatus,
  type Experiment,
  type ListExperimentsRequest,
  type ListExperimentsResponse,
  FieldType,
  FilterLogicOp,
  FilterOperatorType,
  EvalTargetType,
} from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi } from '@cozeloop/api-schema';
import { IconCozPlus } from '@coze-arch/coze-design/icons';
import { Button } from '@coze-arch/coze-design';

import { usePromptStore } from '@/store/use-prompt-store';

interface Filter {
  name?: string;
  status?: ExptStatus[];
}

const filterFields: { key: keyof Filter; type: FieldType }[] = [
  {
    key: 'status',
    type: FieldType.ExptStatus,
  },
];

const columnsOptions = {
  enableSort: true,
  enableIdColumn: false,
  columnManageStorageKey: 'prompt_evaluation_area_column_manage',
};

// eslint-disable-next-line @coze-arch/max-line-per-function -- 评测实验列表功能集中于此，代码行数超限
export function EvaluationArea() {
  const navigateModule = useNavigateModule();
  const { promptInfo } = usePromptStore(
    useShallow(state => ({ promptInfo: state.promptInfo })),
  );
  const promptID = promptInfo?.id;

  // 拉取实验列表时，默认按当前 Prompt 的 id 追加过滤条件
  const pullExperiments = useCallback(
    (req: ListExperimentsRequest): Promise<ListExperimentsResponse> => {
      if (!promptID) {
        return StoneEvaluationApi.ListExperiments(req);
      }
      const promptCondition = {
        field: { field_type: FieldType.SourceTarget, field_key: 'eval_target' },
        operator: FilterOperatorType.In,
        value: '',
        source_target: {
          eval_target_type: EvalTargetType.CozeLoopPrompt,
          source_target_ids: [promptID],
        },
      };
      const reqWithPromptFilter: ListExperimentsRequest = {
        ...req,
        filter_option: {
          ...(req.filter_option ?? {}),
          filters: {
            logic_op: req.filter_option?.filters?.logic_op ?? FilterLogicOp.And,
            filter_conditions: [
              ...(req.filter_option?.filters?.filter_conditions ?? []),
              promptCondition,
            ],
          },
        },
      };
      return StoneEvaluationApi.ListExperiments(reqWithPromptFilter);
    },
    [promptID],
  );

  const {
    service,
    columns,
    defaultColumns,
    setColumns,
    filter,
    setFilter,
    logicFilter,
    hasFilterCondition,
    onSortChange,
    onFilterDebounceChange,
    onLogicFilterChange,
  } = useExperimentListStore<Filter>({
    filterFields,
    columnsOptions,
    pullExperiments,
    pageSizeStorageKey: 'prompt_evaluation_area_page_size',
    source: 'prompt_evaluation_area',
  });

  const filters = (
    <>
      <ExperimentNameSearch
        value={filter?.name}
        onChange={val => {
          setFilter(old => ({ ...old, name: val }));
          onFilterDebounceChange();
        }}
      />

      <ExperimentStatusSelect
        value={filter?.status}
        onChange={val => {
          setFilter(old => ({ ...old, status: val as ExptStatus[] }));
          onFilterDebounceChange();
        }}
      />

      <ExperimentEvaluatorLogicFilter
        value={logicFilter}
        onChange={onLogicFilterChange}
      />
    </>
  );

  const actions = (
    <>
      <RefreshButton onRefresh={service.refresh} />
      <ColumnsManage
        columns={columns}
        defaultColumns={defaultColumns}
        storageKey={columnsOptions.columnManageStorageKey}
        onColumnsChange={setColumns}
      />
      <Button
        icon={<IconCozPlus />}
        onClick={() => {
          navigateModule('evaluation/experiments/create');
        }}
      >
        {I18n.t('new_experiment')}
      </Button>
    </>
  );

  const tableOnRowClick = useCallback(
    (record: Experiment) => {
      // 如果当前有选中的文本，不触发点击事件
      if (!window.getSelection()?.isCollapsed) {
        return;
      }
      navigateModule(`evaluation/experiments/${record.id}`);
    },
    [navigateModule],
  );

  const tableOnChange = useCallback(
    changeInfo => {
      if (changeInfo.extra?.changeType === 'sorter' && changeInfo.sorter?.key) {
        onSortChange(changeInfo.sorter as SemiTableSort);
      }
    },
    [onSortChange],
  );

  const tableHeader = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 grow">{filters}</div>
      <div className="flex items-center gap-2 ml-auto">{actions}</div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="w-full h-full p-6">
        <TableWithPagination<Experiment>
          service={service}
          heightFull
          header={tableHeader}
          showSizeChanger={false}
          pageSizeStorageKey="prompt_evaluation_area_page_size"
          tableProps={{
            rowKey: 'id',
            columns,
            onRow: (record: Experiment) => ({
              onClick: () => tableOnRowClick(record),
            }),
            onChange: tableOnChange,
            empty: (
              <ExperimentListEmptyState
                hasFilterCondition={hasFilterCondition}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
