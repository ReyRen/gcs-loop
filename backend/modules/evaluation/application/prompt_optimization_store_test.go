// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	infraDB "github.com/coze-dev/coze-loop/backend/infra/db"
)

type promptOptimizationStoreTestDB struct{ db *gorm.DB }

func (p *promptOptimizationStoreTestDB) NewSession(context.Context, ...infraDB.Option) *gorm.DB {
	return p.db
}

func (p *promptOptimizationStoreTestDB) Transaction(_ context.Context, fc func(tx *gorm.DB) error, _ ...infraDB.Option) error {
	return fc(p.db)
}

func TestListPromptOptimizationTasksByPrompt(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	gormDB, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), &gorm.Config{})
	require.NoError(t, err)
	store := newPromptOptimizationStore(&promptOptimizationStoreTestDB{db: gormDB})

	whereSQL := "SELECT count(*) FROM `prompt_optimization_task` WHERE (space_id = ? AND prompt_id = ? AND deleted_at = 0) AND status IN (?,?) AND name LIKE ?"
	mock.ExpectQuery(regexp.QuoteMeta(whereSQL)).
		WithArgs(int64(1), int64(9), "running", "succeeded", "%alpha%").
		WillReturnRows(sqlmock.NewRows([]string{"count(*)"}).AddRow(1))
	listSQL := "SELECT * FROM `prompt_optimization_task` WHERE (space_id = ? AND prompt_id = ? AND deleted_at = 0) AND status IN (?,?) AND name LIKE ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
	mock.ExpectQuery(regexp.QuoteMeta(listSQL)).
		WithArgs(int64(1), int64(9), "running", "succeeded", "%alpha%", 10, 10).
		WillReturnRows(sqlmock.NewRows([]string{"id", "space_id", "experiment_id", "prompt_id", "name", "created_at", "updated_at", "deleted_at"}).
			AddRow(101, 1, 20, 9, "alpha task", time.Now(), time.Now(), 0))

	rows, total, err := store.listTasksByPrompt(context.Background(), 1, 9, 2, 10, []string{"running", "succeeded"}, "alpha")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	assert.Equal(t, int64(101), rows[0].ID)
	require.NoError(t, mock.ExpectationsWereMet())
}
