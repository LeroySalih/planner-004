#!/usr/bin/env bash
# Makes leavers inactive and purges uploaded files nobody needs any more.
#
#   bash scripts/purge-leavers.sh 25 26             dry run: report and write the plan
#   bash scripts/purge-leavers.sh 25 26 --apply     do it (asks first; takes a backup)
#   bash scripts/purge-leavers.sh 25 26 --apply --yes --no-backup
#
# A leaver is a pupil in a "<leaving>-" class (e.g. 25-9A-DT) who is in no
# "<staying>-" class (e.g. 26-10A-DT). Staff (teacher, admin, technician) never
# count. A leaver is set inactive (migration 139): they can no longer sign in
# and their sessions and OAuth tokens end. Their submissions, marks and
# feedback are kept, so reports and history are unchanged.
#
# Files purged (stored_files rows and the files on disk):
#   leaver           every file a leaver uploaded or that sits in their folder
#   inactive unit    every file in an inactive unit or in a lesson of one
#   inactive lesson  every file in an inactive lesson, pupil uploads included
#
# Files are not deleted: they are moved to purged/<timestamp>/ beside files/,
# with a manifest, so they can be put back. Disk space is freed only when you
# delete that folder after checking the site. The database part runs in one
# transaction; if it fails nothing changes and no file is moved.
#
# DB_NAME overrides the database (default dino); FILES_DIR the files folder
# (default ./files).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
DB_NAME="${DB_NAME:-dino}"
FILES_DIR="${FILES_DIR:-$PROJECT_DIR/files}"

usage() { echo "usage: $0 <leaving-prefix> <staying-prefix> [--apply] [--yes] [--no-backup]   e.g. $0 25 26" >&2; exit 2; }
fail() { printf '\033[31mpurge-leavers: %s\033[0m\n' "$1" >&2; exit 1; }

[ $# -ge 2 ] || usage
LEAVING="$1"; STAYING="$2"; shift 2
[[ "$LEAVING" =~ ^[0-9]{2}$ && "$STAYING" =~ ^[0-9]{2}$ ]] || usage
[ "$LEAVING" != "$STAYING" ] || fail "the two prefixes must differ"

APPLY=false; YES=false; BACKUP=true
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --yes) YES=true ;;
    --no-backup) BACKUP=false ;;
    *) usage ;;
  esac
done

psql_db() {
  docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -X -q -tA -F "	" -U "$POSTGRES_USER" -d "$1" -v leaving="$2" -v staying="$3"' \
    sh "$DB_NAME" "$LEAVING-%" "$STAYING-%"
}

docker compose ps db --status running -q | grep -q . || fail "the db container is not running"
[ -d "$FILES_DIR" ] || fail "no files folder at $FILES_DIR (set FILES_DIR)"
[ "$(echo "select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'active')" | psql_db)" = t ] \
  || fail "profiles.active is missing: deploy the code and run scripts/migrate.sh first (migration 139)"

# Builds temp tables `leavers` and `purge_files` for the session.
PLAN_SQL=$(cat <<'SQL'
create temp table leavers as
select p.user_id, p.email, p.first_name, p.last_name,
       (select string_agg(gm.group_id, ' ' order by gm.group_id) from group_membership gm where gm.user_id = p.user_id) as classes
from profiles p
where p.active
  and exists (select 1 from group_membership gm where gm.user_id = p.user_id and gm.group_id like :'leaving')
  and not exists (select 1 from group_membership gm where gm.user_id = p.user_id and gm.group_id like :'staying')
  and exists (select 1 from user_roles r where r.user_id = p.user_id and r.role_id = 'pupil')
  and not exists (select 1 from user_roles r where r.user_id = p.user_id and r.role_id in ('teacher', 'admin', 'technician'))
  and p.is_teacher is not true;

create temp table purge_files as
with f as (
  select sf.id, sf.bucket, sf.scope_path, sf.stored_path, sf.size_bytes, sf.uploaded_by,
         case when sf.bucket = 'lessons' then split_part(sf.scope_path, '/', 1) end as lesson_id,
         case when sf.bucket = 'units' then sf.scope_path end as unit_id
  from stored_files sf
), r as (
  select f.id, f.stored_path, f.size_bytes,
    exists (select 1 from leavers l
            where l.user_id = f.uploaded_by
               or (l.email is not null and lower(l.email) = any (string_to_array(lower(f.scope_path), '/')))) as leaver,
    coalesce(u.active is false, false) as unit_inactive,
    coalesce(l.active is false, false) as lesson_inactive
  from f
  left join lessons l on l.lesson_id::text = f.lesson_id
  left join units u on u.unit_id = coalesce(l.unit_id, f.unit_id)
)
select id, stored_path, size_bytes,
       concat_ws(' + ', case when leaver then 'leaver' end,
                        case when unit_inactive then 'inactive unit' end,
                        case when lesson_inactive then 'inactive lesson' end) as reason
from r
where leaver or unit_inactive or lesson_inactive;
SQL
)

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="$PROJECT_DIR/purged/$STAMP"
mkdir -p "$OUT_DIR"

