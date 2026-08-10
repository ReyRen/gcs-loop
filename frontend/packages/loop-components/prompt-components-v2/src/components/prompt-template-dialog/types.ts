// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  iconKey: string;
  templateKey: string;
  draftDetail?: Record<string, unknown>;
  categoryDisplay?: string;
}

export interface PromptTemplateCategory {
  key: string;
  label: string;
  value?: string;
}

export const CATEGORY_VALUE_MAP: Record<string, string> = {
  text: 'text_generation',
  image: 'image_analysis',
  video: 'video_understanding',
  reasoning: 'deep_reasoning',
  json: 'json_output',
  function: 'function_calling',
};

export const TEMPLATE_CATEGORIES: PromptTemplateCategory[] = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本创作', value: 'text_generation' },
  { key: 'image', label: '图片分析', value: 'image_analysis' },
  { key: 'video', label: '视频理解', value: 'video_understanding' },
  { key: 'reasoning', label: '深度思考', value: 'deep_reasoning' },
  { key: 'json', label: 'Json输出', value: 'json_output' },
  { key: 'function', label: '函数调用', value: 'function_calling' },
];
