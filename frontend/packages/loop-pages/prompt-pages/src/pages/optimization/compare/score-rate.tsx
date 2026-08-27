// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import classNames from 'classnames';
import { IconCozStar, IconCozStarFill } from '@coze-arch/coze-design/icons';
import { Typography } from '@coze-arch/coze-design';

interface ScoreRateProps {
  /** 评分值 0~5 */
  value: number;
  /** 最大星级，默认 5 */
  count?: number;
  /** 分数文案，如 0.5 / 0.7 */
  scoreLabel?: string;
  className?: string;
}

/** 星级评分组件：实心星 + 分数文案 */
export function ScoreRate({
  value,
  count = 5,
  scoreLabel,
  className,
}: ScoreRateProps) {
  const stars = Array.from({ length: count }, (_, i) => i + 1);
  // 半星处理：value 的小数部分 >= 0.5 时该星按实心显示
  const filledCount = Math.floor(value);
  const hasHalf = value - filledCount >= 0.5;

  return (
    <div className={classNames('flex items-center gap-1.5', className)}>
      <div className="inline-flex items-center gap-0.5">
        {stars.map(i => {
          const filled = i <= filledCount || (i === filledCount + 1 && hasHalf);
          return (
            <span key={i} className="inline-flex items-center">
              {filled ? (
                <IconCozStarFill className="coz-fg-hglt-yellow text-sm" />
              ) : (
                <IconCozStar className="coz-fg-dim text-sm" />
              )}
            </span>
          );
        })}
      </div>
      {scoreLabel !== undefined ? (
        <Typography.Text strong className="text-sm leading-5">
          {scoreLabel}
        </Typography.Text>
      ) : null}
    </div>
  );
}
