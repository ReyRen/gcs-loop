// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { createAPI } from '../../config';

/** 获取 personal_access_tokens 列表 */
export const ListPersonalAccessTokens = createAPI<
  ListTokensRequest,
  ListTokensResponse
>({
  url: '/api/auth/v1/personal_access_tokens/list',
  method: 'POST',
  name: 'ListPersonalAccessTokens',
  reqType: 'ListTokensRequest',
  reqMapping: { body: ['page_number', 'page_size'] },
  resType: 'ListTokensResponse',
  schemaRoot: 'api://schemas/foundation_coze.loop.foundation.auth',
  service: 'foundationAuth',
});

export interface ListTokensRequest {
  page_number?: number;
  page_size?: number;
}

export interface ListTokensResponse {
  code?: number;
  msg?: string;
  personal_access_tokens?: TokenItem[];
  total?: number;
  extra?: Record<string, string>;
}

export interface TokenItem {
  id?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  expire_at?: string;
  last_used_at?: string;
}

/** 创建 personal_access_token */
export const CreatePersonalAccessToken = createAPI<
  CreateTokenRequest,
  CreateTokenResponse
>({
  url: '/api/auth/v1/personal_access_tokens',
  method: 'POST',
  name: 'CreatePersonalAccessToken',
  reqType: 'CreateTokenRequest',
  reqMapping: { body: ['name', 'duration_day', 'expire_at'] },
  resType: 'CreateTokenResponse',
  schemaRoot: 'api://schemas/foundation_coze.loop.foundation.auth',
  service: 'foundationAuth',
});

export interface CreateTokenRequest {
  name?: string;
  duration_day?: string;
  expire_at?: number;
}

export interface CreateTokenResponse {
  code?: number;
  msg?: string;
}

/** 修改 personal_access_token */
export const UpdatePersonalAccessToken = createAPI<
  UpdateTokenRequest,
  UpdateTokenResponse
>({
  url: '/api/auth/v1/personal_access_tokens/:id',
  method: 'PUT',
  name: 'UpdatePersonalAccessToken',
  reqType: 'UpdateTokenRequest',
  reqMapping: { path: ['id'], body: ['name'] },
  resType: 'UpdateTokenResponse',
  schemaRoot: 'api://schemas/foundation_coze.loop.foundation.auth',
  service: 'foundationAuth',
});

export interface UpdateTokenRequest {
  id?: string;
  name?: string;
}

export interface UpdateTokenResponse {
  code?: number;
  msg?: string;
}

/** 删除 personal_access_token */
export const DeletePersonalAccessToken = createAPI<
  DeleteTokenRequest,
  DeleteTokenResponse
>({
  url: '/api/auth/v1/personal_access_tokens/:id',
  method: 'DELETE',
  name: 'DeletePersonalAccessToken',
  reqType: 'DeleteTokenRequest',
  reqMapping: { path: ['id'] },
  resType: 'DeleteTokenResponse',
  schemaRoot: 'api://schemas/foundation_coze.loop.foundation.auth',
  service: 'foundationAuth',
});

export interface DeleteTokenRequest {
  id?: string;
}

export interface DeleteTokenResponse {
  code?: number;
  msg?: string;
}

/** 获取 public_api_config */
export const GetPublicApiConfig = createAPI<
  GetPublicApiConfigRequest,
  GetPublicApiConfigResponse
>({
  url: '/api/auth/v1/public_api_config',
  method: 'GET',
  name: 'GetPublicApiConfig',
  reqType: 'GetPublicApiConfigRequest',
  reqMapping: { query: ['workspace_id'] },
  resType: 'GetPublicApiConfigResponse',
  schemaRoot: 'api://schemas/foundation_coze.loop.foundation.auth',
  service: 'foundationAuth',
});

export interface GetPublicApiConfigRequest {
  workspace_id?: string;
}

export interface GetPublicApiConfigResponse {
  code?: number;
  msg?: string;
  host?: string;
  api_key?: string;
  base_url?: string;
}
