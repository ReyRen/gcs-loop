// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/** Diff 文本片段：normal 普通 / removed 删除 / added 新增 */
export interface DiffSegment {
  text: string;
  type?: 'normal' | 'removed' | 'added';
}

/** Prompt 单行：行号 + 若干 diff 片段 */
export interface PromptLine {
  line: number;
  segments: DiffSegment[];
}

/** 单个版本的信息：版本号、星级、分数、质量标签 */
export interface CompareVersionMeta {
  /** 版本号，如 0.0.1 */
  version: string;
  /** 星级评分（0~5，支持小数如 3.5） */
  score: number;
  /** 分数文案，如 0.5 */
  scoreLabel: string;
  /** 质量标签，如 通用 / 良好 */
  qualityTag?: string;
  /** 是否为「智能优化」版本 */
  isOptimized?: boolean;
  /** 智能优化来源版本，如 0.0.1 */
  optimizedFrom?: string;
}

/** 版本对比完整数据 */
export interface PromptOptimizationCompareData {
  /** 左侧对比版本 */
  base: CompareVersionMeta;
  /** 右侧当前版本 */
  current: CompareVersionMeta;
  /** 左侧 Prompt 行数据 */
  baseLines: PromptLine[];
  /** 右侧 Prompt 行数据 */
  currentLines: PromptLine[];
  /** 是否展示「优化对比」开关 */
  showDiffSwitch?: boolean;
}
