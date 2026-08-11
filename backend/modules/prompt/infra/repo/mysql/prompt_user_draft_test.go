// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package mysql

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/modules/prompt/infra/repo/mysql/gorm_gen/model"
)

func TestPromptDraftSearchParamUsesPromptID(t *testing.T) {
	assert.Equal(t, "123:test_user", promptDraftSearchParam(123, "test_user"))
}

func TestPromptUserDraftUpdateFieldsIncludesExtInfo(t *testing.T) {
	extInfo := `{"source":"draft"}`
	fields := promptUserDraftUpdateFields(&model.PromptUserDraft{
		ExtInfo:               &extInfo,
		ExpectedLatestVersion: "2.0.0",
	})

	require.Contains(t, fields, "ext_info")
	assert.Equal(t, &extInfo, fields["ext_info"])
	assert.Equal(t, "2.0.0", fields["expected_latest_version"])
}
