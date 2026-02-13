# Migration Recommendation: Hybrid Approach

## Summary
**Do NOT attempt a full migration at this time.** The data shows that 91.5% of lesson-level feedback cannot be mapped to activities without data loss. This indicates the lesson-level feedback feature is being actively used for a different purpose than activity-based feedback.

## Recommended Path Forward

### Immediate Actions (Week 1):

1. **Add FK Constraints** (Data integrity fix)
   ```sql
   ALTER TABLE feedback
     ADD CONSTRAINT fk_feedback_success_criteria
     FOREIGN KEY (success_criteria_id)
     REFERENCES success_criteria(success_criteria_id)
     ON DELETE CASCADE;

   ALTER TABLE lesson_success_criteria
     ADD CONSTRAINT fk_lesson_sc_success_criteria
     FOREIGN KEY (success_criteria_id)
     REFERENCES success_criteria(success_criteria_id)
     ON DELETE CASCADE;

   ALTER TABLE activity_success_criteria
     ADD CONSTRAINT fk_activity_sc_success_criteria
     FOREIGN KEY (success_criteria_id)
     REFERENCES success_criteria(success_criteria_id)
     ON DELETE RESTRICT;  -- Cannot delete SC if assigned to activities
   ```

2. **Freeze Curriculum Mapper** (Make read-only)
   - Disable manual lesson_success_criteria editing in UI
   - Compute curriculum mapper view from activity assignments
   - Old mapper links visible for reference only

3. **Standardize on Activity-Based Workflow** (New behavior)
   - All new lessons must have activities
   - SCs are assigned only through activities
   - Feedback given only through activities

### Medium Term (Months 2-3):

4. **UI Migration Tool for Teachers**
   - Dashboard showing "unmappable feedback"
   - Teachers can:
     - Create activities for lessons with no activities
     - Assign SCs to existing activities
     - Archive/dismiss obsolete feedback
   - Once mapped, auto-migrate feedback

5. **Gradual Deprecation**
   - Old lesson-level feedback marked as "legacy"
   - Shown in read-only "historical view"
   - New feedback only at activity level

### Long Term (Month 4+):

6. **Final Cleanup**
   - Once all active lessons migrated
   - Archive old feedback table to backup
   - Drop old tables from production
   - Unified activity-based model

## Why NOT Migrate Now?

1. **Pedagogical Reasons:** Teachers give feedback at different granularities:
   - Lesson-level: "Did you understand the concept discussed today?"
   - Activity-level: "Did you complete this specific task correctly?"

   These are different use cases! Forcing lesson feedback into activities may lose semantic meaning.

2. **Data Integrity:** 365 feedback entries (91.5%) cannot be automatically mapped. Manual review required.

3. **User Trust:** Deleting teacher-created feedback data without consent damages trust and violates data stewardship principles.

## Success Metrics

Before proceeding to full migration, achieve:
- [ ] All active lessons have at least one activity
- [ ] 90%+ of SC assignments are through activities (not mapper)
- [ ] Teachers comfortable with activity-based workflow
- [ ] Less than 10% unmappable feedback remaining

## Estimated Timeline

- **Immediate fixes (FK constraints):** 1 week
- **Freeze mapper + standardize workflow:** 2 weeks
- **Migration tool development:** 4 weeks
- **Teacher migration period:** 8-12 weeks
- **Final cleanup:** 2 weeks

**Total:** ~4-5 months for safe, zero-data-loss migration

## Alternative: Keep Both Models Permanently

If analysis shows lesson-level and activity-level feedback serve DIFFERENT pedagogical purposes, consider keeping both tables permanently with clear UI separation:

- **Lesson Tab:** Lesson-level feedback (thumbs up/down on SC understanding)
- **Activity Tab:** Activity-level feedback (scores and detailed feedback)

This acknowledges that formative (lesson) and summative (activity) feedback are different things.
