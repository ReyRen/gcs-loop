// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import cs from 'classnames';
import { type Theme, Typography, type Ellipsis } from '@coze-arch/coze-design';

let tooltipPopupContainer: HTMLElement | null = null;

/**
 * 获取 ellipsis tooltip 的浮层挂载容器。
 *
 * wujie 沙箱下浮层若挂到 shadow body，会受基座容器 overflow 的裁剪；
 * 这里在 shadow DOM 内创建一个 position: fixed 的空节点来脱离裁剪
 * （通过 document.createElement/body.appendChild 创建，wujie 会代理到
 * shadow 内部，因此不跨 shadow boundary、不报错、样式也不丢失）。
 */
function getTooltipPopupContainer(): HTMLElement {
  const isWujie =
    typeof window !== 'undefined' &&
    !!(window as unknown as Record<string, unknown>).__POWERED_BY_WUJIE__;
  if (!isWujie) {
    return document.body;
  }
  if (!tooltipPopupContainer || !tooltipPopupContainer.isConnected) {
    tooltipPopupContainer = document.createElement('div');
    tooltipPopupContainer.style.position = 'fixed';
    tooltipPopupContainer.style.top = '0';
    tooltipPopupContainer.style.left = '0';
    tooltipPopupContainer.style.width = '0';
    tooltipPopupContainer.style.height = '0';
    tooltipPopupContainer.style.zIndex = '1060';
    document.body.appendChild(tooltipPopupContainer);
  }
  return tooltipPopupContainer;
}

export const TextEllipsis = ({
  children,
  emptyText = '-',
  className,
  theme = 'dark',
}: {
  children: React.ReactNode;
  emptyText?: string;
  className?: string;
  theme?: 'dark' | 'light';
}) => (
  <Typography.Text
    ellipsis={{
      showTooltip: {
        opts: {
          theme,
          getPopupContainer: getTooltipPopupContainer,
        },
      },
    }}
    className={cs('!text-[13px] !coz-fg-plus text-left', className)}
  >
    {children || emptyText}
  </Typography.Text>
);

export function TypographyText({
  ellipsis = {},
  children,
  style = {},
  className,
  tooltipTheme,
}: {
  children: React.ReactNode;
  ellipsis?: Ellipsis;
  style?: React.CSSProperties;
  className?: string;
  tooltipTheme?: Theme;
}) {
  return (
    <Typography.Text
      className={className}
      style={{
        fontSize: 'inherit',
        color: 'inherit',
        fontWeight: 'inherit',
        lineHeight: 'inherit',
        ...style,
      }}
      ellipsis={{
        rows: 1,
        showTooltip: {
          opts: {
            theme: tooltipTheme ?? 'dark',
            getPopupContainer: getTooltipPopupContainer,
          },
        },
        ...ellipsis,
      }}
    >
      {children}
    </Typography.Text>
  );
}
