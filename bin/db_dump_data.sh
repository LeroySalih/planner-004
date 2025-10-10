#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=bin/env_load.sh
. "$(dirname "$0")/env_load.sh"

mkdir -p dumps

supabase db dump \
  --db-url "${DB_REMOTE_URL}" \
  --data-only \
  --file dumps/remote_data.sql

echo "✅ Data dumped to dumps/remote_data.sql"