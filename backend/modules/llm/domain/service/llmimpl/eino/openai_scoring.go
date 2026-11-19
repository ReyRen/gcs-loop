// Copyright (c) 2026 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package eino

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// scoringTransport adds the vLLM template option that the pinned OpenAI SDK
// does not expose. It is installed only on opted-in scoring requests.
type scoringTransport struct {
	http.RoundTripper
}

func (t scoringTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Method != http.MethodPost || req.Body == nil || !strings.HasSuffix(req.URL.Path, "/chat/completions") {
		return t.RoundTripper.RoundTrip(req)
	}

	var payload map[string]json.RawMessage
	err := json.NewDecoder(req.Body).Decode(&payload)
	_ = req.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("decode scoring request: %w", err)
	}
	if payload == nil {
		return nil, fmt.Errorf("scoring request must be a JSON object")
	}

	var kwargs map[string]json.RawMessage
	if existing := payload["chat_template_kwargs"]; len(existing) > 0 {
		if err := json.Unmarshal(existing, &kwargs); err != nil {
			return nil, fmt.Errorf("decode scoring chat_template_kwargs: %w", err)
		}
	}
	if kwargs == nil {
		kwargs = make(map[string]json.RawMessage)
	}
	kwargs["enable_thinking"] = json.RawMessage("false")
	payload["chat_template_kwargs"], err = json.Marshal(kwargs)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	outgoing := req.Clone(req.Context())
	outgoing.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
	outgoing.Body, _ = outgoing.GetBody()
	outgoing.ContentLength = int64(len(body))
	return t.RoundTripper.RoundTrip(outgoing)
}
