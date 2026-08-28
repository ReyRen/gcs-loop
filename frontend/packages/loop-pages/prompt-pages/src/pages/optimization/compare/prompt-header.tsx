// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import { handleCopy } from '@cozeloop/components';
import { IconCozCopy } from '@coze-arch/coze-design/icons';
import {
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from '@coze-arch/coze-design';

interface PromptHeaderProps {
  /** 版本号标题，如 0.0.1 */
  title: string;
  /** 复制内容 */
  copyContent?: string;
  /** 是否为右侧优化版本（展示「优化对比」开关） */
  isOptimized?: boolean;
  /** 优化对比开关值 */
  diffEnabled?: boolean;
  onDiffToggle?: (checked: boolean) => void;
}

/** Prompt 内容区头部：版本号 + 复制按钮（右侧额外含「优化对比」开关） */
export function PromptHeader({
  title,
  copyContent,
  isOptimized = false,
  diffEnabled,
  onDiffToggle,
}: PromptHeaderProps) {
  return (
    <div className="flex h-10 items-center justify-between   coz-stroke-primary px-4 coz-bg-secondary">
      <div className="flex min-w-0 items-center gap-2">
        <Typography.Text strong className="text-[13px] leading-5">
          {title}
        </Typography.Text>
        {copyContent ? (
          <Tooltip content={I18n.t('copy')} theme="dark">
            <IconButton
              size="mini"
              color="secondary"
              icon={<IconCozCopy />}
              onClick={() => handleCopy(copyContent)}
            />
          </Tooltip>
        ) : null}
      </div>
      {isOptimized ? (
        <div className="flex items-center gap-2">
          <Typography.Text type="secondary" className="text-xs leading-4">
            {I18n.t('prompt_optimization_diff_toggle')}
          </Typography.Text>
          <Switch size="mini" checked={diffEnabled} onChange={onDiffToggle} />
        </div>
      ) : null}
    </div>
  );
}