# The plan: who and what, written before anything changes.
printf '%s\n%s\n' "$PLAN_SQL" "select classes, first_name || ' ' || last_name, email from leavers order by classes, last_name, first_name;" \
  | psql_db > "$OUT_DIR/leavers.tsv"
printf '%s\n%s\n' "$PLAN_SQL" "select reason, size_bytes, stored_path from purge_files order by reason, stored_path;" \
  | psql_db > "$OUT_DIR/files.tsv"

LEAVER_COUNT=$(grep -c . "$OUT_DIR/leavers.tsv" || true)
FILE_COUNT=$(grep -c . "$OUT_DIR/files.tsv" || true)
echo "Leavers: pupils in $LEAVING- classes and in no $STAYING- class: $LEAVER_COUNT"
cut -f1 "$OUT_DIR/leavers.tsv" | tr ' ' '\n' | grep "^$LEAVING-" | sort | uniq -c | awk '{printf "  %-14s %s\n", $2, $1}'
echo "Files to purge: $FILE_COUNT"
awk -F'\t' '{n[$1]++; b[$1]+=$2; tn++; tb+=$2}
  END {for (k in n) printf "  %-32s %6d files %10.1f MB\n", k, n[k], b[k]/1e6;
       printf "  %-32s %6d files %10.1f MB\n", "total", tn, tb/1e6}' "$OUT_DIR/files.tsv"
echo "Plan written to $OUT_DIR (leavers.tsv, files.tsv)"

if ! $APPLY; then
  echo "Dry run: nothing changed. Re-run with --apply to do it."
  exit 0
fi

# Moving files needs write access to files/; it is often owned by the app's user.
SUDO=""
if [ "$FILE_COUNT" -gt 0 ] && [ ! -w "$FILES_DIR" ]; then
  command -v sudo >/dev/null || fail "$FILES_DIR is not writable and sudo is missing"
  SUDO="sudo"
  echo "files/ is not writable by $(id -un): file moves will use sudo."
  sudo -v
fi

if ! $YES; then
  read -r -p "Make $LEAVER_COUNT pupils inactive and purge $FILE_COUNT files from '$DB_NAME'? Type purge to continue: " answer
  [ "$answer" = purge ] || fail "cancelled; nothing changed"
fi

if $BACKUP; then
  [ "$DB_NAME" = dino ] || fail "scripts/backup-db.sh only backs up dino; pass --no-backup with DB_NAME"
  echo "Backing up the database first (scripts/backup-db.sh)..."
  bash "$PROJECT_DIR/scripts/backup-db.sh"
fi

# One transaction. Its only output is the purged paths, which become the manifest.
printf '%s\n' "begin;" "$PLAN_SQL" "
update profiles set active = false where user_id in (select user_id from leavers);
delete from auth_sessions where user_id in (select user_id from leavers);
delete from oauth_tokens where user_id in (select user_id from leavers);
delete from stored_files where id in (select id from purge_files);
select stored_path from purge_files order by stored_path;
commit;" | psql_db > "$OUT_DIR/manifest.txt" || fail "the database step failed and was rolled back; no file was moved"
echo "Database updated: $LEAVER_COUNT pupils inactive, $(grep -c . "$OUT_DIR/manifest.txt" || true) file records removed."

moved=0; missing=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  case "/$rel/" in //*|*/../*|*/./*) echo "skipped unsafe path: $rel" >&2; continue ;; esac
  if [ -e "$FILES_DIR/$rel" ]; then
    $SUDO mkdir -p "$OUT_DIR/files/$(dirname "$rel")"
    $SUDO mv "$FILES_DIR/$rel" "$OUT_DIR/files/$rel"
    moved=$((moved + 1))
  else
    missing=$((missing + 1))
  fi
done < "$OUT_DIR/manifest.txt"

echo "Files moved to $OUT_DIR/files: $moved ($missing were already missing on disk)."
echo "Check the site, then free the space with:  ${SUDO:+sudo }rm -rf '$OUT_DIR/files'"
echo "To put a file back, move it from there to $FILES_DIR/ (the database row is in the backup)."
