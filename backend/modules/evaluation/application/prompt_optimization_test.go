// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	stdjson "encoding/json"
	"errors"
	"math"
	"testing"

	"github.com/bytedance/gg/gptr"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
	promptdto "github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/consts"
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

func TestOptimizationMetricsDoNotCompareIncompleteResults(t *testing.T) {
	valid := &expt.PromptOptimizationSampleEvaluation{OriginalScore: gptr.Of(0.5), OptimizedScore: gptr.Of(0.9)}
	for _, results := range [][]*expt.PromptOptimizationSampleEvaluation{
		nil,
		{nil},
		{{OriginalScore: gptr.Of(0.5), ErrorMessage: gptr.Of("No user query found in messages.")}},
		{valid, {OriginalScore: gptr.Of(0.5)}},
		{{OptimizedScore: gptr.Of(0.5)}},
		{{OriginalScore: gptr.Of(0.5), OptimizedScore: gptr.Of(math.NaN())}},
	} {
		metrics := optimizationMetricsFromResults(results)
		assert.Nil(t, metrics.AverageScore)
		assert.Nil(t, metrics.UnchangedCount)
		assert.False(t, betterOptimizationMetrics(metrics, &expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.0)}))
	}
	metrics := optimizationMetricsFromResults([]*expt.PromptOptimizationSampleEvaluation{{OriginalScore: gptr.Of(0.0), OptimizedScore: gptr.Of(0.0)}})
	require.NotNil(t, metrics.AverageScore)
	assert.Equal(t, 0.0, *metrics.AverageScore)
	assert.Equal(t, int32(1), metrics.GetUnchangedCount())
}

func TestPromptOptimizationReplayRestoresUserAndScorerMappings(t *testing.T) {
	ctrl := gomock.NewController(t)
	prompt := rpcmocks.NewMockIPromptRPCAdapter(ctrl)
	evaluators := servicemocks.NewMockEvaluatorService(ctrl)
	experiment := optimizationConcurrencyExperiment()
	experiment.EvalConf = &entity.EvaluationConfiguration{ConnectorConf: entity.Connector{
		TargetConf: &entity.TargetConf{IngressConf: &entity.TargetIngressConf{
			EvalSetAdapter: &entity.FieldAdapter{FieldConfs: []*entity.FieldConf{
				{FieldName: "knowledge", FromField: "context"},
				{FieldName: consts.EvalTargetInputFieldKeyPromptUserQuery, FromField: "question"},
			}},
		}},
		EvaluatorsConf: &entity.EvaluatorsConf{EvaluatorConf: []*entity.EvaluatorConf{{EvaluatorVersionID: 101,
			IngressConf: &entity.EvaluatorIngressConf{TargetAdapter: &entity.FieldAdapter{FieldConfs: []*entity.FieldConf{{FieldName: "output", FromField: "actual_output"}}}},
		}}},
	}}
	sample := optimizerSample{ItemID: 10, TurnID: 20, OriginalAnswer: "原回答", Variables: map[string]*entity.Content{
		"context": textContent("保修期12个月"), "question": textContent("保修期多久？"),
	}, TargetInput: &entity.EvalTargetInputData{
		InputFields:     map[string]*entity.Content{"knowledge": textContent("保修期12个月")},
		HistoryMessages: []*entity.Message{{Role: entity.RoleAssistant, Content: textContent("您好")}},
		Ext:             map[string]string{consts.TargetExecuteExtRuntimeParamKey: `{"model_config":{"model_id":"122","max_tokens":128}}`},
	}, EvaluatorRecords: map[int64]*entity.EvaluatorRecord{101: {
		EvaluatorInputData:  &entity.EvaluatorInputData{InputFields: map[string]*entity.Content{"output": textContent("原回答"), "input": textContent("保修期多久？")}},
		EvaluatorOutputData: &entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: gptr.Of(0.5)}},
	}}}
	prompt.EXPECT().ExecutePrompt(gomock.Any(), int64(1), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ int64, param *rpc.ExecutePromptParam) (*rpc.ExecutePromptResult, error) {
			require.NotNil(t, param.UserQuery)
			assert.Equal(t, "保修期多久？", param.UserQuery.Content.GetText())
			require.Len(t, param.History, 1)
			assert.Equal(t, "您好", param.History[0].Content.GetText())
			assert.Contains(t, *param.RuntimeParam, `"max_tokens":128`)
			require.Len(t, param.Variables, 1)
			assert.Equal(t, "保修期12个月", *param.Variables[0].Value)
			assert.Equal(t, "仅根据{{knowledge}}回答", param.OverridePromptTemplate.Messages[0].Content)
			return &rpc.ExecutePromptResult{Content: gptr.Of("12个月")}, nil
		})
	evaluators.EXPECT().DebugEvaluator(gomock.Any(), gomock.Any(), gomock.Any(), nil, int64(1)).DoAndReturn(
		func(_ context.Context, _ *entity.Evaluator, input *entity.EvaluatorInputData, _ *entity.EvaluatorRunConfig, _ int64) (*entity.EvaluatorOutputData, error) {
			assert.Equal(t, "12个月", input.InputFields["output"].GetText())
			assert.Equal(t, "12个月", input.EvaluateTargetOutputFields["output"].GetText())
			assert.Equal(t, "保修期多久？", input.InputFields["input"].GetText())
			return &entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: gptr.Of(1.0)}}, nil
		})
	executor := &promptOptimizationExecutor{prompt: prompt, evaluatorService: evaluators}
	metrics, results, _, _, err := executor.evaluateCandidate(context.Background(), &promptOptimizationTaskPO{SpaceID: 1, PromptID: 2, SourcePromptVersion: "0.0.4"},
		promptOptimizationRequestSnapshot{VariableMappings: map[string]string{"knowledge": "context"}}, experiment,
		&rpc.PromptTemplate{Messages: []*rpc.PromptMessage{{Role: "system", Content: "仅根据{{knowledge}}回答"}}}, []optimizerSample{sample}, 1, 6)
	require.NoError(t, err)
	assert.Equal(t, 1.0, metrics.GetAverageScore())
	require.Len(t, results, 1)
	assert.Equal(t, 0.5, results[0].GetOriginalScore())
	assert.Equal(t, 1.0, results[0].GetOptimizedScore())
	assert.Equal(t, "12个月", results[0].GetOptimizedAnswer())
	assert.Equal(t, "原回答", sample.EvaluatorRecords[101].EvaluatorInputData.InputFields["output"].GetText())
	assert.NotContains(t, sample.TargetInput.InputFields, consts.EvalTargetInputFieldKeyPromptUserQuery)
}

