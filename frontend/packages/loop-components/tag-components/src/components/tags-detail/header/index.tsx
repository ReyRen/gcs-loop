// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';

import { formatTimestampToString } from '@cozeloop/toolkit';
import { I18n } from '@cozeloop/i18n-adapter';
import { GuardActionType } from '@cozeloop/guard';
import { UserProfile } from '@cozeloop/components';
import { useNavigateModule } from '@cozeloop/biz-hooks-adapter';
import { type tag } from '@cozeloop/api-schema/data';
import { IconCozLongArrowUp } from '@coze-arch/coze-design/icons';
import { Divider, Button } from '@coze-arch/coze-design';

// 头部组件
interface TagDetailHeaderProps {
  tagDetail?: tag.TagInfo;
  onShowEditHistory: () => void;
  onSubmit: () => void;
  changed: boolean;
  guardType: GuardActionType;
  tagListPagePath?: string;
  tagListPageQuery?: string;
}

export const TagDetailHeader = ({
  tagDetail,
  onShowEditHistory,
  onSubmit,
  changed,
  guardType,
  tagListPagePath,
  tagListPageQuery,
}: TagDetailHeaderProps) => {
  const navigate = useNavigateModule();
  const { base_info } = tagDetail || {};

  const [portalBack, setPortalBack] = useState<HTMLElement | null>(null);
  const [portalSlot, setPortalSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalBack(document.getElementById('page-header-back-btn'));
    setPortalSlot(document.getElementById('page-header-slot'));
  }, []);

  const headerBackBtn = (
    <div
      className="-rotate-90 cursor-pointer flex items-center justify-center w-[32px] h-[32px]"
      onClick={() =>
        navigate(
          `${tagListPagePath}${tagListPageQuery ? `?${tagListPageQuery}` : ''}`,
        )
      }
    >
      <IconCozLongArrowUp className="w-5 h-5" />
    </div>
  );

  const headerLeft = (
    <div className="flex flex-col overflow-hidden w-full">
      {/* <div className="text-[14px] font-medium leading-5 text-[var(--coz-fg-plus)]">
        {tag_key_name ?? ''}
      </div> */}
      <div className="flex items-center justify-start gap-x-4 text-[12px] font-normal leading-4 text-[var(--coz-fg-secondary)]">
        {/* <div className="inline-block max-w-[380px]">
          <Typography.Text
            className="font-inherit text-inherit leading-inherit overflow-hidden !text-[12px]"
            ellipsis={{ showTooltip: { opts: { theme: 'dark' } } }}
          >
            {description ?? '-'}
          </Typography.Text>
        </div> */}
        {/* <Divider layout="vertical" className="h-[12px] mx-[3px]" /> */}
        <div className="text-[var(--coz-fg-secondary)] whitespace-nowrap">
          {I18n.t('update_time')}:
          {formatTimestampToString(base_info?.updated_at ?? '')}
        </div>
        <Divider layout="vertical" className="h-[12px] mx-[3px]" />
        <div className="text-[var(--coz-fg-secondary)] whitespace-nowrap">
          {I18n.t('create_time')}:
          {formatTimestampToString(base_info?.created_at ?? '')}
        </div>
        <Divider layout="vertical" className="h-[12px] mx-[3px]" />
        <div className="flex items-center flex-1 overflow-hidden">
          <UserProfile
            avatarUrl={base_info?.created_by?.avatar_url}
            name={base_info?.created_by?.name ?? '-'}
            userNameClassName="!text-[12px]"
          />
        </div>
      </div>
    </div>
  );

  const headerRight = (
    <div className="flex items-center gap-x-2">
      <Button color="primary" onClick={onShowEditHistory}>
        {I18n.t('tag_change_log')}
      </Button>
      <Button
        color="brand"
        disabled={!changed || guardType === GuardActionType.READONLY}
        onClick={onSubmit}
      >
        {I18n.t('save')}
      </Button>
    </div>
  );

  return (
    <>
      {portalBack ? createPortal(headerBackBtn, portalBack) : null}
      {portalSlot
        ? createPortal(
            <div className="flex justify-between items-center w-full gap-4">
              {headerLeft}
              {headerRight}
            </div>,
            portalSlot,
          )
        : null}
    </>
  );
};
