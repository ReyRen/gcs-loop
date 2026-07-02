IMAGE_REGISTRY := docker.io
IMAGE_REPOSITORY := cozedev
IMAGE_NAME := coze-loop

# Python FaaS image config
PYFAAS_IMAGE_NAME := coze-loop-python-faas
PYFAAS_DOCKERFILE := ./release/image/python-faas.Dockerfile

DOCKER_COMPOSE_DIR := ./release/deployment/docker-compose

COZE_LOOP_NGINX_DATA_VOLUME_NAME := $(or $(COZE_LOOP_NGINX_DATA_VOLUME_NAME),coze-loop-nginx-data)

.PHONY: image

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
		echo "  make image-<version>                      # Build & push coze-loop image (<version>, latest)"; \
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
compose%:
	@case "$*" in \
	  -up-dev) \
	    docker volume rm ${COZE_LOOP_NGINX_DATA_VOLUME_NAME} 2>/dev/null || true; \
	    docker compose \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose-dev.yml \
	      --env-file $(DOCKER_COMPOSE_DIR)/.env \
	      --profile "*" \
	      up --build  ;; \
	  -restart-dev-*) \
		svc="$*"; \
		svc="$${svc#-restart-dev-}"; \
		docker compose \
		  -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
          -f $(DOCKER_COMPOSE_DIR)/docker-compose-dev.yml \
		  --env-file $(DOCKER_COMPOSE_DIR)/.env \
		  restart "$$svc" ;; \
	  -down-dev) \
	    docker compose \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose-dev.yml \
	      --env-file $(DOCKER_COMPOSE_DIR)/.env \
	      --profile "*" \
	      down ;; \
	  -down-v-dev) \
	    docker compose \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose-dev.yml \
	      --env-file $(DOCKER_COMPOSE_DIR)/.env \
	      --profile "*" \
	      down -v ;; \
	  -up-debug) \
	    docker volume rm ${COZE_LOOP_NGINX_DATA_VOLUME_NAME} 2>/dev/null || true; \
	    docker compose \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose-debug.yml \
	      --env-file $(DOCKER_COMPOSE_DIR)/.env \
	      --profile "*" \
	      up --build  ;; \
	  -restart-debug-*) \
		svc="$*"; \
		svc="$${svc#-restart-debug-}"; \
		docker compose \
		  -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
			-f $(DOCKER_COMPOSE_DIR)/docker-compose-debug.yml \
		  --env-file $(DOCKER_COMPOSE_DIR)/.env \
		  restart "$$svc" ;; \
	  -down-debug) \
	    docker compose \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose-debug.yml \
	      --env-file $(DOCKER_COMPOSE_DIR)/.env \
	      --profile "*" \
	      down ;; \
	  -down-v-debug) \
	    docker compose \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
	      -f $(DOCKER_COMPOSE_DIR)/docker-compose-debug.yml \
	      --env-file $(DOCKER_COMPOSE_DIR)/.env \
	      --profile "*" \
	      down -v ;; \
	  -up) \
        docker volume rm ${COZE_LOOP_NGINX_DATA_VOLUME_NAME} 2>/dev/null || true; \
        docker compose \
          -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
          --env-file $(DOCKER_COMPOSE_DIR)/.env \
          --profile "*" \
          up ;; \
      -restart-*) \
        svc="$*"; \
        svc="$${svc#-restart-}"; \
        docker compose \
          -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
          --env-file $(DOCKER_COMPOSE_DIR)/.env \
          restart "$$svc" ;; \
      -down) \
        docker compose \
          -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
          --env-file $(DOCKER_COMPOSE_DIR)/.env \
          --profile "*" \
          down ;; \
      -down-v) \
        docker compose \
          -f $(DOCKER_COMPOSE_DIR)/docker-compose.yml \
          --env-file $(DOCKER_COMPOSE_DIR)/.env \
          --profile "*" \
          down -v ;; \
	  -help|*) \
      	echo "Usage:"; \
      	echo "  # Stable profile"; \
      	echo "  make compose-up                   # Start base services"; \
      	echo "  make compose-restart-<svc>        # Restart specific base service"; \
      	echo "  make compose-down                 # Stop base services"; \
      	echo "  make compose-down-v               # Stop base services and remove volumes"; \
      	echo; \
      	echo "  # Dev profile"; \
      	echo "  make compose-up-dev               # Start base + dev services (build)"; \
      	echo "  make compose-restart-dev-<svc>    # Restart specific dev service"; \
      	echo "  make compose-down-dev             # Stop base + dev services"; \
      	echo "  make compose-down-v-dev           # Stop base + dev services and remove volumes"; \
      	echo; \
      	echo "  # Debug profile"; \
      	echo "  make compose-up-debug             # Start base + debug services (build)"; \
      	echo "  make compose-restart-debug-<svc>  # Restart specific debug service"; \
      	echo "  make compose-down-debug           # Stop base + debug services"; \
      	echo "  make compose-down-v-debug         # Stop base + debug services and remove volumes"; \
      	echo; \
      	echo "Notes:"; \
      	echo "  - '<svc>' means the name of a service in docker-compose.yml"; \
      	echo "  - '--profile \"*\"' is only needed for 'up', not for 'down' or 'restart'."; \
      	echo "  - If you used multiple -f files for 'up', use the same -f set for 'down' or 'restart'."; \
      	exit 1 ;; \
	esac
