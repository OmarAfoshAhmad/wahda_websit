#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.production"
NETWORK_NAME="${NETWORK_NAME:-waadapp_tba_network}"
CANDIDATE_CONTAINER="${CANDIDATE_CONTAINER:-wahda_app_candidate}"
CANDIDATE_PORT="${CANDIDATE_PORT:-3102}"

NEW_TAG="${1:-wahda_web:candidate-$(date +%Y%m%d-%H%M%S)}"

log() {
  printf '[deploy-candidate] %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_health() {
  local container_name="$1"
  local retries="${2:-30}"

  for ((i=1; i<=retries; i++)); do
    if docker exec "$container_name" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  return 1
}

require_cmd docker

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

log "Building candidate image: $NEW_TAG"
BUILD_ENV_FILE="$ROOT_DIR/.env.build"
if [[ ! -f "$BUILD_ENV_FILE" ]]; then
  echo "Missing build env file: $BUILD_ENV_FILE" >&2
  exit 1
fi
DOCKER_BUILDKIT=1 docker build \
  --secret id=build_env,src="$BUILD_ENV_FILE" \
  -t "$NEW_TAG" "$ROOT_DIR"

log "Replacing old candidate container if it exists."
docker rm -f "$CANDIDATE_CONTAINER" >/dev/null 2>&1 || true

# Build REDIS_URL from REDIS_PASSWORD in env file (same as docker-compose.prod.yml)
REDIS_PW="$(grep -oP '^REDIS_PASSWORD=\K.*' "$ENV_FILE" || true)"

log "Starting candidate container on port $CANDIDATE_PORT (production app remains untouched)."
docker run -d \
  --name "$CANDIDATE_CONTAINER" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  ${REDIS_PW:+ -e "REDIS_URL=redis://:${REDIS_PW}@wahda_redis:6379"} \
  --network "$NETWORK_NAME" \
  -p "$CANDIDATE_PORT:3000" \
  "$NEW_TAG" >/dev/null

if ! wait_for_health "$CANDIDATE_CONTAINER" 40; then
  log "Candidate health check failed. Diagnosing..."
  log "--- HTTP response from /api/health ---"
  docker exec "$CANDIDATE_CONTAINER" node -e "
    fetch('http://127.0.0.1:3000/api/health')
      .then(async r => { console.log('HTTP', r.status, await r.text()); process.exit(0); })
      .catch(e => { console.error('Connection failed:', e.message); process.exit(0); })
  " 2>&1 || true
  log "--- Container logs (last 120 lines) ---"
  docker logs --tail 120 "$CANDIDATE_CONTAINER" || true
  exit 1
fi

log "Candidate is healthy."
log "Test URL: http://<server-ip>:$CANDIDATE_PORT"
log "When approved, promote with: ./infra/promote-candidate.sh $NEW_TAG"
