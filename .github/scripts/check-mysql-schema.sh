#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOCKER_INIT_SQL="release/deployment/docker-compose/bootstrap/mysql-init/init-sql"
DOCKER_PATCH_SQL="release/deployment/docker-compose/bootstrap/mysql-init/patch-sql"

SCHEMADIFF="${SCHEMADIFF_BIN:-schemadiff}"

errors=0

log_error() {
    echo "❌ ERROR: $1"
    errors=$((errors + 1))
}

log_ok() {
    echo "✅ $1"
}

log_info() {
    echo "ℹ️  $1"
}

echo "========================================"
echo "  MySQL Schema Migration Check"
echo "========================================"
echo ""

if ! command -v "$SCHEMADIFF" &>/dev/null; then
    log_info "schemadiff not found, installing..."
    go install github.com/planetscale/schemadiff/cmd/schemadiff@latest
    SCHEMADIFF="$(go env GOPATH)/bin/schemadiff"
fi

echo "--- Check 1: ALTER SQL completeness for modified tables ---"
echo ""

check_start_errors=$errors
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

if [ -n "${GITHUB_BASE_REF:-}" ]; then
    log_info "Running in PR mode, checking changed files against base branch"

    git fetch origin "$GITHUB_BASE_REF" --depth=1 2>/dev/null || true

    changed_init_files=$(git diff --name-only "origin/$GITHUB_BASE_REF"...HEAD -- "$DOCKER_INIT_SQL"/*.sql 2>/dev/null || true)

    for changed_file in $changed_init_files; do
        if [ -z "$changed_file" ]; then
            continue
        fi

        filename=$(basename "$changed_file")
        table_name="${filename%.sql}"
        alter_file="$REPO_ROOT/$DOCKER_PATCH_SQL/${table_name}_alter.sql"

        if echo "$filename" | grep -qE '_alter\.sql|_proc\.sql|alter_proc\.sql'; then
            continue
        fi

        old_content=$(git show "origin/$GITHUB_BASE_REF:$changed_file" 2>/dev/null || echo "")

        if [ -z "$old_content" ]; then
            log_info "New table file '$filename', no ALTER check needed"
            continue
        fi

        old_create="$TMP_DIR/old_$filename"
        new_create="$TMP_DIR/new_$filename"
        echo "$old_content" | sed -n '/^CREATE TABLE/,/;$/p' > "$old_create"
        sed -n '/^CREATE TABLE/,/;$/p' "$REPO_ROOT/$changed_file" > "$new_create"

        if [ ! -s "$old_create" ] || [ ! -s "$new_create" ]; then
            continue
        fi

        schema_diff=$("$SCHEMADIFF" diff-table --source "$old_create" --target "$new_create" 2>&1) || true

        if [ -z "$schema_diff" ]; then
            continue
        fi

        has_add_column=$(echo "$schema_diff" | grep -ci "ADD COLUMN" || true)
        has_add_key=$(echo "$schema_diff" | grep -ciE "ADD (UNIQUE )?KEY|ADD INDEX" || true)

        if [ "$has_add_column" -gt 0 ] || [ "$has_add_key" -gt 0 ]; then
            if [ ! -f "$alter_file" ]; then
                log_error "Table '$table_name' has schema changes but no ALTER file found at: $DOCKER_PATCH_SQL/${table_name}_alter.sql"
                echo "  Schema diff: $schema_diff"
            else
                added_columns=$(echo "$schema_diff" | grep -oi 'ADD COLUMN `[^`]*`' | sed "s/ADD COLUMN \`//;s/\`//" | sort -u || true)
                added_indexes=$(echo "$schema_diff" | grep -oiE 'ADD (UNIQUE )?KEY `[^`]*`' | sed 's/.*`//;s/`//' | sort -u || true)
                alter_content=$(cat "$alter_file")

                for col in $added_columns; do
                    if ! echo "$alter_content" | grep -qi "ADD.*COLUMN.*\`$col\`"; then
                        log_error "Column '$col' was added to '$table_name' but has no corresponding ALTER TABLE ADD COLUMN in ${table_name}_alter.sql"
                    fi
                done

                for idx in $added_indexes; do
                    if ! echo "$alter_content" | grep -qi "ADD.*INDEX\|ADD.*KEY.*\`$idx\`"; then
                        log_error "Index '$idx' was added to '$table_name' but has no corresponding ALTER TABLE ADD INDEX in ${table_name}_alter.sql"
                    fi
                done
            fi
        fi
    done
else
    log_info "Not running in PR mode (GITHUB_BASE_REF not set), skipping incremental ALTER check"
    log_info "To test locally, set GITHUB_BASE_REF=main"
fi

if [ $errors -eq $check_start_errors ]; then
    log_ok "All schema changes have corresponding ALTER statements"
fi
echo ""

echo "========================================"
if [ $errors -gt 0 ]; then
    echo "  ❌ Found $errors error(s)"
    echo "========================================"
    exit 1
else
    echo "  ✅ All checks passed"
    echo "========================================"
    exit 0
fi
