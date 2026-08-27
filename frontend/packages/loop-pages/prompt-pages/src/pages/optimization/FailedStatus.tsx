// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import type { PromptOptimizeTask } from '@cozeloop/api-schema/evaluation';
import { Typography } from '@coze-arch/coze-design';

export function FailedStatus({ task }: { task: PromptOptimizeTask }) {
  return (
    <div className="rounded border border-solid coz-stroke-primary p-6">
      <Typography.Text className="text-[#cf1322]" strong>
        {I18n.t('prompt_optimization_failed')}
      </Typography.Text>
      {task.error_message ? (
        <div className="mt-3 rounded bg-[rgba(255,77,79,0.08)] p-3">
          <Typography.Text>{task.error_message}</Typography.Text>
        </div>
      ) : null}
    </div>
  );
}
