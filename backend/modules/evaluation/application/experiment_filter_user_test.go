// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
	servicemocks "github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/service/mocks"
)

func TestExperimentApplication_ResolveExptTurnResultFilterUser(t *testing.T) {
	const (
		experimentID = int64(100)
		spaceID      = int64(200)
	)

	t.Run("returns experiment creator", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		manager := servicemocks.NewMockIExptManager(ctrl)
		manager.EXPECT().MGetBasicByID(gomock.Any(), []int64{experimentID}).Return([]*entity.Experiment{{
			ID:        experimentID,
			SpaceID:   spaceID,
			CreatedBy: "123",
		}}, nil)

		app := &experimentApplication{manager: manager}
		userID, err := app.ResolveExptTurnResultFilterUser(context.Background(), experimentID, spaceID)

		require.NoError(t, err)
		assert.Equal(t, "123", userID)
	})

	t.Run("rejects experiment from another workspace", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		manager := servicemocks.NewMockIExptManager(ctrl)
		manager.EXPECT().MGetBasicByID(gomock.Any(), []int64{experimentID}).Return([]*entity.Experiment{{
			ID:        experimentID,
			SpaceID:   spaceID + 1,
			CreatedBy: "123",
		}}, nil)

		app := &experimentApplication{manager: manager}
		userID, err := app.ResolveExptTurnResultFilterUser(context.Background(), experimentID, spaceID)

		require.Error(t, err)
		assert.Empty(t, userID)
	})

	t.Run("rejects empty creator", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		manager := servicemocks.NewMockIExptManager(ctrl)
		manager.EXPECT().MGetBasicByID(gomock.Any(), []int64{experimentID}).Return([]*entity.Experiment{{
			ID:      experimentID,
			SpaceID: spaceID,
		}}, nil)

		app := &experimentApplication{manager: manager}
		userID, err := app.ResolveExptTurnResultFilterUser(context.Background(), experimentID, spaceID)

		require.Error(t, err)
		assert.Empty(t, userID)
	})
}
