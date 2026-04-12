#!/usr/bin/env bash
set -euo pipefail

# Update with rollback point for server deployments.
#
# Usage:
#   ./infra/update-with-rollback.sh update [branch]
#   ./infra/update-with-rollback.sh rollback [rollback_ref]
#   ./infra/update-with-rollback.sh status
#
# Examples:
#   ./infra/update-with-rollback.sh update main
#   ./infra/update-with-rollback.sh rollback
#   ./infra/update-with-rollback.sh rollback rollback-point-20260412-031500

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ROLLBACK_DIR="$ROOT_DIR/.rollback"
LAST_REF_FILE="$ROLLBACK_DIR/last_ref.txt"
LAST_BRANCH_FILE="$ROLLBACK_DIR/last_branch.txt"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
APP_SERVICE="app"

ACTION="${1:-}"
BRANCH="${2:-main}"

log() {
  printf '[update-rollback] %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree has uncommitted changes. Commit or stash before update." >&2
    exit 1
  fi
}

reload_app() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && [[ -f "$COMPOSE_FILE" ]]; then
    log "Rebuilding and restarting app service..."
    docker compose -f "$COMPOSE_FILE" up -d --build "$APP_SERVICE"
  else
    log "Docker compose not detected or $COMPOSE_FILE missing. Skipping app restart."
  fi
}

do_update() {
  require_cmd git
  cd "$ROOT_DIR"
  mkdir -p "$ROLLBACK_DIR"

  ensure_clean_tree

  local current_ref
  current_ref="$(git rev-parse HEAD)"
  local point
  point="rollback-point-$(date +%Y%m%d-%H%M%S)"

  log "Creating rollback point: $point -> $current_ref"
  git tag -f "$point" "$current_ref" >/dev/null
  printf '%s\n' "$current_ref" > "$LAST_REF_FILE"
  printf '%s\n' "$BRANCH" > "$LAST_BRANCH_FILE"

  log "Fetching origin/$BRANCH"
  git fetch origin "$BRANCH"

  log "Checking out $BRANCH"
  git checkout "$BRANCH" >/dev/null

  log "Pulling latest updates (fast-forward only)"
  git pull --ff-only origin "$BRANCH"

  reload_app

  log "Update completed."
  log "Rollback command: ./infra/update-with-rollback.sh rollback $point"
}

do_rollback() {
  require_cmd git
  cd "$ROOT_DIR"

  local target_ref="${2:-}"
  if [[ -z "$target_ref" ]]; then
    if [[ -f "$LAST_REF_FILE" ]]; then
      target_ref="$(cat "$LAST_REF_FILE")"
    else
      echo "No saved rollback ref found. Provide one explicitly." >&2
      exit 1
    fi
  fi

  log "Rolling back to: $target_ref"
  git fetch --tags origin || true

  if ! git rev-parse --verify "$target_ref" >/dev/null 2>&1; then
    echo "Rollback ref not found: $target_ref" >&2
    exit 1
  fi

  git reset --hard "$target_ref"

  reload_app

  log "Rollback completed to $target_ref"
}

do_status() {
  cd "$ROOT_DIR"
  echo "Current branch: $(git rev-parse --abbrev-ref HEAD)"
  echo "Current commit: $(git rev-parse HEAD)"

  if [[ -f "$LAST_REF_FILE" ]]; then
    echo "Saved rollback ref: $(cat "$LAST_REF_FILE")"
  else
    echo "Saved rollback ref: (none)"
  fi

  echo "Recent rollback tags:"
  git tag --list 'rollback-point-*' --sort=-creatordate | head -n 5
}

case "$ACTION" in
  update)
    do_update
    ;;
  rollback)
    do_rollback "$@"
    ;;
  status)
    do_status
    ;;
  *)
    echo "Usage: $0 {update [branch]|rollback [ref]|status}" >&2
    exit 1
    ;;
esac
