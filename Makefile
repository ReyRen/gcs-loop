IMAGE_REGISTRY := docker.io
IMAGE_REPOSITORY := cozedev
IMAGE_NAME := gcs-loop-app
PYTHON ?= python3
NPX ?= npx

# Python FaaS image config
PYFAAS_IMAGE_NAME := gcs-loop-python-faas
PYFAAS_DOCKERFILE := ./release/image/python-faas.Dockerfile

DOCKER_COMPOSE_DIR := ./release/deployment/docker-compose
DOCKER_COMPOSE_BUILD_FILE := $(DOCKER_COMPOSE_DIR)/docker-compose-build.yml
DOCKER_COMPOSE_COMMON_ENV := $(DOCKER_COMPOSE_DIR)/env/common.env
DOCKER_COMPOSE_LOCAL_ENV := $(DOCKER_COMPOSE_DIR)/.env.local

ARCH ?= $(shell uname -m 2>/dev/null || echo unsupported)
ifneq (,$(filter x86_64 amd64,$(ARCH)))
DEPLOY_ARCH := amd64
else ifneq (,$(filter aarch64 arm64,$(ARCH)))
DEPLOY_ARCH := arm64
else
DEPLOY_ARCH := unsupported
endif

DOCKER_COMPOSE_ARCH_ENV := $(DOCKER_COMPOSE_DIR)/env/$(DEPLOY_ARCH).env
COMPOSE_ENV_ARGS := --env-file $(DOCKER_COMPOSE_COMMON_ENV) --env-file $(DOCKER_COMPOSE_ARCH_ENV)
ifneq (,$(wildcard $(DOCKER_COMPOSE_LOCAL_ENV)))
COMPOSE_ENV_ARGS += --env-file $(DOCKER_COMPOSE_LOCAL_ENV)
endif
COMPOSE_BASE_ARGS := -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml $(COMPOSE_ENV_ARGS)
COMPOSE_BUILD_ARGS := -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml -f $(DOCKER_COMPOSE_BUILD_FILE) $(COMPOSE_ENV_ARGS)

COZE_LOOP_NGINX_DATA_VOLUME_NAME := $(or $(COZE_LOOP_NGINX_DATA_VOLUME_NAME),gcs-loop-nginx-data)

# Operator-facing commands. The architecture is detected automatically; set
# ARCH=amd64 or ARCH=arm64 only when an explicit override is required.
.PHONY: check-deploy-arch start stop restart logs status config

check-deploy-arch:
	@test "$(DEPLOY_ARCH)" != "unsupported" || (echo "Unsupported architecture: $(ARCH). Use ARCH=amd64 or ARCH=arm64." >&2; exit 1)
	@test -f "$(DOCKER_COMPOSE_ARCH_ENV)" || (echo "Missing architecture config: $(DOCKER_COMPOSE_ARCH_ENV)" >&2; exit 1)

start: check-deploy-arch
	$(PYTHON) backend/script/openapi/generate.py
	@docker stop gcs-loop-nginx gcs-loop-app >/dev/null 2>&1 || true
	@docker rm gcs-loop-nginx gcs-loop-app >/dev/null 2>&1 || true
	@if docker volume inspect $(COZE_LOOP_NGINX_DATA_VOLUME_NAME) >/dev/null 2>&1; then \
	  docker volume rm $(COZE_LOOP_NGINX_DATA_VOLUME_NAME); \
	fi
	docker compose $(COMPOSE_BUILD_ARGS) --profile "*" up --build --detach

stop: check-deploy-arch
	docker compose $(COMPOSE_BUILD_ARGS) --profile "*" down
	@if docker volume inspect $(COZE_LOOP_NGINX_DATA_VOLUME_NAME) >/dev/null 2>&1; then \
	  docker volume rm $(COZE_LOOP_NGINX_DATA_VOLUME_NAME); \
	fi

restart: check-deploy-arch
	docker compose $(COMPOSE_BUILD_ARGS) restart app

