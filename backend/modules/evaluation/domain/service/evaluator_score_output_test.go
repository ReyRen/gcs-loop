// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package service

import (
	"context"
	"strconv"
	"testing"

	"github.com/bytedance/gg/gptr"
	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
)

func TestParseOutputRejectsIncompleteOrUnstructuredScores(t *testing.T) {
	for _, tc := range []struct {
		name      string
		reply     *entity.ReplyItem
		parseType entity.ParseType
	}{
		{"truncated final JSON", &entity.ReplyItem{Content: gptr.Of(`{"score":0.9,"reason":"unfinished"}`), FinishReason: "length"}, entity.ParseTypeContent},
		{"truncated tool call", &entity.ReplyItem{ToolCalls: []*entity.ToolCall{{FunctionCall: &entity.FunctionCall{Name: "eval", Arguments: gptr.Of(`{"score":0.9,"reason":"unfinished"}`)}}}, FinishReason: "length"}, entity.ParseTypeFunctionCall},
		{"reasoning JSON is not final output", &entity.ReplyItem{ReasoningContent: gptr.Of(`{"score":1,"reason":"draft score"}`)}, entity.ParseTypeContent},
		{"reasoning mentions five", &entity.ReplyItem{ReasoningContent: gptr.Of("We need to score the Actual_output. Knowledge Base: 5 items.")}, entity.ParseTypeContent},
		{"text mentions nine", &entity.ReplyItem{Content: gptr.Of("We should score the output after examining overload 9.")}, entity.ParseTypeContent},
		{"nonfinite score", &entity.ReplyItem{Content: gptr.Of(`{"score":"NaN","reason":"invalid"}`)}, entity.ParseTypeContent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			output, err := parseOutput(context.Background(), &entity.PromptEvaluatorVersion{ParseType: tc.parseType}, tc.reply, 1, true)
			require.Error(t, err)
			require.Nil(t, output.EvaluatorResult.Score)
		})
	}
}

func TestParseOutputUsesFinalResultAndKeepsCustomScales(t *testing.T) {
	for _, score := range []float64{0, 1, 1.5} {
		content := `{"score":` + strconv.FormatFloat(score, 'f', -1, 64) + `,"reason":"final"}`
		output, err := parseOutput(context.Background(), &entity.PromptEvaluatorVersion{ParseType: entity.ParseTypeContent},
			&entity.ReplyItem{Content: &content, ReasoningContent: gptr.Of(`{"score":9,"reason":"draft"}`), FinishReason: "stop"}, 1, true)
		require.NoError(t, err)
		require.Equal(t, score, *output.EvaluatorResult.Score)
	}
}
