#!/bin/bash
set -euo pipefail

# Installs cron for local backup + Google Drive upload.
# Usage:
#   ./scripts/install-backup-drive-cron.sh
# Optional env vars:
#   BACKUP_DRIVE_CRON_EXPR (default: "0 */2 * * *")
#   PROJECT_DIR (default: current dir)
#   DRIVE_REMOTE (default: gdrive:wahda_db_backups)
#   DB_CONTAINER, DB_USER, DB_NAME, BACKUP_DIR, KEEP_DAYS

BACKUP_DRIVE_CRON_EXPR="${BACKUP_DRIVE_CRON_EXPR:-0 */2 * * *}"
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
SCRIPT_PATH="${PROJECT_DIR}/scripts/backup-drive.sh"

if [ ! -x "$SCRIPT_PATH" ]; then
  chmod +x "$SCRIPT_PATH"
fi

JOB_CMD="${BACKUP_DRIVE_CRON_EXPR} cd ${PROJECT_DIR} && DB_CONTAINER=${DB_CONTAINER:-waadapp-db} DB_USER=${DB_USER:-wahda_user} DB_NAME=${DB_NAME:-wahda_websit} BACKUP_DIR=${BACKUP_DIR:-/var/backups/wahda_db} KEEP_DAYS=${KEEP_DAYS:-30} DRIVE_REMOTE=${DRIVE_REMOTE:-gdrive:wahda_db_backups} ${SCRIPT_PATH} --cron"

( crontab -l 2>/dev/null | grep -v "scripts/backup-drive.sh --cron" || true; echo "$JOB_CMD" ) | crontab -

echo "Backup-to-Drive cron job installed successfully:"
echo "$JOB_CMD"
