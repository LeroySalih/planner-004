#!/usr/bin/env bash
set -euo pipefail

########################################
# Configuration
########################################

# REQUIRED: set this before running, e.g.:
#   export PROD_DATABASE_URL="postgresql://user:pass@prod-host:5432/prod_db"
: "${PROD_DATABASE_URL:?PROD_DATABASE_URL must be set}"

# OPTIONAL: override if your dev DB is different
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="prod_public_${TIMESTAMP}.dump"
DUMP_LOG="dump_${TIMESTAMP}.log"
RESTORE_LOG="restore_${TIMESTAMP}.log"

echo "==> Using PROD_DATABASE_URL=$PROD_DATABASE_URL"
echo "==> Using LOCAL_DATABASE_URL=$LOCAL_DATABASE_URL"
echo "==> Dump file:    $DUMP_FILE"
echo "==> Dump log:     $DUMP_LOG"
echo "==> Restore log:  $RESTORE_LOG"
echo

########################################
# 1. Dump prod (public schema only)
########################################

echo "==> Dumping prod (schema: public) ..."
if pg_dump "$PROD_DATABASE_URL" \
  -Fc \
  -n public \
  -f "$DUMP_FILE" \
  > "$DUMP_LOG" 2>&1; then
  echo "==> Dump completed successfully."
else
  echo "!! Dump FAILED. See $DUMP_LOG for details."
  exit 1
fi

########################################
# 2. Ensure vector extension exists in dev (public schema)
########################################

echo
echo "==> Ensuring 'vector' extension exists in dev (schema: public) ..."

psql "$LOCAL_DATABASE_URL" <<'SQL' >/dev/null
DO $$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  -- Not installed at all -> create in public
  IF ext_schema IS NULL THEN
    RAISE NOTICE 'vector extension not found, creating in schema public';
    CREATE EXTENSION vector WITH SCHEMA public;

  -- Installed but in wrong schema -> move by drop/recreate
  ELSIF ext_schema <> 'public' THEN
    RAISE NOTICE 'vector extension found in schema %, recreating in schema public', ext_schema;
    DROP EXTENSION vector;
    CREATE EXTENSION vector WITH SCHEMA public;
  ELSE
    RAISE NOTICE 'vector extension already installed in schema public';
  END IF;
END$$;
SQL

echo "==> vector extension ready."

########################################
# 3. Restore public schema into dev
########################################

echo
echo "==> Restoring dump into dev (schema: public) ..."
echo "    (this will DROP and recreate objects in public)"

if pg_restore \
  -d "$LOCAL_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -n public \
  "$DUMP_FILE" \
  > "$RESTORE_LOG" 2>&1; then
  echo "==> Restore completed successfully."
else
  echo "!! Restore FAILED. See $RESTORE_LOG for details."
  exit 1
fi


echo "==> Re-applying schema/table/sequence grants on dev ..."

psql "$LOCAL_DATABASE_URL" <<'SQL'
GRANT USAGE ON SCHEMA public
TO postgres, anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
TO postgres, anon, authenticated, service_role;
SQL



echo
echo "==> Done."
echo "    Dump file:    $DUMP_FILE"
echo "    Dump log:     $DUMP_LOG"
echo "    Restore log:  $RESTORE_LOG"
