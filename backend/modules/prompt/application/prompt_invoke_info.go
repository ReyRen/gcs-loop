// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
	"github.com/coze-dev/coze-loop/backend/pkg/urlutil"
)

const (
	promptExecuteEndpoint          = "/v1/loop/prompts/execute"
	promptExecuteStreamingEndpoint = "/v1/loop/prompts/execute_streaming"
)

// PromptInvokeInfoInput identifies one immutable Prompt version and supplies
// the template whose variables must be represented in the invocation example.
type PromptInvokeInfoInput struct {
	WorkspaceID    int64
	PromptKey      string
	Version        string
	BaseURL        string
	PromptTemplate *entity.PromptTemplate
}

// PromptInvokeParameter describes how one Prompt variable is supplied to the
// public execute endpoints. Example is the value of ValueField, not an entire
// variable_vals item.
type PromptInvokeParameter struct {
	Key         string              `json:"key"`
	Description string              `json:"description,omitempty"`
	Type        entity.VariableType `json:"type"`
	TypeTags    []string            `json:"type_tags,omitempty"`
	ValueField  string              `json:"value_field"`
	Example     any                 `json:"example"`
}

// PromptInvokeInfo contains the HTTP-only invocation material shown for a
// published Prompt version. The token remains an environment placeholder; the
// public deployment origin is embedded when it is known for the current HTTP
// request.
type PromptInvokeInfo struct {
	Parameters               []*PromptInvokeParameter `json:"parameters"`
	BaseURL                  string                   `json:"base_url,omitempty"`
	ExecuteEndpoint          string                   `json:"execute_endpoint"`
	StreamingExecuteEndpoint string                   `json:"streaming_execute_endpoint"`
	RequestBody              string                   `json:"request_body"`
	Curl                     string                   `json:"curl"`
	StreamingCurl            string                   `json:"streaming_curl"`
}

type promptInvokeRequestExample struct {
	WorkspaceID      string                             `json:"workspace_id"`
	PromptIdentifier promptInvokePromptIdentifier       `json:"prompt_identifier"`
	VariableVals     []promptInvokeVariableValueExample `json:"variable_vals"`
}

type promptInvokePromptIdentifier struct {
	PromptKey string `json:"prompt_key"`
	Version   string `json:"version"`
}

type promptInvokeVariableValueExample struct {
	Key                 string                           `json:"key"`
	Value               *string                          `json:"value,omitempty"`
	PlaceholderMessages []promptInvokeMessageExample     `json:"placeholder_messages,omitempty"`
	MultiPartValues     []promptInvokeContentPartExample `json:"multi_part_values,omitempty"`
}

type promptInvokeMessageExample struct {
	Role    entity.Role `json:"role"`
	Content string      `json:"content"`
}

type promptInvokeContentPartExample struct {
	Type     entity.ContentType `json:"type"`
	Text     string             `json:"text,omitempty"`
	ImageURL string             `json:"image_url,omitempty"`
	VideoURL string             `json:"video_url,omitempty"`
}

// BuildPromptInvokeInfo builds version-specific curl examples for both public
// execute endpoints. It has no dependency on generated IDL types so it can be
// reused by application handlers and converters.
func BuildPromptInvokeInfo(input PromptInvokeInfoInput) (*PromptInvokeInfo, error) {
	if input.WorkspaceID <= 0 {
		return nil, fmt.Errorf("workspace id must be positive")
	}
	promptKey := strings.TrimSpace(input.PromptKey)
	if promptKey == "" {
		return nil, fmt.Errorf("prompt key is required")
	}
	version := strings.TrimSpace(input.Version)
	if version == "" {
		return nil, fmt.Errorf("prompt version is required")
	}
	if input.PromptTemplate == nil {
		return nil, fmt.Errorf("prompt template is required")
	}

	parameters := make([]*PromptInvokeParameter, 0, len(input.PromptTemplate.VariableDefs))
	variableVals := make([]promptInvokeVariableValueExample, 0, len(input.PromptTemplate.VariableDefs))
	seenKeys := make(map[string]struct{}, len(input.PromptTemplate.VariableDefs))
	for _, variableDef := range input.PromptTemplate.VariableDefs {
		if variableDef == nil {
			continue
		}
		// Variable names are part of the persisted template contract. Preserve
		// them byte-for-byte so the generated request is rendered with the same
		// key that PromptTemplate.Format uses at execution time.
		key := variableDef.Key
		if strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("prompt variable key is required")
		}
		if _, ok := seenKeys[key]; ok {
			return nil, fmt.Errorf("duplicate prompt variable key %q", key)
		}
		seenKeys[key] = struct{}{}

		parameter, variableVal, err := buildPromptInvokeVariableExample(variableDef, key)
		if err != nil {
			return nil, err
		}
		parameters = append(parameters, parameter)
		variableVals = append(variableVals, variableVal)
	}

	request := promptInvokeRequestExample{
		WorkspaceID: strconv.FormatInt(input.WorkspaceID, 10),
		PromptIdentifier: promptInvokePromptIdentifier{
			PromptKey: promptKey,
			Version:   version,
		},
		VariableVals: variableVals,
	}
	body, err := json.MarshalIndent(request, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal prompt invoke request example: %w", err)
	}
	requestBody := string(body)
	baseURL := ""
	if strings.TrimSpace(input.BaseURL) != "" {
		baseURL = urlutil.NormalizeHTTPOrigin(input.BaseURL)
		if baseURL == "" {
			return nil, fmt.Errorf("prompt invoke base URL is invalid")
		}
	}

	return &PromptInvokeInfo{
		Parameters:               parameters,
		BaseURL:                  baseURL,
		ExecuteEndpoint:          promptExecuteEndpoint,
		StreamingExecuteEndpoint: promptExecuteStreamingEndpoint,
		RequestBody:              requestBody,
		Curl:                     buildPromptInvokeCurl(baseURL, promptExecuteEndpoint, requestBody, false),
		StreamingCurl:            buildPromptInvokeCurl(baseURL, promptExecuteStreamingEndpoint, requestBody, true),
	}, nil
}

