// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import { Typography } from '@coze-arch/coze-design';

export function TerminatedStatus() {
  return (
    <div className="rounded border border-solid coz-stroke-primary p-6">
      <Typography.Text className="coz-fg-secondary">
        {I18n.t('prompt_optimization_canceled')}
      </Typography.Text>
    </div>
  );
}
