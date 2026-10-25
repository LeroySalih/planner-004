#!/usr/bin/env bash
# Applies DINO's pending SQL migrations to the dino database in the `db`
# container, in order, skipping any already applied and stopping at the
# first error. Takes an encrypted backup first (scripts/backup-db.sh).
#
#   bash scripts/migrate.sh              asks before applying
#   bash scripts/migrate.sh --yes        no questions
#   bash scripts/migrate.sh --no-backup  skip the backup (only if you just took one)
#   bash scripts/migrate.sh --check      only list what is pending
#
# Each migration has a check that is true once it is applied. Add new ones to
# the end of MIGRATIONS. DB_NAME overrides the database (default dino).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
DB_NAME="${DB_NAME:-dino}"

# file|SQL that returns 't' once the migration is applied
MIGRATIONS=(
  "118-must-change-password.sql|select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'must_change_password')"
  "119-kerf-sso.sql|select exists (select 1 from information_schema.columns where table_name = 'oauth_tokens' and column_name = 'scope')"
  "120-oauth-project-keys.sql|select exists (select 1 from information_schema.columns where table_name = 'oauth_clients' and column_name = 'disabled_by_admin')"
  "121-year-group-levels.sql|select exists (select 1 from information_schema.tables where table_name = 'year_group_levels')"
  "122-year-group-top-level.sql|select exists (select 1 from information_schema.columns where table_name = 'year_group_levels' and column_name = 'top_level')"
  "123-unit-audits.sql|select exists (select 1 from information_schema.tables where table_name = 'unit_audits')"
  "124-lesson-description.sql|select exists (select 1 from information_schema.columns where table_name = 'lessons' and column_name = 'description')"
  "125-lesson-understanding.sql|select exists (select 1 from information_schema.tables where table_name = 'lesson_understanding')"
  "126-sub-units.sql|select exists (select 1 from information_schema.tables where table_name = 'sub_units')"
)

YES=false
BACKUP=true
CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    --no-backup) BACKUP=false ;;
    --check) CHECK_ONLY=true ;;
    *) echo "usage: $0 [--yes] [--no-backup] [--check]" >&2; exit 2 ;;
  esac
done

fail() { printf '\033[31mmigrate: %s\033[0m\n' "$1" >&2; exit 1; }
psql_db() { docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -X -q -U "$POSTGRES_USER" -d "$1"' sh "$DB_NAME"; }
sql_value() { docker compose exec -T db sh -c 'psql -X -tA -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$DB_NAME" "$1"; }

docker compose ps db --status running -q | grep -q . || fail "the db container is not running"

pending=()
for entry in "${MIGRATIONS[@]}"; do
  file="${entry%%|*}"
  check="${entry#*|}"
  [ -f "src/migrations/$file" ] || fail "src/migrations/$file not found"
  if [ "$(sql_value "$check")" = "t" ]; then
    echo "already applied: $file"
  else
    pending+=("$file")
  fi
done

if [ ${#pending[@]} -eq 0 ]; then
  echo "nothing to apply ($DB_NAME)"
  exit 0
fi
echo "to apply to $DB_NAME, in order: ${pending[*]}"
$CHECK_ONLY && exit 0

if ! $YES; then
  read -r -p "Apply them? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "stopped"
fi

if $BACKUP; then
  bash scripts/backup-db.sh
  echo "backup: $(ls -t backups/*dino* 2>/dev/null | head -1)"
fi

for file in "${pending[@]}"; do
  echo "applying $file"
  psql_db < "src/migrations/$file" || fail "$file failed; nothing after it was applied. The backup is in ./backups."
done
echo "done"
