// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

// Package apidocs serves the generated backend OpenAPI document and Swagger UI.
package apidocs

import (
	"context"
	_ "embed"
	"os"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/protocol/consts"
)

const enabledEnvironment = "COZE_LOOP_API_DOCS_ENABLED"

var (
	//go:embed index.html
	indexHTML []byte

	//go:embed openapi.json
	openAPIJSON []byte
)

// Register adds the API documentation endpoints. Documentation is enabled by
// default for frontend integration and can be disabled in production with
// COZE_LOOP_API_DOCS_ENABLED=false.
func Register(r *server.Hertz) {
	if !enabled() {
		return
	}
	r.GET("/api-docs", serveIndex)
	r.GET("/api-docs/", serveIndex)
	r.GET("/api-docs/openapi.json", serveOpenAPI)
}

func enabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(enabledEnvironment))) {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func serveIndex(_ context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	c.Data(consts.StatusOK, "text/html; charset=utf-8", indexHTML)
}

func serveOpenAPI(_ context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	c.Data(consts.StatusOK, "application/json; charset=utf-8", openAPIJSON)
}
