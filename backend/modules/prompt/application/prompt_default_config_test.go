// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	confmocks "github.com/coze-dev/coze-loop/backend/modules/prompt/domain/component/conf/mocks"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
)

func TestEnsurePromptModelConfig_ClonesAndAppliesDefault(t *testing.T) {
	ctrl := gomock.NewController(t)
	provider := confmocks.NewMockIConfigProvider(ctrl)
	provider.EXPECT().GetPromptDefaultConfig(gomock.Any()).Return(&prompt.PromptDetail{
		ModelConfig: &prompt.ModelConfig{ModelID: ptr.Of(int64(1))},
	}, nil)

	original := &entity.Prompt{
		PromptBasic: &entity.PromptBasic{PromptType: entity.PromptTypeNormal},
		PromptCommit: &entity.PromptCommit{PromptDetail: &entity.PromptDetail{
			PromptTemplate: &entity.PromptTemplate{},
		}},
	}

	got, changed, err := ensurePromptModelConfig(context.Background(), original, provider)

	require.NoError(t, err)
	assert.True(t, changed)
	require.NotSame(t, original, got)
	assert.Nil(t, original.GetPromptDetail().ModelConfig, "cached source prompt must remain immutable")
	require.NotNil(t, got.GetPromptDetail().ModelConfig)
	assert.Equal(t, int64(1), got.GetPromptDetail().ModelConfig.ModelID)
}

func TestEnsurePromptModelConfig_PreservesExplicitModel(t *testing.T) {
	ctrl := gomock.NewController(t)
	provider := confmocks.NewMockIConfigProvider(ctrl)
	original := &entity.Prompt{
		PromptBasic: &entity.PromptBasic{PromptType: entity.PromptTypeNormal},
		PromptCommit: &entity.PromptCommit{PromptDetail: &entity.PromptDetail{
			ModelConfig: &entity.ModelConfig{ModelID: 99},
		}},
	}

	got, changed, err := ensurePromptModelConfig(context.Background(), original, provider)

	require.NoError(t, err)
	assert.False(t, changed)
	assert.Same(t, original, got)
	assert.Equal(t, int64(99), got.GetPromptDetail().ModelConfig.ModelID)
}
