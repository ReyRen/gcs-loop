// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/coze-dev/coze-loop/backend/modules/prompt/domain/repo"
)

func TestListCommitPageTokenRoundTrip(t *testing.T) {
	t.Parallel()

	createdAt := time.Unix(1_700_000_000, 123_456_000)
	for _, asc := range []bool{false, true} {
		asc := asc
		t.Run(listCommitCursorOrder(asc), func(t *testing.T) {
			t.Parallel()

			pageToken, err := encodeListCommitPageToken(123, asc, &repo.ListCommitCursor{
				CreatedAt: createdAt,
				ID:        456,
			})
			require.NoError(t, err)
			assert.Contains(t, pageToken, listCommitPageTokenPrefix)

			cursor, err := decodeListCommitPageToken(pageToken, 123, asc)
			require.NoError(t, err)
			assert.Equal(t, int64(456), cursor.ID)
			assert.True(t, createdAt.Equal(cursor.CreatedAt))
			assert.False(t, cursor.Legacy)
		})
	}
}

func TestDecodeListCommitPageTokenLegacy(t *testing.T) {
	t.Parallel()

	cursor, err := decodeListCommitPageToken("1700000000", 123, false)
	require.NoError(t, err)
	assert.Equal(t, time.Unix(1_700_000_000, 0), cursor.CreatedAt)
	assert.Zero(t, cursor.ID)
	assert.True(t, cursor.Legacy)
}

func TestDecodeListCommitPageTokenRejectsInvalidTokens(t *testing.T) {
	t.Parallel()

	validToken, err := encodeListCommitPageToken(123, false, &repo.ListCommitCursor{
		CreatedAt: time.Unix(1_700_000_000, 0),
		ID:        456,
	})
	require.NoError(t, err)

	invalidPayload := base64.RawURLEncoding.EncodeToString([]byte(`{"p":123,"o":"desc","t":0,"i":456}`))
	outOfRangePayload, err := json.Marshal(listCommitCursorPayload{
		PromptID:       123,
		Order:          listCommitCursorOrderDesc,
		CreatedAtMicro: math.MaxInt64,
		ID:             456,
	})
	require.NoError(t, err)
	tests := []struct {
		name      string
		pageToken string
		promptID  int64
		asc       bool
	}{
		{name: "empty", pageToken: "", promptID: 123},
		{name: "invalid legacy", pageToken: "not-a-number", promptID: 123},
		{name: "non-positive legacy", pageToken: "0", promptID: 123},
		{name: "out-of-range legacy", pageToken: strconv.FormatInt(math.MaxInt64, 10), promptID: 123},
		{name: "empty encoded payload", pageToken: listCommitPageTokenPrefix, promptID: 123},
		{name: "invalid base64", pageToken: listCommitPageTokenPrefix + "%%%", promptID: 123},
		{name: "invalid json", pageToken: listCommitPageTokenPrefix + base64.RawURLEncoding.EncodeToString([]byte("not-json")), promptID: 123},
		{name: "invalid values", pageToken: listCommitPageTokenPrefix + invalidPayload, promptID: 123},
		{name: "out-of-range values", pageToken: listCommitPageTokenPrefix + base64.RawURLEncoding.EncodeToString(outOfRangePayload), promptID: 123},
		{name: "prompt mismatch", pageToken: validToken, promptID: 124},
		{name: "order mismatch", pageToken: validToken, promptID: 123, asc: true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := decodeListCommitPageToken(tt.pageToken, tt.promptID, tt.asc)
			assert.Error(t, err)
		})
	}
}

func TestEncodeListCommitPageTokenRejectsInvalidCursor(t *testing.T) {
	t.Parallel()

	_, err := encodeListCommitPageToken(0, false, &repo.ListCommitCursor{CreatedAt: time.Now(), ID: 1})
	assert.Error(t, err)
	_, err = encodeListCommitPageToken(1, false, nil)
	assert.Error(t, err)
	_, err = encodeListCommitPageToken(1, false, &repo.ListCommitCursor{CreatedAt: time.Now()})
	assert.Error(t, err)
	_, err = encodeListCommitPageToken(1, false, &repo.ListCommitCursor{ID: 1})
	assert.Error(t, err)
	_, err = encodeListCommitPageToken(1, false, &repo.ListCommitCursor{
		CreatedAt: time.UnixMicro(math.MaxInt64),
		ID:        1,
	})
	assert.Error(t, err)
}
