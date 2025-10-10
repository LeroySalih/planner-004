#!/usr/bin/env bash
set -euo pipefail

# Load .env (builds DB_REMOTE_URL with sslmode=require and URL-encodes password)
# shellcheck source=bin/env_load.sh
. "$(dirname "$0")/env_load.sh" >/dev/null

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA_FILE="${PROJECT_ROOT}/supabase/schemas/prod.sql"
DATA_FILE="${PROJECT_ROOT}/dumps/remote_data.sql"
SEED_FILE="${PROJECT_ROOT}/supabase/seed.sql"
SEED_FILE_TMP="${PROJECT_ROOT}/supabase/seed.sql.dev.skip"

mkdir -p "${PROJECT_ROOT}/supabase/schemas" "${PROJECT_ROOT}/dumps"

echo "☁️  Pulling remote schema..."
supabase db dump \
  --db-url "${DB_REMOTE_URL}" \
  --schema public \
  --file "${SCHEMA_FILE}"

if [[ "${DEV_IMPORT_DATA:-0}" == "1" ]]; then
  echo "☁️  Pulling remote data (this may take a while)..."
  supabase db dump \
    --db-url "${DB_REMOTE_URL}" \
    --data-only \
    --file "${DATA_FILE}"
fi

# --- Temporarily disable local seed.sql so supabase start doesn't try to load it ---
SEED_MOVED=0
if [[ -f "${SEED_FILE}" ]]; then
  mv "${SEED_FILE}" "${SEED_FILE_TMP}"
  SEED_MOVED=1
  echo "⏸️  Temporarily disabled supabase/seed.sql during init"
fi

echo "🧹 Resetting local Supabase..."
supabase stop >/dev/null || true
# Optional: nuke volumes for a truly fresh DB (comment out if you prefer to keep volumes)
docker volume ls --format '{{.Name}}' | grep -E '^supabase_.*' | xargs -I{} docker volume rm {} || true
supabase start >/dev/null

# Restore seed.sql immediately after start (so it's back for other workflows)
if [[ "${SEED_MOVED}" -eq 1 ]]; then
  mv "${SEED_FILE_TMP}" "${SEED_FILE}"
  echo "▶️  Restored supabase/seed.sql"
fi

# Local DB connection defaults
LOCAL_HOST="${LOCAL_HOST:-127.0.0.1}"
LOCAL_PORT="${LOCAL_PORT:-54322}"
LOCAL_DB="${LOCAL_DB:-postgres}"
LOCAL_USER="${LOCAL_USER:-supabase_admin}"
LOCAL_PASSWORD="${LOCAL_PASSWORD:-postgres}"
export PGPASSWORD="${LOCAL_PASSWORD}"

echo "🧽 Dropping and recreating schema public..."
psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE;"
psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA public;"
psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO postgres;"
psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO public;"

echo "📥 Applying remote schema to local..."
psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -v ON_ERROR_STOP=1 -1 -f "${SCHEMA_FILE}"

if [[ "${DEV_IMPORT_DATA:-0}" == "1" ]]; then
  echo "🍯 Loading remote data into local..."
  psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -v ON_ERROR_STOP=1 -1 -f "${DATA_FILE}"
fi

echo "✅ Local DB now mirrors remote (schema${DEV_IMPORT_DATA:+ + data})."