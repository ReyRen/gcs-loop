// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

const ApiKeysPage = lazy(() => import('./pages/api-keys'));

export function App() {
  return (
    <Routes>
      <Route path="keys" element={<ApiKeysPage />} />
    </Routes>
  );
}
