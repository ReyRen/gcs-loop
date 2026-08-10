// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/kitex/pkg/remote/trans/nphttp2/codes"
	"github.com/cloudwego/kitex/pkg/remote/trans/nphttp2/status"

	"github.com/coze-dev/coze-loop/backend/infra/external/benefit"
	"github.com/coze-dev/coze-loop/backend/infra/middleware/session"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/debug"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/application/convertor"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/entity"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/repo"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/service"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/pkg/consts"
	prompterr "github.com/coze-dev/coze-loop/backend/modules/prompt/pkg/errno"
	"github.com/coze-dev/coze-loop/backend/pkg/errorx"
	"github.com/coze-dev/coze-loop/backend/pkg/goroutine"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
	"github.com/coze-dev/coze-loop/backend/pkg/logs"
)

const (
	optimizedPromptStartTag = "<optimized_prompt>"
	optimizedPromptEndTag   = "</optimized_prompt>"
)

const oneStepOptimizeSystemPrompt = `You are an expert prompt engineer. Rewrite the supplied prompt so it is clearer, more precise, more robust, and easier for a large language model to follow.

Rules:
1. Preserve the original intent, language, facts, constraints, output format, and role.
2. Preserve every template variable exactly as written, especially placeholders such as {{variable_name}}. Never rename, remove, translate, or invent variables.
3. Resolve ambiguity by improving structure and wording, but do not add requirements that conflict with the original prompt.
4. Keep useful examples, Markdown, XML, JSON, and code fences valid.
5. Return only the optimized prompt text. Do not explain your changes and do not add wrapper tags.`