func TestPromptOptimizationPromptFailureIsNotNoImprovement(t *testing.T) {
	t.Setenv(promptOptimizationSampleConcurrencyEnv, "1")
	for _, providerErr := range []error{errors.New("No user query found in messages."), nil} {
		ctrl := gomock.NewController(t)
		prompt := rpcmocks.NewMockIPromptRPCAdapter(ctrl)
		prompt.EXPECT().ExecutePrompt(gomock.Any(), int64(1), gomock.Any()).Return(nil, providerErr)
		sample := optimizerSample{ItemID: 10, OriginalAnswer: "原回答", EvaluatorRecords: map[int64]*entity.EvaluatorRecord{101: {
			EvaluatorInputData:  &entity.EvaluatorInputData{},
			EvaluatorOutputData: &entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: gptr.Of(0.99)}},
		}}}
		executor := &promptOptimizationExecutor{prompt: prompt}
		metrics, results, _, _, err := executor.evaluateCandidate(context.Background(), &promptOptimizationTaskPO{SpaceID: 1},
			promptOptimizationRequestSnapshot{}, optimizationConcurrencyExperiment(), &rpc.PromptTemplate{}, []optimizerSample{sample, sample}, 1, 6)
		require.ErrorContains(t, err, "execute candidate item 10")
		assert.Nil(t, metrics.AverageScore)
		require.NotNil(t, results[0])
		assert.Equal(t, 0.99, results[0].GetOriginalScore())
		assert.Nil(t, results[0].OptimizedScore)
		assert.NotEmpty(t, results[0].GetErrorMessage())
		assert.False(t, betterOptimizationMetrics(metrics, &expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.0)}))
	}
}

