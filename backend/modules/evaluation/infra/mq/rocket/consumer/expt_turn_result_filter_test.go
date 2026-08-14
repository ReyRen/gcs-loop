// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/infra/middleware/session"
	"github.com/coze-dev/coze-loop/backend/infra/mq"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
)

type filterConsumerManager struct {
	gotUserID     string
	resolvedUser  string
	resolveErr    error
	upsertErr     error
	resolveCalled bool
}

func (m *filterConsumerManager) UpsertExptTurnResultFilter(ctx context.Context, _ *expt.UpsertExptTurnResultFilterRequest) (*expt.UpsertExptTurnResultFilterResponse, error) {
	m.gotUserID = session.UserIDInCtxOrEmpty(ctx)
	return &expt.UpsertExptTurnResultFilterResponse{}, m.upsertErr
}

func (m *filterConsumerManager) ResolveExptTurnResultFilterUser(_ context.Context, _, _ int64) (string, error) {
	m.resolveCalled = true
	return m.resolvedUser, m.resolveErr
}

type filterConsumerManagerWithoutResolver struct{}

func (m *filterConsumerManagerWithoutResolver) UpsertExptTurnResultFilter(context.Context, *expt.UpsertExptTurnResultFilterRequest) (*expt.UpsertExptTurnResultFilterResponse, error) {
	return &expt.UpsertExptTurnResultFilterResponse{}, nil
}

func filterEventMessage(t *testing.T, event *entity.ExptTurnResultFilterEvent) *mq.MessageExt {
	t.Helper()
	body, err := json.Marshal(event)
	require.NoError(t, err)
	return &mq.MessageExt{Message: mq.Message{Body: body}, MsgID: "message-id"}
}

func TestExptTurnResultFilterConsumer_RestoresEventSession(t *testing.T) {
	manager := &filterConsumerManager{resolvedUser: "fallback-user"}
	consumer := NewExptTurnResultFilterConsumer(manager)

	err := consumer.HandleMessage(context.Background(), filterEventMessage(t, &entity.ExptTurnResultFilterEvent{
		ExperimentID: 1,
		SpaceID:      2,
		Session:      &entity.Session{UserID: "123"},
	}))

	require.NoError(t, err)
	assert.Equal(t, "123", manager.gotUserID)
	assert.False(t, manager.resolveCalled)
}

func TestExptTurnResultFilterConsumer_ResolvesLegacyEventUser(t *testing.T) {
	manager := &filterConsumerManager{resolvedUser: "456"}
	consumer := NewExptTurnResultFilterConsumer(manager)

	err := consumer.HandleMessage(context.Background(), filterEventMessage(t, &entity.ExptTurnResultFilterEvent{
		ExperimentID: 1,
		SpaceID:      2,
	}))

	require.NoError(t, err)
	assert.Equal(t, "456", manager.gotUserID)
	assert.True(t, manager.resolveCalled)
}

func TestExptTurnResultFilterConsumer_LegacyEventWithoutResolverFails(t *testing.T) {
	consumer := NewExptTurnResultFilterConsumer(&filterConsumerManagerWithoutResolver{})

	err := consumer.HandleMessage(context.Background(), filterEventMessage(t, &entity.ExptTurnResultFilterEvent{
		ExperimentID: 1,
		SpaceID:      2,
	}))

	require.Error(t, err)
	assert.Contains(t, err.Error(), "user session is missing")
}

func TestExptTurnResultFilterConsumer_ResolverError(t *testing.T) {
	wantErr := errors.New("resolve user failed")
	manager := &filterConsumerManager{resolveErr: wantErr}
	consumer := NewExptTurnResultFilterConsumer(manager)

	err := consumer.HandleMessage(context.Background(), filterEventMessage(t, &entity.ExptTurnResultFilterEvent{
		ExperimentID: 1,
		SpaceID:      2,
	}))

	assert.ErrorIs(t, err, wantErr)
}
