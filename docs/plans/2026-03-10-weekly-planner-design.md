# Weekly Planner ("Actions" / "My Actions") — Design

**Date:** 2026-03-10
**Status:** Approved

## Overview

A weekly planning view that helps pupils track their lessons, activities, and tasks per week, grouped by group/class. Teachers have a parallel view ("Actions") with group navigation, rich-text note authoring, and a pupil Q&A notification system.

## Routes

| Route | Role | Nav Label |
|---|---|---|
| `/my-actions` | Pupil | My Actions |
| `/actions` | Teacher | Actions |

Role enforcement: `requireRole('teacher')` on `/actions`, authenticated pupil on `/my-actions`.

## DB Schema (New Tables)

### `weekly_plan_notes`
Teacher-authored rich text per group per week.

```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
group_id       UUID NOT NULL REFERENCES groups(group_id),
week_start_date DATE NOT NULL,
content        TEXT NOT NULL,  -- rich text HTML
created_by     UUID NOT NULL REFERENCES profiles(user_id),
created_at     TIMESTAMPTZ DEFAULT now()
```

### `weekly_plan_questions`
Pupil question attached to a lesson or activity.

```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
lesson_id      UUID NOT NULL REFERENCES lessons(lesson_id),
activity_id    UUID NULLABLE REFERENCES lesson_activities(activity_id),
user_id        UUID NOT NULL REFERENCES profiles(user_id),
content        TEXT NOT NULL,
created_at     TIMESTAMPTZ DEFAULT now()
```

### `weekly_plan_replies`
Flat teacher reply to a pupil question (no nesting).

```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
question_id    UUID NOT NULL REFERENCES weekly_plan_questions(id),
user_id        UUID NOT NULL REFERENCES profiles(user_id),
content        TEXT NOT NULL,
created_at     TIMESTAMPTZ DEFAULT now()
```

## Existing Data Reused

- `lesson_assignments` — `start_date` + `group_id` determines which lessons fall in which week
- `lesson_activities` — activities listed under each lesson
- `groups` — drives teacher side menu and pupil group grouping

## Week Boundaries

- Weeks start Sunday (per project convention)
- Friday–Saturday are non-working days
- Dates displayed as DD-MM-YYYY

## Page Layouts

### `/my-actions` — Pupil View

- Weeks displayed vertically, current week at top
- Default range: current week + 3 weeks past
- "Load future" button at top, "Load past" button at bottom — each adds 3 weeks
- Within each week:
  - Groups listed in order
  - Each group section shows teacher note (if any) at the top
  - Lessons listed beneath, with activities nested under each lesson
- Each lesson/activity has a question button — opens inline flat Q&A thread
  - Pupil can post a question; existing Q&A shown inline

### `/actions` — Teacher View

- **Left sidebar:** list of all groups; clicking a group loads that group's planner in the main panel
- **Main panel:** same week layout as pupil view for the selected group
- Badge count on lessons/activities with unanswered pupil questions
- Clicking badge expands inline Q&A thread — teacher can post a reply
- Each week section has an "Add note" button — opens rich text editor, saves to `weekly_plan_notes`

## Data Fetching

- New server actions in `src/lib/server-actions/weekly-planner.ts`
- Pupil: fetches all groups the pupil belongs to, then `lesson_assignments` filtered by date range
- Teacher: fetches all groups; on group selection fetches `lesson_assignments` for that group + notes + question counts
- Week ranges computed server-side; client sends `from` and `to` date params for load more

## Server Actions

- `readWeeklyPlannerPupilAction(userId, from, to)` — returns weeks → groups → lessons → activities + notes + Q&A
- `readWeeklyPlannerTeacherAction(groupId, from, to)` — same shape for one group
- `createWeeklyPlanNoteAction(groupId, weekStartDate, content)` — teacher adds note
- `createWeeklyPlanQuestionAction(lessonId, activityId?, content)` — pupil posts question
- `createWeeklyPlanReplyAction(questionId, content)` — teacher posts reply

## Component Structure

```
src/app/my-actions/
  page.tsx                  # Pupil page (server component)
src/app/actions/
  page.tsx                  # Teacher page (server component)
src/components/weekly-planner/
  WeekSection.tsx           # One week block with header
  GroupSection.tsx          # One group within a week
  LessonRow.tsx             # Lesson with nested activities
  ActivityRow.tsx           # Single activity
  QuestionThread.tsx        # Inline Q&A thread (pupil + teacher)
  NoteEditor.tsx            # Rich text note editor (teacher)
  TeacherSidebar.tsx        # Group list sidebar (teacher only)
```
