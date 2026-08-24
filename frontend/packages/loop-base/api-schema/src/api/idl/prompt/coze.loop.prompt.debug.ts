// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import * as prompt from './domain/prompt';
export { prompt };
import * as base from './../../../base';
export { base };
import { createAPI } from './../../config';
export const DebugStreaming = /*#__PURE__*/createAPI<DebugStreamingRequest, DebugStreamingResponse, {
  prompt_id: string | number;
}>({
  "url": "/api/prompt/v1/prompts/:prompt_id/debug_streaming",
  "method": "POST",
  "name": "DebugStreaming",
  "reqType": "DebugStreamingRequest",
  "reqMapping": {
    "body": ["prompt", "messages", "variable_vals", "mock_tools", "single_step_debug", "debug_trace_key"]
  },
  "resType": "DebugStreamingResponse",
  "schemaRoot": "api://schemas/prompt_coze.loop.prompt.debug",
  "service": "promptDebug"
});
export const GeneratePrompt = /*#__PURE__*/createAPI<GeneratePromptRequest, GeneratePromptResponse>({
  "url": "/api/prompt/v1/prompts/generate",
  "method": "POST",
  "name": "GeneratePrompt",
  "reqType": "GeneratePromptRequest",
  "reqMapping": {
    "body": ["generate_prompt_type", "space_id", "prompt_id", "prompt_key", "prompt_name", "prompt_desc", "original_prompt_message", "is_retry", "user_message", "assistant_message", "variable_vals", "feedback"]
  },
  "resType": "GeneratePromptResponse",
  "schemaRoot": "api://schemas/prompt_coze.loop.prompt.debug",
  "service": "promptDebug"
});
export const UpdateGenerateRecord = /*#__PURE__*/createAPI<UpdateGenerateRecordRequest, UpdateGenerateRecordResponse>({
  "url": "/api/prompt/v1/prompts/generate/record/:record_id/update",
  "method": "POST",
  "name": "UpdateGenerateRecord",
  "reqType": "UpdateGenerateRecordRequest",
  "reqMapping": {
    "path": ["record_id"],
    "body": ["space_id", "prompt_id", "is_liked", "is_disliked", "is_accepted", "is_canceled"]
  },
  "resType": "UpdateGenerateRecordResponse",
  "schemaRoot": "api://schemas/prompt_coze.loop.prompt.debug",
  "service": "promptDebug"
});
export const SaveDebugContext = /*#__PURE__*/createAPI<SaveDebugContextRequest, SaveDebugContextResponse>({
  "url": "/api/prompt/v1/prompts/:prompt_id/debug_context/save",
  "method": "POST",
  "name": "SaveDebugContext",
  "reqType": "SaveDebugContextRequest",
  "reqMapping": {
    "path": ["prompt_id"],
    "body": ["workspace_id", "debug_context"]
  },
  "resType": "SaveDebugContextResponse",
  "schemaRoot": "api://schemas/prompt_coze.loop.prompt.debug",
  "service": "promptDebug"
});
export const GetDebugContext = /*#__PURE__*/createAPI<GetDebugContextRequest, GetDebugContextResponse>({
  "url": "/api/prompt/v1/prompts/:prompt_id/debug_context/get",
  "method": "GET",
  "name": "GetDebugContext",
  "reqType": "GetDebugContextRequest",
  "reqMapping": {
    "path": ["prompt_id"],
    "query": ["workspace_id"]
  },
  "resType": "GetDebugContextResponse",
  "schemaRoot": "api://schemas/prompt_coze.loop.prompt.debug",
  "service": "promptDebug"
});
export const ListDebugHistory = /*#__PURE__*/createAPI<ListDebugHistoryRequest, ListDebugHistoryResponse>({
  "url": "/api/prompt/v1/prompts/:prompt_id/debug_history/list",
  "method": "GET",
  "name": "ListDebugHistory",
  "reqType": "ListDebugHistoryRequest",
  "reqMapping": {
    "path": ["prompt_id"],
    "query": ["workspace_id", "days_limit", "page_size", "page_token"]
  },
  "resType": "ListDebugHistoryResponse",
  "schemaRoot": "api://schemas/prompt_coze.loop.prompt.debug",
  "service": "promptDebug"
});
export interface DebugStreamingRequest {
  prompt?: prompt.Prompt,
  messages?: prompt.Message[],
  variable_vals?: prompt.VariableVal[],
  mock_tools?: prompt.MockTool[],
  single_step_debug?: boolean,
  debug_trace_key?: string,
}
export interface DebugStreamingResponse {
  delta?: prompt.Message,
  finish_reason?: string,
  usage?: prompt.TokenUsage,
  debug_id?: string,
  debug_trace_key?: string,
}
export enum GeneratePromptType {
  GeneratePromptTypeOneStepOptimize = "one_step_optimize",
  GeneratePromptTypeFeedbackOptimize = "feedback_optimize",
}
export interface GeneratePromptRequest {
  generate_prompt_type?: GeneratePromptType,
  space_id?: string,
  prompt_id?: string,
  prompt_key?: string,
  prompt_name?: string,
  prompt_desc?: string,
  original_prompt_message?: prompt.Message,
  is_retry?: boolean,
  user_message?: prompt.Message,
  assistant_message?: prompt.Message,
  variable_vals?: prompt.VariableVal[],
  feedback?: string,
}
export interface GeneratePromptResponse {
  delta?: prompt.Message,
  usage?: prompt.TokenUsage,
  record_id?: string,
}
export interface UpdateGenerateRecordRequest {
  record_id?: string,
  space_id?: string,
  prompt_id?: string,
  is_liked?: boolean,
  is_disliked?: boolean,
  is_accepted?: boolean,
  is_canceled?: boolean,
}
export interface UpdateGenerateRecordResponse {}
export interface SaveDebugContextRequest {
  prompt_id?: string,
  workspace_id?: string,
  debug_context?: prompt.DebugContext,
}
export interface SaveDebugContextResponse {}
export interface GetDebugContextRequest {
  prompt_id?: string,
  workspace_id?: string,
}
export interface GetDebugContextResponse {
  debug_context?: prompt.DebugContext
}
export interface ListDebugHistoryRequest {
  prompt_id?: string,
  workspace_id?: string,
  days_limit?: number,
  page_size?: number,
  page_token?: string,
}
export interface ListDebugHistoryResponse {
  debug_history?: prompt.DebugLog[],
  has_more?: boolean,
  next_page_token?: string,
}