// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
)

func TestBuildPromptInvokeInfoBuildsVersionSpecificCurlExamples(t *testing.T) {
	t.Parallel()

	template := &entity.PromptTemplate{VariableDefs: []*entity.VariableDef{
		{Key: "topic", Desc: "文章主题", Type: entity.VariableTypeString},
		{Key: "enabled", Type: entity.VariableTypeBoolean},
		{Key: "count", Type: entity.VariableTypeInteger},
		{Key: "score", Type: entity.VariableTypeFloat},
		{Key: "profile", Type: entity.VariableTypeObject},
		{Key: "tags", Type: entity.VariableTypeArrayString},
		{Key: "flags", Type: entity.VariableTypeArrayBoolean},
		{Key: "ids", Type: entity.VariableTypeArrayInteger},
		{Key: "weights", Type: entity.VariableTypeArrayFloat},
		{Key: "records", Type: entity.VariableTypeArrayObject},
		{Key: "history", Desc: "历史对话", Type: entity.VariableTypePlaceholder},
		{Key: "attachment", Desc: "待分析素材", Type: entity.VariableTypeMultiPart},
		nil,
	}}

	info, err := BuildPromptInvokeInfo(PromptInvokeInfoInput{
		WorkspaceID:    7670078211023175681,
		PromptKey:      " bidding_proposal_writing ",
		Version:        " 0.0.3 ",
		BaseURL:        "https://gcs.example.com/",
		PromptTemplate: template,
	})
	require.NoError(t, err)
	require.NotNil(t, info)

	assert.Equal(t, promptExecuteEndpoint, info.ExecuteEndpoint)
	assert.Equal(t, promptExecuteStreamingEndpoint, info.StreamingExecuteEndpoint)
	assert.Equal(t, "https://gcs.example.com", info.BaseURL)
	require.Len(t, info.Parameters, 12)
	assert.Contains(t, info.RequestBody, "\n  \"workspace_id\"")

	var request promptInvokeRequestExample
	require.NoError(t, json.Unmarshal([]byte(info.RequestBody), &request))
	assert.Equal(t, "7670078211023175681", request.WorkspaceID)
	assert.Equal(t, "bidding_proposal_writing", request.PromptIdentifier.PromptKey)
	assert.Equal(t, "0.0.3", request.PromptIdentifier.Version)
	require.Len(t, request.VariableVals, 12)

	values := make(map[string]promptInvokeVariableValueExample, len(request.VariableVals))
	for _, variableVal := range request.VariableVals {
		values[variableVal.Key] = variableVal
	}
	assert.Equal(t, "请填写：文章主题", dereferenceString(values["topic"].Value))
	assert.Equal(t, "true", dereferenceString(values["enabled"].Value))
	assert.Equal(t, "1", dereferenceString(values["count"].Value))
	assert.Equal(t, "1.5", dereferenceString(values["score"].Value))
	assert.Equal(t, `{"key":"value"}`, dereferenceString(values["profile"].Value))
	assert.Equal(t, `["example"]`, dereferenceString(values["tags"].Value))
	assert.Equal(t, `[true,false]`, dereferenceString(values["flags"].Value))
	assert.Equal(t, `[1,2]`, dereferenceString(values["ids"].Value))
	assert.Equal(t, `[1.5,2.5]`, dereferenceString(values["weights"].Value))
	assert.Equal(t, `[{"key":"value"}]`, dereferenceString(values["records"].Value))

	require.Len(t, values["history"].PlaceholderMessages, 1)
	assert.Equal(t, entity.RoleUser, values["history"].PlaceholderMessages[0].Role)
	assert.Equal(t, "请填写：历史对话", values["history"].PlaceholderMessages[0].Content)
	assert.Nil(t, values["history"].Value)

	require.Len(t, values["attachment"].MultiPartValues, 2)
	assert.Equal(t, entity.ContentTypeText, values["attachment"].MultiPartValues[0].Type)
	assert.Equal(t, "请填写：待分析素材", values["attachment"].MultiPartValues[0].Text)
	assert.Equal(t, entity.ContentTypeImageURL, values["attachment"].MultiPartValues[1].Type)
	assert.Equal(t, "https://example.com/image.png", values["attachment"].MultiPartValues[1].ImageURL)
	assert.Nil(t, values["attachment"].Value)

	parameters := make(map[string]*PromptInvokeParameter, len(info.Parameters))
	for _, parameter := range info.Parameters {
		parameters[parameter.Key] = parameter
	}
	assert.Equal(t, "value", parameters["topic"].ValueField)
	assert.Equal(t, entity.VariableTypeString, parameters["topic"].Type)
	assert.Equal(t, "placeholder_messages", parameters["history"].ValueField)
	assert.Equal(t, "multi_part_values", parameters["attachment"].ValueField)

	assert.True(t, strings.HasPrefix(info.Curl, "curl --request POST"))
	assert.Contains(t, info.Curl, shellSingleQuote("https://gcs.example.com"+promptExecuteEndpoint))
	assert.Contains(t, info.Curl, "Authorization: Bearer ${GCS_LOOP_API_TOKEN}")
	assert.Contains(t, info.Curl, shellSingleQuote(info.RequestBody))
	assert.NotContains(t, strings.ToLower(info.Curl), "sdk")
	assert.NotContains(t, strings.ToLower(info.Curl), "python")

	assert.True(t, strings.HasPrefix(info.StreamingCurl, "curl --request POST"))
	assert.Contains(t, info.StreamingCurl, shellSingleQuote("https://gcs.example.com"+promptExecuteStreamingEndpoint))
	assert.Contains(t, info.StreamingCurl, `Accept: text/event-stream`)
	assert.Contains(t, info.StreamingCurl, "--no-buffer")
	assert.Contains(t, info.StreamingCurl, shellSingleQuote(info.RequestBody))
}

