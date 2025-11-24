#!/usr/bin/env bash

export PGPASSWORD="your-super-secret-and-long-postgres-password"
export PROD_DATABASE_URL="postgresql://postgres.local:$PGPASSWORD@157.245.98.25:5432/postgres"

#!/usr/bin/env bash
set -euo pipefail

: "${PROD_DATABASE_URL:?PROD_DATABASE_URL must be set}"

TS="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="prod_app_${TS}.sql"

echo "Dumping prod schemas (public) to $DUMP_FILE"

pg_dump "$PROD_DATABASE_URL" \
  -n public \
  --clean \
  --if-exists \
  -f "$DUMP_FILE"

echo "Restoring to dev (public) to $DUMP_FILE"

psql \
  -h 127.0.0.1 \
  -p 5432 \
  -U postgres.local \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -f "$DUMP_FILE" \
  >restore.log 2>&1

echo "Restore Done."


echo "Enabling RLS"

psql "postgresql://postgres.local:$PGPASSWORD@localhost:5432/postgres" <<'SQL'
DO $$
DECLARE
  r record;
  policy_name text := 'allow_all_authenticated';
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           c.relname  AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'         -- ordinary tables
      AND n.nspname = 'public'    -- limit to public schema
  LOOP
    -- Enable RLS on the table
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;',
      r.schema_name,
      r.table_name
    );

    -- Only create the policy if it doesn't already exist
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy p
      WHERE p.polrelid = format('%I.%I', r.schema_name, r.table_name)::regclass
        AND p.polname  = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I
           ON %I.%I
         AS PERMISSIVE
         FOR ALL
         TO authenticated
         USING (true)
         WITH CHECK (true);',
        policy_name,
        r.schema_name,
        r.table_name
      );
    END IF;
  END LOOP;
END
$$ LANGUAGE plpgsql;
SQL