func buildPromptInvokeVariableExample(variableDef *entity.VariableDef, key string) (*PromptInvokeParameter, promptInvokeVariableValueExample, error) {
	parameter := &PromptInvokeParameter{
		Key:         key,
		Description: strings.TrimSpace(variableDef.Desc),
		Type:        variableDef.Type,
		TypeTags:    append([]string(nil), variableDef.TypeTags...),
	}
	variableVal := promptInvokeVariableValueExample{Key: key}

	var value string
	switch variableDef.Type {
	case entity.VariableTypeString:
		value = promptInvokeTextExample(variableDef, key)
	case entity.VariableTypeBoolean:
		value = "true"
	case entity.VariableTypeInteger:
		value = "1"
	case entity.VariableTypeFloat:
		value = "1.5"
	case entity.VariableTypeObject:
		value = `{"key":"value"}`
	case entity.VariableTypeArrayString:
		value = `["example"]`
	case entity.VariableTypeArrayBoolean:
		value = `[true,false]`
	case entity.VariableTypeArrayInteger:
		value = `[1,2]`
	case entity.VariableTypeArrayFloat:
		value = `[1.5,2.5]`
	case entity.VariableTypeArrayObject:
		value = `[{"key":"value"}]`
	case entity.VariableTypePlaceholder:
		messages := []promptInvokeMessageExample{{
			Role:    entity.RoleUser,
			Content: promptInvokeTextExample(variableDef, key),
		}}
		parameter.ValueField = "placeholder_messages"
		parameter.Example = messages
		variableVal.PlaceholderMessages = messages
		return parameter, variableVal, nil
	case entity.VariableTypeMultiPart:
		parts := promptInvokeMultiPartExample(variableDef, key)
		parameter.ValueField = "multi_part_values"
		parameter.Example = parts
		variableVal.MultiPartValues = parts
		return parameter, variableVal, nil
	default:
		return nil, promptInvokeVariableValueExample{}, fmt.Errorf("unsupported prompt variable type %q for key %q", variableDef.Type, key)
	}

	parameter.ValueField = "value"
	parameter.Example = value
	variableVal.Value = &value
	return parameter, variableVal, nil
}

func promptInvokeTextExample(variableDef *entity.VariableDef, key string) string {
	if description := strings.TrimSpace(variableDef.Desc); description != "" {
		return "请填写：" + description
	}
	return "请填写变量 " + key
}

func promptInvokeMultiPartExample(variableDef *entity.VariableDef, key string) []promptInvokeContentPartExample {
	for _, tag := range variableDef.TypeTags {
		switch strings.ToLower(strings.TrimSpace(tag)) {
		case "video", "video_url":
			return []promptInvokeContentPartExample{{
				Type:     entity.ContentTypeVideoURL,
				VideoURL: "https://example.com/video.mp4",
			}}
		case "image", "image_url":
			return []promptInvokeContentPartExample{{
				Type:     entity.ContentTypeImageURL,
				ImageURL: "https://example.com/image.png",
			}}
		}
	}
	return []promptInvokeContentPartExample{
		{
			Type: entity.ContentTypeText,
			Text: promptInvokeTextExample(variableDef, key),
		},
		{
			Type:     entity.ContentTypeImageURL,
			ImageURL: "https://example.com/image.png",
		},
	}
}

func buildPromptInvokeCurl(baseURL, endpoint, requestBody string, streaming bool) string {
	target := `"${GCS_LOOP_BASE_URL}` + endpoint + `"`
	if baseURL != "" {
		target = shellSingleQuote(baseURL + endpoint)
	}
	lines := []string{
		`curl --request POST \`,
		fmt.Sprintf(`  %s \`, target),
		`  --header "Authorization: Bearer ${GCS_LOOP_API_TOKEN}" \`,
		`  --header "Content-Type: application/json" \`,
	}
	if streaming {
		lines = append(lines,
			`  --header "Accept: text/event-stream" \`,
			`  --no-buffer \`,
		)
	}
	lines = append(lines, "  --data-binary "+shellSingleQuote(requestBody))
	return strings.Join(lines, "\n")
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}
