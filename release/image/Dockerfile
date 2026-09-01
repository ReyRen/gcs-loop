# The defaults are multi-architecture public images. Docker Compose overrides them
# with the native images selected by env/amd64.env or env/arm64.env.
ARG GO_BUILD_IMAGE=golang:1.24-alpine
ARG NODE_BUILD_IMAGE=node:24-alpine
ARG RUNTIME_IMAGE=alpine:3.22.0

# Build the Go binary on the builder architecture and cross-compile for the
# requested target. Native Compose builds use the current host automatically.
FROM --platform=$BUILDPLATFORM ${GO_BUILD_IMAGE} AS backend_builder

ARG TARGETOS
ARG TARGETARCH
ARG ALPINE_MIRROR=

ENV GOPROXY=https://goproxy.cn,direct

# 1. Install git (for downloading go mod dependencies)
RUN if [ -n "$ALPINE_MIRROR" ]; then \
      sed -i "s#https://dl-cdn.alpinelinux.org/alpine#$ALPINE_MIRROR#g" /etc/apk/repositories; \
    fi && \
    apk add --no-cache git

WORKDIR /coze-loop

# 2. Download and cache go mod dependencies
COPY ./backend/go.mod ./backend/go.sum /coze-loop/src/backend/
RUN --mount=type=cache,id=gcs-loop-go-mod-${TARGETARCH},target=/go/pkg/mod \
    for attempt in 1 2 3 4 5; do \
      GODEBUG=http2client=0 go mod download -C ./src/backend -x && exit 0; \
      echo "go mod download retry ${attempt}/5"; \
      sleep $((attempt * 3)); \
    done; \
    exit 1

# 3. Build backend binary
COPY ./backend/ /coze-loop/src/backend/
RUN --mount=type=cache,id=gcs-loop-go-mod-${TARGETARCH},target=/go/pkg/mod \
    --mount=type=cache,id=gcs-loop-go-build-${TARGETARCH},target=/root/.cache/go-build \
    target_os="${TARGETOS:-$(go env GOOS)}" && \
    target_arch="${TARGETARCH:-$(go env GOARCH)}" && \
    mkdir -p ./bin && \
    CGO_ENABLED=0 GOOS="$target_os" GOARCH="$target_arch" \
      go -C /coze-loop/src/backend build -buildvcs=false -o /coze-loop/bin/main "./cmd"

# Minimal Node.js image (with Node.js + npm), additionally installs Rush to build frontend artifacts
FROM --platform=$BUILDPLATFORM ${NODE_BUILD_IMAGE} AS frontend_builder

ARG TARGETARCH
ARG ALPINE_MIRROR=
ARG NPM_REGISTRY=https://registry.npmjs.org

ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY

# 1. Install basic tools (curl, bash, etc.) for alpine
RUN if [ -n "$ALPINE_MIRROR" ]; then \
      sed -i "s#https://dl-cdn.alpinelinux.org/alpine#$ALPINE_MIRROR#g" /etc/apk/repositories; \
    fi && \
    apk add --no-cache bash

# 2. Install pnpm and Rush
RUN --mount=type=cache,id=gcs-loop-npm-${TARGETARCH},target=/root/.npm \
    corepack enable && \
    corepack prepare pnpm@10.27.0 --activate && \
    npm install -g @microsoft/rush@5.172.1

WORKDIR /coze-loop

# 3. Build frontend
COPY ./frontend/ /coze-loop/src/frontend/
COPY ./common/ /coze-loop/src/common/
COPY ./rush.json /coze-loop/src/rush.json
RUN if [ "$NPM_REGISTRY" != "https://registry.npmjs.org" ]; then \
      sed -i "s#registry=https://registry.npmjs.org#registry=$NPM_REGISTRY#g" \
        /coze-loop/src/common/config/subspaces/default/.npmrc; \
    fi
RUN --mount=type=cache,id=gcs-loop-pnpm-store-${TARGETARCH},target=/coze-loop/src/common/temp/pnpm-store \
    --mount=type=cache,id=gcs-loop-rush-${TARGETARCH},target=/root/.rush \
    mkdir -p /coze-loop/resources && \
    sh /coze-loop/src/frontend/apps/cozeloop/build-artifact.sh /coze-loop/resources

# Final minimal image (coze-loop)
FROM ${RUNTIME_IMAGE}

WORKDIR /coze-loop

# Extract build artifacts
COPY --from=backend_builder /coze-loop/bin/main /coze-loop/bin/main
COPY --from=frontend_builder /coze-loop/resources/ /coze-loop/resources/
