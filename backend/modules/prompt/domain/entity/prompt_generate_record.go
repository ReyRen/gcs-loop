// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package entity

const (
	GeneratePromptStatusRunning   = "running"
	GeneratePromptStatusSucceeded = "succeeded"
	GeneratePromptStatusFailed    = "failed"
	GeneratePromptStatusCanceled  = "canceled"
)

// PromptGenerateRecord records one prompt optimization request and its user feedback.
type PromptGenerateRecord struct {
	ID                 int64
	PromptID           int64
	SpaceID            int64
	PromptKey          string
	GeneratePromptType string
	OriginalPrompt     string
	GeneratedPrompt    string
	ModelID            int64
	InputTokens        int64
	OutputTokens       int64
	Status             string
	IsRetry            bool
	IsLiked            *bool
	IsDisliked         *bool
	IsAccepted         *bool
	IsCanceled         *bool
	GeneratedBy        string
	StartedAt          int64
	EndedAt            int64
	CostMS             int64
}
