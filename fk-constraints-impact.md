# FK Constraints Impact Analysis

## What FK Constraints Do

### At Creation Time:
- **Validate existing data** - fail if orphaned records exist (we have 35 orphaned records)
- **Require cleanup first** - must delete orphaned records before FK can be added

### Ongoing Behavior:

Each FK has a "ON DELETE" policy that controls what happens when a referenced record is deleted:

## Proposed FK Constraints

### 1. feedback → success_criteria

```sql
ALTER TABLE feedback
  ADD CONSTRAINT fk_feedback_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE CASCADE;
```

**What this does:**
- ✅ **Prevents orphans:** Can't create feedback for non-existent SC
- ✅ **Auto-cleanup:** When an SC is deleted from curriculum, all feedback for that SC is auto-deleted

**When does CASCADE trigger?**
- When a teacher **deletes an SC from the curriculum entirely** (rare)
- NOT when unassigning from activities (SC still exists, just not assigned)

**Example scenario:**
```
1. Curriculum has SC "Use correct punctuation"
2. Teacher gives feedback on 20 pupils for this SC
3. Teacher deletes "Use correct punctuation" from curriculum
4. CASCADE: All 20 feedback entries auto-delete
```

**Is this desirable?**
- ✅ YES - if the SC doesn't exist in curriculum anymore, feedback on it is meaningless
- This is what SHOULD have happened to prevent the 33 orphaned records we found

### 2. lesson_success_criteria → success_criteria

```sql
ALTER TABLE lesson_success_criteria
  ADD CONSTRAINT fk_lesson_sc_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE CASCADE;
```

**What this does:**
- ✅ **Prevents orphans:** Can't add SC to mapper if SC doesn't exist
- ✅ **Auto-cleanup:** When SC deleted from curriculum, mapper links auto-delete

**When does CASCADE trigger?**
- When a teacher **deletes an SC from the curriculum entirely**
- NOT when unassigning from activities

**Is this desirable?**
- ✅ YES - if SC doesn't exist, mapper link is meaningless

### 3. activity_success_criteria → success_criteria

```sql
ALTER TABLE activity_success_criteria
  ADD CONSTRAINT fk_activity_sc_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE RESTRICT;
```

**What this does:**
- ✅ **Prevents orphans:** Can't assign non-existent SC to activity
- ⚠️ **Blocks deletion:** **CANNOT** delete an SC if it's assigned to any activities

**When does RESTRICT trigger?**
- When trying to **delete an SC from the curriculum** that's still assigned to activities
- Database will **reject the deletion** with an error

**Example scenario:**
```
1. SC "Use variables" is assigned to 3 activities
2. Teacher tries to delete SC from curriculum
3. RESTRICT: Database blocks the deletion
4. Error: "Cannot delete SC - still assigned to activities"
5. Teacher must first unassign from activities, THEN can delete SC
```

**Is this desirable?**
- ✅ YES - this is EXACTLY what we want!
- Forces teachers to use the "unassign" button we just built
- Prevents accidental deletion of SCs that are in use

## Impact on Your New Unassign Feature

### Current behavior (with FKs):

**Scenario 1: Unassign SC from activities**
```
1. Teacher clicks chain icon (unassign)
2. Our code: DELETE FROM activity_success_criteria WHERE sc_id = '...'
3. FK constraint: ✅ Allows deletion (RESTRICT doesn't apply to child table)
4. SC still exists in curriculum
5. Feedback preserved (SC not deleted, CASCADE doesn't trigger)
6. Mapper links preserved (SC not deleted, CASCADE doesn't trigger)
```
**Result:** ✅ Works exactly as intended, no data loss

**Scenario 2: Delete SC from curriculum while still assigned**
```
1. Teacher tries: DELETE FROM success_criteria WHERE sc_id = '...'
2. FK constraint on activity_success_criteria checks assignments
3. RESTRICT: ❌ Blocks the deletion
4. Error returned to teacher: "Cannot delete - still assigned to activities"
5. Teacher must unassign first
```
**Result:** ✅ Prevents accidental data loss

