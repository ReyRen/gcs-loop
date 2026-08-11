// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package hertzutil

import (
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/stretchr/testify/assert"
)

func TestGetPublicBaseURL(t *testing.T) {
	t.Run("configured URL is authoritative and normalized", func(t *testing.T) {
		t.Setenv(PublicBaseURLEnv, " https://gcs.example.com/ ")
		c := app.NewContext(0)
		c.Request.Header.SetHost("internal.example:8888")

		assert.Equal(t, "https://gcs.example.com", GetPublicBaseURL(c))
	})

	t.Run("host preserves the public port", func(t *testing.T) {
		t.Setenv(PublicBaseURLEnv, "")
		c := app.NewContext(0)
		c.Request.Header.SetHost("gcs.example.com:8443")

		assert.Equal(t, "http://gcs.example.com:8443", GetPublicBaseURL(c))
	})

	t.Run("direct request falls back to host and http", func(t *testing.T) {
		t.Setenv(PublicBaseURLEnv, "")
		c := app.NewContext(0)
		c.Request.Header.SetHost("127.0.0.1:8888")

		assert.Equal(t, "http://127.0.0.1:8888", GetPublicBaseURL(c))
	})

	t.Run("invalid configured URL is not replaced by an untrusted host", func(t *testing.T) {
		t.Setenv(PublicBaseURLEnv, "javascript:alert(1)")
		c := app.NewContext(0)
		c.Request.Header.SetHost("localhost:8082")

		assert.Empty(t, GetPublicBaseURL(c))
	})

}
