#!/usr/bin/env bash
# Encrypted backup of the dino + n8n Postgres databases.
#
# Runs pg_dump inside the `db` container (local socket → no password needed),
# gzips, then GPG-symmetric-encrypts with BACKUP_PASSPHRASE (from the container
# env). Output lands in ./backups, which is bind-mounted to /backups in the
# container. Custom format (-Fc) → restore with pg_restore.
#
#   backup-db.sh          daily: timestamped dumps in ./backups, kept 7 days
#   backup-db.sh hourly   one dump per database in ./backups/hourly, replaced
#                         each run, so only the most recent hour survives
#
# Both run from host cron; push-to-coding.sh copies the results off-server.
set -euo pipefail

# Ensure docker/compose are found under the minimal cron PATH.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Project root = parent of this script's dir (so compose.yml is found).
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DBS="dino n8n"          # databases to back up
RETENTION_DAYS=7        # delete daily dumps older than this
MODE="${1:-daily}"

case "$MODE" in
  daily|hourly) ;;
  *) echo "usage: $0 [daily|hourly]" >&2; exit 2 ;;
esac

cd "$PROJECT_DIR"

docker compose -f compose.yml exec -T db bash -c '
  set -euo pipefail
  : "${POSTGRES_USER:?POSTGRES_USER not set in db container}"
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE not set in db container}"
  mode='"$MODE"'
  ts=$(date +%Y%m%d_%H%M%S)
  mkdir -p /backups/hourly
  for db in '"$DBS"'; do
    if [ "$mode" = hourly ]; then
      out="/backups/hourly/postgres_${db}_hourly.dump.gz.gpg"
    else
      out="/backups/postgres_${db}_${ts}.dump.gz.gpg"
    fi
    echo "[$(date)] dumping ${db} -> ${out}"
    # Write to a temp name and rename, so the hourly push never copies a
    # half-written dump over the last good one.
    pg_dump -U "$POSTGRES_USER" -Fc "$db" \
      | gzip \
      | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
            --passphrase "$BACKUP_PASSPHRASE" -o "${out}.tmp"
    mv "${out}.tmp" "$out"
  done
  if [ "$mode" = daily ]; then
    echo "[$(date)] pruning backups older than '"$RETENTION_DAYS"' days"
    find /backups -maxdepth 1 -name "postgres_*.dump.gz.gpg" -type f -mtime +'"$RETENTION_DAYS"' -print -delete
  fi
  echo "[$(date)] ${mode} backup complete"
'
