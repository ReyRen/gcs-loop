#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_DIR="$PROJECT_ROOT/release/deployment/docker-compose"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
COMMON_ENV="$COMPOSE_DIR/env/common.env"
SITE_ENV="$SCRIPT_DIR/site.env"
LIVE_ENV="$COMPOSE_DIR/.env.local"
DATA_ARCHIVE="$SCRIPT_DIR/gcs-loop-data.tar.gz"
MANIFEST="$SCRIPT_DIR/manifest.txt"
HELPER_IMAGE=""
DEPLOY_ARCH=""
ARCH_ENV=""
IMAGE_ARCHIVE=""

RUNTIME_CONTAINERS="
gcs-loop-app
gcs-loop-redis
gcs-loop-mysql
gcs-loop-clickhouse
gcs-loop-minio
gcs-loop-rmq-namesrv
gcs-loop-rmq-broker
gcs-loop-nginx
gcs-loop-python-faas
gcs-loop-js-faas
"

INIT_CONTAINERS="
gcs-loop-mysql-init
gcs-loop-clickhouse-init
gcs-loop-minio-init
gcs-loop-rmq-init
"

# Only persistent service state is backed up. The Nginx resource volume and
# FaaS workspaces are generated again from the packaged images.
DATA_VOLUMES="
coze-loop_redis_data:redis
coze-loop_mysql_data:mysql
coze-loop_clickhouse_data:clickhouse
coze-loop_minio_data:minio-data
coze-loop_minio_config:minio-config
coze-loop_rmqnamesrv_data:rocketmq-namesrv
coze-loop_rocketmq_broker_data:rocketmq-broker
"

DEPLOY_ENV=""

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

detect_host_arch() {
  case "$(uname -m)" in
    x86_64|amd64) DEPLOY_ARCH="amd64" ;;
    aarch64|arm64) DEPLOY_ARCH="arm64" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
  ARCH_ENV="$COMPOSE_DIR/env/$DEPLOY_ARCH.env"
  IMAGE_ARCHIVE="$SCRIPT_DIR/gcs-loop-images-$DEPLOY_ARCH.tar.gz"
}

select_deploy_env() {
  if [ -f "$SITE_ENV" ]; then
    DEPLOY_ENV="$SITE_ENV"
  elif [ -f "$LIVE_ENV" ]; then
    DEPLOY_ENV="$LIVE_ENV"
  else
    die "copy offline/site.env.example to offline/site.env and set the site URL"
  fi
}

select_helper_image() {
  HELPER_IMAGE=$(sed -n 's/^GCS_LOOP_APP_IMAGE=//p' "$ARCH_ENV" "$DEPLOY_ENV" | tail -n 1)
  [ -n "$HELPER_IMAGE" ] || die "GCS_LOOP_APP_IMAGE is not configured"
}

check_host() {
  detect_host_arch
  require_command docker
  docker info >/dev/null 2>&1 || die "Docker Engine is not running or the current user cannot access it"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
  [ -f "$COMPOSE_FILE" ] || die "missing Compose file: $COMPOSE_FILE"
  [ -f "$COMMON_ENV" ] || die "missing common environment file: $COMMON_ENV"
  [ -f "$ARCH_ENV" ] || die "missing $DEPLOY_ARCH environment file: $ARCH_ENV"
}

check_site_url() {
  value=$(sed -n 's/^COZE_LOOP_PUBLIC_BASE_URL=//p' "$DEPLOY_ENV" | tail -n 1)
  case "$value" in
    http://*|https://*) ;;
    *) die "COZE_LOOP_PUBLIC_BASE_URL in $DEPLOY_ENV must be a complete http:// or https:// URL" ;;
  esac
  case "$value" in
    *CHANGE_ME*) die "replace CHANGE_ME in $DEPLOY_ENV with the address used by site users" ;;
  esac
}

compose() {
  docker compose \
    -f "$COMPOSE_FILE" \
    --env-file "$COMMON_ENV" \
    --env-file "$ARCH_ENV" \
    --env-file "$DEPLOY_ENV" \
    "$@"
}

prepare_deployment() {
  check_host
  select_deploy_env
  select_helper_image
  check_site_url
  compose --profile '*' config --quiet
}

image_list() {
  compose --profile '*' config --images | LC_ALL=C sort -u
}

check_images_loaded() {
  missing=0
  for image in $(image_list); do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "missing image: $image" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || die "load $IMAGE_ARCHIVE before starting"
}

load_images() {
  prepare_deployment
  require_command gzip
  [ -f "$IMAGE_ARCHIVE" ] || die "image archive not found: $IMAGE_ARCHIVE"
  gzip -t "$IMAGE_ARCHIVE" || die "image archive is damaged: $IMAGE_ARCHIVE"
  echo "Loading packaged $DEPLOY_ARCH images..."
  gzip -dc "$IMAGE_ARCHIVE" | docker load
  check_images_loaded
}

start_services() {
  prepare_deployment
  check_images_loaded
  echo "Starting all services without pulling or building images..."
  compose --profile '*' up --detach --pull never
}

