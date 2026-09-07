#!/bin/sh

set -e

if [ "${GCS_LOOP_BACKEND_ONLY:-false}" = "true" ]; then
  curl -fsS http://localhost:80/api-docs/openapi.json >/dev/null
  exit 0
fi

if curl \
    -s http://localhost:80 \
    2>/dev/null \
    | grep -Eq cozeloop; then
  exit 0
else
  exit 1
fi
