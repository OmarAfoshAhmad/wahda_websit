#!/bin/bash
# ==========================================
# Waha Health Care - Automated Database Backup Script
# Uses pg_dump via Docker container, compresses, and rotates backups
# ==========================================
# Usage:
#   ./scripts/backup.sh              # نسخة يدوية
#   ./scripts/backup.sh --cron       # للتشغيل عبر cron (بدون ألوان)
# ==========================================

set -euo pipefail

# ---- Configuration ----
DB_CONTAINER="${DB_CONTAINER:-waadapp-db}"
DB_USER="${DB_USER:-wahda_user}"
DB_NAME="${DB_NAME:-wahda_db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wahda_db}"
KEEP_DAYS="${KEEP_DAYS:-30}"
LOG_FILE="${BACKUP_DIR}/backup.log"
LOCK_FILE="${BACKUP_DIR}/.backup.lock"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/wahda_db_$TIMESTAMP.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

mkdir -p "$BACKUP_DIR"

if [ -f "$LOCK_FILE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: backup lock exists at $LOCK_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# ---- Pre-checks ----
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  log "ERROR: Container '$DB_CONTAINER' is not running!"
  exit 1
fi

# ---- Backup ----
log "Starting backup of '$DB_NAME' from container '$DB_CONTAINER'..."

if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=plain --no-owner --no-acl | gzip > "$BACKUP_FILE"; then
  FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "Backup successful: $BACKUP_FILE ($FILE_SIZE)"
else
  log "ERROR: Backup failed!"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# ---- Verify backup is not empty ----
MIN_SIZE=1024  # 1KB minimum
ACTUAL_SIZE=$(stat --format=%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null)
if [ "$ACTUAL_SIZE" -lt "$MIN_SIZE" ]; then
  log "WARNING: Backup file is suspiciously small ($ACTUAL_SIZE bytes). Keeping but flagging."
fi

# ---- Verify gzip and SQL integrity ----
if ! gzip -t "$BACKUP_FILE"; then
  log "ERROR: Gzip integrity test failed."
  rm -f "$BACKUP_FILE"
  exit 1
fi

if ! gzip -dc "$BACKUP_FILE" | head -n 20 | grep -Eiq "PostgreSQL database dump|^--"; then
  log "ERROR: SQL header check failed."
  rm -f "$BACKUP_FILE"
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$BACKUP_FILE" > "$CHECKSUM_FILE"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$BACKUP_FILE" > "$CHECKSUM_FILE"
fi

# ---- Rotate old backups ----
log "Cleaning up backups older than $KEEP_DAYS days..."
DELETED=$(find "$BACKUP_DIR" -type f -name "wahda_db_*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
log "Deleted $DELETED old backup(s)."
find "$BACKUP_DIR" -type f -name "wahda_db_*.sql.gz.sha256" -mtime +"$KEEP_DAYS" -print -delete >/dev/null 2>&1 || true

# ---- Summary ----
TOTAL=$(find "$BACKUP_DIR" -type f -name "wahda_db_*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -1 | cut -f1 || echo "0")
log "Done. Total backups: $TOTAL"
if [ -f "$CHECKSUM_FILE" ]; then
  log "Checksum file: $CHECKSUM_FILE"
fi
log "Approx backup storage size: $TOTAL_SIZE"
