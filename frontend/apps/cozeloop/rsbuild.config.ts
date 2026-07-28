// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createRsbuildConfig } from '@cozeloop/rsbuild-config';

const port = 8090;

export default createRsbuildConfig({
  /**
   * 生产构建：所有资源从 /prompt/ 绝对路径加载
   * - wujie 嵌入：/prompt/static/js/xxx.js -> nginx 代理到 :8082 -> ✅
   * - 独立运行：需在 coze-loop nginx 中配置 /prompt/ 内部重写到根路径（见下方注释）
   *
   * nginx 示例（coze-loop 自身，解决独立运行）：
   *   location /prompt/static/ { rewrite ^/prompt/(.*)$ /$1 last; }
   *   location /prompt/        { try_files $uri /index.html; }
   */
  source: {
    define: {
      'process.env.API_SCHEMA_BASE_URL': JSON.stringify('/promptApi'),
    },
  },
  output: {
    assetPrefix: '/prompt/',
  },
  server: {
    port,
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
