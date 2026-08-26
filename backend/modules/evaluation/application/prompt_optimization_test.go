// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	stdjson "encoding/json"
	"errors"
	"testing"

	"github.com/bytedance/gg/gptr"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/component/rpc"
	rpcmocks "github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/component/rpc/mocks"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
	servicemocks "github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/service/mocks"
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

func TestPromptOptimizationModelUsesConfiguredID(t *testing.T) {
	t.Setenv(promptOptimizerModelIDEnv, "6")

	model, err := promptOptimizationModel(nil)

	require.NoError(t, err)
	assert.Equal(t, int64(6), model.GetModelID())
	assert.Equal(t, promptOptimizerMaxTokens, gptr.Indirect(model.MaxTokens))
}

func TestPromptOptimizationWorkerCount(t *testing.T) {
	t.Run("default", func(t *testing.T) {
		t.Setenv(promptOptimizationWorkersEnv, "")
		assert.Equal(t, promptOptimizationDefaultWorkers, promptOptimizationWorkerCount())
	})
	t.Run("configured", func(t *testing.T) {
		t.Setenv(promptOptimizationWorkersEnv, "6")
		assert.Equal(t, 6, promptOptimizationWorkerCount())
	})
	t.Run("invalid", func(t *testing.T) {
		t.Setenv(promptOptimizationWorkersEnv, "0")
		assert.Equal(t, promptOptimizationDefaultWorkers, promptOptimizationWorkerCount())
	})
	t.Run("over limit", func(t *testing.T) {
		t.Setenv(promptOptimizationWorkersEnv, "33")
		assert.Equal(t, promptOptimizationDefaultWorkers, promptOptimizationWorkerCount())
	})
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
	optimizerModel := &entity.ModelConfig{ModelID: gptr.Of(int64(10)), MaxTokens: gptr.Of(int32(1024))}

	candidate, rationale, inputTokens, outputTokens, err := executor.generateCandidate(
		context.Background(),
		&promptOptimizationTaskPO{SpaceID: 1, CreatedBy: "2", Mode: expt.PromptOptimizationModeEffectFirst},
		optimizerModel,
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

func TestPromptOptimizationGenerateCandidateUsesRequiredToolCall(t *testing.T) {
	ctrl := gomock.NewController(t)
	llm := rpcmocks.NewMockILLMProvider(ctrl)
	arguments := `{"message_0":"Answer {{topic}} accurately.","message_1":"Use the requested output format.","rationale":"use structured output"}`
	llm.EXPECT().Call(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, param *entity.LLMCallParam) (*entity.ReplyItem, error) {
		require.Len(t, param.Tools, 1)
		assert.Equal(t, "submit_optimized_prompt", param.Tools[0].Function.Name)
		assert.Contains(t, param.Tools[0].Function.Parameters, `"message_0"`)
		assert.Contains(t, param.Tools[0].Function.Parameters, `"message_1"`)
		assert.NotContains(t, param.Tools[0].Function.Parameters, `"messages"`)
		require.NotNil(t, param.ToolCallConfig)
		assert.Equal(t, entity.ToolChoiceTypeRequired, param.ToolCallConfig.ToolChoice)
		return &entity.ReplyItem{ToolCalls: []*entity.ToolCall{{FunctionCall: &entity.FunctionCall{
			Name: "submit_optimized_prompt", Arguments: &arguments,
		}}}}, nil
	})

	executor := &promptOptimizationExecutor{llm: llm}
	key, variableType := "topic", rpc.VariableTypeString
	best := &rpc.PromptTemplate{
		Messages: []*rpc.PromptMessage{
			{Role: "system", Content: "Discuss {{topic}}."},
			{Role: "user", Content: "Return a concise answer."},
		},
		VariableDefs: []*rpc.VariableDef{{Key: &key, Type: &variableType}},
	}
	optimizerModel := &entity.ModelConfig{ModelID: gptr.Of(int64(10)), MaxTokens: gptr.Of(int32(1024))}

	candidate, rationale, _, _, err := executor.generateCandidate(context.Background(),
		&promptOptimizationTaskPO{SpaceID: 1, CreatedBy: "2"}, optimizerModel, best, nil, nil, 1)

	require.NoError(t, err)
	require.Len(t, candidate.Messages, 2)
	assert.Equal(t, "system", candidate.Messages[0].Role)
	assert.Equal(t, "Answer {{topic}} accurately.", candidate.Messages[0].Content)
	assert.Equal(t, "user", candidate.Messages[1].Role)
	assert.Equal(t, "Use the requested output format.", candidate.Messages[1].Content)
	assert.Equal(t, "use structured output", rationale)
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
	optimizerModel := &entity.ModelConfig{ModelID: gptr.Of(int64(10)), MaxTokens: gptr.Of(int32(1024))}

	_, _, _, _, err := executor.generateCandidate(context.Background(),
		&promptOptimizationTaskPO{SpaceID: 1, CreatedBy: "2"}, optimizerModel, best, nil, nil, 1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "removed required variable")
}

func TestPromptOptimizationEvaluateCandidateFailsOnEvaluatorError(t *testing.T) {
	ctrl := gomock.NewController(t)
	prompt := rpcmocks.NewMockIPromptRPCAdapter(ctrl)
	evaluatorService := servicemocks.NewMockEvaluatorService(ctrl)

	prompt.EXPECT().ExecutePrompt(gomock.Any(), int64(1), gomock.Any()).Return(&rpc.ExecutePromptResult{
		Content: gptr.Of("candidate answer"),
	}, nil)
	evaluatorService.EXPECT().DebugEvaluator(gomock.Any(), gomock.Any(), gomock.Any(), nil, int64(1)).
		Return(nil, errors.New("provider unavailable"))

	const evaluatorVersionID int64 = 101
	executor := &promptOptimizationExecutor{prompt: prompt, evaluatorService: evaluatorService}
	experiment := &entity.Experiment{Evaluators: []*entity.Evaluator{{
		EvaluatorType: entity.EvaluatorTypePrompt,
		PromptEvaluatorVersion: &entity.PromptEvaluatorVersion{
			ID: evaluatorVersionID,
		},
	}}}
	samples := []optimizerSample{{
		ItemID: 10,
		EvaluatorRecords: map[int64]*entity.EvaluatorRecord{
			evaluatorVersionID: {EvaluatorInputData: &entity.EvaluatorInputData{}},
		},
	}}

	_, _, _, _, err := executor.evaluateCandidate(context.Background(),
		&promptOptimizationTaskPO{SpaceID: 1, PromptID: 2, SourcePromptVersion: "0.0.1"},
		promptOptimizationRequestSnapshot{}, experiment, &rpc.PromptTemplate{}, samples, 1, 8)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "evaluate candidate item 10 with evaluator 101")
	assert.Contains(t, err.Error(), "provider unavailable")
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

func TestPromptOptimizationTaskListFields(t *testing.T) {
	requestData, err := stdjson.Marshal(promptOptimizationRequestSnapshot{Samples: []promptOptimizationSampleRefSnapshot{{ItemID: 1}, {ItemID: 2}}})
	require.NoError(t, err)
	executor := &promptOptimizationExecutor{}
	task := executor.taskPOToDTO(context.Background(), &promptOptimizationTaskPO{RequestData: requestData}, false, false)
	require.NotNil(t, task.OptimizeTaskDataSet)
	assert.Equal(t, []int64{1, 2}, task.OptimizeTaskDataSet.GetSelectedItemIDList())

	experiment := &entity.Experiment{
		EvalSetID: 11, EvalSetVersionID: 12,
		EvalSet: &entity.EvaluationSet{Name: "dataset", EvaluationSetVersion: &entity.EvaluationSetVersion{Version: "0.0.1", ItemCount: 8}},
	}
	evalSets := promptOptimizationEvalSetInfos(experiment)
	require.Len(t, evalSets, 1)
	assert.Equal(t, int64(11), evalSets[0].GetID())
	assert.Equal(t, "dataset", evalSets[0].GetName())
	assert.Equal(t, "0.0.1", evalSets[0].GetVersion())
	assert.Equal(t, int64(8), evalSets[0].GetItemCount())
}
