#!/bin/bash
set -euo pipefail

# Installs a daily cron job for automated DB backups.
# Usage:
#   ./scripts/install-backup-cron.sh
# Optional env vars:
#   BACKUP_CRON_EXPR (default: "0 2 * * *")
#   PROJECT_DIR (default: current working dir)
#   DB_CONTAINER, DB_USER, DB_NAME, BACKUP_DIR, KEEP_DAYS

BACKUP_CRON_EXPR="${BACKUP_CRON_EXPR:-0 2 * * *}"
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
BACKUP_SCRIPT="${PROJECT_DIR}/scripts/backup.sh"

if [ ! -x "$BACKUP_SCRIPT" ]; then
  chmod +x "$BACKUP_SCRIPT"
fi

JOB_CMD="${BACKUP_CRON_EXPR} cd ${PROJECT_DIR} && DB_CONTAINER=${DB_CONTAINER:-waadapp-db} DB_USER=${DB_USER:-wahda_user} DB_NAME=${DB_NAME:-wahda_websit} BACKUP_DIR=${BACKUP_DIR:-/var/backups/wahda_db} KEEP_DAYS=${KEEP_DAYS:-30} ${BACKUP_SCRIPT} --cron"

( crontab -l 2>/dev/null | grep -v "scripts/backup.sh --cron" || true; echo "$JOB_CMD" ) | crontab -

echo "Backup cron job installed successfully:"
echo "$JOB_CMD"
