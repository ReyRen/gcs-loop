// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import copy from 'copy-to-clipboard';
import { Toast } from '@coze-arch/coze-design';

/**
 * 写入剪贴板。
 * wujie 微前端环境下，copy-to-clipboard 基于 Selection 的实现会抛出
 * NotFoundError，此时直接走 Clipboard API 备用方案。
 */
async function writeClipboard(value: string) {
  const isWujie =
    typeof window !== 'undefined' &&
    !!(window as unknown as Record<string, unknown>).__POWERED_BY_WUJIE__;

  if (isWujie) {
    const { clipboard } = navigator;
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(value);
      return;
    }
  }
  copy(value);
}

export const handleCopy = async (value: string, hideToast?: boolean) => {
  try {
    await writeClipboard(value);
    !hideToast &&
      Toast.success({
        content: '复制成功',
        showClose: false,
        zIndex: 99999,
      });
    return Promise.resolve(true);
  } catch (e) {
    Toast.warning({
      content: '复制失败',
      showClose: false,
      zIndex: 99999,
    });
    console.error(e);
    return Promise.resolve(false);
  }
};

export function sleep(timer = 600) {
  return new Promise<void>(resolve => {
    setTimeout(() => resolve(), timer);
  });
}
