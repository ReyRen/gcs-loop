// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

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

func TestPromptOptimizationSampleConcurrency(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int
	}{
		{"", 4}, {" 6 ", 6}, {"1", 1}, {"32", 32}, {"0", 4}, {"-1", 4}, {"33", 4}, {"bad", 4},
	} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv(promptOptimizationSampleConcurrencyEnv, tc.value)
			assert.Equal(t, tc.want, promptOptimizationSampleConcurrency())
		})
	}
}

func TestPromptOptimizationConcurrentSamplesKeepOrderAndIsolation(t *testing.T) {
	t.Setenv(promptOptimizationSampleConcurrencyEnv, "4")
	ctrl := gomock.NewController(t)
	prompt := rpcmocks.NewMockIPromptRPCAdapter(ctrl)
	evaluators := servicemocks.NewMockEvaluatorService(ctrl)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	const sampleCount = 7
	started := make(chan struct{}, sampleCount)
	release := make(chan struct{})
	var active atomic.Int32
	prompt.EXPECT().ExecutePrompt(gomock.Any(), int64(1), gomock.Any()).DoAndReturn(
		func(ctx context.Context, _ int64, param *rpc.ExecutePromptParam) (*rpc.ExecutePromptResult, error) {
			assert.LessOrEqual(t, active.Add(1), int32(4))
			defer active.Add(-1)
			started <- struct{}{}
			select {
			case <-release:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			answer := *param.Variables[0].Value
			// A provider's local edits must not leak into the next sample.
			assert.Equal(t, "candidate", param.OverridePromptTemplate.Messages[0].Content)
			param.OverridePromptTemplate.Messages[0].Content = answer
			return &rpc.ExecutePromptResult{Content: &answer, TokenUsage: &entity.TokenUsage{InputTokens: 2, OutputTokens: 3}}, nil
		}).Times(sampleCount)
	evaluators.EXPECT().DebugEvaluator(gomock.Any(), gomock.Any(), gomock.Any(), nil, int64(1)).DoAndReturn(
		func(_ context.Context, evaluator *entity.Evaluator, input *entity.EvaluatorInputData, _ *entity.EvaluatorRunConfig, _ int64) (*entity.EvaluatorOutputData, error) {
			answer := input.InputFields["actual_output"].GetText()
			assert.Equal(t, "original suffix", evaluator.PromptEvaluatorVersion.PromptSuffix)
			evaluator.PromptEvaluatorVersion.PromptSuffix = answer
			input.InputFields["actual_output"].Text = gptr.Of("modified")
			return &entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: gptr.Of(0.8)},
				EvaluatorUsage: &entity.EvaluatorUsage{InputTokens: 11, OutputTokens: 13}}, nil
		}).Times(sampleCount)
	experiment := optimizationConcurrencyExperiment()
	sharedRecord := &entity.EvaluatorRecord{
		EvaluatorInputData:  &entity.EvaluatorInputData{InputFields: map[string]*entity.Content{"actual_output": textContent("original answer")}},
		EvaluatorOutputData: &entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: gptr.Of(0.5)}},
	}
	samples := make([]optimizerSample, sampleCount)
	for i := range samples {
		samples[i] = optimizerSample{ItemID: int64(i + 1), Variables: map[string]*entity.Content{"input": textContent(strconv.Itoa(i + 1))},
			EvaluatorRecords: map[int64]*entity.EvaluatorRecord{101: sharedRecord}}
	}
	executor := &promptOptimizationExecutor{prompt: prompt, evaluatorService: evaluators}
	candidate := &rpc.PromptTemplate{Messages: []*rpc.PromptMessage{{Content: "candidate"}}}
	type completedEvaluation struct {
		results                   []*expt.PromptOptimizationSampleEvaluation
		inputTokens, outputTokens int64
		err                       error
	}
	done := make(chan completedEvaluation, 1)
	go func() {
		_, results, inTokens, outTokens, err := executor.evaluateCandidate(ctx, &promptOptimizationTaskPO{SpaceID: 1},
			promptOptimizationRequestSnapshot{VariableMappings: map[string]string{"question": "input"}}, experiment, candidate, samples, 1, 6)
		done <- completedEvaluation{results, inTokens, outTokens, err}
	}()
	for i := 0; i < 4; i++ {
		select {
		case <-started:
		case <-ctx.Done():
			t.Fatal("four samples did not start concurrently")
		}
	}
	assert.Equal(t, int32(4), active.Load())
	select {
	case <-started:
		t.Error("sample concurrency exceeded configured limit")
	default:
	}
	close(release)
	var result completedEvaluation
	select {
	case result = <-done:
	case <-ctx.Done():
		t.Fatal("sample evaluation did not complete")
	}
	require.NoError(t, result.err)
	require.Len(t, result.results, sampleCount)
	for i, sample := range result.results {
		assert.Equal(t, int64(i+1), sample.GetItemID())
		assert.Equal(t, strconv.Itoa(i+1), sample.GetOptimizedAnswer())
	}
	assert.Equal(t, int64(sampleCount*13), result.inputTokens)
	assert.Equal(t, int64(sampleCount*16), result.outputTokens)
	assert.Equal(t, "candidate", candidate.Messages[0].Content)
	assert.Equal(t, "original suffix", experiment.Evaluators[0].PromptEvaluatorVersion.PromptSuffix)
	assert.Equal(t, "original answer", sharedRecord.EvaluatorInputData.InputFields["actual_output"].GetText())
}

