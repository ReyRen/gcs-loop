// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

let wujiePopupContainer: HTMLElement | null = null;

/** 是否运行在 wujie 微前端沙箱中 */
export const isWujieEnv = () =>
  typeof window !== 'undefined' &&
  !!(window as unknown as Record<string, unknown>).__POWERED_BY_WUJIE__;

/**
 * wujie 沙箱下的浮层挂载容器。
 *
 * 全局 ConfigProvider 的 getPopupContainer 默认返回 document.body，wujie 下即 shadow body，
 * 它与主文档 html 的坐标原点并不一致。Semi 的 Tooltip 会按「body 相对 html」做一次补偿，
 * 结果浮层被推到容器最右侧。
 *
 * 这里在 shadow DOM 内创建一个 position: fixed 且位于 (0,0) 的空节点作为容器：
 * 挂载到它下面时 Semi 拿到的 containerRect 恒为 (0,0) 且不会走 body 补偿分支，
 * 浮层的绝对定位坐标就与视口坐标对齐；同时也能避免被宿主 overflow 裁剪。
 * 独立运行时直接返回 document.body，不改变原有行为。
 */
export function getWujiePopupContainer(): HTMLElement {
  if (!isWujieEnv()) {
    return document.body;
  }
  if (!wujiePopupContainer || !wujiePopupContainer.isConnected) {
    wujiePopupContainer = document.createElement('div');
    Object.assign(wujiePopupContainer.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      zIndex: '1060',
    });
    document.body.appendChild(wujiePopupContainer);
  }
  return wujiePopupContainer;
}
