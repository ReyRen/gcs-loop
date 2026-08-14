// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package conf

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
	"github.com/coze-dev/coze-loop/backend/pkg/conf"
	confmocks "github.com/coze-dev/coze-loop/backend/pkg/conf/mocks"
	confviper "github.com/coze-dev/coze-loop/backend/pkg/conf/viper"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
)

func TestPromptConfigProvider_GetPromptTemplatePresetCatalog(t *testing.T) {
	ctrl := gomock.NewController(t)
	configLoader := confmocks.NewMockIConfigLoader(ctrl)
	configLoader.EXPECT().
		UnmarshalKey(gomock.Any(), "prompt_template_presets", gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ string, target interface{}, _ ...conf.DecodeOptionFn) error {
			catalog := target.(*entity.PromptTemplatePresetCatalog)
			catalog.Categories = []*entity.PromptTemplatePresetCategoryInfo{{
				Category:    entity.PromptTemplatePresetCategoryTextGeneration,
				DisplayName: "文本创作",
			}}
			catalog.Templates = []*entity.PromptTemplatePreset{{
				TemplateKey: "marketing_copy",
				DisplayName: "营销文案生成器",
				Category:    entity.PromptTemplatePresetCategoryTextGeneration,
			}}
			return nil
		})

	provider := &PromptConfigProvider{ConfigLoader: configLoader}
	catalog, err := provider.GetPromptTemplatePresetCatalog(context.Background())

	assert.NoError(t, err)
	assert.Len(t, catalog.Categories, 1)
	assert.Len(t, catalog.Templates, 1)
	assert.Equal(t, "marketing_copy", catalog.Templates[0].TemplateKey)
}

func TestPromptConfigProvider_GetPromptDefaultConfig(t *testing.T) {
	ctrl := gomock.NewController(t)
	configLoader := confmocks.NewMockIConfigLoader(ctrl)
	configLoader.EXPECT().
		UnmarshalKey(gomock.Any(), "prompt_default_config", gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ string, target interface{}, _ ...conf.DecodeOptionFn) error {
			config := target.(*prompt.PromptDetail)
			config.ModelConfig = &prompt.ModelConfig{ModelID: ptr.Of(int64(1))}
			return nil
		})

	provider := &PromptConfigProvider{ConfigLoader: configLoader}
	config, err := provider.GetPromptDefaultConfig(context.Background())

	require.NoError(t, err)
	require.NotNil(t, config)
	require.NotNil(t, config.ModelConfig)
	assert.Equal(t, int64(1), config.ModelConfig.GetModelID())
}

