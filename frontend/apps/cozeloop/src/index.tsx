// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createRoot, type Root } from 'react-dom/client';
import { initIntl } from '@cozeloop/i18n-adapter';
import { dynamicImportMdBoxStyle } from '@coze-arch/bot-md-box-adapter/style';
import { pullFeatureFlags, type FEATURE_FLAGS } from '@coze-arch/bot-flags';

import { isWujieEnv, onWujieMount, onWujieUnmount } from './wujie-env';

let root: Root | null = null;

/** 渲染 React 应用到 DOM */
export async function render() {
  await Promise.all([
    initIntl({
      fallbackLng: ['zh-CN', 'en-US'],
    }),
    pullFeatureFlags({
      timeout: 1000 * 4,
      fetchFeatureGating: () => Promise.resolve({} as unknown as FEATURE_FLAGS),
    }),
    dynamicImportMdBoxStyle(),
  ]);

  const dom = document.getElementById('cozeloop-root');

  if (dom) {
    const { App } = await import('./app');
    root = createRoot(dom);
    root.render(<App />);
  }
}

/** 卸载 React 应用 */
export function unmount() {
  if (root) {
    root.unmount();
    root = null;
  }
}

// ====== wujie 生命周期注册 ======
// wujie 嵌入时，主应用通过 setupApp lifecycle 控制子应用的挂载/卸载。
// 子应用在此注册 window 上的生命周期钩子，供 wujie 框架调用。

if (isWujieEnv()) {
  // 提供给 wujie 的挂载方法
  onWujieMount(() => {
    render();
  });

  // 提供给 wujie 的卸载方法
  onWujieUnmount(() => {
    unmount();
  });
} else {
  // 独立运行时直接渲染（非 wujie 环境：开发调试或独立部署）
  render();
}
