// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"

	appcontexts "github.com/coze-dev/coze-loop/backend/pkg/contexts"
	"github.com/coze-dev/coze-loop/backend/pkg/hertzutil"
)

// PublicBaseURLMW makes the externally reachable API origin available to the
// application layer without coupling Prompt logic to Hertz request types.
func PublicBaseURLMW() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		c.Next(appcontexts.WithPublicBaseURL(ctx, hertzutil.GetPublicBaseURL(c)))
	}
}