stop_services() {
  prepare_deployment
  compose --profile '*' down
}

show_status() {
  prepare_deployment
  compose --profile '*' ps --all
}

show_logs() {
  prepare_deployment
  compose --profile '*' logs --follow --tail=200
}

runtime_ready() {
  for container in $RUNTIME_CONTAINERS; do
    state=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)
    [ "$state" = "running|healthy" ] || return 1
  done
  for container in $INIT_CONTAINERS; do
    state=$(docker inspect -f '{{.State.Status}}|{{.State.ExitCode}}' "$container" 2>/dev/null || true)
    [ "$state" = "exited|0" ] || return 1
  done
  return 0
}

verify_services() {
  prepare_deployment
  attempt=0
  while [ "$attempt" -lt 180 ]; do
    if runtime_ready; then
      docker exec gcs-loop-nginx sh -c 'curl -fsS http://127.0.0.1/api-docs/openapi.json >/dev/null' || die "Nginx API gateway check failed"
      echo "PASS: 10 runtime containers are healthy and 4 initialization containers exited with code 0."
      show_status
      return 0
    fi
    attempt=$((attempt + 1))
    if [ $((attempt % 6)) -eq 0 ]; then
      echo "Waiting for services to become healthy ($((attempt * 5)) seconds)..."
    fi
    sleep 5
  done
  show_status
  die "services did not become healthy within 15 minutes"
}