logs: check-deploy-arch
	docker compose $(COMPOSE_BUILD_ARGS) --profile "*" logs --follow --tail=200

status: check-deploy-arch
	docker compose $(COMPOSE_BUILD_ARGS) ps

config: check-deploy-arch
	@echo "Detected deployment architecture: $(DEPLOY_ARCH)"
	docker compose $(COMPOSE_BUILD_ARGS) --profile "*" config

.PHONY: image openapi-gen openapi-check openapi-test openapi-lint

openapi-gen:
	$(PYTHON) backend/script/openapi/generate.py

openapi-check:
	$(PYTHON) backend/script/openapi/generate.py --check

openapi-test:
	$(PYTHON) -m unittest discover -s backend/script/openapi -p 'test_*.py'

openapi-lint:
	$(NPX) --yes @redocly/cli@2.44.2 lint backend/api/apidocs/openapi.json

.PHONY: FORCE
FORCE:

image%:
	@case "$*" in \
	  -login) \
	    docker login $(IMAGE_REGISTRY) -u $(IMAGE_REPOSITORY) ;; \
	  -bpush-*) \
	    version="$*"; \
        version="$${version#-bpush-}"; \
	    docker buildx build \
		  --platform linux/amd64,linux/arm64 \
		  --progress=plain \
		  --push \
		  -f ./release/image/Dockerfile \
		  -t $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(IMAGE_NAME):latest \
		  -t $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(IMAGE_NAME):"$$version" \
		  .; \
		docker pull $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(IMAGE_NAME):latest; \
		docker run --rm $(IMAGE_REPOSITORY)/$(IMAGE_NAME):latest du -sh /coze-loop/bin; \
		docker run --rm $(IMAGE_REPOSITORY)/$(IMAGE_NAME):latest du -sh /coze-loop/resources; \
		docker run --rm $(IMAGE_REPOSITORY)/$(IMAGE_NAME):latest du -sh /coze-loop ;; \
	  -python-faas-bpush-*) \
	    version="$*"; \
	    version="$${version#-python-faas-bpush-}"; \
	    docker buildx build \
		  --platform linux/amd64,linux/arm64 \
		  --progress=plain \
		  --push \
		  --build-context bootstrap=$(DOCKER_COMPOSE_DIR)/bootstrap/python-faas \
		  -f $(PYFAAS_DOCKERFILE) \
		  -t $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(PYFAAS_IMAGE_NAME):latest \
		  -t $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(PYFAAS_IMAGE_NAME):"$$version" \
		  .; \
		docker pull $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(PYFAAS_IMAGE_NAME):latest; \
		docker run --rm $(IMAGE_REPOSITORY)/$(PYFAAS_IMAGE_NAME):latest du -sh /app; \
		docker run --rm $(IMAGE_REPOSITORY)/$(PYFAAS_IMAGE_NAME):latest du -sh /app/vendor; \
		;; \
	  -help|*) \
      	echo "Usage:"; \
		echo "  make image--login                         # Login to the image registry ($(IMAGE_REGISTRY))"; \
		echo "  make image-<version>                      # Build & push gcs-loop image (<version>, latest)"; \
		echo "  make image-python-faas-bpush-<version>    # Build & push python-faas image (<version>, latest)"; \
      	echo; \
      	echo "Examples:"; \
	    echo "  make image--login"; \
	    echo "  make image-1.0.0"; \
	    echo "  make image-python-faas-bpush-1.0.0"; \
      	echo; \
      	echo "Notes:"; \
	    echo "  - 'image--login' logs in using IMAGE_REPOSITORY as the username."; \
	    echo "  - 'image-<version>' pushes to $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(IMAGE_NAME)"; \
	    echo "  - 'image-python-faas-bpush-<version>' pushes to $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY)/$(PYFAAS_IMAGE_NAME)"; \
      	exit 1 ;; \
	esac
