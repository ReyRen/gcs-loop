// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package mysql

import (
	"context"

	"github.com/coze-dev/coze-loop/backend/infra/db"
	"github.com/coze-dev/coze-loop/backend/infra/idgen"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/repo"
	prompterr "github.com/coze-dev/coze-loop/backend/modules/prompt/pkg/errno"
	"github.com/coze-dev/coze-loop/backend/pkg/errorx"
)

const tableNamePromptGenerateRecord = "prompt_generate_record"

type promptGenerateRecordPO struct {
	ID                 int64  `gorm:"column:id;primaryKey;autoIncrement:false"`
	PromptID           int64  `gorm:"column:prompt_id"`
	SpaceID            int64  `gorm:"column:space_id"`
	PromptKey          string `gorm:"column:prompt_key"`
	GeneratePromptType string `gorm:"column:generate_prompt_type"`
	OriginalPrompt     string `gorm:"column:original_prompt"`
	GeneratedPrompt    string `gorm:"column:generated_prompt"`
	ModelID            int64  `gorm:"column:model_id"`
	InputTokens        int64  `gorm:"column:input_tokens"`
	OutputTokens       int64  `gorm:"column:output_tokens"`
	Status             string `gorm:"column:status"`
	IsRetry            bool   `gorm:"column:is_retry"`
	IsLiked            *bool  `gorm:"column:is_liked"`
	IsDisliked         *bool  `gorm:"column:is_disliked"`
	IsAccepted         *bool  `gorm:"column:is_accepted"`
	IsCanceled         *bool  `gorm:"column:is_canceled"`
	GeneratedBy        string `gorm:"column:generated_by"`
	StartedAt          int64  `gorm:"column:started_at"`
	EndedAt            int64  `gorm:"column:ended_at"`
	CostMS             int64  `gorm:"column:cost_ms"`
}

func (*promptGenerateRecordPO) TableName() string {
	return tableNamePromptGenerateRecord
}

type GenerateRecordRepoImpl struct {
	db    db.Provider
	idgen idgen.IIDGenerator
}

func NewGenerateRecordRepo(db db.Provider, idgen idgen.IIDGenerator) repo.IGenerateRecordRepo {
	return &GenerateRecordRepoImpl{db: db, idgen: idgen}
}

func (r *GenerateRecordRepoImpl) Create(ctx context.Context, record *entity.PromptGenerateRecord) (int64, error) {
	if record == nil {
		return 0, errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("generate record is nil"))
	}
	recordID, err := r.idgen.GenID(ctx)
	if err != nil {
		return 0, err
	}
	record.ID = recordID
	po := promptGenerateRecordDO2PO(record)
	if err := r.db.NewSession(ctx, db.WithMaster()).Create(po).Error; err != nil {
		return 0, errorx.WrapByCode(err, prompterr.CommonMySqlErrorCode, errorx.WithExtraMsg("create prompt generate record error"))
	}
	return recordID, nil
}

func (r *GenerateRecordRepoImpl) Finish(ctx context.Context, record *entity.PromptGenerateRecord) error {
	if record == nil || record.ID <= 0 {
		return nil
	}
	updates := map[string]any{
		"generated_prompt": record.GeneratedPrompt,
		"input_tokens":     record.InputTokens,
		"output_tokens":    record.OutputTokens,
		"status":           record.Status,
		"ended_at":         record.EndedAt,
		"cost_ms":          record.CostMS,
	}
	if err := r.db.NewSession(ctx, db.WithMaster()).Model(&promptGenerateRecordPO{}).
		Where("id = ?", record.ID).Updates(updates).Error; err != nil {
		return errorx.WrapByCode(err, prompterr.CommonMySqlErrorCode, errorx.WithExtraMsg("finish prompt generate record error"))
	}
	return nil
}

func (r *GenerateRecordRepoImpl) UpdateFeedback(ctx context.Context, param repo.UpdateGenerateRecordParam) error {
	updates := make(map[string]any, 4)
	if param.IsLiked != nil {
		updates["is_liked"] = *param.IsLiked
	}
	if param.IsDisliked != nil {
		updates["is_disliked"] = *param.IsDisliked
	}
	if param.IsAccepted != nil {
		updates["is_accepted"] = *param.IsAccepted
	}
	if param.IsCanceled != nil {
		updates["is_canceled"] = *param.IsCanceled
	}
	if len(updates) == 0 {
		return nil
	}
	result := r.db.NewSession(ctx, db.WithMaster()).Model(&promptGenerateRecordPO{}).
		Where("id = ? AND prompt_id = ? AND space_id = ? AND generated_by = ?", param.RecordID, param.PromptID, param.SpaceID, param.GeneratedBy).
		Updates(updates)
	if result.Error != nil {
		return errorx.WrapByCode(result.Error, prompterr.CommonMySqlErrorCode, errorx.WithExtraMsg("update prompt generate record error"))
	}
	if result.RowsAffected == 0 {
		return errorx.NewByCode(prompterr.ResourceNotFoundCode, errorx.WithExtraMsg("prompt generate record not found"))
	}
	return nil
}

func promptGenerateRecordDO2PO(record *entity.PromptGenerateRecord) *promptGenerateRecordPO {
	return &promptGenerateRecordPO{
		ID:                 record.ID,
		PromptID:           record.PromptID,
		SpaceID:            record.SpaceID,
		PromptKey:          record.PromptKey,
		GeneratePromptType: record.GeneratePromptType,
		OriginalPrompt:     record.OriginalPrompt,
		GeneratedPrompt:    record.GeneratedPrompt,
		ModelID:            record.ModelID,
		InputTokens:        record.InputTokens,
		OutputTokens:       record.OutputTokens,
		Status:             record.Status,
		IsRetry:            record.IsRetry,
		IsLiked:            record.IsLiked,
		IsDisliked:         record.IsDisliked,
		IsAccepted:         record.IsAccepted,
		IsCanceled:         record.IsCanceled,
		GeneratedBy:        record.GeneratedBy,
		StartedAt:          record.StartedAt,
		EndedAt:            record.EndedAt,
		CostMS:             record.CostMS,
	}
}
