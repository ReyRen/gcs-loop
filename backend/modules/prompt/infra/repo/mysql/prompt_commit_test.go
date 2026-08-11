// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package mysql

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-loop/backend/infra/db"
	"github.com/coze-dev/coze-loop/backend/infra/platestwrite"
	writeTrackerMocks "github.com/coze-dev/coze-loop/backend/infra/platestwrite/mocks"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/infra/repo/mysql/gorm_gen/model"
	"github.com/coze-dev/coze-loop/backend/modules/prompt/infra/repo/mysql/hooks"
)

func TestPromptCommitDAOImplListUsesStableCompositeCursor(t *testing.T) {
	for _, asc := range []bool{false, true} {
		asc := asc
		t.Run(fmt.Sprintf("asc=%t", asc), func(t *testing.T) {
			ctx := context.Background()
			dao, testDB := newTestPromptCommitDAO(t)
			createdAt := time.Unix(1_700_000_000, 0)
			commits := make([]*model.PromptCommit, 0, 6)
			for id := int64(1); id <= 5; id++ {
				commits = append(commits, testPromptCommit(id, 100, fmt.Sprintf("1.0.%d", id), createdAt))
			}
			// A row from another prompt at the same timestamp must never leak
			// through the cursor's OR condition.
			commits = append(commits, testPromptCommit(100, 200, "2.0.0", createdAt))
			require.NoError(t, testDB.NewSession(ctx).Create(&commits).Error)

			firstPage, err := dao.List(ctx, ListCommitParam{
				PromptID: 100,
				Limit:    3,
				Asc:      asc,
			})
			require.NoError(t, err)
			if asc {
				assert.Equal(t, []int64{1, 2, 3}, promptCommitIDs(firstPage))
			} else {
				assert.Equal(t, []int64{5, 4, 3}, promptCommitIDs(firstPage))
			}

			lastReturnedID := int64(4)
			if asc {
				lastReturnedID = 2
			}
			secondPage, err := dao.List(ctx, ListCommitParam{
				PromptID: 100,
				Cursor: &ListCommitCursor{
					CreatedAt: createdAt,
					ID:        lastReturnedID,
				},
				Limit: 3,
				Asc:   asc,
			})
			require.NoError(t, err)
			if asc {
				assert.Equal(t, []int64{3, 4, 5}, promptCommitIDs(secondPage))
			} else {
				assert.Equal(t, []int64{3, 2, 1}, promptCommitIDs(secondPage))
			}
		})
	}
}

func TestPromptCommitDAOImplListAcceptsLegacyTimestampCursor(t *testing.T) {
	ctx := context.Background()
	dao, testDB := newTestPromptCommitDAO(t)
	createdAt := time.Unix(1_700_000_000, 0)
	commits := []*model.PromptCommit{
		testPromptCommit(1, 100, "1.0.1", createdAt),
		testPromptCommit(2, 100, "1.0.2", createdAt),
	}
	require.NoError(t, testDB.NewSession(ctx).Create(&commits).Error)

	got, err := dao.List(ctx, ListCommitParam{
		PromptID: 100,
		Cursor: &ListCommitCursor{
			CreatedAt: createdAt,
			Legacy:    true,
		},
		Limit: 3,
	})
	require.NoError(t, err)
	assert.Equal(t, []int64{2, 1}, promptCommitIDs(got))
}

func newTestPromptCommitDAO(t *testing.T) (*PromptCommitDAOImpl, db.Provider) {
	t.Helper()

	testDB := db.NewTestDB(t, &model.PromptCommit{})
	ctrl := gomock.NewController(t)
	writeTracker := writeTrackerMocks.NewMockILatestWriteTracker(ctrl)
	writeTracker.EXPECT().CheckWriteFlagByID(gomock.Any(), platestwrite.ResourceTypePromptCommit, gomock.Any()).Return(false).AnyTimes()
	return &PromptCommitDAOImpl{
		db:           testDB,
		writeTracker: writeTracker,
		hook:         &hooks.EmptyPromptCommitHook{},
	}, testDB
}

func testPromptCommit(id, promptID int64, version string, createdAt time.Time) *model.PromptCommit {
	return &model.PromptCommit{
		ID:          id,
		SpaceID:     1,
		PromptID:    promptID,
		PromptKey:   fmt.Sprintf("prompt_%d", promptID),
		Version:     version,
		BaseVersion: "1.0.0",
		CommittedBy: "test_user",
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	}
}

func promptCommitIDs(commits []*model.PromptCommit) []int64 {
	ids := make([]int64, 0, len(commits))
	for _, commit := range commits {
		ids = append(ids, commit.ID)
	}
	return ids
}
