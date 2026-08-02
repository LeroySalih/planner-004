#!/usr/bin/env bash
# Encrypted nightly backup of the dino + n8n Postgres databases.
#
# Runs pg_dump inside the `db` container (local socket → no password needed),
# gzips, then GPG-symmetric-encrypts with BACKUP_PASSPHRASE (from the container
# env). Output lands in ./backups, which is bind-mounted to /backups in the
# container. Custom format (-Fc) → restore with pg_restore.
#
# Intended to be run from host cron at midnight (see README/cron below).
set -euo pipefail

# Ensure docker/compose are found under the minimal cron PATH.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Project root = parent of this script's dir (so compose.yml is found).
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DBS="dino n8n"          # databases to back up
RETENTION_DAYS=14       # delete encrypted dumps older than this

cd "$PROJECT_DIR"

docker compose -f compose.yml exec -T db bash -c '
  set -euo pipefail
  : "${POSTGRES_USER:?POSTGRES_USER not set in db container}"
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE not set in db container}"
  ts=$(date +%Y%m%d_%H%M%S)
  for db in '"$DBS"'; do
    out="/backups/postgres_${db}_${ts}.dump.gz.gpg"
    echo "[$(date)] dumping ${db} -> ${out}"
    pg_dump -U "$POSTGRES_USER" -Fc "$db" \
      | gzip \
      | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
            --passphrase "$BACKUP_PASSPHRASE" -o "$out"
  done
  echo "[$(date)] pruning backups older than '"$RETENTION_DAYS"' days"
  find /backups -name "postgres_*.dump.gz.gpg" -type f -mtime +'"$RETENTION_DAYS"' -print -delete
  echo "[$(date)] backup complete"
'
