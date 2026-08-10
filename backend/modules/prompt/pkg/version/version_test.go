// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package version

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParse(t *testing.T) {
	t.Parallel()

	validVersions := []string{"0.0.0", "0.0.1", "1.23.456", "9999.9999.9999"}
	for _, raw := range validVersions {
		raw := raw
		t.Run("valid_"+raw, func(t *testing.T) {
			t.Parallel()
			_, err := Parse(raw)
			require.NoError(t, err)
		})
	}

	invalidVersions := []string{
		"", "1", "1.0", "1.0.0.0", "01.0.0", "1.00.0", "1.0.00",
		"10000.0.0", "1.10000.0", "1.0.10000", "1.0.0-alpha", "v1.0.0",
	}
	for _, raw := range invalidVersions {
		raw := raw
		t.Run("invalid_"+raw, func(t *testing.T) {
			t.Parallel()
			_, err := Parse(raw)
			assert.ErrorIs(t, err, ErrInvalidVersion)
		})
	}
}

func TestValidateNext(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		candidate string
		latest    string
		wantErr   string
	}{
		{name: "first commit", candidate: "0.0.1"},
		{name: "first commit cannot be zero", candidate: "0.0.0", wantErr: "first commit version must be at least 0.0.1"},
		{name: "patch increase", candidate: "1.2.4", latest: "1.2.3"},
		{name: "minor increase", candidate: "1.3.0", latest: "1.2.9999"},
		{name: "major increase", candidate: "2.0.0", latest: "1.9999.9999"},
		{name: "same version", candidate: "1.2.3", latest: "1.2.3", wantErr: "commit version 1.2.3 must be greater than latest version 1.2.3"},
		{name: "lower version", candidate: "1.2.2", latest: "1.2.3", wantErr: "commit version 1.2.2 must be greater than latest version 1.2.3"},
		{name: "invalid candidate", candidate: "1.2.3-beta", latest: "1.2.2", wantErr: ErrInvalidVersion.Error()},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateNext(tt.candidate, tt.latest)
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Equal(t, tt.wantErr, err.Error())
			if errors.Is(err, ErrInvalidVersion) {
				assert.ErrorIs(t, err, ErrInvalidVersion)
			}
		})
	}
}
