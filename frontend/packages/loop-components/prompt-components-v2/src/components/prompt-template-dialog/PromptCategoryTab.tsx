// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { type PromptTemplateCategory } from './types';

interface PromptCategoryTabProps {
  categories: PromptTemplateCategory[];
  activeKey: string;
  onChange: (key: string) => void;
}

export const PromptCategoryTab = ({
  categories,
  activeKey,
  onChange,
}: PromptCategoryTabProps) => (
  <div className="flex items-center gap-2 overflow-x-auto">
    {categories.map(cat => (
      <button
        key={cat.key}
        onClick={() => onChange(cat.key)}
        className={`h-9 px-4 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-200 border-0 cursor-pointer ${
          activeKey === cat.key
            ? 'bg-[#f2f3f5] text-[#1f2329]'
            : 'bg-transparent text-[#646a73] hover:bg-[#f7f8fa]'
        }`}
      >
        {cat.label}
      </button>
    ))}
  </div>
);
