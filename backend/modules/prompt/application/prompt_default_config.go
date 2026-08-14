// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"

	"github.com/coze-dev/coze-loop/backend/modules/prompt/application/convertor"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/component/conf"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
)

// ensurePromptModelConfig materializes the deployment default only when a
// Prompt has no executable model. The returned bool tells callers whether the
// in-memory Prompt changed and should be persisted (for example, a draft).
func ensurePromptModelConfig(ctx context.Context, promptDO *entity.Prompt, provider conf.IConfigProvider) (*entity.Prompt, bool, error) {
	if promptDO == nil || provider == nil {
		return promptDO, false, nil
	}
	if promptDO.PromptBasic != nil && promptDO.PromptBasic.PromptType == entity.PromptTypeSnippet {
		return promptDO, false, nil
	}
	detail := promptDO.GetPromptDetail()
	if detail == nil || (detail.ModelConfig != nil && detail.ModelConfig.ModelID > 0) {
		return promptDO, false, nil
	}

	defaultDetail, err := provider.GetPromptDefaultConfig(ctx)
	if err != nil {
		return promptDO, false, err
	}
	if defaultDetail == nil || defaultDetail.GetModelConfig() == nil || defaultDetail.GetModelConfig().GetModelID() <= 0 {
		return promptDO, false, nil
	}

	clonedPrompt := promptDO.Clone()
	if clonedPrompt == nil || clonedPrompt.GetPromptDetail() == nil {
		return promptDO, false, nil
	}
	clonedPrompt.GetPromptDetail().ModelConfig = convertor.ModelConfigDTO2DO(defaultDetail.GetModelConfig())
	return clonedPrompt, true, nil
}