// GeneratePrompt implements the quick "优化" action above the first System Prompt.
// It intentionally uses the model configuration stored in the current user's prompt draft.
func (p *PromptDebugApplicationImpl) GeneratePrompt(ctx context.Context, req *debug.GeneratePromptRequest, stream debug.PromptDebugService_GeneratePromptServer) (err error) {
	if err = validateGeneratePromptRequest(req); err != nil {
		return err
	}
	userID, ok := session.UserIDInCtx(ctx)
	if !ok || strings.TrimSpace(userID) == "" {
		return errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("User not found"))
	}

	promptDO, err := p.promptService.GetPrompt(ctx, service.GetPromptParam{
		PromptID:  req.GetPromptID(),
		WithDraft: true,
		UserID:    userID,
	})
	if err != nil {
		return err
	}
	if promptDO == nil || promptDO.SpaceID != req.GetSpaceID() {
		return errorx.NewByCode(prompterr.ResourceNotFoundCode, errorx.WithExtraMsg("WorkspaceID not match"))
	}
	if err = p.auth.MCheckPromptPermission(ctx, promptDO.SpaceID, []int64{promptDO.ID}, consts.ActionLoopPromptDebug); err != nil {
		return err
	}
	if err = p.checkOptimizeBenefit(ctx, userID, promptDO); err != nil {
		return err
	}

	promptDetail := promptDO.GetPromptDetail()
	if promptDetail == nil || promptDetail.ModelConfig == nil || promptDetail.ModelConfig.ModelID <= 0 {
		return errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("Prompt draft model config is required"))
	}
	originalMessage := convertor.MessageDTO2DO(req.GetOriginalPromptMessage())
	originalPrompt := messageText(originalMessage)
	if strings.TrimSpace(originalPrompt) == "" {
		return errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("Original prompt content is required"))
	}

	startedAt := time.Now()
	record := &entity.PromptGenerateRecord{
		PromptID:           promptDO.ID,
		SpaceID:            promptDO.SpaceID,
		PromptKey:          promptDO.PromptKey,
		GeneratePromptType: string(req.GetGeneratePromptType()),
		OriginalPrompt:     originalPrompt,
		ModelID:            promptDetail.ModelConfig.ModelID,
		Status:             entity.GeneratePromptStatusRunning,
		IsRetry:            req.GetIsRetry(),
		GeneratedBy:        userID,
		StartedAt:          startedAt.UnixMilli(),
	}
	record.ID, err = p.generateRecordRepo.Create(ctx, record)
	if err != nil {
		return err
	}
	defer func() {
		record.EndedAt = time.Now().UnixMilli()
		record.CostMS = record.EndedAt - record.StartedAt
		if finishErr := p.generateRecordRepo.Finish(context.WithoutCancel(ctx), record); finishErr != nil {
			logs.CtxError(ctx, "finish prompt generate record failed, record_id=%d, err=%v", record.ID, finishErr)
		}
	}()

	if err = sendGeneratePromptContent(ctx, stream, record.ID, optimizedPromptStartTag+"\n", nil); err != nil {
		record.Status = streamResultStatus(err)
		return normalizeGenerateStreamError(ctx, err)
	}

	resultStream := make(chan *entity.Reply)
	replyChan := make(chan *entity.Reply, 1)
	errChan := make(chan error, 1)
	optimizePrompt, optimizeMessages := buildOneStepOptimizePrompt(promptDO, req, originalPrompt)
	goroutine.GoSafe(ctx, func() {
		var reply *entity.Reply
		var executeErr error
		defer func() {
			if recovered := recover(); recovered != nil {
				executeErr = errorx.New("panic occurred, reason=%v", recovered)
			}
			close(resultStream)
			replyChan <- reply
			close(replyChan)
			errChan <- executeErr
			close(errChan)
		}()
		reply, executeErr = p.promptService.ExecuteStreaming(ctx, service.ExecuteStreamingParam{
			ExecuteParam: service.ExecuteParam{
				Prompt:         optimizePrompt,
				Messages:       optimizeMessages,
				Scenario:       entity.ScenarioPromptDebug,
				DisableTracing: true,
			},
			ResultStream: resultStream,
		})
	})

	var optimized strings.Builder
	for reply := range resultStream {
		if reply == nil || reply.Item == nil || reply.Item.Message == nil {
			continue
		}
		content := ptr.From(reply.Item.Message.Content)
		optimized.WriteString(content)
		if err = stream.Send(ctx, &debug.GeneratePromptResponse{
			Delta:    convertor.MessageDO2DTO(reply.Item.Message),
			Usage:    convertor.TokenUsageDO2DTO(reply.Item.TokenUsage),
			RecordID: ptr.Of(record.ID),
		}); err != nil {
			record.GeneratedPrompt = optimized.String()
			record.Status = streamResultStatus(err)
			return normalizeGenerateStreamError(ctx, err)
		}
	}
	aggregatedReply := <-replyChan
	executeErr := <-errChan
	if executeErr != nil {
		record.GeneratedPrompt = optimized.String()
		record.Status = streamResultStatus(executeErr)
		return normalizeGenerateStreamError(ctx, executeErr)
	}
	var finalUsage *entity.TokenUsage
	if aggregatedReply != nil && aggregatedReply.Item != nil && aggregatedReply.Item.TokenUsage != nil {
		finalUsage = aggregatedReply.Item.TokenUsage
		record.InputTokens = finalUsage.InputTokens
		record.OutputTokens = finalUsage.OutputTokens
	}
	record.GeneratedPrompt = strings.TrimSpace(optimized.String())
	if err = sendGeneratePromptContent(ctx, stream, record.ID, "\n"+optimizedPromptEndTag, finalUsage); err != nil {
		record.Status = streamResultStatus(err)
		return normalizeGenerateStreamError(ctx, err)
	}
	record.Status = entity.GeneratePromptStatusSucceeded
	return nil
}

func (p *PromptDebugApplicationImpl) UpdateGenerateRecord(ctx context.Context, req *debug.UpdateGenerateRecordRequest) (*debug.UpdateGenerateRecordResponse, error) {
	resp := debug.NewUpdateGenerateRecordResponse()
	if req == nil {
		return resp, errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("Request is nil"))
	}
	if err := req.IsValid(); err != nil {
		return resp, errorx.WrapByCode(err, prompterr.CommonInvalidParamCode)
	}
	userID, ok := session.UserIDInCtx(ctx)
	if !ok || strings.TrimSpace(userID) == "" {
		return resp, errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("User not found"))
	}
	if err := p.auth.MCheckPromptPermission(ctx, req.GetSpaceID(), []int64{req.GetPromptID()}, consts.ActionLoopPromptRead); err != nil {
		return resp, err
	}
	err := p.generateRecordRepo.UpdateFeedback(ctx, repo.UpdateGenerateRecordParam{
		RecordID:    req.GetRecordID(),
		PromptID:    req.GetPromptID(),
		SpaceID:     req.GetSpaceID(),
		GeneratedBy: userID,
		IsLiked:     req.IsLiked,
		IsDisliked:  req.IsDisliked,
		IsAccepted:  req.IsAccepted,
		IsCanceled:  req.IsCanceled,
	})
	return resp, err
}

