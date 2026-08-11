// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package entity

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCommitRequestFingerprint_NormalizesLabels(t *testing.T) {
	a, err := CommitRequestFingerprint("1.0.0", "release", []string{"stable", "prod", "stable"})
	require.NoError(t, err)
	b, err := CommitRequestFingerprint("1.0.0", "release", []string{"prod", "stable"})
	require.NoError(t, err)
	assert.Equal(t, a, b)

	c, err := CommitRequestFingerprint("1.0.0", "different", []string{"prod", "stable"})
	require.NoError(t, err)
	assert.NotEqual(t, a, c)
}

func TestPromptDetailFingerprint_IsStableForMapOrder(t *testing.T) {
	a, err := PromptDetailFingerprint(&PromptDetail{ExtInfos: map[string]string{"b": "2", "a": "1"}})
	require.NoError(t, err)
	b, err := PromptDetailFingerprint(&PromptDetail{ExtInfos: map[string]string{"a": "1", "b": "2"}})
	require.NoError(t, err)
	assert.Equal(t, a, b)
}

func TestPromptDraftFingerprint_IncludesBaseVersion(t *testing.T) {
	detail := &PromptDetail{ExtInfos: map[string]string{"source": "same"}}
	a, err := PromptDraftFingerprint(&PromptDraft{
		DraftInfo:    &DraftInfo{BaseVersion: "1.0.0"},
		PromptDetail: detail,
	})
	require.NoError(t, err)
	b, err := PromptDraftFingerprint(&PromptDraft{
		DraftInfo:    &DraftInfo{BaseVersion: "1.0.1"},
		PromptDetail: detail,
	})
	require.NoError(t, err)
	assert.NotEqual(t, a, b)
}
