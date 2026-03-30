#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
ENV_FILE="$ROOT_DIR/.env.production"
APP_SERVICE="app"
APP_CONTAINER="wahda_app"
CANDIDATE_CONTAINER="${CANDIDATE_CONTAINER:-wahda_app_candidate}"
NETWORK_NAME="${NETWORK_NAME:-waadapp_tba_network}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
RUN_DB_BACKUP="${RUN_DB_BACKUP:-true}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-wahda_db}"
CHECK_DESTRUCTIVE_MIGRATIONS="${CHECK_DESTRUCTIVE_MIGRATIONS:-true}"
ALLOW_DESTRUCTIVE_MIGRATIONS="${ALLOW_DESTRUCTIVE_MIGRATIONS:-false}"

TARGET_IMAGE="${1:-}"
if [[ -z "$TARGET_IMAGE" ]]; then
  if docker inspect "$CANDIDATE_CONTAINER" >/dev/null 2>&1; then
    TARGET_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CANDIDATE_CONTAINER")"
  else
    echo "Usage: $0 <image-tag>   OR ensure candidate container exists: $CANDIDATE_CONTAINER" >&2
    exit 1
  fi
fi

ROLLBACK_TAG="wahda_web:rollback-$(date +%Y%m%d-%H%M%S)"

log() {
  printf '[promote-candidate] %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

find_destructive_migrations() {
  # Only check PENDING migrations (not already applied).
  # We ask Prisma which migrations are pending, then grep only those folders.
  local pending
  pending="$(docker run --rm \
    --env-file "$ENV_FILE" \
    --network "$NETWORK_NAME" \
    "$TARGET_IMAGE" \
    node node_modules/prisma/build/index.js migrate status 2>&1 || true)"

  # Extract migration folder names that are "Not yet applied"
  local pending_dirs
  pending_dirs="$(echo "$pending" | grep -oP '\d{14}_\S+(?=\s)' | while read -r dir; do
    # Check if this migration appears as pending (listed after "Following migration" or "not yet applied")
    echo "$dir"
  done)"

  # If prisma migrate status fails or shows no pending, try simpler heuristic:
  # compare migration folders with _prisma_migrations table entries
  if [[ -z "$pending_dirs" ]]; then
    # No pending migrations detected — nothing destructive to worry about
    return 0
  fi

  # Build grep pattern for pending dirs only
  local pattern
  pattern="$(echo "$pending_dirs" | paste -sd '|')"

  docker run --rm \
    --entrypoint sh \
    "$TARGET_IMAGE" \
    -c "if [ -d prisma/migrations ]; then grep -RinE 'DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|RENAME[[:space:]]+COLUMN|ALTER[[:space:]]+TABLE.*ALTER[[:space:]]+COLUMN.*TYPE|SET[[:space:]]+NOT[[:space:]]+NULL' prisma/migrations | grep -E '$pattern' || true; fi"
}

backup_database() {
  local timestamp
  local backup_file

  timestamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  backup_file="$BACKUP_DIR/${BACKUP_PREFIX}-${timestamp}.dump"

  log "Creating pre-migration DB backup: $backup_file"
  docker run --rm \
    --env-file "$ENV_FILE" \
    --network "$NETWORK_NAME" \
    -v "$BACKUP_DIR:/backups" \
    postgres:16-alpine \
    sh -c "pg_dump \"\${DATABASE_URL%%\\?*}\" -Fc -f \"/backups/$(basename "$backup_file")\""

  log "Database backup completed: $backup_file"
}

wait_for_container_health() {
  local container_name="$1"
  local tries="${2:-45}"

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
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if ! grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  echo "DATABASE_URL is required in $ENV_FILE" >&2
  exit 1
fi

if ! docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1; then
  echo "Target image not found locally: $TARGET_IMAGE" >&2
  exit 1
fi

if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  docker image tag "$CURRENT_IMAGE_ID" "$ROLLBACK_TAG"
  log "Rollback image prepared: $ROLLBACK_TAG"
else
  ROLLBACK_TAG=""
  log "No running production app found; rollback image is unavailable for this run."
fi

if [[ "$CHECK_DESTRUCTIVE_MIGRATIONS" == "true" ]]; then
  DESTRUCTIVE_MATCHES="$(find_destructive_migrations)"
  if [[ -n "$DESTRUCTIVE_MATCHES" ]]; then
    log "Detected potentially destructive migration statements in target image:"
    printf '%s\n' "$DESTRUCTIVE_MATCHES"

    if [[ "$ALLOW_DESTRUCTIVE_MIGRATIONS" != "true" ]]; then
      log "Promote blocked. Use expand/contract flow or set ALLOW_DESTRUCTIVE_MIGRATIONS=true after explicit approval."
      exit 1
    fi

    log "ALLOW_DESTRUCTIVE_MIGRATIONS=true set; continuing despite destructive migrations."
  fi
fi

if [[ "$RUN_MIGRATIONS" == "true" ]]; then
  if [[ "$RUN_DB_BACKUP" == "true" ]]; then
    backup_database
  fi

  log "Applying migrations with target image before cutover."
  docker run --rm \
    --env-file "$ENV_FILE" \
    --network "$NETWORK_NAME" \
    "$TARGET_IMAGE" \
    node node_modules/prisma/build/index.js migrate deploy
fi

log "Promoting image to production app: $TARGET_IMAGE"
APP_IMAGE="$TARGET_IMAGE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps "$APP_SERVICE"

if ! wait_for_container_health "$APP_CONTAINER" 45; then
  log "Health check failed after promote."
  docker logs --tail 120 "$APP_CONTAINER" || true

  if [[ -n "$ROLLBACK_TAG" ]]; then
    log "Rolling back to: $ROLLBACK_TAG"
    APP_IMAGE="$ROLLBACK_TAG" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps "$APP_SERVICE"

    if wait_for_container_health "$APP_CONTAINER" 45; then
      log "Rollback succeeded."
    else
      log "Rollback failed. Manual intervention required."
      docker logs --tail 120 "$APP_CONTAINER" || true
    fi
  fi

  exit 1
fi

log "Promote completed successfully."
if [[ -n "$ROLLBACK_TAG" ]]; then
  log "Rollback image retained: $ROLLBACK_TAG"
fi
