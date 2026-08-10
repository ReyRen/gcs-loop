// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import { Typography, Button } from '@coze-arch/coze-design';

import videoIcon from '@/assets/template-icons/video.png';
import reasoningIcon from '@/assets/template-icons/reasoning.png';
import jsonIcon from '@/assets/template-icons/json.png';
import imageIcon from '@/assets/template-icons/image.png';
import functionIcon from '@/assets/template-icons/function.png';
import copywritingIcon from '@/assets/template-icons/copywriting.png';

import { type PromptTemplate } from './types';

const ICON_MAP: Record<string, string> = {
  copywriting: copywritingIcon,
  image: imageIcon,
  video: videoIcon,
  reasoning: reasoningIcon,
  json: jsonIcon,
  function: functionIcon,
};

interface PromptTemplateCardProps {
  template: PromptTemplate;
  onClick?: (template: PromptTemplate) => void;
  onPreview?: (template: PromptTemplate) => void;
}

export const PromptTemplateCard = ({
  template,
  onClick,
  onPreview,
}: PromptTemplateCardProps) => (
  <div
    className={
      'group relative h-[175px] bg-white rounded-[12px] border border-solid ' +
      'border-[#e5e6eb] p-4 flex flex-col gap-3 cursor-pointer transition-all ' +
      'duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] ' +
      'overflow-hidden'
    }
  >
    {/* 顶部：图标 + 标题 + 分类标签 */}
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 border-solid border-[0.5px] coz-stroke-primary bg-[#EBE8E5]">
        <img
          src={ICON_MAP[template.iconKey]}
          className="w-12 h-12 rounded-[8px]"
          alt=""
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <Typography.Text
          className="!text-base !font-semibold !text-[#1f2329]"
          ellipsis={{ showTooltip: true }}
        >
          {template.title}
        </Typography.Text>
        <div>
          <span className="inline-block h-[22px] px-2 bg-[#f2f3f5] rounded text-xs leading-[22px] text-[#646a73]">
            {template.categoryDisplay || template.category}
          </span>
        </div>
      </div>
    </div>

    {/* 描述 */}
    <Typography.Text
      className="!text-sm !text-[#4e5969] !leading-[22px]"
      ellipsis={{ rows: 3, showTooltip: true }}
    >
      {template.description}
    </Typography.Text>

    {/* hover 操作按钮 */}
    <div className="absolute inset-x-0 bottom-0 h-[56px] px-4 flex items-center justify-between gap-3 bg-gradient-to-t from-white via-white to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      <Button
        size="small"
        color="primary"
        className="flex-1"
        onClick={e => {
          e.stopPropagation();
          onPreview?.(template);
        }}
      >
        {I18n.t('prompt_preview')}
      </Button>
      <Button
        size="small"
        color="brand"
        className="flex-1"
        onClick={e => {
          e.stopPropagation();
          onClick?.(template);
        }}
      >
        {I18n.t('prompt_use')}
      </Button>
    </div>
  </div>
);
