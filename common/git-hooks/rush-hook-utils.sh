#!/bin/bash

# Rush only manages the frontend workspace and its package-manager metadata.
# Backend and deployment-only commits should not need a Node.js toolchain.
RUSH_MANAGED_PATH_PATTERN='^(frontend/|rush\.json$|common/config/rush/|common/config/subspaces/|common/autoinstallers/)'

is_rebase_in_progress() {
  local branch_name
  branch_name=$(git branch --show-current)
  [[ -z "$branch_name" ]]
}

has_staged_rush_changes() {
  git diff --cached --name-only --diff-filter=ACMR | grep -Eq "$RUSH_MANAGED_PATH_PATTERN"
}

head_has_rush_changes() {
  git diff-tree --no-commit-id --name-only -r HEAD | grep -Eq "$RUSH_MANAGED_PATH_PATTERN"
}

require_node_for_rush_hook() {
  if command -v node >/dev/null 2>&1; then
    return 0
  fi

  echo "Node.js is required because this commit changes the Rush-managed frontend workspace." >&2
  echo "Install Node.js and run 'rush install', then retry the commit." >&2
  return 1
}

validate_commit_message_without_node() {
  local message_file="$1"
  local header
  header=$(head -n 1 "$message_file")

  # Preserve common Git-generated messages and autosquash commits.
  if [[ "$header" =~ ^(Merge|Revert|fixup!|squash!|amend!) ]]; then
    return 0
  fi

  if (( ${#header} > 150 )); then
    echo "Invalid commit message: header must not exceed 150 characters." >&2
    return 1
  fi

  if ! printf '%s\n' "$header" | grep -Eq '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+'; then
    echo "Invalid commit message. Use Conventional Commits, for example:" >&2
    echo "  feat(scope): describe the change" >&2
    return 1
  fi
}
