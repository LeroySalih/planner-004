#!/bin/bash

# Apply migration 059: Add foreign key constraints for success criteria
# This migration:
# - Cleans up 35 orphaned records (33 feedback + 2 lesson_success_criteria)
# - Adds FK constraints to prevent future orphaned data
# - Enforces proper workflow (unassign before delete)

MIGRATION_FILE="src/migrations/applied/059-add-success-criteria-foreign-keys.sql"

echo "============================================================="
echo "Applying migration 059: Add success criteria foreign keys"
echo "============================================================="
echo ""
echo "This migration will:"
echo "  1. Delete 33 orphaned feedback records"
echo "  2. Delete 2 orphaned lesson_success_criteria records"
echo "  3. Add FK constraint: feedback -> success_criteria (CASCADE)"
echo "  4. Add FK constraint: lesson_success_criteria -> success_criteria (CASCADE)"
echo "  5. Add FK constraint: activity_success_criteria -> success_criteria (RESTRICT)"
echo ""
echo "Press Ctrl+C to cancel, or Enter to continue..."
read

# Check if we're using Docker or local postgres
if docker ps | grep -q postgres17; then
  echo "Using Docker postgres..."
  docker exec -i postgres17 psql -U postgres -d postgres < "$MIGRATION_FILE"
else
  echo "Using local postgres..."
  PGPASSWORD='your-super-secret-and-long-postgres-password' psql -h localhost -U postgres -d postgres < "$MIGRATION_FILE"
fi

if [ $? -eq 0 ]; then
  echo ""
  echo "============================================================="
  echo "✓ Migration 059 applied successfully"
  echo "============================================================="
  echo ""
  echo "Changes made:"
  echo "  ✓ Orphaned records cleaned up"
  echo "  ✓ Foreign key constraints added"
  echo "  ✓ Data integrity enforced"
  echo ""
  echo "Impact on users:"
  echo "  - Teachers cannot delete SCs assigned to activities"
  echo "  - Must use 'unassign' feature before deletion"
  echo "  - No more orphaned data will accumulate"
  echo "============================================================="
else
  echo ""
  echo "============================================================="
  echo "✗ Migration 059 failed"
  echo "============================================================="
  echo "Please check the error messages above."
  exit 1
fi
