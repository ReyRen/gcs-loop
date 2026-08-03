// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';

import dayjs from 'dayjs';
import { type Result } from 'ahooks/lib/useRequest/src/types';
import { I18n } from '@cozeloop/i18n-adapter';
import { GuardPoint, Guard } from '@cozeloop/guard';
import { CozeUser } from '@cozeloop/evaluate-components';
import { EditIconButton } from '@cozeloop/components';
import { RouteBackAction } from '@cozeloop/base-with-adapter-components';
import {
  type EvaluatorVersion,
  type Evaluator,
} from '@cozeloop/api-schema/evaluation';
import { IconCozLoading } from '@coze-arch/coze-design/icons';
import { Button, Tag, Typography } from '@coze-arch/coze-design';

import {
  DebugButton,
  type DebugButtonProps,
} from '../evaluator-create/debug-button';
import { type BaseInfo, BaseInfoModal } from './base-info-modal';

interface HeaderProps {
  evaluator?: Evaluator;
  selectedVersion?: EvaluatorVersion;
  autoSaveService: Result<
    | {
        lastSaveTime: string | undefined;
      }
    | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >;
  onChangeBaseInfo: (values: BaseInfo) => void;
  onOpenVersionList: () => void;
  onSubmitVersion: () => void;
  customDebugButton?: React.ReactNode;
  debugButtonProps?: DebugButtonProps;
}

const DIVIDER = (
  <div className="mx-3 h-3 w-0 border-0 border-l border-solid coz-stroke-primary" />
);
const TAG_STYLE = '!h-5 !px-2 !py-[2px] rounded-[3px] mr-1';

export function Header({
  evaluator,
  selectedVersion,
  autoSaveService,
  onChangeBaseInfo,
  onOpenVersionList,
  onSubmitVersion,
  debugButtonProps,
  customDebugButton,
}: HeaderProps) {
  const [editVisible, setEditVisible] = useState(false);
  const [portalBack, setPortalBack] = useState<HTMLElement | null>(null);
  const [portalSlot, setPortalSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalBack(document.getElementById('page-header-back-btn'));
    setPortalSlot(document.getElementById('page-header-slot'));
  }, []);

  const autoSaveTag = autoSaveService.loading ? (
    <Tag color="primary" className={TAG_STYLE}>
      <IconCozLoading className="w-3 h-3 animate-spin mr-1" />
      {I18n.t('draft_auto_saving')}
    </Tag>
  ) : autoSaveService.error ? (
    <Tag color="primary" className={TAG_STYLE}>
      {I18n.t('draft_auto_save_failed')}
    </Tag>
  ) : autoSaveService.data?.lastSaveTime ? (
    <Tag color="primary" className={TAG_STYLE}>
      {I18n.t('draft_auto_saving')}{' '}
      {dayjs(Number(autoSaveService.data.lastSaveTime)).format(
        'YYYY-MM-DD HH:mm:ss',
      )}
    </Tag>
  ) : null;

  const extraTags = selectedVersion ? (
    <>
      {DIVIDER}
      <Tag color="green" className={TAG_STYLE}>
        {selectedVersion.version}
      </Tag>
      {DIVIDER}
      <div className="text-xs coz-fg-secondary font-normal">
        {I18n.t('submission_time')}
        {dayjs(Number(selectedVersion.base_info?.created_at)).format(
          'YYYY-MM-DD HH:mm:ss',
        )}
      </div>
      {DIVIDER}
      <div className="text-xs coz-fg-secondary font-normal flex items-center">
        <span className="shrink-0">{I18n.t('submitter')}</span>
        <CozeUser user={selectedVersion.base_info?.created_by} size="small" />
      </div>
    </>
  ) : (
    <>
      {evaluator?.draft_submitted === false ? (
        <Tag color="yellow" className={TAG_STYLE}>
          {I18n.t('unsubmitted_changes')}
        </Tag>
      ) : null}
      {autoSaveTag}
    </>
  );

  const debugBtn =
    customDebugButton ||
    (debugButtonProps ? <DebugButton {...debugButtonProps} /> : null);

  const headerLeft = (
    <div className="flex-1">
      <div className="text-[14px] leading-5 font-medium coz-fg-plus flex items-center gap-x-1">
        <Typography.Text className="!coz-fg-plus !font-medium !text-[14px] !leading-[20px]">
          {evaluator?.name}
        </Typography.Text>
        <Guard point={GuardPoint['eval.evaluator.edit_meta']}>
          <EditIconButton onClick={() => setEditVisible(true)} />
        </Guard>
      </div>
      <div className="h-6 flex flex-row items-center">
        <div className="text-xs font-normal !coz-fg-secondary max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap leading-4">
          {I18n.t('description')}：{evaluator?.description || '-'}
        </div>
        {extraTags}
      </div>
    </div>
  );

  const headerRight = (
    <div className="flex-shrink-0 flex flex-row gap-2">
      <Button color="primary" onClick={onOpenVersionList}>
        {I18n.t('version_record')}
      </Button>
      {!selectedVersion && debugBtn}
      {!selectedVersion && (
        <Guard point={GuardPoint['eval.evaluator.commit']}>
          <Button color="brand" onClick={onSubmitVersion}>
            {I18n.t('submit_new_version')}
          </Button>
        </Guard>
      )}
    </div>
  );

  return (
    <>
      {portalBack
        ? createPortal(
            <RouteBackAction defaultModuleRoute="evaluation/evaluators" />,
            portalBack,
          )
        : null}
      {portalSlot
        ? createPortal(
            <div className="flex justify-between items-center w-full">
              {headerLeft}
              {headerRight}
            </div>,
            portalSlot,
          )
        : null}
      <BaseInfoModal
        evaluator={evaluator}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onSubmit={onChangeBaseInfo}
      />
    </>
  );
}
