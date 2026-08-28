// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';

import { VersionMetaPanel } from './version-meta';
import type { PromptOptimizationCompareData } from './types';
import { PromptHeader } from './prompt-header';
import { DiffContentView } from './diff-content-view';

import styles from './index.module.less';

interface PromptOptimizationCompareProps {
  data: PromptOptimizationCompareData;
  /** 是否默认开启「优化对比」 */
  defaultDiffEnabled?: boolean;
}

/**
 * Prompt 智能优化版本对比容器：
 * - 顶部蓝紫渐变边框
 * - 左右 50% 布局 + 中间分割线
 * - 左侧对比版本 / 右侧智能优化当前版本
 */
export function PromptOptimizationCompare({
  data,
  defaultDiffEnabled = true,
}: PromptOptimizationCompareProps) {
  const { base, current, baseLines, currentLines } = data;
  const [diffEnabled, setDiffEnabled] = useState(defaultDiffEnabled);

  // 关闭「优化对比」时，左右两侧都清除 diff 高亮，仅展示纯文本
  const normalizeLines = (lines: typeof currentLines) =>
    lines.map(line => ({
      ...line,
      segments: line.segments.map(seg => ({
        text: seg.text,
        type: 'normal' as const,
      })),
    }));

  const baseLinesRendered = useMemo(
    () => (diffEnabled ? baseLines : normalizeLines(baseLines)),
    [baseLines, diffEnabled],
  );
  const currentLinesRendered = useMemo(
    () => (diffEnabled ? currentLines : normalizeLines(currentLines)),
    [currentLines, diffEnabled],
  );

  const baseCopyContent = useMemo(
    () => baseLines.map(l => l.segments.map(s => s.text).join('')).join('\n'),
    [baseLines],
  );
  const currentCopyContent = useMemo(
    () =>
      currentLines.map(l => l.segments.map(s => s.text).join('')).join('\n'),
    [currentLines],
  );

  // 顶部 bar 高亮位置由左右分数决定：分数高的一侧显示渐变，另一侧显示灰色
  const isBaseHigher = base.score > current.score;
  const isCurrentHigher = current.score > base.score;

  return (
    <div className="relative flex w-full overflow-hidden rounded-lg border border-solid coz-stroke-primary bg-[#fff] coz-bg-primary">
      {/* 顶部渐变边框：高亮侧跟随分数较高的一侧 */}
      <div className={styles['compare-gradient-bar']}>
        <div
          className={
            isBaseHigher
              ? styles['gradient-seg-active']
              : styles['gradient-seg-inactive']
          }
        />
        <div
          className={
            isCurrentHigher
              ? styles['gradient-seg-active']
              : styles['gradient-seg-inactive']
          }
        />
      </div>

      {/* 左侧：对比版本 */}
      <div className="flex w-1/2 min-w-0 flex-1 flex-col bg-[#fff]">
        <VersionMetaPanel meta={base} />
        <PromptHeader
          title={I18n.t('prompt_optimization_base_prompt', {
            version: base.version,
          })}
          copyContent={baseCopyContent}
        />
        <div className="min-h-0 flex-1 overflow-hidden p-3 pr-4 pb-4">
          <DiffContentView lines={baseLinesRendered} />
        </div>
      </div>

      {/* 中间分割线 */}
      <div className="w-px shrink-0" />

      {/* 右侧：当前版本（智能优化） */}
      <div className="flex w-1/2 min-w-0 flex-1 flex-col bg-[#fff]">
        <VersionMetaPanel meta={current} isCurrent />
        <PromptHeader
          title={I18n.t('prompt_optimization_optimized_prompt_title')}
          copyContent={currentCopyContent}
          isOptimized
          diffEnabled={diffEnabled}
          onDiffToggle={setDiffEnabled}
        />
        <div className="min-h-0 flex-1 overflow-hidden p-3 pr-4 pb-4">
          <DiffContentView lines={currentLinesRendered} isOptimized />
        </div>
      </div>
    </div>
  );
}