func TestPromptOptimizationSampleFailureCancelsRemainingCalls(t *testing.T) {
	t.Setenv(promptOptimizationSampleConcurrencyEnv, "2")
	ctrl := gomock.NewController(t)
	prompt := rpcmocks.NewMockIPromptRPCAdapter(ctrl)
	evaluators := servicemocks.NewMockEvaluatorService(ctrl)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var started atomic.Int32
	bothStarted := make(chan struct{})
	prompt.EXPECT().ExecutePrompt(gomock.Any(), int64(1), gomock.Any()).DoAndReturn(
		func(ctx context.Context, _ int64, _ *rpc.ExecutePromptParam) (*rpc.ExecutePromptResult, error) {
			n := started.Add(1)
			if n == 2 {
				close(bothStarted)
			}
			if n == 1 {
				select {
				case <-bothStarted:
				case <-ctx.Done():
					return nil, ctx.Err()
				}
				return &rpc.ExecutePromptResult{Content: gptr.Of("answer")}, nil
			}
			<-ctx.Done()
			return nil, ctx.Err()
		}).Times(2)
	evaluators.EXPECT().DebugEvaluator(gomock.Any(), gomock.Any(), gomock.Any(), nil, int64(1)).Return(nil, errors.New("invalid scoring result"))
	samples := make([]optimizerSample, 8)
	for i := range samples {
		samples[i] = optimizerSample{ItemID: int64(i + 1), EvaluatorRecords: map[int64]*entity.EvaluatorRecord{101: {EvaluatorInputData: &entity.EvaluatorInputData{}}}}
	}
	executor := &promptOptimizationExecutor{prompt: prompt, evaluatorService: evaluators}
	_, results, _, _, err := executor.evaluateCandidate(ctx, &promptOptimizationTaskPO{SpaceID: 1},
		promptOptimizationRequestSnapshot{}, optimizationConcurrencyExperiment(), &rpc.PromptTemplate{}, samples, 1, 6)
	require.ErrorContains(t, err, "invalid scoring result")
	assert.Nil(t, results)
	assert.Equal(t, int32(2), started.Load())
}

func TestPromptOptimizationRejectsInvalidEvaluatorScores(t *testing.T) {
	for _, score := range []*float64{nil, gptr.Of(-0.1), gptr.Of(5.0), gptr.Of(9.0), gptr.Of(math.NaN()), gptr.Of(math.Inf(1))} {
		t.Run(fmt.Sprint(score), func(t *testing.T) {
			ctrl := gomock.NewController(t)
			prompt := rpcmocks.NewMockIPromptRPCAdapter(ctrl)
			evaluators := servicemocks.NewMockEvaluatorService(ctrl)
			prompt.EXPECT().ExecutePrompt(gomock.Any(), int64(1), gomock.Any()).Return(&rpc.ExecutePromptResult{Content: gptr.Of("answer")}, nil)
			evaluators.EXPECT().DebugEvaluator(gomock.Any(), gomock.Any(), gomock.Any(), nil, int64(1)).Return(
				&entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: score}}, nil)
			samples := []optimizerSample{{ItemID: 1, EvaluatorRecords: map[int64]*entity.EvaluatorRecord{101: {
				EvaluatorInputData: &entity.EvaluatorInputData{}, EvaluatorOutputData: &entity.EvaluatorOutputData{EvaluatorResult: &entity.EvaluatorResult{Score: score}},
			}}}}
			executor := &promptOptimizationExecutor{prompt: prompt, evaluatorService: evaluators}
			_, _, _, _, err := executor.evaluateCandidate(context.Background(), &promptOptimizationTaskPO{SpaceID: 1},
				promptOptimizationRequestSnapshot{}, optimizationConcurrencyExperiment(), &rpc.PromptTemplate{}, samples, 1, 6)
			require.ErrorContains(t, err, "finite score between 0 and 1")
			_, _, err = baselineOptimizationMetrics(samples)
			require.ErrorContains(t, err, "source experiment has an invalid score")
		})
	}
	for _, score := range []float64{0, 0.5, 1} {
		require.NoError(t, validateOptimizationScore(&score, 1, 101))
	}
}

func optimizationConcurrencyExperiment() *entity.Experiment {
	return &entity.Experiment{Evaluators: []*entity.Evaluator{{
		EvaluatorType:          entity.EvaluatorTypePrompt,
		PromptEvaluatorVersion: &entity.PromptEvaluatorVersion{ID: 101, PromptSuffix: "original suffix"},
	}}}
}

func TestPromptOptimizationSampleFailureRecoversPanic(t *testing.T) {
	t.Setenv(promptOptimizationSampleConcurrencyEnv, "1")
	ctrl := gomock.NewController(t)
	prompt := rpcmocks.NewMockIPromptRPCAdapter(ctrl)
	prompt.EXPECT().ExecutePrompt(gomock.Any(), int64(1), gomock.Any()).DoAndReturn(
		func(context.Context, int64, *rpc.ExecutePromptParam) (*rpc.ExecutePromptResult, error) {
			panic("sample provider panic")
		})
	executor := &promptOptimizationExecutor{prompt: prompt}
	_, _, _, _, err := executor.evaluateCandidate(context.Background(), &promptOptimizationTaskPO{SpaceID: 1},
		promptOptimizationRequestSnapshot{}, &entity.Experiment{}, &rpc.PromptTemplate{}, []optimizerSample{{ItemID: 1}, {ItemID: 2}}, 1, 6)
	require.ErrorContains(t, err, "sample provider panic")
}
