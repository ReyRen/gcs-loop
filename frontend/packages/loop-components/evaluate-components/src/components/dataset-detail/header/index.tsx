// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable complexity */
import { createPortal } from 'react-dom';
import { Fragment, useState, useEffect } from 'react';

import { formatTimestampToString } from '@cozeloop/toolkit';
import { I18n } from '@cozeloop/i18n-adapter';
import { UserProfile } from '@cozeloop/components';
import { RouteBackAction } from '@cozeloop/base-with-adapter-components';
import { type EvaluationSet } from '@cozeloop/api-schema/evaluation';
import { Divider, Typography } from '@coze-arch/coze-design';

import { DatasetDetailEditModal } from '../../dataset-detail-edit-modal';

export const DatasetDetailHeader = ({
  datasetDetail,
  onRefresh,
}: {
  datasetDetail?: EvaluationSet;
  onRefresh: () => void;
}) => {
  const detail = [
    `${I18n.t('description')}:${datasetDetail?.description || '-'}`,
    `${I18n.t('update_time')}:${formatTimestampToString(
      datasetDetail?.base_info?.updated_at || '',
      'YYYY-MM-DD HH:mm:ss',
    )}`,
    `${I18n.t('create_time')}:${formatTimestampToString(
      datasetDetail?.base_info?.created_at || '',
      'YYYY-MM-DD HH:mm:ss',
    )}`,
  ]?.filter(Boolean);

  const [portalBack, setPortalBack] = useState<HTMLElement | null>(null);
  const [portalSlot, setPortalSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalBack(document.getElementById('page-header-back-btn'));
    setPortalSlot(document.getElementById('page-header-slot'));
  }, []);

  const headerContent = datasetDetail ? (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <Typography.Text
          className="!text-[14px] !font-medium !max-w-[400px] !coz-fg-plus !leading-[20px]"
          ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
        >
          {datasetDetail?.name}
        </Typography.Text>
        <DatasetDetailEditModal
          datasetDetail={datasetDetail}
          onSuccess={() => onRefresh()}
        />
      </div>
      <div className="flex items-center gap-2">
        {detail.map((item, index) => (
          <Fragment key={index}>
            <Typography.Text
              type="secondary"
              className="!max-w-[400px] break-all !coz-fg-secondary !leading-[16px] !text-[12px]"
              size="small"
              ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
            >
              {item}
            </Typography.Text>
            <Divider
              layout="vertical"
              className="coz-fg-secondary w-[1px] !h-[12px] mx-[6px]"
            />
          </Fragment>
        ))}
        <div className="flex gap-1 items-center">
          <Typography.Text
            type="secondary"
            size="small"
            className="!coz-fg-secondary !leading-[16px] !text-[12px]"
          >
            {I18n.t('evaluate_dataset_info_creator')}
          </Typography.Text>
          <UserProfile
            className="flex-1 !coz-fg-secondary !leading-[16px] !text-[12px]"
            name={datasetDetail?.base_info?.created_by?.name}
            avatarUrl={datasetDetail?.base_info?.created_by?.avatar_url}
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {portalBack
        ? createPortal(
            <RouteBackAction onBack={() => history.back()} />,
            portalBack,
          )
        : null}
      {portalSlot ? createPortal(headerContent, portalSlot) : null}
    </>
  );
};
