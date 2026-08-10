// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package apis

import (
	"net/http"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/stretchr/testify/assert"

	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/observability/openapi"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/ptr"
)

func TestRenderOtelIngestTracesResponse(t *testing.T) {
	c := &app.RequestContext{}
	body := []byte{0x0a, 0x00}

	renderOtelIngestTracesResponse(c, &openapi.OtelIngestTracesResponse{
		Body:        body,
		ContentType: ptr.Of("application/x-protobuf"),
	})

	assert.Equal(t, http.StatusOK, c.Response.StatusCode())
	assert.Equal(t, "application/x-protobuf", string(c.Response.Header.ContentType()))
	assert.Equal(t, body, c.Response.Body())
}
