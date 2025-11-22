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

echo "Done."