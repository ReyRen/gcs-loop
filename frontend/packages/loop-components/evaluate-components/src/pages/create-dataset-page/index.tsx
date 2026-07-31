// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import { useBreadcrumb } from '@cozeloop/hooks';
import { RouteBackAction } from '@cozeloop/base-with-adapter-components';
import { Layout, Typography } from '@coze-arch/coze-design';

import { DatasetCreateForm } from '../../components/dataset-create-form';

export const CreateDatasetPage = () => {
  useBreadcrumb({
    text: I18n.t('new_evaluation_set'),
  });

  const [portalBack, setPortalBack] = useState<HTMLElement | null>(null);
  const [portalSlot, setPortalSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalBack(document.getElementById('page-header-back-btn'));
    setPortalSlot(document.getElementById('page-header-slot'));
  }, []);

  return (
    <Layout.Content className="h-full w-full overflow-hidden flex flex-col">
      {portalBack
        ? createPortal(
            <RouteBackAction onBack={() => history.back()} />,
            portalBack,
          )
        : null}
      {portalSlot
        ? createPortal(
            <Typography.Title
              heading={6}
              className="!coz-fg-plus !font-medium !text-[18px] !leading-[20px]"
            >
              {I18n.t('new_evaluation_set')}
            </Typography.Title>,
            portalSlot,
          )
        : null}
      <DatasetCreateForm header={null} />
    </Layout.Content>
  );
};
