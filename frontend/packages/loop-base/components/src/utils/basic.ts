// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import copy from 'copy-to-clipboard';
import { Toast } from '@coze-arch/coze-design';

/**
 * 写入剪贴板。
 * wujie 微前端环境下需特殊处理：
 * - Clipboard API 要求 document 处于 focus 状态，需先 window.focus()
 * - copy-to-clipboard 复制成功后，其 finally 清理 Selection 时会抛 NotFoundError，
 *   但此时复制已成功，需忽略该错误
 */
async function writeClipboard(value: string) {
  const isWujie =
    typeof window !== 'undefined' &&
    !!(window as unknown as Record<string, unknown>).__POWERED_BY_WUJIE__;

  if (!isWujie) {
    copy(value);
    return;
  }

  const { clipboard } = navigator;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      // writeText 要求 document 处于 focus 状态，否则抛 Document is not focused
      window.focus();
      await clipboard.writeText(value);
      return;
    } catch {
      // Clipboard API 不可用（如 Document is not focused），回退到 execCommand 方案
      console.error('Clipboard API 不可用');
    }
  }

  try {
    copy(value);
  } catch (e) {
    // copy-to-clipboard 复制成功后，finally 清理 Selection 时抛 NotFoundError，
    // 此时复制已成功，忽略该错误
    if ((e as { name?: string })?.name !== 'NotFoundError') {
      throw e;
    }
  }
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
