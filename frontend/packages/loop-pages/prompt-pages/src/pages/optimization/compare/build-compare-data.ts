// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import type { Message } from '@cozeloop/api-schema/prompt';

import type {
  DiffSegment,
  PromptLine,
  PromptOptimizationCompareData,
} from './types';

/** 将 message 列表拼接为纯文本 */
function messagesToText(messages: Message[]): string {
  return messages.map(m => m.content ?? '').join('\n');
}

/** 基于 LCS 做行级 diff，标记 removed / added */
function diffLines(
  baseText: string,
  currentText: string,
): { baseLines: PromptLine[]; currentLines: PromptLine[] } {
  const base = baseText.split('\n');
  const current = currentText.split('\n');
  const n = base.length;
  const m = current.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        base[i] === current[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const baseLines: PromptLine[] = [];
  const currentLines: PromptLine[] = [];
  let baseIdx = 0;
  let curIdx = 0;
  let lineNo = 1;

  const pushBase = (text: string, type: DiffSegment['type'] = 'normal') => {
    baseLines.push({ line: lineNo, segments: [{ text, type }] });
  };
  const pushCurrent = (text: string, type: DiffSegment['type'] = 'normal') => {
    currentLines.push({ line: lineNo, segments: [{ text, type }] });
  };

  while (baseIdx < n && curIdx < m) {
    if (base[baseIdx] === current[curIdx]) {
      pushBase(base[baseIdx]);
      pushCurrent(current[curIdx]);
      baseIdx++;
      curIdx++;
      lineNo++;
    } else if (dp[baseIdx + 1][curIdx] >= dp[baseIdx][curIdx + 1]) {
      // 左侧独有 -> 删除
      pushBase(base[baseIdx], 'removed');
      pushCurrent('', 'normal');
      baseIdx++;
      lineNo++;
    } else {
      // 右侧独有 -> 新增
      pushBase('', 'normal');
      pushCurrent(current[curIdx], 'added');
      curIdx++;
      lineNo++;
    }
  }

  while (baseIdx < n) {
    pushBase(base[baseIdx], 'removed');
    pushCurrent('', 'normal');
    baseIdx++;
    lineNo++;
  }
  while (curIdx < m) {
    pushBase('', 'normal');
    pushCurrent(current[curIdx], 'added');
    curIdx++;
    lineNo++;
  }

  return { baseLines, currentLines };
}

export interface BuildCompareDataParams {
  baseVersion: string;
  currentVersion: string;
  baseMessages: Message[];
  currentMessages: Message[];
  /** 当前版本评分（0~1 归一化分数） */
  currentScore?: number;
  currentScoreLabel?: string;
  /** 当前版本质量标签，如 良好 */
  currentQualityTag?: string;
  /** 对比版本评分（0~1 归一化分数） */
  baseScore?: number;
  baseScoreLabel?: string;
  baseQualityTag?: string;
}

/** 星级满分（5 星制） */
const STAR_FULL_SCORE = 5;

/** 将 0~1 归一化分数换算为 0~5 星级 */
function toStarScore(score?: number): number {
  return (score ?? 0) * STAR_FULL_SCORE;
}

/** 构建版本对比数据（含行级 diff） */
export function buildCompareData(
  params: BuildCompareDataParams,
): PromptOptimizationCompareData {
  const {
    baseVersion,
    currentVersion,
    baseMessages,
    currentMessages,
    currentScore,
    currentScoreLabel = '0',
    currentQualityTag,
    baseScore,
    baseScoreLabel = '0',
    baseQualityTag,
  } = params;

  const baseText = messagesToText(baseMessages);
  const currentText = messagesToText(currentMessages);

  const { baseLines, currentLines } = diffLines(baseText, currentText);

  return {
    base: {
      version: baseVersion,
      score: toStarScore(baseScore),
      scoreLabel: baseScoreLabel,
      qualityTag: baseQualityTag,
    },
    current: {
      version: currentVersion,
      score: toStarScore(currentScore),
      scoreLabel: currentScoreLabel,
      qualityTag: currentQualityTag,
      isOptimized: true,
      optimizedFrom: baseVersion,
    },
    baseLines,
    currentLines,
  };
}
