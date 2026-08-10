// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package apidocs

import (
	"encoding/json"
	"testing"
)

func TestEnabled(t *testing.T) {
	t.Setenv(enabledEnvironment, "")
	if !enabled() {
		t.Fatal("API docs should be enabled by default")
	}

	for _, value := range []string{"false", "0", "off", "NO"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv(enabledEnvironment, value)
			if enabled() {
				t.Fatalf("API docs should be disabled for %q", value)
			}
		})
	}
}

func TestEmbeddedOpenAPI(t *testing.T) {
	var document struct {
		OpenAPI string         `json:"openapi"`
		Paths   map[string]any `json:"paths"`
	}
	if err := json.Unmarshal(openAPIJSON, &document); err != nil {
		t.Fatalf("embedded OpenAPI is not valid JSON: %v", err)
	}
	if document.OpenAPI != "3.0.3" {
		t.Fatalf("unexpected OpenAPI version %q", document.OpenAPI)
	}
	if len(document.Paths) == 0 {
		t.Fatal("embedded OpenAPI has no paths")
	}
}
