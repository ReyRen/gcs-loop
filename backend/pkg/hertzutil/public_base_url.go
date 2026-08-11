// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package hertzutil

import (
	"os"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"

	"github.com/coze-dev/coze-loop/backend/pkg/urlutil"
)

const (
	PublicBaseURLEnv           = "COZE_LOOP_PUBLIC_BASE_URL"
	defaultPublicBaseURLScheme = "http"
)

// GetPublicBaseURL returns the public HTTP origin that callers should use for
// /v1 APIs. An explicitly configured URL is authoritative; otherwise the
// origin is derived from the actual Host header. Forwarded headers are not
// trusted because the application port may also be exposed directly. Invalid
// configured values are rejected instead of falling back to request headers.
func GetPublicBaseURL(c *app.RequestContext) string {
	if configuredRaw := strings.TrimSpace(os.Getenv(PublicBaseURLEnv)); configuredRaw != "" {
		return urlutil.NormalizeHTTPOrigin(configuredRaw)
	}
	if c == nil {
		return ""
	}

	host := strings.TrimSpace(string(c.Request.Header.Host()))
	if host == "" {
		host = strings.TrimSpace(string(c.Request.URI().Host()))
	}
	if host == "" {
		return ""
	}

	scheme := strings.ToLower(strings.TrimSpace(string(c.Request.URI().Scheme())))
	if scheme == "" {
		scheme = defaultPublicBaseURLScheme
	}
	return urlutil.NormalizeHTTPOrigin(scheme + "://" + host)
}
