#!/usr/bin/env bash
# Runs on PROD from cron, hourly. Pushes a copy of the uploaded files and the
# newest database dumps to the coding server, so a dead prod disk no longer
# takes the files with it (they were never in the database dumps).
#
# Push, not pull: the coding server holds no credentials for prod. Its
# authorized_keys pins this key to rrsync write-only inside ~/prod-mirror, so
# the key cannot open a shell, read anything back, or write anywhere else.
#
# Files are never deleted on the coding side, so a file removed on prod (by
# accident or otherwise) survives in the mirror. Dumps are pruned there by a
# local timer on the coding server.
#
#   push-to-coding.sh                 hourly: files/, newest dumps, hourly dumps
#   push-to-coding.sh dumps [<ts>]    only the timestamped dumps of one run
#                                     (<ts> as in postgres_dino_<ts>, default
#                                     the newest); waits up to 10 minutes for a
#                                     running push instead of skipping, so a
#                                     manual backup (backup-on-request.sh) is
#                                     never dropped
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

CODING_HOST="${CODING_HOST:-leroy@149.104.105.55}"
CODING_PORT="${CODING_PORT:-2223}"
SSH_KEY="$HOME/.ssh/push_to_coding"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-all}"
DUMP_TS="${2:-newest}"

case "$MODE" in
  all) ;;
  dumps)
    if [ "$DUMP_TS" != newest ] && ! [[ "$DUMP_TS" =~ ^[0-9]{8}_[0-9]{6}$ ]]; then
      echo "timestamp must look like 20261117_093000" >&2; exit 2
    fi
    ;;
  *) echo "usage: $0 [dumps [<timestamp>|newest]]" >&2; exit 2 ;;
esac

exec 9>"/tmp/push-to-coding.lock"
if [ "$MODE" = dumps ]; then
  # A manual request waits for the hourly push rather than being dropped.
  flock -w 600 9 || { echo "[$(date)] another push held the lock for 10 minutes" >&2; exit 1; }
else
  # The first run copies several GB and can outlast the hour; skip rather than
  # start a second copy alongside it.
  flock -n 9 || { echo "[$(date)] previous push still running, skipping"; exit 0; }
fi

ssh_cmd="ssh -p $CODING_PORT -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

if [ "$MODE" = dumps ]; then
  ts="$DUMP_TS"
  if [ "$ts" = newest ]; then
    latest=$(ls -1t "$PROJECT_DIR"/backups/postgres_dino_*.dump.gz.gpg 2>/dev/null | head -n 1 || true)
    [ -n "$latest" ] || { echo "no dumps in $PROJECT_DIR/backups" >&2; exit 1; }
    ts=${latest##*postgres_dino_}
    ts=${ts%.dump.gz.gpg}
  fi
  ls "$PROJECT_DIR"/backups/postgres_*_"$ts".dump.gz.gpg >/dev/null 2>&1 \
    || { echo "no dumps for $ts in $PROJECT_DIR/backups" >&2; exit 1; }
  echo "[$(date)] sending dumps for $ts"
  rsync -t --ignore-existing -e "$ssh_cmd" \
    "$PROJECT_DIR"/backups/postgres_*_"$ts".dump.gz.gpg "$CODING_HOST:backups/"
  echo "[$(date)] push complete"
  exit 0
fi

echo "[$(date)] syncing files"
rsync -a --partial -e "$ssh_cmd" "$PROJECT_DIR/files/" "$CODING_HOST:files/"

# Newest dino dump and its n8n sibling from the same run share a timestamp.
latest=$(ls -1t "$PROJECT_DIR"/backups/postgres_dino_*.dump.gz.gpg 2>/dev/null | head -n 1 || true)
if [ -n "$latest" ]; then
  ts=${latest##*postgres_dino_}
  ts=${ts%.dump.gz.gpg}
  echo "[$(date)] sending dumps for $ts"
  # -t keeps the dump's own timestamp so the coding side prunes by backup age.
  rsync -t --ignore-existing -e "$ssh_cmd" \
    "$PROJECT_DIR"/backups/postgres_*_"$ts".dump.gz.gpg "$CODING_HOST:backups/"
fi

# The hourly dumps keep fixed names, so each push replaces the copy on the
# coding side and only the most recent hour is ever held there.
if ls "$PROJECT_DIR"/backups/hourly/postgres_*_hourly.dump.gz.gpg >/dev/null 2>&1; then
  echo "[$(date)] sending hourly dumps"
  rsync -t -e "$ssh_cmd" \
    "$PROJECT_DIR"/backups/hourly/postgres_*_hourly.dump.gz.gpg "$CODING_HOST:backups/hourly/"
fi

echo "[$(date)] push complete"
