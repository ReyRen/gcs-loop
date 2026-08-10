// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package convertor

import (
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/manage"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
)

func PromptTemplatePresetCategoryInfoDO2DTO(category *entity.PromptTemplatePresetCategoryInfo) *manage.PromptTemplatePresetCategoryInfo {
	if category == nil {
		return nil
	}
	return &manage.PromptTemplatePresetCategoryInfo{
		Category:    ptr.Of(manage.PromptTemplatePresetCategory(category.Category)),
		DisplayName: ptr.Of(category.DisplayName),
	}
}

func PromptTemplatePresetDO2DTO(preset *entity.PromptTemplatePreset) *manage.PromptTemplatePreset {
	if preset == nil {
		return nil
	}
	return &manage.PromptTemplatePreset{
		TemplateKey: ptr.Of(preset.TemplateKey),
		DisplayName: ptr.Of(preset.DisplayName),
		Description: ptr.Of(preset.Description),
		Category:    ptr.Of(manage.PromptTemplatePresetCategory(preset.Category)),
		IconKey:     ptr.Of(preset.IconKey),
		DraftDetail: PromptDetailDO2DTO(preset.PromptDetail),
	}
}
