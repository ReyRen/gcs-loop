// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	stdjson "encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/bytedance/gg/gptr"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	infraDB "github.com/coze-dev/coze-loop/backend/infra/db"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
)

type promptOptimizationStoreTestDB struct{ db *gorm.DB }

func (p *promptOptimizationStoreTestDB) NewSession(context.Context, ...infraDB.Option) *gorm.DB {
	return p.db
}

func (p *promptOptimizationStoreTestDB) Transaction(_ context.Context, fc func(tx *gorm.DB) error, _ ...infraDB.Option) error {
	return fc(p.db)
}

func TestListPromptOptimizationTasksByPrompt(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	gormDB, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	require.NoError(t, err)
	store := newPromptOptimizationStore(&promptOptimizationStoreTestDB{db: gormDB})

	whereSQL := "SELECT count(*) FROM `prompt_optimization_task` WHERE (space_id = ? AND prompt_id = ? AND deleted_at = 0) AND status IN (?,?) AND name LIKE ?"
	mock.ExpectQuery(regexp.QuoteMeta(whereSQL)).
		WithArgs(int64(1), int64(9), "running", "succeeded", "%alpha%").
		WillReturnRows(sqlmock.NewRows([]string{"count(*)"}).AddRow(1))
	listSQL := "SELECT * FROM `prompt_optimization_task` WHERE (space_id = ? AND prompt_id = ? AND deleted_at = 0) AND status IN (?,?) AND name LIKE ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
	mock.ExpectQuery(regexp.QuoteMeta(listSQL)).
		WithArgs(int64(1), int64(9), "running", "succeeded", "%alpha%", 10, 10).
		WillReturnRows(sqlmock.NewRows([]string{"id", "space_id", "experiment_id", "prompt_id", "name", "created_at", "updated_at", "deleted_at"}).
			AddRow(101, 1, 20, 9, "alpha task", time.Now(), time.Now(), 0))

	rows, total, err := store.listTasksByPrompt(context.Background(), 1, 9, 2, 10, []string{"running", "succeeded"}, "alpha")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	assert.Equal(t, int64(101), rows[0].ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTryCancelPromptOptimizationTask(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	gormDB, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	require.NoError(t, err)
	store := newPromptOptimizationStore(&promptOptimizationStoreTestDB{db: gormDB})

	updateSQL := "UPDATE `prompt_optimization_task` SET `ended_at`=?,`status`=?,`updated_at`=? WHERE id = ? AND status IN (?,?) AND deleted_at = 0"
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(updateSQL)).
		WithArgs(sqlmock.AnyArg(), "canceled", sqlmock.AnyArg(), int64(101), "queued", "running").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	terminated, err := store.tryCancelTask(context.Background(), 101)
	require.NoError(t, err)
	assert.True(t, terminated)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromptOptimizationProgressOnlyUpdatesRunningTask(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	gormDB, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	require.NoError(t, err)
	executor := &promptOptimizationExecutor{store: newPromptOptimizationStore(&promptOptimizationStoreTestDB{db: gormDB})}
	updateSQL := "UPDATE `prompt_optimization_task` SET `progress`=?,`stage`=?,`updated_at`=? WHERE id = ? AND status = ? AND deleted_at = 0"
	for completed := 1; completed <= 4; completed++ {
		mock.ExpectBegin()
		mock.ExpectExec(regexp.QuoteMeta(updateSQL)).
			WithArgs(int32(10+completed*5), "evaluating", sqlmock.AnyArg(), int64(101), "running").
			WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit()
		executor.updateEvaluationProgress(context.Background(), 101, 1, 4, completed, 4)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromptOptimizationDetailsDoNotSelectAFailedIteration(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	gormDB, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	require.NoError(t, err)
	executor := &promptOptimizationExecutor{store: newPromptOptimizationStore(&promptOptimizationStoreTestDB{db: gormDB})}
	selectedRows := []*expt.PromptOptimizationSampleEvaluation{{ItemID: gptr.Of(int64(10)),
		OriginalAnswer: gptr.Of("12个月"), OptimizedAnswer: gptr.Of("12个月"), OriginalScore: gptr.Of(0.99), OptimizedScore: gptr.Of(0.99),
	}}
	stored, err := stdjson.Marshal(promptOptimizationBestResult{optimizationMetricsFromResults(selectedRows), gptr.Of(int32(0))})
	require.NoError(t, err)
	selectedData, err := stdjson.Marshal(selectedRows)
	require.NoError(t, err)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM `prompt_optimization_iteration` WHERE task_id = ? ORDER BY iteration_no ASC")).
		WithArgs(int64(101)).WillReturnRows(sqlmock.NewRows([]string{"id", "task_id", "iteration_no", "candidate_template", "metrics", "sample_results"}).
		AddRow(200, 101, 0, `{"messages":[{"role":"system","content":"original Prompt"}]}`, `{"sample_count":1,"average_score":0.99}`, selectedData).
		AddRow(201, 101, 1, `{"messages":[{"role":"system","content":"failed candidate"}]}`, `{"sample_count":1}`,
			`[{"item_id":10,"original_score":0.99,"error_message":"No user query found in messages."}]`))
	task := executor.taskPOToDTO(context.Background(), &promptOptimizationTaskPO{ID: 101, Status: "failed", BestMetrics: stored,
		OptimizedPromptTemplate: []byte(`{"messages":[{"role":"system","content":"original Prompt"}]}`)}, true, true)
	require.NotNil(t, task.OptimizeResult_)
	assert.Equal(t, int32(0), task.OptimizeResult_.GetBestIteration())
	assert.Equal(t, "original Prompt", task.OptimizeResult_.OptimizedPromptMessageList[0].GetContent())
	assert.Equal(t, "12个月", task.OptimizeResult_.SampleResults[0].GetOptimizedAnswer())
	assert.Equal(t, 0.99, task.OptimizeResult_.BestMetrics.GetAverageScore())
	require.Len(t, task.OptimizeResult_.Iterations, 1)
	assert.Nil(t, task.OptimizeResult_.Iterations[0].Metrics.AverageScore)
	assert.Nil(t, task.OptimizeResult_.Iterations[0].SampleResults[0].OptimizedAnswer)
	assert.Contains(t, task.OptimizeResult_.Iterations[0].SampleResults[0].GetErrorMessage(), "No user query")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromptOptimizationDetailsReturnSelectedCandidateRows(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	gormDB, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	require.NoError(t, err)
	executor := &promptOptimizationExecutor{store: newPromptOptimizationStore(&promptOptimizationStoreTestDB{db: gormDB})}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM `prompt_optimization_iteration` WHERE task_id = ? ORDER BY iteration_no ASC")).
		WithArgs(int64(101)).WillReturnRows(sqlmock.NewRows([]string{"id", "task_id", "iteration_no", "candidate_template", "metrics", "sample_results"}).
		AddRow(200, 101, 0, `{}`, `{"average_score":0.5}`, `[{"item_id":10,"optimized_answer":"baseline"}]`).
		AddRow(201, 101, 1, `{}`, `{"average_score":0.7}`, `[{"item_id":10,"optimized_answer":"other candidate"}]`).
		AddRow(202, 101, 2, `{}`, `{"average_score":0.9}`, `[{"item_id":10,"optimized_answer":"selected candidate","original_score":0.5,"optimized_score":0.9}]`))
	task := executor.taskPOToDTO(context.Background(), &promptOptimizationTaskPO{ID: 101, Status: "succeeded",
		BestMetrics:             []byte(`{"sample_count":1,"average_score":0.9,"best_iteration":2}`),
		OptimizedPromptTemplate: []byte(`{"messages":[{"role":"system","content":"selected Prompt"}]}`)}, true, true)
	assert.Equal(t, int32(2), task.OptimizeResult_.GetBestIteration())
	require.Len(t, task.OptimizeResult_.SampleResults, 1)
	assert.Equal(t, "selected candidate", task.OptimizeResult_.SampleResults[0].GetOptimizedAnswer())
	assert.Equal(t, 0.9, task.OptimizeResult_.SampleResults[0].GetOptimizedScore())
	// Baseline is retained internally but is not an extra generated candidate.
	require.Len(t, task.OptimizeResult_.Iterations, 2)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromptOptimizationBaselineCanBePreparedAgain(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	gormDB, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	require.NoError(t, err)
	store := newPromptOptimizationStore(&promptOptimizationStoreTestDB{db: gormDB})
	for _, id := range []int64{1, 2} {
		mock.ExpectBegin()
		mock.ExpectExec("INSERT INTO `prompt_optimization_iteration`.*ON DUPLICATE KEY UPDATE.*").WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectCommit()
		require.NoError(t, store.createIteration(context.Background(), &promptOptimizationIterationPO{
			ID: id, TaskID: 101, IterationNo: 0, CandidateTemplate: []byte(`{}`), SampleResults: []byte(`[]`),
		}))
	}
	require.NoError(t, mock.ExpectationsWereMet())
}
