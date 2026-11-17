#!/usr/bin/env bash
# Runs on PROD from cron, every minute. Carries out "Back up now" requests made
# on /admin/backups (table backup_requests, migration 145).
#
# The web app has no Docker socket and no SSH key, so it only records the
# request; this script, on the host, does the work:
#   1. claims the oldest pending request (pending -> running)
#   2. backup-db.sh manual        timestamped, encrypted dumps of dino + n8n
#   3. push-to-coding.sh dumps    sends just those dumps to the coding server
#   4. records done (file names and sizes) or error (the last lines of output)
#
# A request left running for 30 minutes (this script killed, server rebooted)
# is marked as an error so the page stops waiting and a new one can be made.
#
# BACKUP_REQUEST_SKIP_PUSH=1 skips step 3 (for trying it on the dev server).
#
# Install on prod:
#   * * * * * /path/to/planner-004/scripts/backup-on-request.sh >> /path/to/planner-004/backups/request.log 2>&1
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# A backup can take minutes; the next minute's run must not start a second.
exec 8>"/tmp/backup-on-request.lock"
flock -n 8 || exit 0

# Runs the SQL on stdin against dino. Arguments become psql variables
# (id, files, err) so values reach the SQL quoted by psql (:'id'), never
# spliced into it.
db_sql() {
  docker compose -f compose.yml exec -T db bash -c \
    'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d dino -v id="$1" -v files="$2" -v err="$3"' \
    bash "${1:-}" "${2:-}" "${3:-}"
}

db_sql <<'SQL' >/dev/null
update backup_requests
   set status = 'error', finished_at = now(), error = 'Backup did not finish within 30 minutes.'
 where status = 'running' and started_at < now() - interval '30 minutes';
SQL

request_id=$(db_sql <<'SQL'
update backup_requests
   set status = 'running', started_at = now()
 where request_id = (
   select request_id from backup_requests
    where status = 'pending'
    order by requested_at
    limit 1
    for update skip locked
 )
returning request_id;
SQL
)
[ -n "$request_id" ] || exit 0
[[ "$request_id" =~ ^[0-9a-f-]{36}$ ]] || { echo "[$(date)] unexpected request id from the database" >&2; exit 1; }

echo "[$(date)] request $request_id: starting"

finished=false

record_error() {
  local message="$1"
  # Keep it short enough to read on the page.
  message="${message:0:500}"
  db_sql "$request_id" "" "$message" <<'SQL' >/dev/null
update backup_requests
   set status = 'error', finished_at = now(), error = :'err'
 where request_id = :'id';
SQL
  finished=true
  echo "[$(date)] request $request_id: error: $message"
}

# Anything that stops the script after the claim leaves an error, not a
# request stuck on running until the 30-minute timeout.
on_exit() {
  if ! $finished; then
    record_error "The backup script stopped unexpectedly." || true
  fi
}
trap on_exit EXIT

# The last lines of a step's output, which is where its error is.
tail_of() {
  printf '%s\n' "$1" | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -n 5 | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

if ! backup_out=$(bash "$PROJECT_DIR/scripts/backup-db.sh" manual 2>&1); then
  printf '%s\n' "$backup_out"
  record_error "Backup failed: $(tail_of "$backup_out")"
  exit 1
fi
printf '%s\n' "$backup_out"

files_json=""
ts=""
while read -r name; do
  if ! [[ "$name" =~ ^postgres_[A-Za-z0-9]+_([0-9]{8}_[0-9]{6})\.dump\.gz\.gpg$ ]]; then
    record_error "Backup wrote an unexpected file name."
    exit 1
  fi
  ts="${BASH_REMATCH[1]}"
  if ! bytes=$(stat -c %s "$PROJECT_DIR/backups/$name" 2>/dev/null); then
    record_error "Backup said it wrote $name but it is not in backups/."
    exit 1
  fi
  files_json+="${files_json:+,}{\"name\":\"$name\",\"bytes\":$bytes}"
done < <(printf '%s\n' "$backup_out" | sed -n 's/^WROTE //p')

if [ -z "$ts" ]; then
  record_error "Backup finished but reported no files."
  exit 1
fi

if [ "${BACKUP_REQUEST_SKIP_PUSH:-}" = 1 ]; then
  echo "[$(date)] request $request_id: push skipped (BACKUP_REQUEST_SKIP_PUSH=1)"
elif ! push_out=$(bash "$PROJECT_DIR/scripts/push-to-coding.sh" dumps "$ts" 2>&1); then
  printf '%s\n' "$push_out"
  record_error "Backup made but not sent to the dev server: $(tail_of "$push_out")"
  exit 1
else
  printf '%s\n' "$push_out"
fi

db_sql "$request_id" "[$files_json]" <<'SQL' >/dev/null
update backup_requests
   set status = 'done', finished_at = now(), files = :'files'::jsonb, error = null
 where request_id = :'id';
SQL
finished=true
echo "[$(date)] request $request_id: done"