func TestDockerComposePromptTemplatePresetCatalog(t *testing.T) {
	_, testFile, _, ok := runtime.Caller(0)
	require.True(t, ok)

	configFile := filepath.Clean(filepath.Join(
		filepath.Dir(testFile),
		"..", "..", "..", "..", "..",
		"release", "deployment", "docker-compose", "conf", "prompt.yaml",
	))
	configLoader, err := confviper.NewFileConfLoader(
		filepath.Base(configFile),
		confviper.WithConfigPath(filepath.Dir(configFile)),
	)
	require.NoError(t, err)

	provider := &PromptConfigProvider{ConfigLoader: configLoader}
	defaultConfig, err := provider.GetPromptDefaultConfig(context.Background())
	require.NoError(t, err)
	require.NotNil(t, defaultConfig)
	require.NotNil(t, defaultConfig.ModelConfig)
	assert.Equal(t, int64(1), defaultConfig.ModelConfig.GetModelID())

	catalog, err := provider.GetPromptTemplatePresetCatalog(context.Background())
	require.NoError(t, err)
	require.NotNil(t, catalog)
	require.Len(t, catalog.Categories, 6)
	require.Len(t, catalog.Templates, 14)

	expectedCategories := []struct {
		category entity.PromptTemplatePresetCategory
		name     string
	}{
		{entity.PromptTemplatePresetCategoryTextGeneration, "文本创作"},
		{entity.PromptTemplatePresetCategoryImageAnalysis, "图片分析"},
		{entity.PromptTemplatePresetCategoryVideoUnderstanding, "视频理解"},
		{entity.PromptTemplatePresetCategoryDeepReasoning, "深度思考"},
		{entity.PromptTemplatePresetCategoryJSONOutput, "Json输出"},
		{entity.PromptTemplatePresetCategoryFunctionCalling, "函数调用"},
	}
	for i, expected := range expectedCategories {
		require.NotNil(t, catalog.Categories[i])
		assert.Equal(t, expected.category, catalog.Categories[i].Category)
		assert.Equal(t, expected.name, catalog.Categories[i].DisplayName)
	}

	type templateExpectation struct {
		key               string
		name              string
		description       string
		category          entity.PromptTemplatePresetCategory
		iconKey           string
		roles             []entity.Role
		variableKeys      []string
		variableType      entity.VariableType
		temperature       float64
		hasTopP           bool
		hasFrequency      bool
		hasThinking       bool
		hasThinkingBudget bool
		digest            string
	}
	expectedTemplates := []templateExpectation{
		{key: "sku_search", name: "商品搜索", description: "一个电商导购机器人，能够理解用户的商品查询意图，并调用函数来查找相关商品。", category: entity.PromptTemplatePresetCategoryFunctionCalling, iconKey: "function", roles: []entity.Role{entity.RoleSystem}, temperature: 1, hasTopP: true, hasFrequency: true, hasThinking: true, hasThinkingBudget: true, digest: "13175dcb4cf34a0cfedd74369be17ef934be2a462c927aafe3e32d5cfd6d06c9"},
		{key: "review_conclusion_structure", name: "会议结论结构化", description: "项目管理办公室（PMO）的专家，负责将会议或评审的结论进行标准化记录，能够根据用户输入的评审会议纪要 ，提取关键信息并以严格的 JSON 格式输出。", category: entity.PromptTemplatePresetCategoryJSONOutput, iconKey: "json", roles: []entity.Role{entity.RoleSystem}, variableKeys: []string{"review_minutes"}, variableType: entity.VariableTypeString, temperature: 0.8, digest: "e28387a3b30829d70c376b82416b026245be5fe0ed62a919176e1c6a795ab829"},
		{key: "course_resource_checklist", name: "结构化课程清单", description: "一名教务助理，能够根据用户提供的课程介绍，整理出一份结构化的课程资源清单，输出能够严格符合 JSON 格式。", category: entity.PromptTemplatePresetCategoryJSONOutput, iconKey: "json", roles: []entity.Role{entity.RoleSystem}, variableKeys: []string{"course_description"}, variableType: entity.VariableTypeString, temperature: 1, hasTopP: true, hasFrequency: true, hasThinking: true, digest: "bdce7bf62f9e291dd57c827179b511909d46e7d37307446459e6b09a4f449790"},
		{key: "sku_structure_copywriting", name: "结构化商品文案", description: "一位顶级的电商文案写手，能够为给定的商品 创作一套完整的营销文案，同时输出严格遵守指定的 JSON 结构。", category: entity.PromptTemplatePresetCategoryJSONOutput, iconKey: "json", roles: []entity.Role{entity.RoleSystem}, variableKeys: []string{"product_name", "tone_and_style", "core_features", "target_customer"}, variableType: entity.VariableTypeString, temperature: 1, hasTopP: true, hasFrequency: true, hasThinking: true, digest: "4a0ee2246de02d9009177bebfa0d0ca02ec9441f6bf2898c1515a064170676d0"},
		{key: "prd_risk_analysis", name: "方案评审与风险分析", description: "一位顶级的解决方案架构师，能够评审用户提交的技术方案，并从技术可行性、成本效益、安全性和可扩展性四个维度进行深入分析，最终输出一份结构化的评审结论和风险评估报告。", category: entity.PromptTemplatePresetCategoryDeepReasoning, iconKey: "reasoning", roles: []entity.Role{entity.RoleSystem, entity.RoleUser}, variableKeys: []string{"solution_document"}, variableType: entity.VariableTypeString, temperature: 0.8, digest: "d33d161b414246fe4ed85eb6e5b7b4fb0d3cc6ce1924e5c3358cac8efbb459b7"},
		{key: "product_requirement_collector", name: "需求采集器", description: "一位资深的 IT 咨询顾问，可以与客户进行初步沟通，并结构化地记录下他们的核心需求，并根据用户提供的项目基本信息生成一份标准化的需求采集纪要。", category: entity.PromptTemplatePresetCategoryDeepReasoning, iconKey: "reasoning", roles: []entity.Role{entity.RoleSystem}, variableKeys: []string{"client_company", "project_name", "initial_description"}, variableType: entity.VariableTypeString, temperature: 0.8, digest: "efc7f0b16f446d7c3d9574804b4dd774c5bba09196d8574f43da260aebeb2fbd"},
		{key: "lesson_keypoint_extraction", name: "课堂视频要点提取", description: "一名高效的学习助理，能够观看用户上传的课堂录播视频 ，并提取出本堂课的核心内容，生成一份精炼的学习笔记。", category: entity.PromptTemplatePresetCategoryVideoUnderstanding, iconKey: "video", roles: []entity.Role{entity.RoleSystem, entity.RoleUser}, variableKeys: []string{"lecture_video"}, variableType: entity.VariableTypeMultiPart, temperature: 1, hasTopP: true, hasFrequency: true, digest: "14c395cc5044441e8b73dc578d51f83dea486dbc564543016d502dd54228bd82"},
		{key: "live_stream_summary", name: "直播复盘摘要", description: "一位专业的电商直播运营，能够分析一段直播带货视频 ，并生成一份数据驱动的复盘摘要。", category: entity.PromptTemplatePresetCategoryVideoUnderstanding, iconKey: "video", roles: []entity.Role{entity.RoleSystem, entity.RoleUser}, variableKeys: []string{"livestream_video"}, variableType: entity.VariableTypeMultiPart, temperature: 1, hasTopP: true, hasFrequency: true, hasThinking: true, digest: "3548795f4633529b33256ad940129a4a7052b0a858c667ff74379e7e9c10b9d6"},
		{key: "ecommerce_video_analyze", name: "电商产品视频分析", description: "一位电商产品视频分析专家，能够分析用户提供的产品视频，提取产品特点、使用场景、优势卖点等关键信息，并生成结构化的产品描述和营销要点", category: entity.PromptTemplatePresetCategoryVideoUnderstanding, iconKey: "video", roles: []entity.Role{entity.RoleSystem, entity.RoleUser}, variableKeys: []string{"video"}, variableType: entity.VariableTypeMultiPart, temperature: 1, hasTopP: true, hasFrequency: true, digest: "45d6249f11b158729c760b16d720bc3e10a1b52be08f9b8e3294e0442b307484"},
		{key: "homework_grading_assistant", name: "作业批改辅助", description: "一位认真负责的数学老师，能够根据用户上传的题目图片和学生答案图片，判断学生的解答是否正确，并给出评语。", category: entity.PromptTemplatePresetCategoryImageAnalysis, iconKey: "image", roles: []entity.Role{entity.RoleSystem, entity.RoleUser}, variableKeys: []string{"problem_image", "answer_image"}, variableType: entity.VariableTypeMultiPart, temperature: 1, hasTopP: true, hasFrequency: true, hasThinking: true, digest: "8e9aa7fa10ef894e49493971a7e7f013a7ec21ee16e2d43487196eb0fed6d6c7"},
		{key: "competitor_image_analyze", name: "竞品广告图分析", description: "一名资深的市场分析师，专精于广告创意评估。能够分析用户上传的竞品广告图，并从设计、文案和营销策略三个角度给出结构化的分析报告。", category: entity.PromptTemplatePresetCategoryImageAnalysis, iconKey: "image", roles: []entity.Role{entity.RoleSystem, entity.RoleUser}, variableKeys: []string{"competitor_ad_image"}, variableType: entity.VariableTypeMultiPart, temperature: 1, hasTopP: true, hasFrequency: true, hasThinking: true, digest: "355abe11db113d54e25cb26c5b569a4b0e4ce93158d510e771990d11c2598c68"},
		{key: "bidding_proposal_writing", name: "招标方案撰写", description: "一位顶级的 IT 解决方案售前专家，可以根据客户的招标要求和我方的优势，撰写一份有说服力的投标方案核心章节。", category: entity.PromptTemplatePresetCategoryTextGeneration, iconKey: "copywriting", roles: []entity.Role{entity.RoleSystem}, variableKeys: []string{"tender_requirements", "our_advantages"}, variableType: entity.VariableTypeString, temperature: 0.8, digest: "c0c9e205d51bdce10d6e9b550d72dfb4341875226811bdc1b20cf4761e44380a"},
		{key: "lesson_outline_generator", name: "课程大纲生成器", description: "一位经验丰富的教学设计师，擅长将复杂的知识体系转化为结构清晰、易于学习的课程大纲。可以根据用户给定的课程主题、目标学员和总课时，设计一份详细的课程大纲。", category: entity.PromptTemplatePresetCategoryTextGeneration, iconKey: "copywriting", roles: []entity.Role{entity.RoleSystem}, variableKeys: []string{"total_hours", "learning_objectives", "course_title", "target_audience"}, variableType: entity.VariableTypeString, temperature: 0.8, digest: "1f0385a06045d6798cd38c591fa25e355f963d6c03d104e1a82569565b0a1037"},
		{key: "video_copywriter_generator", name: "带货短视频文案生产器", description: "专注创作短视频带货文案，文案能够体现现代年轻人和老年人购买产品的心理。", category: entity.PromptTemplatePresetCategoryTextGeneration, iconKey: "copywriting", roles: []entity.Role{entity.RoleSystem}, temperature: 0.8, digest: "276614314d8fcade142c2c97ec49af10f63801385dc458d6fcdb448d351520cf"},
	}

	templatesByKey := make(map[string]*entity.PromptTemplatePreset, len(catalog.Templates))
	for i, expected := range expectedTemplates {
		preset := catalog.Templates[i]
		require.NotNil(t, preset)
		assert.Equal(t, expected.key, preset.TemplateKey)
		assert.Equal(t, expected.name, preset.DisplayName)
		assert.Equal(t, expected.description, preset.Description)
		assert.Equal(t, expected.category, preset.Category)
		assert.Equal(t, expected.iconKey, preset.IconKey)
		require.NotNil(t, preset.PromptDetail)
		require.NotNil(t, preset.PromptDetail.PromptTemplate)
		promptTemplate := preset.PromptDetail.PromptTemplate
		assert.Equal(t, entity.TemplateTypeNormal, promptTemplate.TemplateType)
		require.Len(t, promptTemplate.Messages, len(expected.roles))
		for j, role := range expected.roles {
			require.NotNil(t, promptTemplate.Messages[j])
			assert.Equal(t, role, promptTemplate.Messages[j].Role)
		}
		require.Len(t, promptTemplate.VariableDefs, len(expected.variableKeys))
		for j, key := range expected.variableKeys {
			require.NotNil(t, promptTemplate.VariableDefs[j])
			assert.Equal(t, key, promptTemplate.VariableDefs[j].Key)
			assert.Empty(t, promptTemplate.VariableDefs[j].Desc)
			assert.Equal(t, expected.variableType, promptTemplate.VariableDefs[j].Type)
			assert.Empty(t, promptTemplate.VariableDefs[j].TypeTags)
		}

		modelConfig := preset.PromptDetail.ModelConfig
		require.NotNil(t, modelConfig)
		assert.Equal(t, int64(1), modelConfig.ModelID)
		require.NotNil(t, modelConfig.MaxTokens)
		assert.Equal(t, int32(4096), *modelConfig.MaxTokens)
		require.NotNil(t, modelConfig.Temperature)
		assert.Equal(t, expected.temperature, *modelConfig.Temperature)
		if expected.hasTopP {
			require.NotNil(t, modelConfig.TopP)
			assert.Equal(t, 0.7, *modelConfig.TopP)
		} else {
			assert.Nil(t, modelConfig.TopP)
		}
		if expected.hasFrequency {
			require.NotNil(t, modelConfig.FrequencyPenalty)
			assert.Zero(t, *modelConfig.FrequencyPenalty)
		} else {
			assert.Nil(t, modelConfig.FrequencyPenalty)
		}
		assert.Nil(t, modelConfig.TopK)
		assert.Nil(t, modelConfig.PresencePenalty)
		assert.Nil(t, modelConfig.JSONMode)
		assert.Nil(t, modelConfig.Extra)
		assert.Empty(t, modelConfig.ParamConfigValues)
		if expected.hasThinking {
			require.NotNil(t, modelConfig.Thinking)
			require.NotNil(t, modelConfig.Thinking.ThinkingOption)
			assert.Equal(t, entity.ThinkingOptionEnabled, *modelConfig.Thinking.ThinkingOption)
			assert.Nil(t, modelConfig.Thinking.ReasoningEffort)
			if expected.hasThinkingBudget {
				require.NotNil(t, modelConfig.Thinking.BudgetTokens)
				assert.Zero(t, *modelConfig.Thinking.BudgetTokens)
			} else {
				assert.Nil(t, modelConfig.Thinking.BudgetTokens)
			}
		} else {
			assert.Nil(t, modelConfig.Thinking)
		}

		payload, err := json.Marshal(preset)
		require.NoError(t, err)
		digest := fmt.Sprintf("%x", sha256.Sum256(payload))
		assert.Equal(t, expected.digest, digest, expected.key)

		_, duplicated := templatesByKey[preset.TemplateKey]
		assert.False(t, duplicated, "duplicate template key %s", preset.TemplateKey)
		templatesByKey[preset.TemplateKey] = preset
	}

	productSearch := templatesByKey["sku_search"].PromptDetail
	require.Len(t, productSearch.Tools, 1)
	assert.Equal(t, entity.ToolTypeFunction, productSearch.Tools[0].Type)
	require.NotNil(t, productSearch.Tools[0].Function)
	assert.Equal(t, "search_products", productSearch.Tools[0].Function.Name)
	assert.Equal(t, "帮助用户寻找他们所需要的产品", productSearch.Tools[0].Function.Description)
	var parameters struct {
		Type       string `json:"type"`
		Properties map[string]struct {
			Type        string   `json:"type"`
			Description string   `json:"description"`
			Enum        []string `json:"enum"`
		} `json:"properties"`
		Required []string `json:"required"`
	}
	require.NoError(t, json.Unmarshal([]byte(productSearch.Tools[0].Function.Parameters), &parameters))
	assert.Equal(t, "object", parameters.Type)
	require.Len(t, parameters.Properties, 2)
	assert.Equal(t, "string", parameters.Properties["keywords"].Type)
	assert.Equal(t, "从user query里找到关键词", parameters.Properties["keywords"].Description)
	assert.Equal(t, []string{"食品", "电器"}, parameters.Properties["category"].Enum)
	_, hasPriceRange := parameters.Properties["price_range"]
	assert.False(t, hasPriceRange)
	assert.Equal(t, []string{"keywords"}, parameters.Required)
	require.NotNil(t, productSearch.ToolCallConfig)
	assert.Equal(t, entity.ToolChoiceTypeAuto, productSearch.ToolCallConfig.ToolChoice)

	type expectedPart struct {
		partType entity.ContentType
		text     string
	}
	part := func(partType entity.ContentType, text string) expectedPart {
		return expectedPart{partType: partType, text: text}
	}
	assertMessageParts := func(t *testing.T, key string, expected ...expectedPart) {
		t.Helper()
		messages := templatesByKey[key].PromptDetail.PromptTemplate.Messages
		require.Len(t, messages, 2)
		require.Len(t, messages[1].Parts, len(expected))
		for i, expectedPart := range expected {
			require.NotNil(t, messages[1].Parts[i])
			assert.Equal(t, expectedPart.partType, messages[1].Parts[i].Type)
			require.NotNil(t, messages[1].Parts[i].Text)
			assert.Equal(t, expectedPart.text, *messages[1].Parts[i].Text)
		}
	}
	assertMessageParts(t, "lesson_keypoint_extraction", part(entity.ContentTypeMultiPartVariable, "lecture_video"))
	assertMessageParts(t, "live_stream_summary", part(entity.ContentTypeMultiPartVariable, "livestream_video"))
	assertMessageParts(t, "ecommerce_video_analyze",
		part(entity.ContentTypeText, "请分析提供的产品视频"),
		part(entity.ContentTypeMultiPartVariable, "video"),
		part(entity.ContentTypeText, "，完成以下任务：1) 提取产品核心功能；2) 识别产品使用场景；3) 总结产品优势卖点；4) 生成3个潜在的营销文案；5) 指出视频中的关键帧时刻。"),
	)
	assertMessageParts(t, "homework_grading_assistant",
		part(entity.ContentTypeMultiPartVariable, "problem_image"),
		part(entity.ContentTypeMultiPartVariable, "answer_image"),
	)
	assertMessageParts(t, "competitor_image_analyze", part(entity.ContentTypeMultiPartVariable, "competitor_ad_image"))

	riskUserMessage := templatesByKey["prd_risk_analysis"].PromptDetail.PromptTemplate.Messages[1]
	require.NotNil(t, riskUserMessage.Content)
	assert.Empty(t, *riskUserMessage.Content)
	assert.Empty(t, riskUserMessage.Parts)

	biddingMessages := templatesByKey["bidding_proposal_writing"].PromptDetail.PromptTemplate.Messages
	require.Len(t, biddingMessages, 1)
	assert.Equal(t, entity.RoleSystem, biddingMessages[0].Role)
	require.NotNil(t, biddingMessages[0].Content)
	assert.Contains(t, *biddingMessages[0].Content, "{{tender_requirements}}")
	assert.Contains(t, *biddingMessages[0].Content, "{{our_advantages}}")
	assert.NotContains(t, *biddingMessages[0].Content, "{{section_goal}}")
}

