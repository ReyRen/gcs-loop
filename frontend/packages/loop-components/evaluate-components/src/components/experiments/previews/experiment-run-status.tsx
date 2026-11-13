// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import {
  type Experiment,
  ExptStatus,
  ExptType,
} from '@cozeloop/api-schema/evaluation';
import { Divider, Popover, Tag, type TagProps } from '@coze-arch/coze-design';

import {
  type ExperimentRunStatusInfo,
  experimentRunStatusInfoList,
  experimentPartialFailureStatusInfo,
} from '../../../constants/experiment-status';

const statusMap = experimentRunStatusInfoList.reduce(
  (prev, item) => ({ ...prev, [item.status]: item }),
  {} as unknown as Record<string | number, ExperimentRunStatusInfo>,
);

/**
 * 已完成（部分失败）：任务已结束（status 仍为 Failed），
 * 但同时存在成功样本与失败样本，且没有待执行、执行中或终止的样本。
 */
export function isPartialFailedExperiment(experiment?: Experiment): boolean {
  const stats = experiment?.expt_stats;
  const isOfflineFailed =
    experiment?.status === ExptStatus.Failed &&
    experiment.expt_type !== ExptType.Online;
  if (!isOfflineFailed || !stats) {
    return false;
  }
  const statCount = (value?: string) => Number(value ?? 0);
  const success = statCount(stats.success_turn_cnt);
  const failed = statCount(stats.fail_turn_cnt);
  const total = statCount(experiment.total_item_count);
  const unfinished =
    statCount(stats.pending_turn_cnt) +
    statCount(stats.processing_turn_cnt) +
    statCount(stats.terminated_turn_cnt);
  // total_item_count 可能缺省，此时只依赖五项计数判断
  const countMatched = total <= 0 || success + failed === total;
  return success > 0 && failed > 0 && unfinished === 0 && countMatched;
}

/** 实验运行状态标签 */
// eslint-disable-next-line complexity
export function ExperimentRunStatus({
  status,
  showIcon = true,
  experiment,
  enableOnClick = true,
  showProcess,
  ...rest
}: {
  status: ExptStatus | undefined;
  showIcon?: boolean;
  experiment?: Experiment | undefined;
  enableOnClick?: boolean; // 是否显示执行进度
  showProcess?: boolean;
} & TagProps) {
  const processing = status === ExptStatus.Processing;
  const partialFailure = isPartialFailedExperiment(experiment);
  const baseStatusInfo = statusMap[status ?? ''];
  const statusInfo =
    partialFailure && baseStatusInfo
      ? experimentPartialFailureStatusInfo
      : baseStatusInfo;
  const showProcessDetail = processing || partialFailure;
  if (statusInfo) {
    const tagContent = (
      <Tag
        size="small"
        color={statusInfo.tagColor}
        prefixIcon={showIcon ? statusInfo.icon : null}
        onClick={enableOnClick ? e => e.stopPropagation() : undefined}
        {...rest}
      >
        <span
          className={
            showProcess && showProcessDetail
              ? 'underline decoration-dotted underline-offset-2 decoration-[var(rgb(var(--coze-blue-50)))]'
              : ''
          }
        >
          {statusInfo.name}
        </span>
      </Tag>
    );

    if (showProcess && showProcessDetail && experiment) {
      const {
        success_turn_cnt,
        fail_turn_cnt,
        pending_turn_cnt,
        processing_turn_cnt,
        terminated_turn_cnt,
      } = experiment?.expt_stats ?? {};
      const totalCount =
        Number(pending_turn_cnt) +
        Number(success_turn_cnt) +
        Number(fail_turn_cnt) +
        Number(processing_turn_cnt) +
        Number(terminated_turn_cnt);
      return (
        <Popover
          stopPropagation
          position="top"
          content={
            <div className="px-2 py-1">
              <div>
                {I18n.t('total_number')} {totalCount || 0}
              </div>
              <div>
                {I18n.t('success')} {success_turn_cnt}
                <Divider
                  layout="vertical"
                  style={{ marginLeft: 8, marginRight: 8, height: 12 }}
                />
                {I18n.t('failure')} {fail_turn_cnt}
                <Divider
                  layout="vertical"
                  style={{ marginLeft: 8, marginRight: 8, height: 12 }}
                />
                {terminated_turn_cnt ? (
                  <>
                    {I18n.t('abort')} {terminated_turn_cnt}
                    <Divider
                      layout="vertical"
                      style={{ marginLeft: 8, marginRight: 8, height: 12 }}
                    />
                  </>
                ) : null}
                {processing_turn_cnt ? (
                  <>
                    {I18n.t('status_running')} {processing_turn_cnt}
                    <Divider
                      layout="vertical"
                      style={{ marginLeft: 8, marginRight: 8, height: 12 }}
                    />
                  </>
                ) : null}
                {I18n.t('to_be_executed')} {pending_turn_cnt}
              </div>
            </div>
          }
        >
          {tagContent}
        </Popover>
      );
    }
    return tagContent;
  }
  return '-';
}
