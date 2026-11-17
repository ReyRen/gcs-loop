// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createRsbuildConfig } from '@cozeloop/rsbuild-config';

import { collectPromptBuildMeta } from './build-meta.collect';

const port = 8090;

const PROMPT_BUILD_META = collectPromptBuildMeta({
  mode: process.env.NODE_ENV || 'development',
});
// eslint-disable-next-line no-console -- build-time visibility for local deploy tracing
console.warn('[build-meta] prompt', PROMPT_BUILD_META);

export default createRsbuildConfig({
  /**
   * 生产构建：所有资源从 /prompt/ 绝对路径加载
   * - wujie 嵌入：/prompt/static/js/xxx.js 由主站 nginx 托管
   * - nginx 配置：frontend/micro-app-prompt-conf.d/
   */
  source: {
    define: {
      'process.env.API_SCHEMA_BASE_URL': JSON.stringify('/promptApi'),
      // 与 API_SCHEMA 一样预先 JSON.stringify（shared formatDefineVars 不会再包一层 app define）
      __PROMPT_BUILD_META__: JSON.stringify(PROMPT_BUILD_META),
    },
  },
  output: {
    assetPrefix: '/prompt/',
    distPath: {
      root: '../../dist/micro-app-prompt',
    },
  },
  server: {
    host: '0.0.0.0',
    port,
    /** model 开发代理剥掉 /prompt 后，支持 /auth/*、/console/* 等 SPA 深链。 */
    historyApiFallback: true,
    cors: {
      origin: '*',
    },
    proxy: {
      '/promptApi': {
        target: 'http://172.18.36.230:8082',
        changeOrigin: true,
        pathRewrite: { '^/promptApi': '' },
      },
      '/open-api': {
        target: 'http://your-backend-host:8888',
        changeOrigin: true,
      },
    },
  },
  dev: {
    lazyCompilation: false,
    /** 开发模式资源前缀设为 /prompt/，与代理路径对齐 */
    assetPrefix: '/prompt/',
    client: {
      port: `${port}`,
      host: 'localhost',
      protocol: 'ws',
    },
  },
  html: {
    title: 'Coze Loop',
    template: './src/assets/template.html',
    favicon: './src/assets/images/coze.svg',
    crossorigin: 'anonymous',
  },
});
