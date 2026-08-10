// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package version

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	// ErrInvalidVersion is intentionally compatible with the error returned by
	// semver.StrictNewVersion for an invalid version.
	ErrInvalidVersion = errors.New("Invalid Semantic Version")
	versionPattern    = regexp.MustCompile(`^(?:0|[1-9]\d{0,3})(?:\.(?:0|[1-9]\d{0,3})){2}$`)
)

// Number is the numeric a.b.c version format used by Prompt commits.
// Each component is limited to 0-9999 to stay aligned with the Prompt editor.
type Number struct {
	major int
	minor int
	patch int
}

// Parse validates and parses the Prompt commit version format.
func Parse(raw string) (Number, error) {
	if !versionPattern.MatchString(raw) {
		return Number{}, ErrInvalidVersion
	}

	components := strings.Split(raw, ".")
	if len(components) != 3 {
		return Number{}, ErrInvalidVersion
	}

	parts := [3]int{}
	for i, component := range components {
		part, err := strconv.Atoi(component)
		if err != nil {
			return Number{}, ErrInvalidVersion
		}
		parts[i] = part
	}

	return Number{major: parts[0], minor: parts[1], patch: parts[2]}, nil
}

// ValidateNext ensures candidate is a valid Prompt version and is strictly
// greater than the latest committed version. An empty latest version denotes
// the first commit.
func ValidateNext(candidate, latest string) error {
	candidateVersion, err := Parse(candidate)
	if err != nil {
		return err
	}
	if latest == "" {
		if candidateVersion.compare(Number{}) <= 0 {
			return errors.New("first commit version must be at least 0.0.1")
		}
		return nil
	}

	latestVersion, err := Parse(latest)
	if err != nil {
		return fmt.Errorf("latest prompt version %q is invalid: %w", latest, err)
	}
	if candidateVersion.compare(latestVersion) <= 0 {
		return fmt.Errorf("commit version %s must be greater than latest version %s", candidate, latest)
	}
	return nil
}

func (v Number) compare(other Number) int {
	left := [3]int{v.major, v.minor, v.patch}
	right := [3]int{other.major, other.minor, other.patch}
	for i := range left {
		if left[i] < right[i] {
			return -1
		}
		if left[i] > right[i] {
			return 1
		}
	}
	return 0
}
