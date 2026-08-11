// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package urlutil

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeHTTPOrigin(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "domain", in: " HTTPS://GCS.Example.COM/ ", want: "https://gcs.example.com"},
		{name: "domain and port", in: "http://localhost:8082", want: "http://localhost:8082"},
		{name: "ipv4", in: "http://127.0.0.1:8888", want: "http://127.0.0.1:8888"},
		{name: "ipv6", in: "https://[2001:db8::1]:8443", want: "https://[2001:db8::1]:8443"},
		{name: "credentials", in: "https://user:secret@example.com", want: ""},
		{name: "path", in: "https://example.com/api", want: ""},
		{name: "query", in: "https://example.com?next=x", want: ""},
		{name: "shell substitution", in: "http://$(id)", want: ""},
		{name: "backtick", in: "http://`id`", want: ""},
		{name: "invalid port", in: "http://example.com:99999", want: ""},
		{name: "unsupported scheme", in: "javascript:alert(1)", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, NormalizeHTTPOrigin(tt.in))
		})
	}
}
