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
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

CODING_HOST="${CODING_HOST:-leroy@149.104.105.55}"
CODING_PORT="${CODING_PORT:-2223}"
SSH_KEY="$HOME/.ssh/push_to_coding"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# The first run copies several GB and can outlast the hour; skip rather than
# start a second copy alongside it.
exec 9>"/tmp/push-to-coding.lock"
flock -n 9 || { echo "[$(date)] previous push still running, skipping"; exit 0; }

ssh_cmd="ssh -p $CODING_PORT -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

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

echo "[$(date)] push complete"
