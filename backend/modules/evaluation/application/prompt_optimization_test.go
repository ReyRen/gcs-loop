// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"testing"

	"github.com/bytedance/gg/gptr"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/component/rpc"
	rpcmocks "github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/component/rpc/mocks"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
)

func TestOptimizationMetricsFromResults(t *testing.T) {
	results := []*expt.PromptOptimizationSampleEvaluation{
		{OriginalScore: gptr.Of(0.2), OptimizedScore: gptr.Of(0.8), OptimizedEvaluatorScores: map[string]float64{"101": 0.8}},
		{OriginalScore: gptr.Of(0.9), OptimizedScore: gptr.Of(0.4), OptimizedEvaluatorScores: map[string]float64{"101": 0.4}},
		{OriginalScore: gptr.Of(1.0), OptimizedScore: gptr.Of(1.0), OptimizedEvaluatorScores: map[string]float64{"101": 1.0}},
	}

	metrics := optimizationMetricsFromResults(results)

	require.NotNil(t, metrics)
	assert.Equal(t, int32(3), metrics.GetSampleCount())
	assert.InDelta(t, 2.2/3.0, metrics.GetAverageScore(), 1e-9)
	assert.Equal(t, int32(1), metrics.GetFullScoreCount())
	assert.Equal(t, int32(1), metrics.GetImprovedCount())
	assert.Equal(t, int32(1), metrics.GetRegressedCount())
	assert.Equal(t, int32(1), metrics.GetUnchangedCount())
	assert.InDelta(t, 2.2/3.0, metrics.GetEvaluatorAverageScores()["101"], 1e-9)
}

func TestBetterOptimizationMetrics(t *testing.T) {
	assert.True(t, betterOptimizationMetrics(
		&expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.8)},
		&expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.7)},
	))
	assert.True(t, betterOptimizationMetrics(
		&expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.8), FullScoreCount: gptr.Of(int32(4))},
		&expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.8), FullScoreCount: gptr.Of(int32(3))},
	))
	assert.False(t, betterOptimizationMetrics(
		&expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.6)},
		&expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.7)},
	))
}

func TestPromptOptimizationGenerateCandidate(t *testing.T) {
	ctrl := gomock.NewController(t)
	llm := rpcmocks.NewMockILLMProvider(ctrl)
	llm.EXPECT().Call(gomock.Any(), gomock.Any()).Return(&entity.ReplyItem{
		Content:    gptr.Of(`{"messages":[{"role":"system","content":"Answer {{topic}} accurately."}],"rationale":"make the instruction explicit"}`),
		TokenUsage: &entity.TokenUsage{InputTokens: 12, OutputTokens: 8},
	}, nil)

	executor := &promptOptimizationExecutor{llm: llm}
	key, variableType := "topic", rpc.VariableTypeString
	best := &rpc.PromptTemplate{
		TemplateType: "normal",
		Messages:     []*rpc.PromptMessage{{Role: "system", Content: "Discuss {{topic}}."}},
		VariableDefs: []*rpc.VariableDef{{Key: &key, Type: &variableType}},
	}
	promptDO := &rpc.LoopPrompt{PromptCommit: &rpc.PromptCommit{Detail: &rpc.PromptDetail{
		ModelConfig: &rpc.PromptModelConfig{ModelID: 10, MaxTokens: 1024},
	}}}

	candidate, rationale, inputTokens, outputTokens, err := executor.generateCandidate(
		context.Background(),
		&promptOptimizationTaskPO{SpaceID: 1, CreatedBy: "2", Mode: expt.PromptOptimizationModeEffectFirst},
		promptDO,
		best,
		[]optimizerSample{{DisplayVariables: map[string]string{"topic": "testing"}}},
		nil,
		1,
	)

	require.NoError(t, err)
	require.Len(t, candidate.Messages, 1)
	assert.Equal(t, "Answer {{topic}} accurately.", candidate.Messages[0].Content)
	assert.Equal(t, "make the instruction explicit", rationale)
	assert.Equal(t, int64(12), inputTokens)
	assert.Equal(t, int64(8), outputTokens)
	assert.Equal(t, best.VariableDefs, candidate.VariableDefs)
}

func TestPromptOptimizationGenerateCandidateRejectsRemovedVariable(t *testing.T) {
	ctrl := gomock.NewController(t)
	llm := rpcmocks.NewMockILLMProvider(ctrl)
	llm.EXPECT().Call(gomock.Any(), gomock.Any()).Return(&entity.ReplyItem{
		Content: gptr.Of(`{"messages":[{"role":"system","content":"Answer accurately."}]}`),
	}, nil)

	executor := &promptOptimizationExecutor{llm: llm}
	key := "topic"
	best := &rpc.PromptTemplate{
		Messages:     []*rpc.PromptMessage{{Role: "system", Content: "Discuss {{topic}}."}},
		VariableDefs: []*rpc.VariableDef{{Key: &key}},
	}
	promptDO := &rpc.LoopPrompt{PromptCommit: &rpc.PromptCommit{Detail: &rpc.PromptDetail{
		ModelConfig: &rpc.PromptModelConfig{ModelID: 10, MaxTokens: 1024},
	}}}

	_, _, _, _, err := executor.generateCandidate(context.Background(),
		&promptOptimizationTaskPO{SpaceID: 1, CreatedBy: "2"}, promptDO, best, nil, nil, 1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "removed required variable")
}

func TestValidateOptimizationVariableMappings(t *testing.T) {
	key := "topic"
	template := &rpc.PromptTemplate{VariableDefs: []*rpc.VariableDef{{Key: &key}}}

	require.NoError(t, validateOptimizationVariableMappings(template, map[string]string{"topic": "dataset_topic"}))
	assert.Error(t, validateOptimizationVariableMappings(template, nil))
	assert.Error(t, validateOptimizationVariableMappings(template, map[string]string{"other": "dataset_topic"}))
	assert.Error(t, validateOptimizationVariableMappings(template, map[string]string{"topic": ""}))
}

func TestPromptTemplateReferencesVariable(t *testing.T) {
	assert.True(t, promptTemplateReferencesVariable(&rpc.PromptTemplate{Messages: []*rpc.PromptMessage{{Content: "{{ topic }}"}}}, "topic"))
	assert.True(t, promptTemplateReferencesVariable(&rpc.PromptTemplate{Messages: []*rpc.PromptMessage{{Content: "{{.topic}}"}}}, "topic"))
	assert.False(t, promptTemplateReferencesVariable(&rpc.PromptTemplate{Messages: []*rpc.PromptMessage{{Content: "{{other}}"}}}, "topic"))
}
