// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package conf

import (
	"context"
	"time"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
)

//go:generate mockgen -destination=mocks/config_provider.go -package=mocks . IConfigProvider
type IConfigProvider interface {
	GetPromptHubMaxQPSBySpace(ctx context.Context, spaceID int64) (maxQPS int, err error)
	GetPTaaSMaxQPSByPromptKey(ctx context.Context, spaceID int64, promptKey string) (maxQPS int, err error)
	GetPromptDefaultConfig(ctx context.Context) (config *prompt.PromptDetail, err error)
	GetPromptTemplatePresetCatalog(ctx context.Context) (catalog *entity.PromptTemplatePresetCatalog, err error)
	ListPresetLabels() (presetLabels []string, err error)
	GetPromptLabelVersionCacheConfig(ctx context.Context) (enable bool, ttl time.Duration, err error)
}