func TestPromptOptimizationSelectedSnapshotIsAuthoritative(t *testing.T) {
	for _, selected := range []int32{0, 2} {
		for _, status := range []string{"running", "succeeded", "failed", "canceled"} {
			rows := []*expt.PromptOptimizationSampleEvaluation{{ItemID: gptr.Of(int64(10)), OriginalAnswer: gptr.Of("原回答"), OptimizedAnswer: gptr.Of("选中回答"), OriginalScore: gptr.Of(0.5), OptimizedScore: gptr.Of(0.8)}}
			metrics := optimizationMetricsFromResults(rows)
			stored, err := stdjson.Marshal(promptOptimizationBestResult{metrics, &selected})
			require.NoError(t, err)
			template, err := stdjson.Marshal(&promptdto.PromptTemplate{Messages: []*promptdto.Message{{Content: gptr.Of("选中Prompt")}}})
			require.NoError(t, err)
			executor := &promptOptimizationExecutor{}
			row := &promptOptimizationTaskPO{Status: status, BestMetrics: stored, OptimizedPromptTemplate: template}
			task := executor.taskPOToDTO(context.Background(), row, false, false)
			require.NotNil(t, task.OptimizeResult_)
			assert.Equal(t, selected, task.OptimizeResult_.GetBestIteration())
			assert.Equal(t, "选中Prompt", task.OptimizeResult_.OptimizedPromptMessageList[0].GetContent())
			assert.Equal(t, 0.8, task.OptimizeResult_.GetBestMetrics().GetAverageScore())
			assert.Empty(t, executor.taskPOToDTO(context.Background(), row, false, false).OptimizeResult_.SampleResults)
		}
	}
}

func TestPromptOptimizationNoImprovementKeepsBaselineAnswers(t *testing.T) {
	samples := []optimizerSample{{ItemID: 10, OriginalAnswer: "12个月", EvaluatorRecords: map[int64]*entity.EvaluatorRecord{101: {
		EvaluatorOutputData: &entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: gptr.Of(0.99)}},
	}}}}
	metrics, rows, err := baselineOptimizationMetrics(samples)
	require.NoError(t, err)
	assert.False(t, betterOptimizationMetrics(&expt.PromptOptimizationMetrics{AverageScore: gptr.Of(0.98)}, metrics))
	stored, err := stdjson.Marshal(promptOptimizationBestResult{metrics, gptr.Of(int32(0))})
	require.NoError(t, err)
	task := (&promptOptimizationExecutor{}).taskPOToDTO(context.Background(), &promptOptimizationTaskPO{Status: "succeeded", BestMetrics: stored}, false, false)
	assert.Equal(t, int32(0), task.OptimizeResult_.GetBestIteration())
	assert.Equal(t, "12个月", rows[0].GetOptimizedAnswer())
	assert.Equal(t, 0.99, rows[0].GetOriginalScore())
	assert.Equal(t, 0.99, rows[0].GetOptimizedScore())
	assert.Equal(t, int32(1), task.OptimizeResult_.GetBestMetrics().GetUnchangedCount())
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

func TestPromptOptimizationRunningTaskReturnsPartialResult(t *testing.T) {
	executor := &promptOptimizationExecutor{}
	task := executor.taskPOToDTO(context.Background(), &promptOptimizationTaskPO{
		Status:                  string(expt.PromptOptimizationStatusRunning),
		OptimizedPromptTemplate: []byte(`{"messages":[{"role":"system","content":"optimized prompt"}]}`),
		BaselineMetrics:         []byte(`{"sample_count":20,"average_score":0.3,"full_score_count":3}`),
		BestMetrics:             []byte(`{"sample_count":20,"average_score":0.7,"full_score_count":8,"improved_count":6,"regressed_count":1}`),
	}, false, false)

	require.NotNil(t, task.OptimizeResult_)
	require.Len(t, task.OptimizeResult_.GetOptimizedPromptMessageList(), 1)
	assert.Equal(t, "optimized prompt", task.OptimizeResult_.GetOptimizedPromptMessageList()[0].GetContent())
	assert.InDelta(t, 0.3, task.OptimizeResult_.GetBaselineMetrics().GetAverageScore(), 1e-9)
	assert.InDelta(t, 0.7, task.OptimizeResult_.GetBestMetrics().GetAverageScore(), 1e-9)
	assert.Equal(t, int32(6), task.OptimizeResult_.GetBestMetrics().GetImprovedCount())
	assert.Equal(t, int32(1), task.OptimizeResult_.GetBestMetrics().GetRegressedCount())
}