func TestBuildPromptInvokeInfoUsesMultiPartTypeTags(t *testing.T) {
	t.Parallel()

	imageTypeTags := []string{" IMAGE_URL "}
	info, err := BuildPromptInvokeInfo(PromptInvokeInfoInput{
		WorkspaceID: 1,
		PromptKey:   "media_prompt",
		Version:     "1.0.0",
		PromptTemplate: &entity.PromptTemplate{VariableDefs: []*entity.VariableDef{
			{Key: "image", Type: entity.VariableTypeMultiPart, TypeTags: imageTypeTags},
			{Key: "video", Type: entity.VariableTypeMultiPart, TypeTags: []string{"video"}},
		}},
	})
	require.NoError(t, err)
	require.Len(t, info.Parameters, 2)
	assert.Equal(t, []string{" IMAGE_URL "}, info.Parameters[0].TypeTags)
	assert.Equal(t, []string{"video"}, info.Parameters[1].TypeTags)
	imageTypeTags[0] = "mutated"
	assert.Equal(t, []string{" IMAGE_URL "}, info.Parameters[0].TypeTags)

	var request promptInvokeRequestExample
	require.NoError(t, json.Unmarshal([]byte(info.RequestBody), &request))
	require.Len(t, request.VariableVals, 2)
	require.Len(t, request.VariableVals[0].MultiPartValues, 1)
	assert.Equal(t, entity.ContentTypeImageURL, request.VariableVals[0].MultiPartValues[0].Type)
	assert.Equal(t, "https://example.com/image.png", request.VariableVals[0].MultiPartValues[0].ImageURL)
	require.Len(t, request.VariableVals[1].MultiPartValues, 1)
	assert.Equal(t, entity.ContentTypeVideoURL, request.VariableVals[1].MultiPartValues[0].Type)
	assert.Equal(t, "https://example.com/video.mp4", request.VariableVals[1].MultiPartValues[0].VideoURL)
}

func TestBuildPromptInvokeInfoProducesEmptyVariableArray(t *testing.T) {
	t.Parallel()

	info, err := BuildPromptInvokeInfo(PromptInvokeInfoInput{
		WorkspaceID:    1,
		PromptKey:      "no_variables",
		Version:        "1.0.0",
		PromptTemplate: &entity.PromptTemplate{},
	})
	require.NoError(t, err)
	assert.Empty(t, info.Parameters)
	assert.Contains(t, info.RequestBody, `"variable_vals": []`)
}

