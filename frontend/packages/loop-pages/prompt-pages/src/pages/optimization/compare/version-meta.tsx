// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import { IconCozAiFill } from '@coze-arch/coze-design/icons';
import { Tag, Typography } from '@coze-arch/coze-design';

import type { CompareVersionMeta } from './types';
import { ScoreRate } from './score-rate';

interface VersionMetaPanelProps {
  meta: CompareVersionMeta;
  /** 是否为右侧当前版本 */
  isCurrent?: boolean;
}

/** 版本头部信息区：版本号 + 说明小字 / 智能优化标识 + 星级评分 + 质量标签 */
export function VersionMetaPanel({
  meta,
  isCurrent = false,
}: VersionMetaPanelProps) {
  return (
    <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
      <div className="flex items-center gap-2">
        <Typography.Text strong className="text-base leading-[22px]">
          {meta.version}
        </Typography.Text>
        {isCurrent && meta.isOptimized ? (
          <div className="inline-flex items-center gap-1 rounded-xl px-2 py-0.5 coz-mg-hglt-secondary">
            <IconCozAiFill className="coz-fg-hglt" />
            <Typography.Text className="text-xs leading-4 coz-fg-hglt">
              {I18n.t('prompt_optimization_optimized_from', {
                version: meta.optimizedFrom ?? '',
              })}
            </Typography.Text>
          </div>
        ) : (
          <Typography.Text type="secondary" className="text-xs leading-4">
            {I18n.t('prompt_optimization_compare_version')}
          </Typography.Text>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <ScoreRate value={meta.score} scoreLabel={meta.scoreLabel} />
        {meta.qualityTag ? (
          <Tag
            size="small"
            color={isCurrent ? 'brand' : 'grey'}
            className="shrink-0"
          >
            {meta.qualityTag}
          </Tag>
        ) : null}
      </div>
    </div>
  );
}
