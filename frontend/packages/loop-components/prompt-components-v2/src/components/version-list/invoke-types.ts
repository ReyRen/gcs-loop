// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/** 已提交版本调用信息，字段与后端 invoke_info 保持一致 */
export interface InvokeParam {
  key?: string;
  description?: string;
  type?: string;
  value_field?: string;
  example?: string;
  type_tags?: string[];
}

export interface InvokeInfo {
  prompt_key?: string;
  version?: string;
  base_url?: string;
  parameters?: InvokeParam[];
  execute_endpoint?: string;
  streaming_execute_endpoint?: string;
  request_body?: string;
  curl?: string;
  streaming_curl?: string;
}

/** 公共执行接口的 variable_vals 单项 */
export interface InvokeVariableValue {
  key: string;
  value?: string;
  placeholder_messages?: unknown[];
  multi_part_values?: unknown[];
}