func TestBuildPromptInvokeInfoKeepsBaseURLPlaceholderWhenOriginIsUnavailable(t *testing.T) {
	t.Parallel()

	info, err := BuildPromptInvokeInfo(PromptInvokeInfoInput{
		WorkspaceID:    1,
		PromptKey:      "prompt_key",
		Version:        "1.0.0",
		PromptTemplate: &entity.PromptTemplate{},
	})
	require.NoError(t, err)
	assert.Empty(t, info.BaseURL)
	assert.Contains(t, info.Curl, "${GCS_LOOP_BASE_URL}"+promptExecuteEndpoint)
}

func TestBuildPromptInvokeInfoRejectsInvalidInput(t *testing.T) {
	t.Parallel()

	validInput := PromptInvokeInfoInput{
		WorkspaceID:    1,
		PromptKey:      "prompt_key",
		Version:        "1.0.0",
		PromptTemplate: &entity.PromptTemplate{},
	}
	tests := []struct {
		name  string
		input PromptInvokeInfoInput
	}{
		{name: "workspace id", input: func() PromptInvokeInfoInput { v := validInput; v.WorkspaceID = 0; return v }()},
		{name: "prompt key", input: func() PromptInvokeInfoInput { v := validInput; v.PromptKey = " "; return v }()},
		{name: "version", input: func() PromptInvokeInfoInput { v := validInput; v.Version = " "; return v }()},
		{name: "prompt template", input: func() PromptInvokeInfoInput { v := validInput; v.PromptTemplate = nil; return v }()},
		{name: "base URL", input: func() PromptInvokeInfoInput { v := validInput; v.BaseURL = "http://$(id)"; return v }()},
		{name: "empty variable key", input: func() PromptInvokeInfoInput {
			v := validInput
			v.PromptTemplate = &entity.PromptTemplate{VariableDefs: []*entity.VariableDef{{Type: entity.VariableTypeString}}}
			return v
		}()},
		{name: "duplicate variable key", input: func() PromptInvokeInfoInput {
			v := validInput
			v.PromptTemplate = &entity.PromptTemplate{VariableDefs: []*entity.VariableDef{
				{Key: "key", Type: entity.VariableTypeString},
				{Key: "key", Type: entity.VariableTypeString},
			}}
			return v
		}()},
		{name: "unsupported variable type", input: func() PromptInvokeInfoInput {
			v := validInput
			v.PromptTemplate = &entity.PromptTemplate{VariableDefs: []*entity.VariableDef{{Key: "raw", Type: entity.VariableType("bytes")}}}
			return v
		}()},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := BuildPromptInvokeInfo(tt.input)
			assert.Error(t, err)
		})
	}
}

func TestBuildPromptInvokeInfoPreservesPersistedVariableKeys(t *testing.T) {
	t.Parallel()

	info, err := BuildPromptInvokeInfo(PromptInvokeInfoInput{
		WorkspaceID: 1,
		PromptKey:   "prompt_key",
		Version:     "1.0.0",
		PromptTemplate: &entity.PromptTemplate{VariableDefs: []*entity.VariableDef{
			{Key: " exact_key ", Type: entity.VariableTypeString},
		}},
	})
	require.NoError(t, err)
	require.Len(t, info.Parameters, 1)
	assert.Equal(t, " exact_key ", info.Parameters[0].Key)

	var request promptInvokeRequestExample
	require.NoError(t, json.Unmarshal([]byte(info.RequestBody), &request))
	require.Len(t, request.VariableVals, 1)
	assert.Equal(t, " exact_key ", request.VariableVals[0].Key)
}

func TestShellSingleQuoteEscapesPromptKeysSafely(t *testing.T) {
	t.Parallel()

	quoted := shellSingleQuote("sales'prompt")
	assert.Equal(t, `'sales'"'"'prompt'`, quoted)
}

func dereferenceString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
