// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package entity

type PromptTemplatePresetCategory string

const (
	PromptTemplatePresetCategoryTextGeneration     PromptTemplatePresetCategory = "text_generation"
	PromptTemplatePresetCategoryImageAnalysis      PromptTemplatePresetCategory = "image_analysis"
	PromptTemplatePresetCategoryVideoUnderstanding PromptTemplatePresetCategory = "video_understanding"
	PromptTemplatePresetCategoryDeepReasoning      PromptTemplatePresetCategory = "deep_reasoning"
	PromptTemplatePresetCategoryJSONOutput         PromptTemplatePresetCategory = "json_output"
	PromptTemplatePresetCategoryFunctionCalling    PromptTemplatePresetCategory = "function_calling"
)

type PromptTemplatePresetCategoryInfo struct {
	Category    PromptTemplatePresetCategory `json:"category"`
	DisplayName string                       `json:"display_name"`
}

type PromptTemplatePreset struct {
	TemplateKey  string                       `json:"template_key"`
	DisplayName  string                       `json:"display_name"`
	Description  string                       `json:"description"`
	Category     PromptTemplatePresetCategory `json:"category"`
	IconKey      string                       `json:"icon_key"`
	PromptDetail *PromptDetail                `json:"draft_detail"`
}

type PromptTemplatePresetCatalog struct {
	Categories []*PromptTemplatePresetCategoryInfo `json:"categories"`
	Templates  []*PromptTemplatePreset             `json:"templates"`
}
