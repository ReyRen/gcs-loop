// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import { IconCozPlus } from '@coze-arch/coze-design/icons';

import { type PromptTemplate } from './types';
import { PromptTemplateCard } from './PromptTemplateCard';

interface PromptTemplateGridProps {
  templates: PromptTemplate[];
  onSelect?: (template: PromptTemplate) => void;
  onPreview?: (template: PromptTemplate) => void;
  onCreateClick?: () => void;
}

export const PromptTemplateGrid = ({
  templates,
  onSelect,
  onPreview,
  onCreateClick,
}: PromptTemplateGridProps) => (
  <div
    className="grid gap-5 overflow-y-auto pr-1"
    style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
  >
    {/* 自定义创建卡片 */}
    <div
      onClick={onCreateClick}
      className="h-[175px] rounded-[12px] border border-solid border-[#e5e6eb] bg-white flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">
        <IconCozPlus className="w-5 h-5" />
      </div>
      <span className="text-sm font-medium">
        {I18n.t('prompt_custom_create')}
      </span>
    </div>

    {/* 模板卡片 */}
    {templates.map(template => (
      <PromptTemplateCard
        key={template.id}
        template={template}
        onClick={onSelect}
        onPreview={onPreview}
      />
    ))}

    {/* 空搜索提示 */}
    {templates.length === 0 ? (
      <div className="col-span-3 py-16 text-center text-sm text-[#86909c]">
        {I18n.t('prompt_no_template_found')}
      </div>
    ) : null}
  </div>
);
