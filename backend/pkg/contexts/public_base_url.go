// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package contexts

import "context"

type publicBaseURLKeyType struct{}

var publicBaseURLKey = publicBaseURLKeyType{}

// WithPublicBaseURL records the externally reachable HTTP origin associated
// with the current request. The value must not contain an API path.
func WithPublicBaseURL(ctx context.Context, publicBaseURL string) context.Context {
	return context.WithValue(ctx, publicBaseURLKey, publicBaseURL)
}

// CtxPublicBaseURL returns the externally reachable HTTP origin associated
// with the current request, or an empty string when the transport did not
// provide one.
func CtxPublicBaseURL(ctx context.Context) string {
	publicBaseURL, _ := ctx.Value(publicBaseURLKey).(string)
	return publicBaseURL
}
