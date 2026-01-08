# Plan: Remove Homework Concept

## Objective
Remove the "homework" flag and concept from the application entirely. This includes removing the ability to mark activities as homework, displaying homework status to pupils/teachers, and cleaning up the underlying data structures.

## Scope
- **UI**: Teacher activity manager, Pupil lesson details, Lesson lists.
- **Backend**: Server actions for creating/updating activities, data fetching for pupil lessons.
- **Database**: `activities` table schema.

## Execution Steps

### Phase 1: UI Removal
1.  **Teacher Interface**:
    - Remove the "Homework" toggle switch from `src/components/lessons/lesson-activities-manager.tsx`.
2.  **Pupil Interface**:
    - Remove "Homework" badges/pills from `src/app/pupil-lessons/[pupilId]/pupil-lessons-detail-client.tsx`.
    - Remove "Homework" labels from activity components (e.g., `pupil-upload-activity.tsx`).
    - Remove "Homework" indicators from `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`.
3.  **Teacher Lesson View**:
    - Remove "Homework" indicators from `src/app/lessons/[lessonId]/activities/page.tsx`.

### Phase 2: Code Cleanup
1.  **Types & Schemas**:
    - Remove `isHomework` from Zod schemas in `src/types/index.ts`.
    - Remove `PupilHomeworkItem` and `PupilHomeworkSection` from `src/lib/pupil-lessons-data.ts`.
2.  **Server Actions**:
    - Update `src/lib/server-actions/lesson-activities.ts` to stop accepting/processing `isHomework`.
    - Update `src/lib/server-actions/pupil-lessons.ts` to remove homework activity fetching/processing.
3.  **Data Logic**:
    - Remove `hasHomework` calculation in `src/lib/pupil-lessons-data.ts`.

### Phase 3: Database Cleanup
1.  **Migrations**:
    - Create a migration to drop the `is_homework` column from the `activities` table.
    - Update SQL functions that reference `is_homework`.
    - Update `schema/schema.sql`.

## Verification
- Verify that the activity manager no longer shows the homework toggle.
- Verify that pupil lesson lists no longer show "Homework set".
- Verify that creating/updating activities works without the homework flag.
