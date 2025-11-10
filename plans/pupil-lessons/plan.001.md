# Plan 001 – Align `/pupil-lessons` with updated spec

## Spec delta (2025-11-10)
- The lesson list remains week → subject → lesson, but activities must no longer render under each lesson.
- Instead, each lesson title must flag whether homework exists (e.g., badge or prefix) so pupils see homework at a glance.
- Lessons must expose their Learning Objectives (LO) and Success Criteria (SC) rather than per-activity details.
- Tabs stay removed per the prior simplification.
- Data reads should remain server-side/Supabase RPC driven; avoid shifting aggregation to the client when the DB can shape it.

## Implementation outline
1. **Extend data contract at the DB / RPC layer**  
   - Source the homework flag plus LO/SC collections from Supabase (either by extending `pupil_lessons_detail_bootstrap` or by running consolidated server actions against `lesson_success_criteria` / `lessons_learning_objective`).  
   - Keep the work inside Supabase so lesson → LO/SC relationships (many-to-many) are flattened in SQL rather than reconstructed in the browser.  
   - Mirror any new fields in `src/lib/server-actions/pupil-lessons.ts` schemas, ensuring telemetry remains intact.

2. **Reshape server-side transformers**  
   - In `src/lib/pupil-lessons-data.ts`, replace `PupilLessonActivity` with new `PupilLessonObjective` / `PupilLessonSuccessCriterion` shapes.  
   - Populate each lesson entry with `hasHomework`, `learningObjectives`, and nested `successCriteria` arrays using the RPC payload (still privileging DB-side joins).  
   - Remove obsolete activity-specific helpers while keeping week/subject grouping untouched.

3. **Simplify derived homework datasets**  
   - Retain the homework date sections if other pages rely on them, but ensure the new lesson `hasHomework` flag derives from the RPC so the UI doesn’t need to recompute it.  
   - Document that activities are no longer emitted for `/pupil-lessons` to avoid confusion.

4. **Update the `/pupil-lessons/[pupilId]` UI**  
   - Swap the activity list for LO/SC blocks beneath each lesson heading.  
   - Surface the homework indicator inline with the lesson title (badge or icon).  
   - Preserve the existing week/subject card styling, ensuring accessibility for long LO/SC lists.

5. **QA + follow-up**  
   - Smoke-test teacher and pupil flows to confirm homework flags and LO/SC data hydrate correctly.  
   - Verify Supabase logs/telemetry still capture the updated RPC timings.  
   - If the RPC change adds new tables/joins, note the migration or SQL snippet so future agents understand the data provenance.

## Outstanding questions
- ✅ Only include LO/SC that were explicitly linked to the lesson (no unit-wide extras).  
- ✅ Homework badge is a simple presence/absence flag (no counts).  
- ✅ Only lessons collapse/expand; weeks and subjects stay expanded for quick scanning.
