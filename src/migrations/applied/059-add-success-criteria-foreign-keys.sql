-- Migration: Add foreign key constraints for success criteria references
-- Author: Claude Code
-- Date: 2026-02-13
-- Description: Adds FK constraints to prevent orphaned records when success criteria
--              are deleted. Also cleans up existing orphaned data before adding constraints.
--
--              Constraints added:
--              1. feedback.success_criteria_id -> success_criteria (CASCADE)
--              2. lesson_success_criteria.success_criteria_id -> success_criteria (CASCADE)
--              3. activity_success_criteria.success_criteria_id -> success_criteria (RESTRICT)
--
--              Impact:
--              - Deletes 35 orphaned records (33 feedback + 2 lesson_success_criteria)
--              - Prevents future orphaned data
--              - Enforces proper workflow: unassign from activities before deleting SC

-- =============================================================================
-- STEP 1: Clean up orphaned records before adding FK constraints
-- =============================================================================

-- Delete orphaned feedback records (reference deleted success criteria)
-- These records reference SCs that were deleted from the curriculum
-- Expected: 33 rows deleted
DELETE FROM feedback
WHERE success_criteria_id NOT IN (
  SELECT success_criteria_id FROM success_criteria
);

-- Delete orphaned lesson_success_criteria records (reference deleted success criteria)
-- These mapper links reference SCs that were deleted from the curriculum
-- Expected: 2 rows deleted
DELETE FROM lesson_success_criteria
WHERE success_criteria_id NOT IN (
  SELECT success_criteria_id FROM success_criteria
);

-- Verify activity_success_criteria has no orphans (should be 0)
-- This is just a safety check - we confirmed no orphans exist
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM activity_success_criteria acs
  WHERE NOT EXISTS (
    SELECT 1 FROM success_criteria WHERE success_criteria_id = acs.success_criteria_id
  );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Found % orphaned activity_success_criteria records. Cannot proceed.', orphan_count;
  END IF;
END $$;

-- =============================================================================
-- STEP 2: Add foreign key constraints
-- =============================================================================

-- Constraint 1: feedback -> success_criteria
-- ON DELETE CASCADE: When an SC is deleted from curriculum, auto-delete all feedback for it
-- This is appropriate because feedback on a non-existent SC is meaningless
ALTER TABLE feedback
  ADD CONSTRAINT fk_feedback_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE CASCADE;

-- Constraint 2: lesson_success_criteria -> success_criteria
-- ON DELETE CASCADE: When an SC is deleted from curriculum, auto-delete mapper links
-- This is appropriate because mapper links to non-existent SCs are meaningless
ALTER TABLE lesson_success_criteria
  ADD CONSTRAINT fk_lesson_sc_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE CASCADE;

-- Constraint 3: activity_success_criteria -> success_criteria
-- ON DELETE RESTRICT: Block SC deletion if it's still assigned to activities
-- This enforces proper workflow: teachers must unassign SC from activities first
-- This makes the new "unassign" feature essential for proper data management
ALTER TABLE activity_success_criteria
  ADD CONSTRAINT fk_activity_sc_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE RESTRICT;

-- =============================================================================
-- VERIFICATION: Confirm constraints were created
-- =============================================================================

-- This will output a summary of the new constraints
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 059: Foreign key constraints added successfully';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Constraints created:';
  RAISE NOTICE '  1. fk_feedback_success_criteria (CASCADE)';
  RAISE NOTICE '  2. fk_lesson_sc_success_criteria (CASCADE)';
  RAISE NOTICE '  3. fk_activity_sc_success_criteria (RESTRICT)';
  RAISE NOTICE '';
  RAISE NOTICE 'Data cleanup:';
  RAISE NOTICE '  - Orphaned feedback records removed';
  RAISE NOTICE '  - Orphaned lesson_success_criteria records removed';
  RAISE NOTICE '';
  RAISE NOTICE 'Impact:';
  RAISE NOTICE '  - Teachers cannot delete SCs that are assigned to activities';
  RAISE NOTICE '  - Teachers must use "unassign" feature before deletion';
  RAISE NOTICE '  - No more orphaned data will accumulate';
  RAISE NOTICE '=================================================================';
END $$;