run_data_container() {
  mode=$1
  command=$2
  shift 2
  set -- docker run --rm --entrypoint sh "$@"
  for spec in $DATA_VOLUMES; do
    volume=${spec%%:*}
    directory=${spec#*:}
    if [ "$mode" = "read" ]; then
      set -- "$@" -v "$volume:/volumes/$directory:ro"
    else
      set -- "$@" -v "$volume:/volumes/$directory"
    fi
  done
  set -- "$@" "$HELPER_IMAGE" -c "$command"
  "$@"
}

backup_data() {
  prepare_deployment
  require_command gzip
  check_images_loaded
  for spec in $DATA_VOLUMES; do
    volume=${spec%%:*}
    docker volume inspect "$volume" >/dev/null 2>&1 || die "data volume does not exist: $volume"
  done

  tmp="$DATA_ARCHIVE.tmp.$$"
  rm -f "$tmp"
  running=$(compose ps --status running --quiet | wc -l | tr -d ' ')
  restart_after_backup=0
  cleanup_backup() {
    rm -f "$tmp"
    if [ "$restart_after_backup" -eq 1 ]; then
      echo "Restarting services after interrupted backup..." >&2
      compose --profile '*' up --detach --pull never >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_backup EXIT HUP INT TERM

  if [ "$running" -gt 0 ]; then
    echo "Stopping the stack briefly for a consistent data snapshot..."
    compose --profile '*' down
    restart_after_backup=1
  fi

  echo "Backing up seven persistent named volumes..."
  run_data_container read 'cd /volumes && tar -czf - .' > "$tmp"
  gzip -t "$tmp" || die "generated data archive failed validation"
  mv "$tmp" "$DATA_ARCHIVE"

  if [ "$restart_after_backup" -eq 1 ]; then
    echo "Restarting the stack..."
    compose --profile '*' up --detach --pull never
    restart_after_backup=0
  fi
  trap - EXIT HUP INT TERM
  echo "Created $DATA_ARCHIVE"
}

volume_is_empty() {
  volume=$1
  docker run --rm --entrypoint sh -v "$volume:/volume:ro" "$HELPER_IMAGE" -c '[ -z "$(ls -A /volume)" ]'
}

restore_data() {
  prepare_deployment
  require_command gzip
  check_images_loaded
  [ -f "$DATA_ARCHIVE" ] || die "data archive not found: $DATA_ARCHIVE"
  gzip -t "$DATA_ARCHIVE" || die "data archive is damaged: $DATA_ARCHIVE"

  for spec in $DATA_VOLUMES; do
    volume=${spec%%:*}
    if docker volume inspect "$volume" >/dev/null 2>&1 && ! volume_is_empty "$volume"; then
      die "refusing to overwrite non-empty volume $volume; restore onto a fresh deployment"
    fi
  done

  compose --profile '*' down
  for spec in $DATA_VOLUMES; do
    volume=${spec%%:*}
    docker volume create "$volume" >/dev/null
  done
  echo "Restoring the packaged data snapshot into Docker named volumes..."
  run_data_container write 'cd /volumes && tar -xzf -' -i < "$DATA_ARCHIVE"
  echo "Data restore complete. Run '$0 start' to start the stack."
}

export_images() {
  prepare_deployment
  require_command gzip
  check_images_loaded

  raw="$IMAGE_ARCHIVE.raw.$$"
  tmp="$IMAGE_ARCHIVE.tmp.$$"
  list="$IMAGE_ARCHIVE.list.$$"
  rm -f "$raw" "$tmp" "$list"
  trap 'rm -f "$raw" "$tmp" "$list"' EXIT HUP INT TERM
  image_list > "$list"

  set --
  while IFS= read -r image; do
    arch=$(docker image inspect -f '{{.Architecture}}' "$image")
    [ "$arch" = "$DEPLOY_ARCH" ] || die "image $image is $arch, expected $DEPLOY_ARCH"
    set -- "$@" "$image"
  done < "$list"

  echo "Exporting $(wc -l < "$list" | tr -d ' ') $DEPLOY_ARCH runtime images..."
  docker save --output "$raw" "$@"
  gzip -1 -c "$raw" > "$tmp"
  gzip -t "$tmp" || die "generated image archive failed validation"
  mv "$tmp" "$IMAGE_ARCHIVE"
  rm -f "$raw" "$list"
  trap - EXIT HUP INT TERM
  echo "Created $IMAGE_ARCHIVE"
}

write_manifest() {
  prepare_deployment
  {
    echo "gcs-loop offline bundle"
    echo "generated_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "source_commit=$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
    echo "platform=linux/$DEPLOY_ARCH"
    echo "docker_server=$(docker version --format '{{.Server.Version}}')"
    echo "compose_version=$(docker compose version --short)"
    echo
    echo "runtime_images:"
    for image in $(image_list); do
      docker image inspect -f '  {{index .RepoTags 0}} | {{.Id}} | {{.Architecture}} | {{.Size}} bytes' "$image"
    done
    echo
    echo "archives:"
    [ ! -f "$IMAGE_ARCHIVE" ] || echo "  $(basename "$IMAGE_ARCHIVE") | $(wc -c < "$IMAGE_ARCHIVE" | tr -d ' ') bytes"
    [ ! -f "$DATA_ARCHIVE" ] || echo "  $(basename "$DATA_ARCHIVE") | $(wc -c < "$DATA_ARCHIVE" | tr -d ' ') bytes"
  } > "$MANIFEST"
}

build_bundle() {
  output_dir=${1:-}
  include_data=${2:-}
  [ -n "$output_dir" ] || die "usage: $0 bundle OUTPUT_DIRECTORY [--include-data]"
  [ -d "$PROJECT_ROOT/.git" ] || die "bundle creation requires a Git checkout"
  [ -z "$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=no)" ] || die "commit tracked changes before creating a bundle"

  export_images
  if [ "$include_data" = "--include-data" ]; then
    backup_data
  elif [ -n "$include_data" ]; then
    die "unknown bundle option: $include_data"
  fi
  write_manifest

  require_command tar
  mkdir -p "$output_dir"
  stage=$(mktemp -d)
  cleanup_bundle() {
    rm -rf "$stage"
  }
  trap cleanup_bundle EXIT HUP INT TERM
  mkdir -p "$stage/gcs-loop"
  git -C "$PROJECT_ROOT" archive --format=tar --output "$stage/source.tar" HEAD
  tar -xf "$stage/source.tar" -C "$stage/gcs-loop"
  rm -f "$stage/source.tar"
  cp "$IMAGE_ARCHIVE" "$MANIFEST" "$stage/gcs-loop/offline/"
  if [ "$include_data" = "--include-data" ]; then
    cp "$DATA_ARCHIVE" "$stage/gcs-loop/offline/"
  fi

  name="gcs-loop-offline-$DEPLOY_ARCH-$(date '+%Y%m%d').tar.gz"
  tmp="$output_dir/$name.tmp.$$"
  final="$output_dir/$name"
  tar -czf "$tmp" -C "$stage" gcs-loop
  tar -tzf "$tmp" >/dev/null
  mv "$tmp" "$final"
  trap - EXIT HUP INT TERM
  cleanup_bundle
  echo "Created $final"
}

install_bundle() {
  restore=${1:-}
  [ -z "$restore" ] || [ "$restore" = "--restore-data" ] || die "usage: $0 install [--restore-data]"
  load_images
  if [ "$restore" = "--restore-data" ]; then
    restore_data
  fi
  start_services
  verify_services
}

usage() {
  cat <<EOF
Usage: $0 COMMAND [OPTIONS]

Site commands:
  install [--restore-data]  Load images, optionally restore bundled source data, start and verify
  load-images               Load all packaged images without starting services
  restore-data              Restore data only; requires empty named volumes
  start                     Start without building or pulling
  stop                      Stop containers and preserve named volumes
  status                    Show all service states
  logs                      Follow the last 200 log lines
  verify                    Wait for and verify all services

Bundle-maintainer commands:
  export-images             Export the exact configured images for this host architecture
  backup-data               Briefly stop the stack and snapshot persistent named volumes
  bundle DIR [--include-data]
                            Create a portable outer archive in DIR
EOF
}

command=${1:-help}
shift || true
case "$command" in
  install) install_bundle "${1:-}" ;;
  load-images) load_images ;;
  restore-data) restore_data ;;
  start) start_services ;;
  stop) stop_services ;;
  status) show_status ;;
  logs) show_logs ;;
  verify) verify_services ;;
  export-images) export_images ;;
  backup-data) backup_data ;;
  bundle) build_bundle "${1:-}" "${2:-}" ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown command: $command" ;;
esac
