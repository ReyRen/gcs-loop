// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';

import { useDebounce, useRequest } from 'ahooks';
import { I18n } from '@cozeloop/i18n-adapter';
import { type PromptTemplatePresetCategory } from '@cozeloop/api-schema/prompt';
import { StonePromptApi } from '@cozeloop/api-schema';
import { IconCozCross, IconCozLoading } from '@coze-arch/coze-design/icons';
import { Search, Modal } from '@coze-arch/coze-design';

import { type PromptTemplate } from './types';
import { PromptTemplateGrid } from './PromptTemplateGrid';
import { PromptCategoryTab } from './PromptCategoryTab';

interface PromptTemplateDialogProps {
  visible: boolean;
  spaceID: string;
  onCancel: () => void;
  onSelect?: (template: PromptTemplate) => void;
  onPreview?: (template: PromptTemplate) => void;
  onCreateClick?: () => void;
}

export const PromptTemplateDialog = ({
  visible,
  spaceID,
  onCancel,
  onSelect,
  onPreview,
  onCreateClick,
}: PromptTemplateDialogProps) => {
  const [searchKeyword, setSearchKeyword] = useState('');
  const debouncedSearch = useDebounce(searchKeyword, { wait: 300 });
  const [activeCategory, setActiveCategory] = useState('all');

  // 从接口获取模板列表
  const templatesRequest = useRequest(
    async () => {
      const categoryFilter: PromptTemplatePresetCategory[] | undefined =
        activeCategory !== 'all'
          ? [activeCategory as PromptTemplatePresetCategory]
          : undefined;
      const res = await StonePromptApi.ListPromptTemplates({
        workspace_id: spaceID,
        categories: categoryFilter,
        key_word: debouncedSearch || undefined,
      });
      const categoryDisplayMap: Record<string, string> = {};
      (res.categories || []).forEach(c => {
        if (c.category) {
          categoryDisplayMap[c.category] = c.display_name || c.category;
        }
      });
      const templates = (res.prompt_templates || []).map(
        (t): PromptTemplate => ({
          id: t.template_key || '',
          title: t.display_name || '',
          description: t.description || '',
          category: t.category || '',
          iconKey: t.icon_key || '',
          templateKey: t.template_key || '',
          draftDetail: t.draft_detail,
          categoryDisplay: categoryDisplayMap[t.category || ''] || t.category,
        }),
      );
      const categoryTabs = (res.categories || []).map(c => ({
        key: c.category || '',
        label: c.display_name || '',
      }));
      return { templates, categoryTabs };
    },
    {
      refreshDeps: [activeCategory, debouncedSearch, spaceID],
      ready: visible,
    },
  );

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      width={1100}
      footer={null}
      hasScroll={false}
      className="!rounded-2xl"
      header={
        <div className="flex items-center justify-between w-full">
          <h2 className="text-xl font-semibold text-[#1f2329] m-0">
            {I18n.t('prompt_template_title')}
          </h2>
          <Search
            value={searchKeyword}
            onChange={setSearchKeyword}
            placeholder={I18n.t('prompt_search_template_placeholder')}
            width={360}
          />
          <div
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f2f3f5] cursor-pointer flex-shrink-0 ml-3"
          >
            <IconCozCross className="w-4 h-4 text-[#646a73]" />
          </div>
        </div>
      }
    >
      {/* 分类 Tab */}
      <div className="flex-shrink-0">
        <PromptCategoryTab
          categories={[
            { key: 'all', label: '全部' },
            ...(templatesRequest.data?.categoryTabs || []),
          ]}
          activeKey={activeCategory}
          onChange={setActiveCategory}
        />
      </div>

      {/* 模板卡片区域 */}
      <div
        className="overflow-y-auto mt-4"
        style={{ height: 'calc(100vh - 400px)' }}
      >
        {templatesRequest.loading ? (
          <div className="flex items-center justify-center h-full">
            <IconCozLoading className="w-6 h-6 animate-spin text-[#646a73]" />
          </div>
        ) : (
          <PromptTemplateGrid
            templates={templatesRequest.data?.templates || []}
            onSelect={onSelect}
            onPreview={onPreview}
            onCreateClick={onCreateClick}
          />
        )}
      </div>
    </Modal>
  );
};
