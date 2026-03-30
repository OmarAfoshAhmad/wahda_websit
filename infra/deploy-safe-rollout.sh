#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
APP_CONTAINER="wahda_app"
APP_SERVICE="app"
NETWORK_NAME="waadapp_tba_network"
SMOKE_PORT="${SMOKE_PORT:-3102}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
RUN_DB_BACKUP="${RUN_DB_BACKUP:-true}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-wahda_db}"
CHECK_DESTRUCTIVE_MIGRATIONS="${CHECK_DESTRUCTIVE_MIGRATIONS:-true}"
ALLOW_DESTRUCTIVE_MIGRATIONS="${ALLOW_DESTRUCTIVE_MIGRATIONS:-false}"

NEW_TAG="${1:-wahda_web:release-$(date +%Y%m%d-%H%M%S)}"
ROLLBACK_TAG="wahda_web:rollback-$(date +%Y%m%d-%H%M%S)"
SMOKE_CONTAINER="wahda_smoke_$(date +%s)"

log() {
  printf '[deploy-safe] %s\n' "$1"
}

cleanup() {
  docker rm -f "$SMOKE_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

find_destructive_migrations() {
  docker run --rm \
    --entrypoint sh \
    "$NEW_TAG" \
    -c "if [ -d prisma/migrations ]; then grep -RinE 'DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|RENAME[[:space:]]+COLUMN|ALTER[[:space:]]+TABLE.*ALTER[[:space:]]+COLUMN.*TYPE|SET[[:space:]]+NOT[[:space:]]+NULL' prisma/migrations || true; fi"
}

backup_database() {
  local timestamp
  local backup_file

  timestamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  backup_file="$BACKUP_DIR/${BACKUP_PREFIX}-${timestamp}.dump"

  log "Creating pre-migration DB backup: $backup_file"
  docker run --rm \
    --env-file "$ROOT_DIR/.env.production" \
    --network "$NETWORK_NAME" \
    -v "$BACKUP_DIR:/backups" \
    postgres:16-alpine \
    sh -c "pg_dump \"\$DATABASE_URL\" -Fc -f \"/backups/$(basename "$backup_file")\""

  log "Database backup completed: $backup_file"
}

wait_for_container_health() {
  local container_name="$1"
  local tries="${2:-40}"

  for ((i=1; i<=tries; i++)); do
    local state
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"

    if [[ "$state" == "healthy" || "$state" == "running" ]]; then
      return 0
    fi

    if [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]]; then
      return 1
    fi

    sleep 2
  done

  return 1
}

require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 plugin is required." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env.production" ]]; then
  echo "Missing $ROOT_DIR/.env.production" >&2
  exit 1
fi

if ! grep -q '^DATABASE_URL=' "$ROOT_DIR/.env.production"; then
  echo "DATABASE_URL is required in $ROOT_DIR/.env.production" >&2
  exit 1
fi

log "Creating rollback image tag from current running container (if exists)."
if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  docker image tag "$CURRENT_IMAGE_ID" "$ROLLBACK_TAG"
  log "Rollback image prepared: $ROLLBACK_TAG"
else
  ROLLBACK_TAG=""
  log "No running app container found. Rollback image will not be available for this run."
fi

log "Building new image: $NEW_TAG"
docker build -t "$NEW_TAG" "$ROOT_DIR"

log "Starting smoke container on port $SMOKE_PORT for pre-cutover verification."
docker run -d \
  --name "$SMOKE_CONTAINER" \
  --env-file "$ROOT_DIR/.env.production" \
  --network "$NETWORK_NAME" \
  -p "$SMOKE_PORT:3000" \
  "$NEW_TAG" >/dev/null

SMOKE_OK="false"
for _ in {1..30}; do
  if docker exec "$SMOKE_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    SMOKE_OK="true"
    break
  fi
  sleep 2
done

if [[ "$SMOKE_OK" != "true" ]]; then
  log "Smoke test failed. Showing last app logs from smoke container."
  docker logs --tail 80 "$SMOKE_CONTAINER" || true
  exit 1
fi

log "Smoke test passed."

if [[ "$CHECK_DESTRUCTIVE_MIGRATIONS" == "true" ]]; then
  DESTRUCTIVE_MATCHES="$(find_destructive_migrations)"
  if [[ -n "$DESTRUCTIVE_MATCHES" ]]; then
    log "Detected potentially destructive migration statements in new image:"
    printf '%s\n' "$DESTRUCTIVE_MATCHES"

    if [[ "$ALLOW_DESTRUCTIVE_MIGRATIONS" != "true" ]]; then
      log "Deployment blocked. Use expand/contract flow or set ALLOW_DESTRUCTIVE_MIGRATIONS=true after explicit approval."
      exit 1
    fi

    log "ALLOW_DESTRUCTIVE_MIGRATIONS=true set; continuing despite destructive migrations."
  fi
fi

if [[ "$RUN_MIGRATIONS" == "true" ]]; then
  if [[ "$RUN_DB_BACKUP" == "true" ]]; then
    backup_database
  fi

  log "Applying database migrations using the new image before cutover."
  docker run --rm \
    --env-file "$ROOT_DIR/.env.production" \
    --network "$NETWORK_NAME" \
    "$NEW_TAG" \
    npx prisma migrate deploy
fi

log "Cutover: updating compose app service to new image."
APP_IMAGE="$NEW_TAG" docker compose -f "$COMPOSE_FILE" up -d --no-deps "$APP_SERVICE"

if ! wait_for_container_health "$APP_CONTAINER" 45; then
  log "New version failed health check after cutover."
  docker logs --tail 120 "$APP_CONTAINER" || true

  if [[ -n "$ROLLBACK_TAG" ]]; then
    log "Rolling back to previous image: $ROLLBACK_TAG"
    APP_IMAGE="$ROLLBACK_TAG" docker compose -f "$COMPOSE_FILE" up -d --no-deps "$APP_SERVICE"

    if wait_for_container_health "$APP_CONTAINER" 45; then
      log "Rollback succeeded."
    else
      log "Rollback failed. Manual intervention required."
      docker logs --tail 120 "$APP_CONTAINER" || true
    fi
  else
    log "No rollback image available. Manual intervention required."
  fi

  exit 1
fi

log "Deployment completed successfully with image: $NEW_TAG"
if [[ -n "$ROLLBACK_TAG" ]]; then
  log "Rollback image retained: $ROLLBACK_TAG"
fi
