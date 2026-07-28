// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createRsbuildConfig } from '@cozeloop/rsbuild-config';

const port = 8090;

export default createRsbuildConfig({
  /** 输出配置：作为 wujie 子应用，静态资源统一从 /prompt/ 路径加载 */
  output: {
    assetPrefix: '/prompt/',
  },
  server: {
    port,
    cors: {
      origin: '*',
    },
    proxy: {
      '/api': {
        target: 'http://172.18.36.230:8082',
        changeOrigin: true,
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
