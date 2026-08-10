// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/debug"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
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
	assert.False(t, strings.Contains(userContent, optimizedPromptStartTag))
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