**Scenario 3: Delete SC from curriculum after unassigning**
```
1. SC not assigned to any activities
2. SC has 10 feedback entries
3. SC has 2 mapper links
4. Teacher: DELETE FROM success_criteria WHERE sc_id = '...'
5. CASCADE on feedback: Auto-deletes 10 feedback entries
6. CASCADE on lesson_success_criteria: Auto-deletes 2 mapper links
7. SC deleted successfully
```
**Result:** ✅ Clean deletion, no orphans

## What Changes for Users?

### Before FKs:
- ❌ Can delete SC from curriculum even if assigned to activities
- ❌ Leaves orphaned feedback/mapper links
- ❌ No warning to teacher
- ❌ Data integrity issues accumulate

### After FKs:
- ✅ Cannot delete SC if assigned to activities
- ✅ Must unassign first (using your new feature!)
- ✅ Feedback/mapper auto-cleanup when SC truly deleted
- ✅ No orphaned records ever

## Risk Assessment

### Risk Level: 🟢 LOW

**Why it's safe:**
1. **No data loss on FK creation** - only removes 35 ALREADY-BROKEN records
2. **No behavior change for normal operations** - teachers won't notice
3. **Only affects edge case** - deleting SCs (rare operation)
4. **Better UX** - prevents mistakes, forces proper workflow
5. **Reversible** - can drop constraints if issues arise

### What Could Go Wrong?

**Scenario: Teacher tries to delete in-use SC**
- Before: Silently creates orphans
- After: Shows error, teacher confused

**Mitigation:**
- Update curriculum UI to check before allowing deletion
- Show warning: "SC assigned to 3 activities. Unassign first."
- Provide "Unassign from all activities" button

## Recommended Implementation Steps

### Phase 1: Cleanup (No user impact)
```sql
-- 1. Delete orphaned feedback (already broken)
DELETE FROM feedback
WHERE success_criteria_id NOT IN (
  SELECT success_criteria_id FROM success_criteria
);
-- Expected: 33 rows deleted

-- 2. Delete orphaned mapper links (already broken)
DELETE FROM lesson_success_criteria
WHERE success_criteria_id NOT IN (
  SELECT success_criteria_id FROM success_criteria
);
-- Expected: 2 rows deleted
```

### Phase 2: Add FK Constraints (Low risk)
```sql
-- 3. Add FK on feedback
ALTER TABLE feedback
  ADD CONSTRAINT fk_feedback_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE CASCADE;

-- 4. Add FK on mapper
ALTER TABLE lesson_success_criteria
  ADD CONSTRAINT fk_lesson_sc_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE CASCADE;

-- 5. Add FK on activity assignments
ALTER TABLE activity_success_criteria
  ADD CONSTRAINT fk_activity_sc_success_criteria
  FOREIGN KEY (success_criteria_id)
  REFERENCES success_criteria(success_criteria_id)
  ON DELETE RESTRICT;
```

### Phase 3: UI Updates (Nice to have)
- Update curriculum deletion logic to check assignments first
- Show helpful error messages
- Add "Unassign from all" batch operation

## Timeline

- **Phase 1 (Cleanup):** 10 minutes
- **Phase 2 (FK Constraints):** 10 minutes
- **Phase 3 (UI Updates):** 2-4 hours (optional)

**Total:** 20 minutes for data integrity fix, 2-4 hours for UX polish

## Recommendation

✅ **Proceed with FK constraints**

The risk is minimal, the benefit is significant, and the current orphaned data proves this is needed. The FK constraints will:
- Fix existing data integrity issues
- Prevent future orphans
- Enforce proper workflow (unassign before delete)
- Make your new unassign feature essential

The only "scary" part is deleting 35 orphaned records, but they're already broken data referencing deleted SCs. They SHOULD have been deleted when the SCs were removed.
