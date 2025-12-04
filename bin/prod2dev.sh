#!/usr/bin/env bash
set -euo pipefail

# Optionally set this here, or export it before running the script
# export PGPASSWORD="your-super-secret-and-long-postgres-password"

: "${PGPASSWORD:?PGPASSWORD must be set}"
export PROD_DATABASE_URL="postgresql://postgres.local:${PGPASSWORD}@157.245.98.25:5432/postgres"

TS="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="prod_app_${TS}.sql"

echo "==> Dumping prod schemas (public) to $DUMP_FILE"

pg_dump "$PROD_DATABASE_URL" \
  -n public \
  -n storage \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  -f "$DUMP_FILE"


echo "==> Ensuring 'extensions' schema and pgvector extension exist on local dev"

psql \
  -h 127.0.0.1 \
  -p 5432 \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;"

echo "==> Restoring to local dev (public) from $DUMP_FILE"

psql \
  -h 127.0.0.1 \
  -p 5432 \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -f "$DUMP_FILE" \
  2>&1 | tee restore.log

echo "==> Restore Done."

echo "==> Enabling RLS on all public tables"

