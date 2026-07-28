// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Suspense } from 'react';

import { sendEvent } from '@cozeloop/tea-adapter';
import { I18n } from '@cozeloop/i18n-adapter';
import { CozeLoopProvider, PageLoading } from '@cozeloop/components';

import { getRouterBasename } from './wujie-env';
import { routeConfig } from './routes';
import { useSetupI18n } from './hooks';
import { LocaleProvider } from './components';

import './index.css';

const router = createBrowserRouter(routeConfig, {
  basename: getRouterBasename(),
});

export function App() {
  useSetupI18n();

  return (
    <CozeLoopProvider i18n={I18n} sendEvent={sendEvent}>
      <Suspense fallback={<PageLoading />}>
        <LocaleProvider>
          <RouterProvider router={router} />
        </LocaleProvider>
      </Suspense>
    </CozeLoopProvider>
  );
}
