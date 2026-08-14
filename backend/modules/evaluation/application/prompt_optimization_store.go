// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/coze-dev/coze-loop/backend/infra/db"
)

type promptOptimizationTaskPO struct {
	ID                      int64     `gorm:"column:id;primaryKey"`
	SpaceID                 int64     `gorm:"column:space_id"`
	ExperimentID            int64     `gorm:"column:experiment_id"`
	PromptID                int64     `gorm:"column:prompt_id"`
	PromptKey               string    `gorm:"column:prompt_key"`
	SourcePromptVersion     string    `gorm:"column:source_prompt_version"`
	Name                    string    `gorm:"column:name"`
	Mode                    string    `gorm:"column:mode"`
	Status                  string    `gorm:"column:status"`
	Stage                   string    `gorm:"column:stage"`
	Progress                int32     `gorm:"column:progress"`
	RequestData             []byte    `gorm:"column:request_data"`
	OriginalPromptTemplate  []byte    `gorm:"column:original_prompt_template"`
	OptimizedPromptTemplate []byte    `gorm:"column:optimized_prompt_template"`
	BaselineMetrics         []byte    `gorm:"column:baseline_metrics"`
	BestMetrics             []byte    `gorm:"column:best_metrics"`
	ErrorMessage            string    `gorm:"column:error_message"`
	IdempotencyKey          *string   `gorm:"column:idempotency_key"`
	CreatedBy               string    `gorm:"column:created_by"`
	StartedAt               int64     `gorm:"column:started_at"`
	EndedAt                 int64     `gorm:"column:ended_at"`
	AppliedAt               int64     `gorm:"column:applied_at"`
	CreatedAt               time.Time `gorm:"column:created_at"`
	UpdatedAt               time.Time `gorm:"column:updated_at"`
	DeletedAt               int64     `gorm:"column:deleted_at"`
}

func (*promptOptimizationTaskPO) TableName() string { return "prompt_optimization_task" }

type promptOptimizationIterationPO struct {
	ID                int64     `gorm:"column:id;primaryKey"`
	TaskID            int64     `gorm:"column:task_id"`
	IterationNo       int32     `gorm:"column:iteration_no"`
	CandidateTemplate []byte    `gorm:"column:candidate_template"`
	Rationale         string    `gorm:"column:rationale"`
	Metrics           []byte    `gorm:"column:metrics"`
	SampleResults     []byte    `gorm:"column:sample_results"`
	InputTokens       int64     `gorm:"column:input_tokens"`
	OutputTokens      int64     `gorm:"column:output_tokens"`
	CreatedAt         time.Time `gorm:"column:created_at"`
}

func (*promptOptimizationIterationPO) TableName() string { return "prompt_optimization_iteration" }

type promptOptimizationStore struct{ db db.Provider }

func newPromptOptimizationStore(provider db.Provider) *promptOptimizationStore {
	return &promptOptimizationStore{db: provider}
}

func (s *promptOptimizationStore) createTask(ctx context.Context, task *promptOptimizationTaskPO) error {
	return s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).Create(task).Error
}

func (s *promptOptimizationStore) getTask(ctx context.Context, spaceID, exptID, taskID int64) (*promptOptimizationTaskPO, error) {
	var task promptOptimizationTaskPO
	err := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).
		Where("id = ? AND space_id = ? AND experiment_id = ? AND deleted_at = 0", taskID, spaceID, exptID).
		First(&task).Error
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func (s *promptOptimizationStore) getTaskByID(ctx context.Context, taskID int64) (*promptOptimizationTaskPO, error) {
	var task promptOptimizationTaskPO
	err := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).
		Where("id = ? AND deleted_at = 0", taskID).
		First(&task).Error
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func (s *promptOptimizationStore) getTaskByIdempotency(ctx context.Context, spaceID int64, userID, key string) (*promptOptimizationTaskPO, error) {
	var task promptOptimizationTaskPO
	err := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).
		Where("space_id = ? AND created_by = ? AND idempotency_key = ? AND deleted_at = 0", spaceID, userID, key).
		First(&task).Error
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func (s *promptOptimizationStore) listTasks(ctx context.Context, spaceID, exptID int64, page, size int32, statuses []string) ([]*promptOptimizationTaskPO, int64, error) {
	q := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).Model(&promptOptimizationTaskPO{}).
		Where("space_id = ? AND experiment_id = ? AND deleted_at = 0", spaceID, exptID)
	if len(statuses) > 0 {
		q = q.Where("status IN ?", statuses)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []*promptOptimizationTaskPO
	err := q.Order("created_at DESC, id DESC").Offset(int((page - 1) * size)).Limit(int(size)).Find(&rows).Error
	return rows, total, err
}

func (s *promptOptimizationStore) updateTask(ctx context.Context, taskID int64, values map[string]any) error {
	values["updated_at"] = time.Now()
	return s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).Model(&promptOptimizationTaskPO{}).
		Where("id = ? AND deleted_at = 0", taskID).Updates(values).Error
}

func (s *promptOptimizationStore) updateTaskIfStatus(ctx context.Context, taskID int64, status string, values map[string]any) (bool, error) {
	values["updated_at"] = time.Now()
	res := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).Model(&promptOptimizationTaskPO{}).
		Where("id = ? AND status = ? AND deleted_at = 0", taskID, status).
		Updates(values)
	return res.RowsAffected == 1, res.Error
}

func (s *promptOptimizationStore) tryStartTask(ctx context.Context, taskID int64) (bool, error) {
	now := time.Now()
	res := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).Model(&promptOptimizationTaskPO{}).
		Where("id = ? AND status = ? AND deleted_at = 0", taskID, "queued").
		Updates(map[string]any{"status": "running", "stage": "preparing", "progress": 1, "started_at": now.UnixMilli(), "updated_at": now})
	return res.RowsAffected == 1, res.Error
}

func (s *promptOptimizationStore) tryCancelTask(ctx context.Context, taskID int64) (bool, error) {
	now := time.Now()
	res := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).Model(&promptOptimizationTaskPO{}).
		Where("id = ? AND status IN ? AND deleted_at = 0", taskID, []string{"queued", "running"}).
		Updates(map[string]any{"status": "canceled", "ended_at": now.UnixMilli(), "updated_at": now})
	return res.RowsAffected == 1, res.Error
}

func (s *promptOptimizationStore) markRunningForRecovery(ctx context.Context) ([]int64, error) {
	var rows []promptOptimizationTaskPO
	err := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).
		Where("status IN ? AND deleted_at = 0", []string{"queued", "running"}).
		Order("created_at ASC").Limit(100).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
		if row.Status == "running" {
			_ = s.updateTask(ctx, row.ID, map[string]any{"status": "queued", "stage": "preparing", "progress": 0})
		}
	}
	return ids, nil
}

func (s *promptOptimizationStore) createIteration(ctx context.Context, row *promptOptimizationIterationPO) error {
	return s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).Create(row).Error
}

func (s *promptOptimizationStore) listIterations(ctx context.Context, taskID int64) ([]*promptOptimizationIterationPO, error) {
	var rows []*promptOptimizationIterationPO
	err := s.db.NewSession(ctx, db.WithMaster()).WithContext(ctx).
		Where("task_id = ?", taskID).Order("iteration_no ASC").Find(&rows).Error
	return rows, err
}

func isPromptOptimizationNotFound(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }
