// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package urlutil

import (
	"net"
	"net/url"
	"strconv"
	"strings"
)

// NormalizeHTTPOrigin validates and canonicalizes an externally reachable
// HTTP(S) origin. It intentionally accepts only ASCII DNS names and IP
// literals so the result is safe to display and embed into shell examples.
func NormalizeHTTPOrigin(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	if (scheme != "http" && scheme != "https") || parsed.Host == "" || parsed.Opaque != "" {
		return ""
	}
	if parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return ""
	}

	hostname := strings.ToLower(parsed.Hostname())
	if !validHTTPOriginHostname(hostname) {
		return ""
	}
	port := parsed.Port()
	if port != "" {
		portNumber, err := strconv.ParseUint(port, 10, 16)
		if err != nil || portNumber == 0 {
			return ""
		}
		return scheme + "://" + net.JoinHostPort(hostname, port)
	}
	if strings.Contains(hostname, ":") {
		return scheme + "://[" + hostname + "]"
	}
	return scheme + "://" + hostname
}

func validHTTPOriginHostname(hostname string) bool {
	if hostname == "" {
		return false
	}
	if net.ParseIP(hostname) != nil {
		return true
	}
	if len(hostname) > 253 {
		return false
	}
	for _, label := range strings.Split(hostname, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
				return false
			}
		}
	}
	return true
}
