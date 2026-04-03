#!/bin/bash
# ==========================================
# Waha Health Care - Backup + Google Drive Upload
# Requires: rclone configured with a Google Drive remote
# ==========================================
# Usage:
#   ./scripts/backup-drive.sh
#   ./scripts/backup-drive.sh --cron
# ==========================================

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
BACKUP_SCRIPT="${PROJECT_DIR}/scripts/backup.sh"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wahda_db}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DRIVE_REMOTE="${DRIVE_REMOTE:-gdrive:wahda_db_backups}"
LOG_FILE="${BACKUP_DIR}/backup-drive.log"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

if ! command -v rclone >/dev/null 2>&1; then
  log "ERROR: rclone is not installed."
  exit 1
fi

if [ ! -x "$BACKUP_SCRIPT" ]; then
  chmod +x "$BACKUP_SCRIPT"
fi

log "Starting local backup..."
DB_CONTAINER="${DB_CONTAINER:-waadapp-db}" \
DB_USER="${DB_USER:-wahda_user}" \
DB_NAME="${DB_NAME:-wahda_websit}" \
BACKUP_DIR="$BACKUP_DIR" \
KEEP_DAYS="$KEEP_DAYS" \
"$BACKUP_SCRIPT" --cron

LATEST_BACKUP="$(ls -1t "$BACKUP_DIR"/wahda_db_*.sql.gz 2>/dev/null | head -n1 || true)"
if [ -z "$LATEST_BACKUP" ]; then
  log "ERROR: No backup file found after local backup run."
  exit 1
fi

BASENAME="$(basename "$LATEST_BACKUP")"
CHECKSUM_FILE="${LATEST_BACKUP}.sha256"

log "Uploading backup to Google Drive: $DRIVE_REMOTE/$BASENAME"
rclone copyto "$LATEST_BACKUP" "$DRIVE_REMOTE/$BASENAME"

if [ -f "$CHECKSUM_FILE" ]; then
  log "Uploading checksum: $(basename "$CHECKSUM_FILE")"
  rclone copyto "$CHECKSUM_FILE" "$DRIVE_REMOTE/$(basename "$CHECKSUM_FILE")"
fi

log "Applying remote retention: delete files older than ${KEEP_DAYS} days"
rclone delete "$DRIVE_REMOTE" --include "wahda_db_*.sql.gz" --min-age "${KEEP_DAYS}d"
rclone delete "$DRIVE_REMOTE" --include "wahda_db_*.sql.gz.sha256" --min-age "${KEEP_DAYS}d"

log "Done. Backup uploaded and retention applied successfully."
