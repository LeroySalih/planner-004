#!/usr/bin/env bash
set -euo pipefail

# source the env loader so exported vars are available here
# shellcheck source=bin/env_load.sh
. "$(dirname "$0")/env_load.sh"

mkdir -p dumps supabase/schemas

supabase db dump \
  --db-url "${DB_REMOTE_URL}" \
  --schema public \
  --file supabase/schemas/prod.sql

echo "✅ Schema dumped to supabase/schemas/prod.sql"