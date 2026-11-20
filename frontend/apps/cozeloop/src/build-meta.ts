/**
 * Prompt 子应用构建元数据（Rsbuild define 注入 __PROMPT_BUILD_META__）
 */

export type PromptBuildMeta = {
  app: string;
  name: string;
  version: string;
  branch: string;
  commit: string;
  commitShort: string;
  commitAt: string;
  dirty: boolean;
  builtAt: string;
  mode: string;
};

declare const __PROMPT_BUILD_META__: PromptBuildMeta | undefined;

const injected =
  typeof __PROMPT_BUILD_META__ !== 'undefined' &&
  __PROMPT_BUILD_META__ &&
  typeof __PROMPT_BUILD_META__ === 'object'
    ? __PROMPT_BUILD_META__
    : null;

export const BUILD_META: PromptBuildMeta = Object.freeze({
  app: injected?.app || 'prompt',
  name: injected?.name || '@cozeloop/community-base',
  version: injected?.version || '0.0.0',
  branch: injected?.branch || 'unknown',
  commit: injected?.commit || 'unknown',
  commitShort: injected?.commitShort || 'unknown',
  commitAt: injected?.commitAt || 'unknown',
  dirty: Boolean(injected?.dirty),
  builtAt: injected?.builtAt || 'unknown',
  mode: injected?.mode || 'development',
});

/** 挂到子应用 window，并尽量回写 parent，供主应用双击版本号读取 */
export function publishPromptBuildMeta() {
  if (typeof window === 'undefined') {
    return;
  }

  window.__PROMPT_BUILD_META__ = BUILD_META;
  console.warn('[build] prompt', BUILD_META);

  try {
    if (window.parent && window.parent !== window) {
      window.parent.__PROMPT_BUILD_META__ = BUILD_META;
    }
  } catch {
    // ignore cross-origin
  }
}