func TestPromptConfigProvider_GetPTaaSMaxQPSByPromptKey(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		spaceID    int64
		promptKey  string
		configData interface{}
		mockErr    error
		wantQPS    int
		wantErr    bool
	}{
		{
			name:      "使用默认QPS - space_id和prompt_key都不存在",
			spaceID:   12345,
			promptKey: "non_existent_key",
			configData: &ptaasRateLimitConfig{
				DefaultMaxQPS:   100,
				PromptKeyMaxQPS: map[string]map[string]int{},
			},
			wantQPS: 100,
			wantErr: false,
		},
		{
			name:      "使用特定space_id和prompt_key的QPS",
			spaceID:   12345,
			promptKey: "special_prompt",
			configData: &ptaasRateLimitConfig{
				DefaultMaxQPS: 100,
				PromptKeyMaxQPS: map[string]map[string]int{
					"12345": {
						"special_prompt": 200,
					},
				},
			},
			wantQPS: 200,
			wantErr: false,
		},
		{
			name:      "space_id存在但prompt_key不存在时使用默认QPS",
			spaceID:   12345,
			promptKey: "non_existent_prompt",
			configData: &ptaasRateLimitConfig{
				DefaultMaxQPS: 150,
				PromptKeyMaxQPS: map[string]map[string]int{
					"12345": {
						"other_prompt": 300,
					},
				},
			},
			wantQPS: 150,
			wantErr: false,
		},
		{
			name:      "space_id不存在时使用默认QPS",
			spaceID:   99999,
			promptKey: "any_prompt",
			configData: &ptaasRateLimitConfig{
				DefaultMaxQPS: 120,
				PromptKeyMaxQPS: map[string]map[string]int{
					"12345": {
						"some_prompt": 400,
					},
				},
			},
			wantQPS: 120,
			wantErr: false,
		},
		{
			name:      "配置加载失败",
			spaceID:   12345,
			promptKey: "any_key",
			mockErr:   assert.AnError,
			wantQPS:   0,
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockConfigLoader := confmocks.NewMockIConfigLoader(ctrl)

			if tt.mockErr != nil {
				mockConfigLoader.EXPECT().
					UnmarshalKey(gomock.Any(), "ptaas_rate_limit_config", gomock.Any()).
					Return(tt.mockErr).AnyTimes()
			} else {
				mockConfigLoader.EXPECT().
					UnmarshalKey(gomock.Any(), "ptaas_rate_limit_config", gomock.Any()).
					DoAndReturn(func(ctx context.Context, key string, target interface{}, opts ...conf.DecodeOptionFn) error {
						if config, ok := target.(*ptaasRateLimitConfig); ok {
							*config = *tt.configData.(*ptaasRateLimitConfig)
						}
						return nil
					}).AnyTimes()
			}

			provider := &PromptConfigProvider{
				ConfigLoader: mockConfigLoader,
			}

			qps, err := provider.GetPTaaSMaxQPSByPromptKey(context.Background(), tt.spaceID, tt.promptKey)

			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.wantQPS, qps)
			}
		})
	}
}
