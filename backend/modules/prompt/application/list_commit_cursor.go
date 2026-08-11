// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/repo"
)

const listCommitPageTokenPrefix = "lc1."

const (
	mySQLDateTimeMinYear = 1000
	mySQLDateTimeMaxYear = 9999
)

const (
	listCommitCursorOrderAsc  = "asc"
	listCommitCursorOrderDesc = "desc"
)

type listCommitCursorPayload struct {
	PromptID       int64  `json:"p"`
	Order          string `json:"o"`
	CreatedAtMicro int64  `json:"t"`
	ID             int64  `json:"i"`
}

func encodeListCommitPageToken(promptID int64, asc bool, cursor *repo.ListCommitCursor) (string, error) {
	if promptID <= 0 {
		return "", fmt.Errorf("invalid prompt id: %d", promptID)
	}
	if cursor == nil || cursor.ID <= 0 || cursor.CreatedAt.IsZero() {
		return "", fmt.Errorf("invalid list commit cursor")
	}

	payload := listCommitCursorPayload{
		PromptID:       promptID,
		Order:          listCommitCursorOrder(asc),
		CreatedAtMicro: cursor.CreatedAt.UnixMicro(),
		ID:             cursor.ID,
	}
	if payload.CreatedAtMicro <= 0 {
		return "", fmt.Errorf("invalid list commit cursor time")
	}
	if !isValidMySQLDateTime(cursor.CreatedAt) {
		return "", fmt.Errorf("list commit cursor time is outside MySQL DATETIME range")
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal list commit cursor: %w", err)
	}
	return listCommitPageTokenPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}

func decodeListCommitPageToken(pageToken string, promptID int64, asc bool) (*repo.ListCommitCursor, error) {
	if pageToken == "" {
		return nil, fmt.Errorf("empty page token")
	}

	// Backward compatibility: the old token is a decimal Unix timestamp in
	// seconds. Since it does not contain an ID, the DAO retains the old
	// inclusive timestamp boundary for this one request and emits a new token.
	if !strings.HasPrefix(pageToken, listCommitPageTokenPrefix) {
		seconds, err := strconv.ParseInt(pageToken, 10, 64)
		if err != nil || seconds <= 0 {
			return nil, fmt.Errorf("invalid legacy page token")
		}
		createdAt := time.Unix(seconds, 0)
		if !isValidMySQLDateTime(createdAt) {
			return nil, fmt.Errorf("legacy page token time is outside MySQL DATETIME range")
		}
		return &repo.ListCommitCursor{
			CreatedAt: createdAt,
			Legacy:    true,
		}, nil
	}

	encoded := strings.TrimPrefix(pageToken, listCommitPageTokenPrefix)
	b, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode list commit cursor: %w", err)
	}

	var payload listCommitCursorPayload
	if err = json.Unmarshal(b, &payload); err != nil {
		return nil, fmt.Errorf("unmarshal list commit cursor: %w", err)
	}
	if payload.PromptID != promptID {
		return nil, fmt.Errorf("list commit cursor prompt mismatch")
	}
	if payload.Order != listCommitCursorOrder(asc) {
		return nil, fmt.Errorf("list commit cursor order mismatch")
	}
	if payload.CreatedAtMicro <= 0 || payload.ID <= 0 {
		return nil, fmt.Errorf("invalid list commit cursor values")
	}

	createdAt := time.UnixMicro(payload.CreatedAtMicro)
	if !isValidMySQLDateTime(createdAt) {
		return nil, fmt.Errorf("list commit cursor time is outside MySQL DATETIME range")
	}

	return &repo.ListCommitCursor{
		CreatedAt: createdAt,
		ID:        payload.ID,
	}, nil
}

func isValidMySQLDateTime(t time.Time) bool {
	year := t.Year()
	return year >= mySQLDateTimeMinYear && year <= mySQLDateTimeMaxYear
}

func listCommitCursorOrder(asc bool) string {
	if asc {
		return listCommitCursorOrderAsc
	}
	return listCommitCursorOrderDesc
}
