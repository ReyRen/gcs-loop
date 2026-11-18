// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';

import { getPath } from './utils';
import {
  type RouteInfoURLParams,
  type UseRouteInfo,
  type UseOpenWindow,
} from './types';

/** 是否运行在 wujie 微前端沙箱中 */
const isWujieEnv = () =>
  typeof window !== 'undefined' &&
  !!(window as unknown as Record<string, unknown>).__POWERED_BY_WUJIE__;

/**
 * wujie 子应用挂载前缀（如 /prompt），由当前 pathname 首段推导。
 * 独立运行时返回空串。
 */
const getWujiePathPrefix = () => {
  if (!isWujieEnv()) {
    return '';
  }
  const first = window.location.pathname.split('/')[1];
  return first ? `/${first}` : '';
};

/**
 * 处理链接跳转
 * @returns
 */
export const createUseOpenWindow =
  (useRouteInfo: UseRouteInfo): UseOpenWindow =>
  () => {
    const { getBaseURL } = useRouteInfo();
    const navigate = useNavigate();

    const getURL = useCallback(
      (path: string, params?: RouteInfoURLParams) => {
        if (path.startsWith('http://') || path.startsWith('https://')) {
          return path;
        }
        const dynamicBaseURL = getBaseURL(params);
        const basePath = getPath(path, dynamicBaseURL);
        // wujie 下 window.location.pathname 比路由 baseURL 多一个挂载前缀（如 /prompt），
        // window.open / location.href 等使用浏览器完整路径，需补回前缀
        return `${getWujiePathPrefix()}${basePath}`;
      },
      [getBaseURL],
    );
    /**
     * 打开新窗口
     */
    const openBlank = useCallback(
      (path: string, params?: RouteInfoURLParams) => {
        window.open(getURL(path, params));
      },
      [getURL],
    );

    /**
     * 原窗口加载地址
     */
    const openSelf = useCallback(
      (path: string, params?: RouteInfoURLParams) => {
        if (isWujieEnv()) {
          // wujie 下 window.open(url, '_self') 会直接导航隐藏 iframe 触发栈溢出；
          // location.href 又会被 wujie 解析成绝对 URL，导致主应用路由参数变成完整地址。
          // 这里改走 react-router 的 SPA 导航（history.pushState），
          // wujie 通过 history 代理把相对路径同步回主应用。
          navigate(getPath(path, getBaseURL(params)));
          return;
        }
        window.open(getURL(path, params), '_self');
      },
      [navigate, getBaseURL, getURL],
    );

    return {
      openBlank,
      openSelf,
      getURL,
    };
  };
