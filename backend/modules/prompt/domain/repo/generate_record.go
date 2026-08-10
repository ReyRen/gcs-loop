// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package repo

import (
	"context"

	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
)

//go:generate mockgen -destination=mocks/generate_record_repo.go -package=mocks . IGenerateRecordRepo
type IGenerateRecordRepo interface {
	Create(ctx context.Context, record *entity.PromptGenerateRecord) (recordID int64, err error)
	Finish(ctx context.Context, record *entity.PromptGenerateRecord) error
	UpdateFeedback(ctx context.Context, param UpdateGenerateRecordParam) error
}

type UpdateGenerateRecordParam struct {
	RecordID    int64
	PromptID    int64
	SpaceID     int64
	GeneratedBy string
	IsLiked     *bool
	IsDisliked  *bool
	IsAccepted  *bool
	IsCanceled  *bool
}
