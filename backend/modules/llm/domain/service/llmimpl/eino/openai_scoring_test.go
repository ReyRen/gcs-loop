// Copyright (c) 2026 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package eino

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/modules/llm/domain/entity"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
)

func TestOpenAIScoringThinkingOnWire(t *testing.T) {
	for _, tc := range []struct {
		name   string
		optIn  bool
		scorer bool
	}{
		{name: "opted-in evaluator", optIn: true, scorer: true},
		{name: "optimizer on same model", optIn: true},
		{name: "evaluator on unconfigured model", scorer: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/v1/chat/completions", r.URL.Path)
				assert.Equal(t, "Bearer dummy", r.Header.Get("Authorization"))
				var request struct {
					MaxTokens  int               `json:"max_tokens"`
					Tools      []json.RawMessage `json:"tools"`
					ToolChoice struct {
						Type     string `json:"type"`
						Function struct {
							Name string `json:"name"`
						} `json:"function"`
					} `json:"tool_choice"`
					Kwargs *struct {
						EnableThinking *bool `json:"enable_thinking"`
					} `json:"chat_template_kwargs"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					http.Error(w, "invalid test request", http.StatusBadRequest)
					return
				}
				assert.Equal(t, 256, request.MaxTokens)
				assert.Len(t, request.Tools, 1)
				assert.Equal(t, "function", request.ToolChoice.Type)
				assert.Equal(t, "submit_score", request.ToolChoice.Function.Name)
				if tc.optIn && tc.scorer {
					if assert.NotNil(t, request.Kwargs) && assert.NotNil(t, request.Kwargs.EnableThinking) {
						assert.False(t, *request.Kwargs.EnableThinking)
					}
				} else {
					assert.Nil(t, request.Kwargs)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"id":"test","choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"submit_score","arguments":"{\"score\":1,\"reason\":\"Matches warranty.\"}"}}]},"finish_reason":"tool_calls"}]}`)
			}))
			defer server.Close()

			opts := []entity.Option{entity.WithMaxTokens(256),
				entity.WithToolChoice(ptr.Of(entity.ToolChoiceRequired)),
				entity.WithTools([]*entity.ToolInfo{{
					Name: "submit_score", ToolDefType: entity.ToolDefTypeOpenAPIV3,
					Def: `{"type":"object","properties":{"score":{"type":"number"},"reason":{"type":"string"}},"required":["score","reason"]}`,
				}}),
			}
			if tc.scorer {
				opts = append(opts, entity.WithEvaluatorScoring())
			}
			ctx := context.Background()
			model, err := NewLLM(ctx, &entity.Model{
				Protocol: entity.ProtocolOpenAI, Frame: entity.FrameEino,
				ProtocolConfig: &entity.ProtocolConfig{
					BaseURL: server.URL + "/v1", APIKey: "dummy", Model: "test", TimeoutMs: ptr.Of(int64(5000)),
					ProtocolConfigOpenAI: &entity.ProtocolConfigOpenAI{DisableThinkingForScoring: tc.optIn},
				},
			}, opts...)
			require.NoError(t, err)
			reply, err := model.Generate(ctx, []*entity.Message{{Role: entity.RoleUser, Content: "Check the warranty answer."}}, opts...)
			require.NoError(t, err)
			require.Len(t, reply.ToolCalls, 1)
			assert.Equal(t, "submit_score", reply.ToolCalls[0].Function.Name)
			assert.JSONEq(t, `{"score":1,"reason":"Matches warranty."}`, reply.ToolCalls[0].Function.Arguments)
		})
	}
}
