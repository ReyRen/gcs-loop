// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import classNames from 'classnames';

import type { PromptLine } from './types';

import styles from './index.module.less';

interface DiffContentViewProps {
  lines: PromptLine[];
  /** 是否为右侧优化版本（added 片段高亮为绿色） */
  isOptimized?: boolean;
}

/**
 * Prompt 行内容区：
 * - 左侧固定宽度行号列
 * - 内容区支持局部文本高亮（removed 红 / added 绿）
 * - 长文本自动换行，换行内容与首行文本对齐
 */
export function DiffContentView({
  lines,
  isOptimized = false,
}: DiffContentViewProps) {
  return (
    <div className={styles['diff-content']}>
      {lines.map(item => (
        <div key={item.line} className="flex w-full items-start">
          <div className="w-9 shrink-0 pr-3 text-right coz-fg-dim select-none">
            {item.line}
          </div>
          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {item.segments.map((seg, idx) => {
              const segClass =
                seg.type === 'removed'
                  ? 'rounded-sm coz-fg-hglt-red coz-mg-hglt-red'
                  : seg.type === 'added'
                    ? isOptimized
                      ? 'rounded-sm coz-fg-hglt-green coz-mg-hglt-green'
                      : 'coz-fg-primary'
                    : null;
              return (
                <span
                  key={idx}
                  className={classNames('whitespace-pre-wrap', segClass)}
                >
                  {seg.text}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
