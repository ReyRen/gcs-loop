// Copyright (c) 2026 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package eino

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/modules/llm/domain/entity"
)

func TestPrepareOpenAIMessages(t *testing.T) {
	input := []*entity.Message{
		{Role: entity.RoleSystem},
		{Role: entity.RoleUser, Content: "Hello"},
		{Role: entity.RoleAssistant},
		{Role: entity.RoleUser},
		{Role: entity.RoleAssistant, Content: " "},
		{Role: entity.RoleUser, MultiModalContent: []*entity.ChatMessagePart{{Type: entity.ChatMessagePartTypeImageURL}}},
		{Role: entity.RoleAssistant, ToolCalls: []*entity.ToolCall{{ID: "call_1"}}},
		{Role: entity.RoleTool, ToolCallID: "call_1"},
		{Role: entity.RoleAssistant, ReasoningContent: "reasoning"},
	}
	l := &LLM{protocol: entity.ProtocolOpenAI}
	require.Equal(t, []*entity.Message{input[1], input[4], input[5], input[6], input[7], input[8]}, l.prepareMessages(input))
	require.Len(t, input, 9, "the original debug history must not be modified")
	l.protocol = entity.ProtocolArk
	require.Equal(t, input, l.prepareMessages(input))
}

// Exercise the real OpenAI SDK serializer in both execution paths. A mock
// ChatModel would miss the omitempty behavior that caused Ollama's HTTP 400.
func TestOpenAIEmptyDebugMessagesOnWire(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", streaming), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Messages []struct {
						Role    string          `json:"role"`
						Content json.RawMessage `json:"content"`
					} `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					http.Error(w, "invalid JSON", http.StatusBadRequest)
					return
				}
				if len(request.Messages) != 2 {
					t.Errorf("expected two nonempty messages, got %d", len(request.Messages))
					http.Error(w, "unexpected empty messages", http.StatusBadRequest)
					return
				}
				for _, msg := range request.Messages {
					if len(msg.Content) == 0 || string(msg.Content) == "null" {
						t.Errorf("missing content for %s message", msg.Role)
						http.Error(w, "invalid message content type: <nil>", http.StatusBadRequest)
						return
					}
				}
				if streaming {
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"OK\"},\"finish_reason\":null}]}\n\n")
					fmt.Fprint(w, "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
				} else {
					w.Header().Set("Content-Type", "application/json")
					fmt.Fprint(w, `{"id":"test","choices":[{"index":0,"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`)
				}
			}))
			defer server.Close()
			ctx := context.Background()
			llm, err := NewLLM(ctx, &entity.Model{
				ID: 1, Name: "test", Frame: entity.FrameEino, Protocol: entity.ProtocolOpenAI,
				ProtocolConfig: &entity.ProtocolConfig{BaseURL: server.URL + "/v1", APIKey: "dummy", Model: "test"},
			}, entity.WithMaxTokens(16))
			require.NoError(t, err)
			input := []*entity.Message{
				{Role: entity.RoleSystem},
				{Role: entity.RoleUser, Content: "Hello"},
				{Role: entity.RoleAssistant},
				{Role: entity.RoleUser, Content: "Reply OK"},
			}
			if !streaming {
				reply, err := llm.Generate(ctx, input)
				require.NoError(t, err)
				require.Equal(t, "OK", reply.Content)
				return
			}
			stream, err := llm.Stream(ctx, input)
			require.NoError(t, err)
			var answer string
			for {
				chunk, err := stream.Recv()
				if err == io.EOF {
					break
				}
				require.NoError(t, err)
				answer += chunk.Content
			}
			require.Equal(t, "OK", answer)
		})
	}
}

func TestOpenAIEmptyDebugMessagesLive(t *testing.T) {
	baseURL := os.Getenv("GCS_LOOP_LIVE_MODEL_BASE_URL")
	if baseURL == "" {
		t.Skip("set GCS_LOOP_LIVE_MODEL_BASE_URL to test a running model service")
	}
	for _, name := range []string{"qwen3:30b-instruct", "qwen2.5vl:7b"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			llm, err := NewLLM(ctx, &entity.Model{
				ID: 1, Name: name, Frame: entity.FrameEino, Protocol: entity.ProtocolOpenAI,
				ProtocolConfig: &entity.ProtocolConfig{BaseURL: baseURL, APIKey: "dummy", Model: name},
			}, entity.WithMaxTokens(64), entity.WithTemperature(0))
			require.NoError(t, err)
			stream, err := llm.Stream(ctx, []*entity.Message{
				{Role: entity.RoleSystem},
				{Role: entity.RoleUser, Content: "Hello"},
				{Role: entity.RoleAssistant},
				{Role: entity.RoleUser, Content: "The service warranty is 12 months. How many months is it? Answer with the number only."},
			})
			require.NoError(t, err)
			var answer string
			for {
				chunk, err := stream.Recv()
				if err == io.EOF {
					break
				}
				require.NoError(t, err)
				answer += chunk.Content
			}
			require.Contains(t, answer, "12")
			t.Logf("model=%s answer=%q", name, answer)
		})
	}
}
