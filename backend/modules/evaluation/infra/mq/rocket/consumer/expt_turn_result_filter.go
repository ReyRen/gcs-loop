// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package consumer

import (
	"context"
	"fmt"

	"github.com/bytedance/sonic"

	"github.com/coze-dev/coze-loop/backend/infra/middleware/session"
	"github.com/coze-dev/coze-loop/backend/infra/mq"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
	"github.com/coze-dev/coze-loop/backend/pkg/errorx"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
	"github.com/coze-dev/coze-loop/backend/pkg/logs"
)

type exptTurnResultFilterManager interface {
	UpsertExptTurnResultFilter(ctx context.Context, req *expt.UpsertExptTurnResultFilterRequest) (*expt.UpsertExptTurnResultFilterResponse, error)
}

type exptTurnResultFilterUserResolver interface {
	ResolveExptTurnResultFilterUser(ctx context.Context, experimentID, spaceID int64) (string, error)
}

type ExptTurnResultFilterConsumer struct {
	exptManager  exptTurnResultFilterManager
	userResolver exptTurnResultFilterUserResolver
}

func NewExptTurnResultFilterConsumer(exptManager exptTurnResultFilterManager) mq.IConsumerHandler {
	consumer := &ExptTurnResultFilterConsumer{
		exptManager: exptManager,
	}
	consumer.userResolver, _ = exptManager.(exptTurnResultFilterUserResolver)
	return consumer
}

func (c *ExptTurnResultFilterConsumer) HandleMessage(ctx context.Context, ext *mq.MessageExt) (err error) {
	defer func() {
		if err != nil {
			logs.CtxError(ctx, "ExptTurnResultFilterConsumer HandleMessage fail, err: %v", err)
		}
	}()

	event := &entity.ExptTurnResultFilterEvent{}
	body := ext.Body
	if err := sonic.Unmarshal(body, event); err != nil {
		logs.CtxError(ctx, "ExptTurnResultFilterEvent json unmarshal fail, raw: %v, err: %s", string(body), err)
		return nil
	}

	logs.CtxInfo(ctx, "ExptTurnResultFilterConsumer consume message, event: %v, msg_id: %v", string(body), ext.MsgID)
	if event.Session != nil && event.Session.UserID != "" {
		ctx = session.WithCtxUser(ctx, &session.User{ID: event.Session.UserID})
	} else {
		if c.userResolver == nil {
			return fmt.Errorf("ExptTurnResultFilterEvent user session is missing")
		}
		userID, err := c.userResolver.ResolveExptTurnResultFilterUser(ctx, event.ExperimentID, event.SpaceID)
		if err != nil {
			return err
		}
		if userID == "" {
			return fmt.Errorf("ExptTurnResultFilterEvent resolved empty user_id")
		}
		ctx = session.WithCtxUser(ctx, &session.User{ID: userID})
	}

	upsertExptTurnResultFilterRequest := &expt.UpsertExptTurnResultFilterRequest{
		WorkspaceID:  ptr.Of(event.SpaceID),
		ExperimentID: ptr.Of(event.ExperimentID),
		ItemIds:      event.ItemID,
	}
	if event.FilterType != nil {
		upsertExptTurnResultFilterRequest.FilterType = (*expt.UpsertExptTurnResultFilterType)(event.FilterType)
	}
	if event.RetryTimes != nil {
		upsertExptTurnResultFilterRequest.RetryTimes = ptr.Of(*event.RetryTimes)
	}
	// 调用 ExptMangerImpl.UpsertExptTurnResultFilter
	resp, err := c.exptManager.UpsertExptTurnResultFilter(ctx, upsertExptTurnResultFilterRequest)
	if err != nil {
		return err
	}
	if resp.BaseResp != nil && resp.BaseResp.StatusCode != 0 {
		return errorx.NewByCode(resp.BaseResp.StatusCode, errorx.WithExtraMsg(resp.BaseResp.StatusMessage))
	}
	return nil
}