func validateGeneratePromptRequest(req *debug.GeneratePromptRequest) error {
	if req == nil {
		return errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("Request is nil"))
	}
	if err := req.IsValid(); err != nil {
		return errorx.WrapByCode(err, prompterr.CommonInvalidParamCode)
	}
	if req.GetGeneratePromptType() != debug.GeneratePromptTypeOneStepOptimize {
		return errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("Only one_step_optimize is supported"))
	}
	message := convertor.MessageDTO2DO(req.GetOriginalPromptMessage())
	if message == nil || message.Role != entity.RoleSystem {
		return errorx.NewByCode(prompterr.CommonInvalidParamCode, errorx.WithExtraMsg("Only the first System Prompt can be optimized"))
	}
	return nil
}

func (p *PromptDebugApplicationImpl) checkOptimizeBenefit(ctx context.Context, userID string, promptDO *entity.Prompt) error {
	result, err := p.benefitService.CheckPromptBenefit(ctx, &benefit.CheckPromptBenefitParams{
		ConnectorUID: userID,
		SpaceID:      promptDO.SpaceID,
		PromptID:     promptDO.ID,
	})
	if err != nil {
		return err
	}
	if result != nil && result.DenyReason != nil {
		return result.DenyReason.ToErr()
	}
	return nil
}

func buildOneStepOptimizePrompt(source *entity.Prompt, req *debug.GeneratePromptRequest, originalPrompt string) (*entity.Prompt, []*entity.Message) {
	detail := source.GetPromptDetail()
	userContent := fmt.Sprintf("Prompt name: %s\nPrompt description: %s\n\nOriginal prompt:\n%s", req.GetPromptName(), req.GetPromptDesc(), originalPrompt)
	if req.GetIsRetry() {
		userContent += "\n\nThis is a retry. Produce a meaningfully different and better optimization."
	}
	optimizePrompt := (&entity.Prompt{
		ID:          source.ID,
		SpaceID:     source.SpaceID,
		PromptKey:   source.PromptKey,
		PromptBasic: source.PromptBasic,
		PromptDraft: &entity.PromptDraft{PromptDetail: &entity.PromptDetail{
			PromptTemplate: &entity.PromptTemplate{
				TemplateType: entity.TemplateTypeNormal,
				Messages: []*entity.Message{{
					Role:    entity.RoleSystem,
					Content: ptr.Of(oneStepOptimizeSystemPrompt),
				}},
			},
			ModelConfig: detail.ModelConfig,
		}},
	}).Clone()
	return optimizePrompt, []*entity.Message{{
		Role:       entity.RoleUser,
		Content:    ptr.Of(userContent),
		SkipRender: ptr.Of(true),
	}}
}

func messageText(message *entity.Message) string {
	if message == nil {
		return ""
	}
	if content := ptr.From(message.Content); content != "" {
		return content
	}
	var builder strings.Builder
	for _, part := range message.Parts {
		if part == nil || part.Type != entity.ContentTypeText {
			continue
		}
		builder.WriteString(ptr.From(part.Text))
	}
	return builder.String()
}

func sendGeneratePromptContent(ctx context.Context, stream debug.PromptDebugService_GeneratePromptServer, recordID int64, content string, usage *entity.TokenUsage) error {
	return stream.Send(ctx, &debug.GeneratePromptResponse{
		Delta: convertor.MessageDO2DTO(&entity.Message{
			Role:    entity.RoleAssistant,
			Content: ptr.Of(content),
		}),
		Usage:    convertor.TokenUsageDO2DTO(usage),
		RecordID: ptr.Of(recordID),
	})
}

func streamResultStatus(err error) string {
	if isGenerateStreamCanceled(err) {
		return entity.GeneratePromptStatusCanceled
	}
	return entity.GeneratePromptStatusFailed
}

func normalizeGenerateStreamError(ctx context.Context, err error) error {
	if !isGenerateStreamCanceled(err) {
		return err
	}
	logs.CtxWarn(ctx, "prompt optimization stream canceled")
	return nil
}

func isGenerateStreamCanceled(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if st, ok := status.FromError(err); ok {
		return st.Code() == codes.Canceled || st.Code() == codes.DeadlineExceeded
	}
	return false
}
