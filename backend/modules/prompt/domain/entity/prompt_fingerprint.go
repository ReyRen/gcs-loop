// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package entity

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// PromptDetailFingerprint returns a stable digest of a Prompt detail.
func PromptDetailFingerprint(detail *PromptDetail) (string, error) {
	payload, err := json.Marshal(detail)
	if err != nil {
		return "", err
	}
	return sha256Hex(payload), nil
}

// PromptDraftFingerprint binds both the persisted detail and its source
// version to the application-layer audit. BaseVersion is deliberately part of
// the digest: a concurrent revert or explicit rebase can preserve identical
// content while changing the commit lineage.
func PromptDraftFingerprint(draft *PromptDraft) (string, error) {
	var detail *PromptDetail
	var baseVersion string
	if draft != nil {
		detail = draft.PromptDetail
		if draft.DraftInfo != nil {
			baseVersion = draft.DraftInfo.BaseVersion
		}
	}
	payload, err := json.Marshal(struct {
		Detail      *PromptDetail `json:"detail"`
		BaseVersion string        `json:"base_version"`
	}{
		Detail:      detail,
		BaseVersion: baseVersion,
	})
	if err != nil {
		return "", err
	}
	return sha256Hex(payload), nil
}

// CommitRequestFingerprint is persisted with a commit and makes retrying the
// same version safe after the first request succeeded but its response was
// lost. Label order and duplicate label keys are intentionally ignored.
func CommitRequestFingerprint(version, description string, labelKeys []string) (string, error) {
	payload, err := json.Marshal(struct {
		Version     string   `json:"version"`
		Description string   `json:"description"`
		LabelKeys   []string `json:"label_keys"`
	}{
		Version:     version,
		Description: description,
		LabelKeys:   NormalizeLabelKeys(labelKeys),
	})
	if err != nil {
		return "", err
	}
	return sha256Hex(payload), nil
}

// NormalizeLabelKeys returns sorted, de-duplicated label keys. An empty input
// remains nil so existing JSON and database behavior stays backward compatible.
func NormalizeLabelKeys(labelKeys []string) []string {
	if len(labelKeys) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(labelKeys))
	for _, key := range labelKeys {
		set[key] = struct{}{}
	}
	normalized := make([]string, 0, len(set))
	for key := range set {
		normalized = append(normalized, key)
	}
	sort.Strings(normalized)
	return normalized
}

func sha256Hex(payload []byte) string {
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}
