/**
 * wujie 微前端环境检测与工具函数
 *
 * 用于在主应用通过 wujie 嵌入时，适配路由前缀、环境识别等。
 */

/** 子应用在 wujie 中的挂载路径前缀，与主应用同域 */
export const WUJIE_APP_PATH_PREFIX = '/prompt';

/** 是否运行在 wujie 容器中 */
export function isWujieEnv(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return !!window.__POWERED_BY_WUJIE__;
}

/** 获取 wujie 传递的 props（主应用 setupApp 时注入） */
export function getWujieProps(): Record<string, unknown> | null {
  if (!isWujieEnv()) {
    return null;
  }
  const wujie = window.$wujie;
  return wujie?.props || null;
}

/** 获取路由 basename：wujie 环境下为 /prompt，独立运行下无前缀 */
export function getRouterBasename(): string {
  return isWujieEnv() ? WUJIE_APP_PATH_PREFIX : '/';
}

/**
 * 将内部路由 path 转为 wujie 同域完整路径
 * 例：'/console/enterprise' → '/prompt/console/enterprise'
 */
export function toWujiePath(internalPath: string): string {
  if (!internalPath.startsWith('/')) {
    internalPath = `/${internalPath}`;
  }
  return WUJIE_APP_PATH_PREFIX + internalPath;
}

/**
 * wujie 生命周期：挂载时调用
 * 由主应用 setupApp lifecycle.beforeMount/afterMount 触发，
 * 若子应用需自理挂载/卸载，可在 index.tsx 注册 window.__WUJIE_MOUNT
 */
export function onWujieMount(fn: () => void) {
  if (typeof window !== 'undefined') {
    window.__WUJIE_MOUNT = fn;
  }
}

export function onWujieUnmount(fn: () => void) {
  if (typeof window !== 'undefined') {
    window.__WUJIE_UNMOUNT = fn;
  }
}
