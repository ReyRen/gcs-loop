// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/debug"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/service"
	servicemocks "github.com/coze-dev/coze-loop/backend/modules/prompt/domain/service/mocks"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
)

func TestValidateGeneratePromptRequest(t *testing.T) {
	valid := newGeneratePromptRequest(prompt.RoleSystem, "Answer {{question}} in JSON.")

	tests := []struct {
		name    string
		req     *debug.GeneratePromptRequest
		wantErr bool
	}{
		{name: "nil request", req: nil, wantErr: true},
		{name: "valid system prompt", req: valid},
		{name: "user message is not optimizable", req: newGeneratePromptRequest(prompt.RoleUser, "hello"), wantErr: true},
		{name: "empty prompt", req: newGeneratePromptRequest(prompt.RoleSystem, ""), wantErr: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateGeneratePromptRequest(tt.req)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestBuildOneStepOptimizePromptUsesDraftModelConfig(t *testing.T) {
	source := &entity.Prompt{
		ID:        101,
		SpaceID:   202,
		PromptKey: "customer-support",
		PromptDraft: &entity.PromptDraft{PromptDetail: &entity.PromptDetail{
			ModelConfig: &entity.ModelConfig{
				ModelID:     303,
				Temperature: ptr.Of(0.4),
				MaxTokens:   ptr.Of(int32(2048)),
			},
		}},
	}
	req := newGeneratePromptRequest(prompt.RoleSystem, "Answer {{question}} in JSON.")
	req.PromptName = ptr.Of("support")
	req.PromptDesc = ptr.Of("answer customers")
	req.IsRetry = ptr.Of(true)

	optimized, messages := buildOneStepOptimizePrompt(source, req, req.GetOriginalPromptMessage().GetContent())

	require.NotNil(t, optimized)
	detail := optimized.GetPromptDetail()
	require.NotNil(t, detail)
	require.NotNil(t, detail.ModelConfig)
	assert.Equal(t, int64(303), detail.ModelConfig.ModelID)
	assert.Equal(t, 0.4, ptr.From(detail.ModelConfig.Temperature))
	assert.Equal(t, int32(2048), ptr.From(detail.ModelConfig.MaxTokens))
	assert.NotSame(t, source.GetPromptDetail().ModelConfig, detail.ModelConfig)
	require.Len(t, detail.PromptTemplate.Messages, 1)
	assert.Equal(t, entity.RoleSystem, detail.PromptTemplate.Messages[0].Role)

	require.Len(t, messages, 1)
	assert.Equal(t, entity.RoleUser, messages[0].Role)
	assert.True(t, ptr.From(messages[0].SkipRender))
	userContent := ptr.From(messages[0].Content)
	assert.Contains(t, userContent, "{{question}}")
	assert.Contains(t, userContent, "meaningfully different")
	assert.Contains(t, userContent, "Output only the rewritten prompt body now.")
}

func TestGetOptimizeSourcePromptFallsBackToLatestCommit(t *testing.T) {
	ctrl := gomock.NewController(t)
	promptService := servicemocks.NewMockIPromptService(ctrl)
	ctx := context.Background()

	promptAfterCommit := &entity.Prompt{
		ID:        101,
		SpaceID:   202,
		PromptKey: "customer-support",
		PromptBasic: &entity.PromptBasic{
			LatestVersion: "1.0.0",
		},
	}
	latestCommit := promptAfterCommit.Clone()
	latestCommit.PromptCommit = &entity.PromptCommit{PromptDetail: &entity.PromptDetail{
		ModelConfig: &entity.ModelConfig{ModelID: 303},
	}}

	promptService.EXPECT().GetPrompt(ctx, service.GetPromptParam{
		PromptID:  101,
		WithDraft: true,
		UserID:    "user-1",
	}).Return(promptAfterCommit, nil)
	promptService.EXPECT().GetPrompt(ctx, service.GetPromptParam{
		PromptID:      101,
		WithCommit:    true,
		CommitVersion: "1.0.0",
		UserID:        "user-1",
	}).Return(latestCommit, nil)

	app := &PromptDebugApplicationImpl{promptService: promptService}
	got, err := app.getOptimizeSourcePrompt(ctx, 101, "user-1")

	require.NoError(t, err)
	require.NotNil(t, got)
	require.NotNil(t, got.GetPromptDetail())
	require.NotNil(t, got.GetPromptDetail().ModelConfig)
	assert.Equal(t, int64(303), got.GetPromptDetail().ModelConfig.ModelID)
}

func TestGetOptimizeSourcePromptPrefersDraft(t *testing.T) {
	ctrl := gomock.NewController(t)
	promptService := servicemocks.NewMockIPromptService(ctrl)
	ctx := context.Background()
	draftPrompt := &entity.Prompt{
		ID:        101,
		SpaceID:   202,
		PromptKey: "customer-support",
		PromptBasic: &entity.PromptBasic{
			LatestVersion: "1.0.0",
		},
		PromptDraft: &entity.PromptDraft{PromptDetail: &entity.PromptDetail{
			ModelConfig: &entity.ModelConfig{ModelID: 404},
		}},
	}

	promptService.EXPECT().GetPrompt(ctx, service.GetPromptParam{
		PromptID:  101,
		WithDraft: true,
		UserID:    "user-1",
	}).Return(draftPrompt, nil)

	app := &PromptDebugApplicationImpl{promptService: promptService}
	got, err := app.getOptimizeSourcePrompt(ctx, 101, "user-1")

	require.NoError(t, err)
	assert.Same(t, draftPrompt, got)
	assert.Equal(t, int64(404), got.GetPromptDetail().ModelConfig.ModelID)
}

func TestOneStepOptimizeSystemPromptRequiresBodyOnly(t *testing.T) {
	assert.Contains(t, oneStepOptimizeSystemPrompt, "Start the response immediately with the first character")
	assert.Contains(t, oneStepOptimizeSystemPrompt, "Do not output analysis, reasoning")
	assert.Contains(t, oneStepOptimizeSystemPrompt, "只输出优化后的 Prompt 正文")
	assert.NotContains(t, oneStepOptimizeSystemPrompt, "<optimized_prompt>")
	assert.NotContains(t, oneStepOptimizeSystemPrompt, "</optimized_prompt>")
}

func TestBuildGeneratePromptUsageResponseHasNoDisplayDelta(t *testing.T) {
	resp := buildGeneratePromptUsageResponse(123, &entity.TokenUsage{
		InputTokens:  10,
		OutputTokens: 20,
	})

	require.NotNil(t, resp)
	assert.Nil(t, resp.Delta)
	assert.Equal(t, int64(123), resp.GetRecordID())
	require.NotNil(t, resp.Usage)
	assert.Equal(t, int64(10), resp.Usage.GetInputTokens())
	assert.Equal(t, int64(20), resp.Usage.GetOutputTokens())
}

func TestMessageText(t *testing.T) {
	assert.Equal(t, "plain", messageText(&entity.Message{Content: ptr.Of("plain")}))
	assert.Equal(t, "first second", messageText(&entity.Message{Parts: []*entity.ContentPart{
		{Type: entity.ContentTypeText, Text: ptr.Of("first ")},
		{Type: entity.ContentTypeImageURL},
		{Type: entity.ContentTypeText, Text: ptr.Of("second")},
	}}))
	assert.Empty(t, messageText(nil))
}

func newGeneratePromptRequest(role prompt.Role, content string) *debug.GeneratePromptRequest {
	return &debug.GeneratePromptRequest{
		GeneratePromptType:    ptr.Of(debug.GeneratePromptTypeOneStepOptimize),
		SpaceID:               ptr.Of(int64(202)),
		PromptID:              ptr.Of(int64(101)),
		OriginalPromptMessage: &prompt.Message{Role: ptr.Of(role), Content: ptr.Of(content)},
	}
}
