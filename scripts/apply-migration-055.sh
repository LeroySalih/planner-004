#!/bin/bash

# Apply migration 055: Fix reports function to return empty arrays instead of null

MIGRATION_FILE="../src/migrations/055-fix-reports-function-null-arrays.sql"
APPLIED_DIR="../src/migrations/applied"

echo "Applying migration 055-fix-reports-function-null-arrays.sql..."

# Apply the migration to the database
docker exec -i postgres17 psql -U postgres -d postgres < "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
  echo "✓ Migration applied successfully"

  # Move the migration to the applied directory
  if [ ! -d "$APPLIED_DIR" ]; then
    mkdir -p "$APPLIED_DIR"
  fi

  cp "$MIGRATION_FILE" "$APPLIED_DIR/"
  echo "✓ Migration moved to applied directory"
else
  echo "✗ Migration failed"
  exit 1
fi
