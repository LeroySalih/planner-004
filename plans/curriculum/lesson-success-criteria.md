# Curriculum Mapper – Lesson Success Criteria Linking Plan

## 1. Data Model & Schema
- Extend `lesson_success_criteria` with foreign keys to `lessons.lesson_id` and `success_criteria.success_criteria_id`, plus `created_at`/`updated_at` timestamps for auditing.
- Add supporting indices (`lesson_id`, `success_criteria_id`) and RLS policies that mirror `lessons_learning_objective` (teachers can manage links for their unit; pupils read-only/block).
- Ensure Supabase migration also seeds existing lesson ↔ LO links into `lesson_success_criteria` where activities or assignments already reference the same criteria.
- Update `src/types/index.ts` with `LessonSuccessCriterionSchema` and thread new types through relevant unions.

## 2. Server Actions & Barrels
- Create `src/lib/server-actions/lesson-success-criteria.ts` exposing CRUD helpers (`list`, `link`, `unlink`) with Zod-validated payloads and guard rails (`requireTeacherProfile`).
- Re-export via `src/lib/server-updates.ts`, and inject into existing lesson loaders (`readLessonWithObjectives`, `readLessonsByUnitAction`) so consumers receive `lesson.success_criteria`.
- Update activity-related actions (`listLessonActivitiesAction`, `createLessonActivityAction`, `updateLessonActivityAction`) to source available criteria from `lesson_success_criteria` instead of deriving directly from learning objectives.

## 3. Curriculum Builder UI/UX
- In the Curriculum Mapper tab (`curriculum-prototype-client.tsx`), augment the lesson grid so each learning objective row expands to show its success criteria with nested cells per lesson.
- Provide visual cues: objective row (bold), success criteria subrows (indented, lighter text), and separate toggle states (objective link vs. criterion link).
- Wire toggle interactions: clicking a success criterion cell calls the new `linkLessonSuccessCriterion`/`unlink` actions and updates state optimistically with toast messaging on failure.
- Include filters/search that respect both levels, ensuring the sticky column displays objective + nested criteria simultaneously.

## 4. Lesson & Activity Surfaces
- Update `readLessonAction`/`LessonDetailClient` to use `lesson_success_criteria` when presenting linked criteria (instead of recomputing from objectives).
- Adjust `LessonActivitiesManager` so the Success Criteria multi-select is powered by the new lesson-level dataset; fallback when no criteria are linked should prompt users to map them in the Curriculum Mapper.
- Ensure pupil/teacher presentation components (lesson overview, feedback tables) consume the unified lesson criteria list to avoid drift.

## 5. Migration & Backfill
- Write a one-off Supabase script (SQL or server action) that, for each lesson, scans its linked learning objectives and inserts missing `lesson_success_criteria` rows so legacy data remains available.
- Prevent duplicates by using `ON CONFLICT DO NOTHING` and log lessons that still have zero criteria after the pass (for manual review).

## 6. Testing & QA
- Add Playwright scenarios: (a) mapper toggling a success criterion on/off; (b) verifying the toggle surfaces in the lesson activity editor selection list.
- Cover server action unit tests (if existing harness) or integration smoke tests to confirm correct auth failures and deduping.
- Update documentation (`Planner Agents Playbook` + relevant specs) describing the new linking workflow and any mapper UX changes.
