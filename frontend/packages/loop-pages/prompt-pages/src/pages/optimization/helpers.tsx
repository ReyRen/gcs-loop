// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import type { Message } from '@cozeloop/api-schema/prompt';
import type { PromptOptimizationSampleEvaluation } from '@cozeloop/api-schema/evaluation';
import { Pagination, Tag, Typography } from '@coze-arch/coze-design';
import { CalypsoLazy } from '@bytedance/calypso';

export interface DiffToken {
  type: 'equal' | 'delete' | 'insert';
  value: string;
}

/** 将文本按「变量 / 单词 / 标点 / 空白」切分为 token，便于本地 diff */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const regex = /\{\{[^{}]+\}\}|\w+|[^\w\s]|\s+/g;
  let m = regex.exec(text);
  while (m !== null) {
    tokens.push(m[0]);
    m = regex.exec(text);
  }
  return tokens;
}

/** 基于 token 的 LCS diff，返回分段结果 */
function diffTokens(oldText: string, newText: string): DiffToken[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'equal', value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'delete', value: a[i] });
      i++;
    } else {
      result.push({ type: 'insert', value: b[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: 'delete', value: a[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: 'insert', value: b[j] });
    j++;
  }
  return result;
}

function isVariable(token: string): boolean {
  return /^\{\{[^{}]+\}\}$/.test(token);
}

export function DiffText({ diff }: { diff: DiffToken[] }) {
  return (
    <span className="break-words whitespace-pre-wrap">
      {diff.map((t, idx) => {
        const className =
          t.type === 'delete'
            ? 'bg-[rgba(255,77,79,0.15)] text-[#cf1322] line-through'
            : t.type === 'insert'
              ? 'bg-[rgba(82,196,26,0.15)] text-[#237804]'
              : '';
        if (isVariable(t.value)) {
          return (
            <span
              key={idx}
              className="mx-0.5 rounded bg-[#EFF1FF] px-1 text-[#4C5BD4]"
            >
              {t.value}
            </span>
          );
        }
        if (!className) {
          return <span key={idx}>{t.value}</span>;
        }
        return (
          <span key={idx} className={className}>
            {t.value}
          </span>
        );
      })}
    </span>
  );
}

export function formatScore(v?: number): string {
  if (v === undefined || v === null) {
    return '-';
  }
  return (Math.round(v * 100) / 100).toString();
}

export function renderMessages(messages?: Message[]) {
  if (!messages?.length) {
    return (
      <Typography.Text>
        {I18n.t('prompt_optimization_no_content')}
      </Typography.Text>
    );
  }
  return messages.map((msg, idx) => (
    <div key={idx} className="mb-3">
      <Tag size="small" className="mb-1">
        {String(msg.role)}
      </Tag>
      <div className="rounded border border-solid coz-stroke-primary bg-white p-3">
        <Typography.Paragraph className="!mb-0 whitespace-pre-wrap break-words">
          {msg.content ?? ''}
        </Typography.Paragraph>
      </div>
    </div>
  ));
}

export function renderDiffMessages(original: Message[], optimized: Message[]) {
  const maxLen = Math.max(original?.length ?? 0, optimized?.length ?? 0);
  if (!maxLen) {
    return (
      <Typography.Text>
        {I18n.t('prompt_optimization_no_content')}
      </Typography.Text>
    );
  }
  return Array.from({ length: maxLen }, (_, idx) => {
    const left = original?.[idx];
    const right = optimized?.[idx];
    const diff = diffTokens(left?.content ?? '', right?.content ?? '');
    return (
      <div key={idx} className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <Tag size="small" className="mb-1">
            {left ? String(left.role) : '-'}
          </Tag>
          <div className="rounded border border-solid coz-stroke-primary bg-white p-3">
            <DiffText diff={diff.filter(t => t.type !== 'insert')} />
          </div>
        </div>
        <div>
          <Tag size="small" className="mb-1">
            {right ? String(right.role) : '-'}
          </Tag>
          <div className="rounded border border-solid coz-stroke-primary bg-white p-3">
            <DiffText diff={diff.filter(t => t.type !== 'delete')} />
          </div>
        </div>
      </div>
    );
  });
}

export function MetricItem({
  label,
  value,
  delta,
  selected = false,
  icon,
  iconColor,
  iconBackground,
  onClick,
}: {
  label: string;
  value?: string | number;
  delta?: number;
  /** 是否选中（高亮边框） */
  selected?: boolean;
  /** 卡片图标 */
  icon?: ReactNode;
  /** 图标颜色 */
  iconColor?: string;
  /** 图标背景色 */
  iconBackground?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={
        selected
          ? 'flex h-[98px] cursor-pointer items-center gap-4 rounded-xl border border-solid border-[#4C5BD4] bg-white px-4 py-5 shadow-[0_0_0_1px_#4C5BD4] transition-[border-color] duration-200'
          : 'flex h-[98px] cursor-pointer items-center gap-4 rounded-xl border border-solid border-[#dde2e9] bg-white px-4 py-5 transition-[border-color] duration-200'
      }
      onClick={onClick}
    >
      {icon ? (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{
            color: iconColor,
            backgroundColor: iconBackground,
          }}
        >
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <Typography.Text className="font-[14px] text-[rgba(32,41,69,.62))]">
          {label}
        </Typography.Text>
        <div className="text-color-plus text-[24px]">{value}</div>
      </div>
    </div>
  );
}

const SAMPLE_TABLE_BORDER = '1px solid #eaedf1';
const SAMPLE_TABLE_CELL_BG = { background: '#fff' };
/* eslint-disable-next-line @typescript-eslint/no-magic-numbers -- 分页可选的每页条数选项 */
const SAMPLE_TABLE_PAGE_SIZE_OPTS = [10, 20, 50];

function SampleComparisonRow({
  item,
}: {
  item: PromptOptimizationSampleEvaluation;
}) {
  const border = SAMPLE_TABLE_BORDER;
  const cellBg = SAMPLE_TABLE_CELL_BG;
  return (
    <tr>
      <td
        style={{ ...cellBg, borderBottom: border, borderRight: border }}
        className="p-2 align-top break-all"
      >
        {item.variables?.input ?? '-'}
      </td>
      <td
        style={{ ...cellBg, borderBottom: border, borderRight: border }}
        className="p-2 align-top break-all"
      >
        {item.reference_answer ? (
          <CalypsoLazy markDown={item.reference_answer} />
        ) : (
          '-'
        )}
      </td>
      <td
        style={{
          background:
            (item.original_score ?? 0) > (item.optimized_score ?? 0)
              ? '#ecfdf5'
              : '#fff',
          borderBottom: border,
          borderRight: border,
        }}
        className="p-2 align-top break-all"
      >
        {item.original_answer ? (
          <CalypsoLazy markDown={item.original_answer} />
        ) : (
          '-'
        )}
      </td>
      <td
        style={{
          background:
            (item.optimized_score ?? 0) > (item.original_score ?? 0)
              ? '#ecfdf5'
              : '#fff',
          borderBottom: border,
          borderRight: border,
        }}
        className="p-2 align-top break-all"
      >
        {item.optimized_answer ? (
          <CalypsoLazy markDown={item.optimized_answer} />
        ) : (
          '-'
        )}
      </td>
      <td
        style={{ ...cellBg, borderBottom: border, borderRight: border }}
        className="p-2 align-top"
      >
        {I18n.t('prompt_optimization_baseline_score')}：
        {formatScore(item.original_score)}
      </td>
      <td style={{ ...cellBg, borderBottom: border }} className="p-2 align-top">
        {I18n.t('prompt_optimization_best_score_lbl')}：
        {formatScore(item.optimized_score)}
      </td>
    </tr>
  );
}

export function SampleComparisonTable({
  data,
}: {
  data: PromptOptimizationSampleEvaluation[];
}) {
  const border = SAMPLE_TABLE_BORDER;
  const cellBg = SAMPLE_TABLE_CELL_BG;
  const [currentPage, setCurrentPage] = useState(1);
  /* eslint-disable-next-line @typescript-eslint/no-magic-numbers -- 默认每页展示 10 条 */
  const [pageSize, setPageSize] = useState(10);
  const total = data.length;
  const pagedData = data.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  return (
    <div style={{ width: '100%', border }} className="rounded-lg">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th
              style={{ ...cellBg, borderBottom: border, borderRight: border }}
              className="p-2"
            >
              {I18n.t('prompt_optimization_input_variable')}
            </th>
            <th
              style={{
                ...cellBg,
                width: 360,
                borderBottom: border,
                borderRight: border,
              }}
              className="p-2"
            >
              {I18n.t('prompt_optimization_reference_answer')}
            </th>
            <th
              style={{
                ...cellBg,
                width: 360,
                borderBottom: border,
                borderRight: border,
                borderTop: '5px solid #41a6ff',
              }}
              className="p-2"
            >
              {I18n.t('prompt_optimization_original_answer')}
            </th>
            <th
              style={{
                ...cellBg,
                width: 360,
                borderBottom: border,
                borderRight: border,
                borderTop: '5px solid #5a4eed',
              }}
              className="p-2"
            >
              {I18n.t('prompt_optimization_optimized_answer')}
            </th>
            <th
              colSpan={2}
              style={{ ...cellBg, borderBottom: border }}
              className="p-2"
            >
              {I18n.t('prompt_optimization_evaluator_score_change')}
            </th>
          </tr>
        </thead>
        <tbody>
          {pagedData.map((item, idx) => (
            <SampleComparisonRow key={idx} item={item} />
          ))}
        </tbody>
      </table>
      {total > 0 ? (
        <div className="flex flex-row-reverse p-3">
          <Pagination
            currentPage={currentPage}
            pageSize={pageSize}
            total={total}
            showTotal
            showSizeChanger
            pageSizeOpts={SAMPLE_TABLE_PAGE_SIZE_OPTS}
            onChange={(page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 固定展示的评估器名称列表 */
const EVALUATOR_NAMES = ['正确性', '简洁性'];

/** 渲染 markdown 内容单元格，空值展示 '-' */
function renderMarkdownCell(content?: string) {
  return content ? <CalypsoLazy markDown={content} /> : '-';
}

/**
 * 按评估器拆分的样本明细表：
 * - 固定列：输入变量、参考答案、优化前模型回答、优化后模型回答
 * - 固定评估器列：正确性、简洁性，每列展示「优化前得分 / 优化后得分」
 */
export function EvaluatorScoreTable({
  data,
}: {
  data: PromptOptimizationSampleEvaluation[];
}) {
  const border = SAMPLE_TABLE_BORDER;
  const cellBg = SAMPLE_TABLE_CELL_BG;
  const thStyle = { ...cellBg, borderBottom: border, borderRight: border };

  return (
    <div
      style={{ width: '100%', border }}
      className="overflow-x-auto rounded-lg mt-2"
    >
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th style={thStyle} className="p-2">
              {I18n.t('prompt_optimization_input_variable')}
            </th>
            <th style={{ ...thStyle, width: 360 }} className="p-2">
              {I18n.t('prompt_optimization_reference_answer')}
            </th>
            <th style={{ ...thStyle, width: 360 }} className="p-2">
              {I18n.t('prompt_optimization_original_answer')}
            </th>
            <th style={{ ...thStyle, width: 360 }} className="p-2">
              {I18n.t('prompt_optimization_optimized_answer')}
            </th>
            {EVALUATOR_NAMES.map(name => (
              <th key={name} colSpan={2} style={thStyle} className="p-2">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, idx) => (
            <tr key={idx}>
              <td style={thStyle} className="p-2 align-top">
                {item.variables?.input ?? '-'}
              </td>
              <td style={thStyle} className="p-2 align-top break-all">
                {renderMarkdownCell(item.reference_answer)}
              </td>
              <td style={thStyle} className="p-2 align-top break-all">
                {renderMarkdownCell(item.original_answer)}
              </td>
              <td style={thStyle} className="p-2 align-top break-all">
                {renderMarkdownCell(item.optimized_answer)}
              </td>
              {EVALUATOR_NAMES.map(name => {
                const orig = item.original_evaluator_scores?.[name];
                const opt = item.optimized_evaluator_scores?.[name];
                return (
                  <Fragment key={name}>
                    <td style={thStyle} className="p-2 align-top">
                      {I18n.t('prompt_optimization_baseline_score')}：
                      {formatScore(orig)}
                    </td>
                    <td style={thStyle} className="p-2 align-top">
                      {I18n.t('prompt_optimization_best_score_lbl')}：
                      {formatScore(opt)}
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
