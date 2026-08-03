// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { Outlet, Navigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';

import { GuardProvider } from '@cozeloop/guard';
import { PageLoading } from '@cozeloop/components';
import { useCheckLogin, useLogin, useLoginStatus } from '@cozeloop/account';

import { useApiErrorToast } from '@/hooks';
import { LOGIN_PATH } from '@/constants';

export function BaseRoute() {
  const loginStatus = useLoginStatus();
  const login = useLogin();
  useCheckLogin();
  useApiErrorToast();
  const [searchParams] = useSearchParams();

  // 任意页面 URL 带 ?email=xxx&password=xxx 时自动登录
  useEffect(() => {
    const email = searchParams.get('email');
    const password = searchParams.get('password');
    if (email && password) {
      login(email, password);
    }
  }, [loginStatus, searchParams]);

  switch (loginStatus) {
    case 'settling':
      return <PageLoading />;
    case 'not_login':
      return <Navigate to={LOGIN_PATH} />;
    case 'logined':
      return (
        <GuardProvider>
          <Outlet />
        </GuardProvider>
      );
    default:
      return null;
  }
}
