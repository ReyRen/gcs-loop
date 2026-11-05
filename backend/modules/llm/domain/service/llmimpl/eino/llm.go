// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package eino

import (
	"context"

	einoModel "github.com/cloudwego/eino/components/model"

	"github.com/coze-dev/coze-loop/backend/modules/llm/domain/entity"
	llm_errorx "github.com/coze-dev/coze-loop/backend/modules/llm/pkg/errno"
	"github.com/coze-dev/coze-loop/backend/pkg/errorx"
)

type LLM struct {
	frame     entity.Frame
	protocol  entity.Protocol
	chatModel IEinoChatModel
}

//go:generate mockgen -destination=mocks/llm.go -package=mocks . IEinoChatModel
type IEinoChatModel interface {
	einoModel.ToolCallingChatModel
}

func (l *LLM) Generate(ctx context.Context, input []*entity.Message, opts ...entity.Option) (*entity.Message, error) {
	// 解析option
	optsDO := entity.ApplyOptions(nil, opts...)
	einoOpts, err := entity.FromDOOptions(optsDO)
	if err != nil {
		return nil, err
	}
	// 绑定tools
	einoTools, err := entity.FromDOTools(optsDO.Tools)
	if err != nil {
		return nil, errorx.NewByCode(llm_errorx.RequestNotValidCode, errorx.WithExtraMsg(err.Error()))
	}
	if len(einoTools) > 0 {
		l.chatModel, err = l.chatModel.WithTools(einoTools)
		if err != nil {
			return nil, errorx.NewByCode(llm_errorx.BuildLLMFailedCode, errorx.WithExtraMsg(err.Error()))
		}
	}
	// 请求模型
	einoMsg, err := l.chatModel.Generate(ctx, entity.FromDOMessages(l.prepareMessages(input)), einoOpts...)
	if err != nil {
		return nil, errorx.NewByCode(llm_errorx.CallModelFailedCode, errorx.WithExtraMsg(err.Error()))
	}
	// 解析模型返回结果
	return entity.ToDOMessage(einoMsg)
}

func (l *LLM) Stream(ctx context.Context, input []*entity.Message, opts ...entity.Option) (
	entity.IStreamReader, error,
) {
	// 解析 option
	optsDO := entity.ApplyOptions(nil, opts...)
	einoOpts, err := entity.FromDOOptions(optsDO)
	if err != nil {
		return nil, err
	}
	// 绑定tools
	einoTools, err := entity.FromDOTools(optsDO.Tools)
	if err != nil {
		return nil, errorx.NewByCode(llm_errorx.RequestNotValidCode, errorx.WithExtraMsg(err.Error()))
	}
	if len(einoTools) > 0 {
		l.chatModel, err = l.chatModel.WithTools(einoTools)
		if err != nil {
			return nil, errorx.NewByCode(llm_errorx.BuildLLMFailedCode, errorx.WithExtraMsg(err.Error()))
		}
	}
	// 请求模型
	einoSr, err := l.chatModel.Stream(ctx, entity.FromDOMessages(l.prepareMessages(input)), einoOpts...)
	if err != nil {
		return nil, errorx.NewByCode(llm_errorx.CallModelFailedCode, errorx.WithExtraMsg(err.Error()))
	}
	// 解析模型返回结果
	return entity.NewStreamReader(l.frame, einoSr), nil
}

func (l *LLM) prepareMessages(input []*entity.Message) []*entity.Message {
	if l.protocol != entity.ProtocolOpenAI {
		return input
	}
	messages := make([]*entity.Message, 0, len(input))
	for _, msg := range input {
		// The OpenAI SDK omits empty content strings. Ollama rejects these
		// content-less template/history placeholders; keep media and tool turns.
		if msg != nil && (msg.Role == entity.RoleSystem || msg.Role == entity.RoleUser || msg.Role == entity.RoleAssistant) &&
			msg.Content == "" && msg.ReasoningContent == "" && len(msg.MultiModalContent) == 0 &&
			len(msg.ToolCalls) == 0 && msg.ToolCallID == "" {
			continue
		}
		messages = append(messages, msg)
	}
	return messages
}
