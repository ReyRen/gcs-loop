// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import {
  useResourcePageJump,
  useOpenWindow,
} from '@cozeloop/biz-hooks-adapter';
import { IconCozLongArrowTopRight } from '@coze-arch/coze-design/icons';

export function TagDetailLink({ tagKey }: { tagKey?: string }) {
  const { getTagDetailURL } = useResourcePageJump();
  const { openSelf } = useOpenWindow();
  return (
    <span
      className="cursor-pointer text-brand-7"
      onClick={() => {
        openSelf(getTagDetailURL(tagKey || ''));
      }}
    >
      {I18n.t('view_tag_details')}
      <IconCozLongArrowTopRight className="ml-1" />
    </span>
  );
}
