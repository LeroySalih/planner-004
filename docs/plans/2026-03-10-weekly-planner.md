# Weekly Planner (Actions / My Actions) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `/actions` (teacher) and `/my-actions` (pupil) pages showing lessons and activities grouped by week, with teacher note authoring and a pupil Q&A system.

**Architecture:** Single feature folder `src/components/weekly-planner/` with shared components; two separate routes with role-based access. New DB tables for notes and Q&A. Server actions in `src/lib/server-actions/weekly-planner.ts`.

**Tech Stack:** Next.js 15 App Router, React 19, PostgreSQL via `pg`, Zod, Tailwind CSS v4, Tiptap (rich text), Radix UI primitives, sonner (toasts).

**Design doc:** `docs/plans/2026-03-10-weekly-planner-design.md`

**Worktree:** `.worktrees/weekly-planner` — dev server at http://localhost:3001

---

### Task 1: DB Migration — New Tables

**Files:**
- Create: `src/migrations/063-weekly-planner.sql`

**Step 1: Write the migration**

```sql
-- weekly_plan_notes: teacher rich-text note per group per week
CREATE TABLE IF NOT EXISTS weekly_plan_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  week_start_date  DATE NOT NULL,
  content          TEXT NOT NULL,
  created_by       UUID NOT NULL REFERENCES profiles(user_id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, week_start_date)
);

-- weekly_plan_questions: pupil question on a lesson or activity
CREATE TABLE IF NOT EXISTS weekly_plan_questions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    UUID NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  activity_id  UUID REFERENCES lesson_activities(activity_id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(user_id),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- weekly_plan_replies: flat teacher reply to a question
CREATE TABLE IF NOT EXISTS weekly_plan_replies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES weekly_plan_questions(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(user_id),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Step 2: Apply migration to worktree DB**

```bash
psql -U postgres -d postgres-weekly-planner -f src/migrations/063-weekly-planner.sql
```

Expected: `CREATE TABLE` x3, no errors.

**Step 3: Verify tables exist**

```bash
psql -U postgres -d postgres-weekly-planner -c "\dt weekly_plan*"
```

Expected: 3 tables listed.

**Step 4: Commit**

```bash
git add src/migrations/063-weekly-planner.sql
git commit -m "feat: add weekly planner DB migration (notes, questions, replies)"
```

---

### Task 2: Zod Types

**Files:**
- Modify: `src/types/index.ts` (append at end)

**Step 1: Add schemas**

Append to `src/types/index.ts`:

```typescript
// ─── Weekly Planner ───────────────────────────────────────────────────────────

export const WeeklyPlanNoteSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  week_start_date: z.string(),
  content: z.string(),
  created_by: z.string(),
  created_at: z.string(),
});
export type WeeklyPlanNote = z.infer<typeof WeeklyPlanNoteSchema>;

export const WeeklyPlanQuestionSchema = z.object({
  id: z.string(),
  lesson_id: z.string(),
  activity_id: z.string().nullable(),
  user_id: z.string(),
  display_name: z.string(),
  content: z.string(),
  created_at: z.string(),
});
export type WeeklyPlanQuestion = z.infer<typeof WeeklyPlanQuestionSchema>;

export const WeeklyPlanReplySchema = z.object({
  id: z.string(),
  question_id: z.string(),
  user_id: z.string(),
  display_name: z.string(),
  content: z.string(),
  created_at: z.string(),
});
export type WeeklyPlanReply = z.infer<typeof WeeklyPlanReplySchema>;

export const WeeklyPlanActivitySchema = z.object({
  activity_id: z.string(),
  title: z.string(),
  activity_type: z.string(),
  order_by: z.number(),
  question_count: z.number().default(0),
  questions: z.array(WeeklyPlanQuestionSchema).default([]),
  replies: z.array(WeeklyPlanReplySchema).default([]),
});
export type WeeklyPlanActivity = z.infer<typeof WeeklyPlanActivitySchema>;

export const WeeklyPlanLessonSchema = z.object({
  lesson_id: z.string(),
  title: z.string(),
  start_date: z.string(),
  question_count: z.number().default(0),
  questions: z.array(WeeklyPlanQuestionSchema).default([]),
  replies: z.array(WeeklyPlanReplySchema).default([]),
  activities: z.array(WeeklyPlanActivitySchema).default([]),
});
export type WeeklyPlanLesson = z.infer<typeof WeeklyPlanLessonSchema>;

export const WeeklyPlanGroupSchema = z.object({
  group_id: z.string(),
  group_name: z.string(),
  note: WeeklyPlanNoteSchema.nullable(),
  lessons: z.array(WeeklyPlanLessonSchema).default([]),
});
export type WeeklyPlanGroup = z.infer<typeof WeeklyPlanGroupSchema>;

export const WeeklyPlanWeekSchema = z.object({
  week_start: z.string(),  // ISO date, Sunday
  groups: z.array(WeeklyPlanGroupSchema).default([]),
});
export type WeeklyPlanWeek = z.infer<typeof WeeklyPlanWeekSchema>;
```

**Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add weekly planner Zod schemas"
```

---

### Task 3: Week Utility Helpers

**Files:**
- Create: `src/lib/weekly-planner-utils.ts`

**Step 1: Write the file**

```typescript
/**
 * Returns the Sunday that starts the week containing `date`.
 * Weeks start on Sunday per project convention.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * Returns an array of week-start dates (Sundays) covering `from` to `to`.
 * Ordered newest first.
 */
export function getWeekRange(from: Date, to: Date): Date[] {
  const weeks: Date[] = [];
  const current = getWeekStart(to);
  const stop = getWeekStart(from);

  while (current >= stop) {
    weeks.push(new Date(current));
    current.setDate(current.getDate() - 7);
  }

  return weeks;
}

/**
 * Formats a date as DD-MM-YYYY per project convention.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Returns default date range: current week start going back 3 weeks.
 */
export function defaultPupilDateRange(): { from: Date; to: Date } {
  const to = getWeekStart(new Date());
  const from = new Date(to);
  from.setDate(from.getDate() - 21); // 3 weeks back
  return { from, to };
}
```

**Step 2: Commit**

```bash
git add src/lib/weekly-planner-utils.ts
git commit -m "feat: add weekly planner week utility helpers"
```

---

### Task 4: Server Actions — Read

**Files:**
- Create: `src/lib/server-actions/weekly-planner.ts`

**Step 1: Write the server actions file**

```typescript
"use server";

import { z } from "zod";
import { query } from "@/lib/db";
import { requireAuthenticatedProfile, requireRole } from "@/lib/auth";
import { withTelemetry } from "@/lib/telemetry";
import {
  WeeklyPlanWeekSchema,
  WeeklyPlanWeek,
} from "@/types";
import { getWeekStart, getWeekRange } from "@/lib/weekly-planner-utils";

// ─── Pupil: fetch all groups + lessons + activities + Q&A for date range ──────

export const readWeeklyPlannerPupilAction = withTelemetry(
  "readWeeklyPlannerPupilAction",
  async (from: string, to: string): Promise<{ data: WeeklyPlanWeek[] | null; error: string | null }> => {
    try {
      const profile = await requireAuthenticatedProfile();

      const result = await query(`
        WITH pupil_groups AS (
          SELECT g.group_id, g.name AS group_name
          FROM group_membership gm
          JOIN groups g ON g.group_id = gm.group_id
          WHERE gm.user_id = $1
          ORDER BY g.name
        ),
        assigned_lessons AS (
          SELECT
            la.group_id,
            la.lesson_id,
            la.start_date,
            l.title AS lesson_title
          FROM lesson_assignments la
          JOIN lessons l ON l.lesson_id = la.lesson_id
          WHERE la.group_id IN (SELECT group_id FROM pupil_groups)
            AND la.start_date >= $2
            AND la.start_date <= ($3::date + INTERVAL '6 days')
            AND l.active = true
        ),
        lesson_acts AS (
          SELECT
            a.lesson_id,
            a.activity_id,
            a.title,
            a.activity_type,
            a.order_by
          FROM lesson_activities a
          WHERE a.lesson_id IN (SELECT lesson_id FROM assigned_lessons)
          ORDER BY a.order_by
        ),
        notes AS (
          SELECT group_id, week_start_date, content, created_by, created_at, id
          FROM weekly_plan_notes
          WHERE group_id IN (SELECT group_id FROM pupil_groups)
            AND week_start_date >= $2 AND week_start_date <= $3
        ),
        questions AS (
          SELECT
            wpq.id, wpq.lesson_id, wpq.activity_id, wpq.user_id,
            COALESCE(NULLIF(TRIM(CONCAT(pr.first_name, ' ', pr.last_name)), ''), wpq.user_id) AS display_name,
            wpq.content, wpq.created_at::text
          FROM weekly_plan_questions wpq
          JOIN profiles pr ON pr.user_id = wpq.user_id
          WHERE wpq.lesson_id IN (SELECT lesson_id FROM assigned_lessons)
          ORDER BY wpq.created_at
        ),
        replies AS (
          SELECT
            wpr.id, wpr.question_id, wpr.user_id,
            COALESCE(NULLIF(TRIM(CONCAT(pr.first_name, ' ', pr.last_name)), ''), wpr.user_id) AS display_name,
            wpr.content, wpr.created_at::text
          FROM weekly_plan_replies wpr
          JOIN profiles pr ON pr.user_id = wpr.user_id
          WHERE wpr.question_id IN (SELECT id FROM questions)
          ORDER BY wpr.created_at
        )
        SELECT
          json_build_object(
            'groups', (
              SELECT json_agg(
                json_build_object(
                  'group_id', pg.group_id,
                  'group_name', pg.group_name,
                  'note', (SELECT row_to_json(n) FROM notes n WHERE n.group_id = pg.group_id AND n.week_start_date = $4::date LIMIT 1),
                  'lessons', (
                    SELECT COALESCE(json_agg(
                      json_build_object(
                        'lesson_id', al.lesson_id,
                        'title', al.lesson_title,
                        'start_date', al.start_date::text,
                        'question_count', (SELECT COUNT(*) FROM questions q WHERE q.lesson_id = al.lesson_id AND q.activity_id IS NULL),
                        'questions', (SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json) FROM questions q WHERE q.lesson_id = al.lesson_id AND q.activity_id IS NULL),
                        'replies', (SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM replies r WHERE r.question_id IN (SELECT id FROM questions q2 WHERE q2.lesson_id = al.lesson_id AND q2.activity_id IS NULL)),
                        'activities', (
                          SELECT COALESCE(json_agg(
                            json_build_object(
                              'activity_id', a.activity_id,
                              'title', a.title,
                              'activity_type', a.activity_type,
                              'order_by', a.order_by,
                              'question_count', (SELECT COUNT(*) FROM questions q WHERE q.activity_id = a.activity_id),
                              'questions', (SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json) FROM questions q WHERE q.activity_id = a.activity_id),
                              'replies', (SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM replies r WHERE r.question_id IN (SELECT id FROM questions q2 WHERE q2.activity_id = a.activity_id))
                            ) ORDER BY a.order_by
                          ), '[]'::json)
                          FROM lesson_acts a WHERE a.lesson_id = al.lesson_id
                        )
                      ) ORDER BY al.start_date
                    ), '[]'::json)
                    FROM assigned_lessons al WHERE al.group_id = pg.group_id
                  )
                )
              )
              FROM pupil_groups pg
            )
          ) AS payload
      `, [profile.userId, from, to, from]);

      // NOTE: The above query is a simplified single-week version.
      // For multi-week, call this action once per week with the week's Sunday as $2/$4 and $3 as Saturday.
      // The page-level code builds the week array by calling getWeekRange and mapping each week.

      const raw = result.rows[0]?.payload;
      if (!raw) return { data: [], error: null };

      // Parse a single-week response (caller maps weeks)
      const parsed = z.object({
        groups: z.array(z.any()),
      }).parse(raw);

      return { data: parsed.groups, error: null };
    } catch (err) {
      console.error("readWeeklyPlannerPupilAction", err);
      return { data: null, error: "Failed to load weekly planner" };
    }
  }
);
```

> **Note to implementer:** The SQL above returns data for ONE week. The page server component calls this per week-start date and assembles the week array. This keeps the query readable. Refactor to a single batch query only if performance requires it.

**Step 2: Add teacher read action to same file**

```typescript
// ─── Teacher: fetch one group's planner for date range ────────────────────────

export const readWeeklyPlannerTeacherAction = withTelemetry(
  "readWeeklyPlannerTeacherAction",
  async (groupId: string, from: string, to: string): Promise<{ data: any | null; error: string | null }> => {
    try {
      await requireRole("teacher");

      const result = await query(`
        SELECT
          la.lesson_id,
          l.title AS lesson_title,
          la.start_date::text,
          (SELECT COUNT(*) FROM weekly_plan_questions q WHERE q.lesson_id = la.lesson_id AND q.activity_id IS NULL) AS question_count,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', q.id,
              'lesson_id', q.lesson_id,
              'activity_id', q.activity_id,
              'user_id', q.user_id,
              'display_name', COALESCE(NULLIF(TRIM(CONCAT(pr.first_name, ' ', pr.last_name)), ''), q.user_id::text),
              'content', q.content,
              'created_at', q.created_at::text
            ))
            FROM weekly_plan_questions q
            JOIN profiles pr ON pr.user_id = q.user_id
            WHERE q.lesson_id = la.lesson_id AND q.activity_id IS NULL
            ORDER BY q.created_at
          ), '[]') AS questions,
          COALESCE((
            SELECT json_agg(json_build_object(
              'activity_id', a.activity_id,
              'title', a.title,
              'activity_type', a.activity_type,
              'order_by', a.order_by,
              'question_count', (SELECT COUNT(*) FROM weekly_plan_questions q WHERE q.activity_id = a.activity_id),
              'questions', COALESCE((
                SELECT json_agg(json_build_object(
                  'id', q.id, 'lesson_id', q.lesson_id, 'activity_id', q.activity_id,
                  'user_id', q.user_id,
                  'display_name', COALESCE(NULLIF(TRIM(CONCAT(pr2.first_name, ' ', pr2.last_name)), ''), q.user_id::text),
                  'content', q.content, 'created_at', q.created_at::text
                ))
                FROM weekly_plan_questions q
                JOIN profiles pr2 ON pr2.user_id = q.user_id
                WHERE q.activity_id = a.activity_id
                ORDER BY q.created_at
              ), '[]')
            ) ORDER BY a.order_by)
            FROM lesson_activities a WHERE a.lesson_id = la.lesson_id
          ), '[]') AS activities
        FROM lesson_assignments la
        JOIN lessons l ON l.lesson_id = la.lesson_id
        WHERE la.group_id = $1
          AND la.start_date >= $2
          AND la.start_date <= ($3::date + INTERVAL '6 days')
          AND l.active = true
        ORDER BY la.start_date
      `, [groupId, from, to]);

      return { data: result.rows, error: null };
    } catch (err) {
      console.error("readWeeklyPlannerTeacherAction", err);
      return { data: null, error: "Failed to load teacher planner" };
    }
  }
);
```

**Step 3: Commit**

```bash
git add src/lib/server-actions/weekly-planner.ts
git commit -m "feat: add weekly planner read server actions"
```

---

### Task 5: Server Actions — Mutations

**Files:**
- Modify: `src/lib/server-actions/weekly-planner.ts` (append)
- Modify: `src/lib/server-updates.ts` (re-export)

**Step 1: Append mutation actions**

```typescript
// ─── Mutations ────────────────────────────────────────────────────────────────

export const createWeeklyPlanNoteAction = withTelemetry(
  "createWeeklyPlanNoteAction",
  async (groupId: string, weekStartDate: string, content: string): Promise<{ data: null; error: string | null }> => {
    try {
      await requireRole("teacher");

      await query(`
        INSERT INTO weekly_plan_notes (group_id, week_start_date, content, created_by)
        VALUES ($1, $2, $3, (SELECT user_id FROM profiles WHERE user_id = current_setting('app.current_user_id', true)::uuid LIMIT 1))
        ON CONFLICT (group_id, week_start_date) DO UPDATE SET content = EXCLUDED.content
      `, [groupId, weekStartDate, content]);

      return { data: null, error: null };
    } catch (err) {
      console.error("createWeeklyPlanNoteAction", err);
      return { data: null, error: "Failed to save note" };
    }
  }
);
```

> **Note:** The `created_by` lookup above needs to use the authenticated profile from `requireRole`. Adjust to pass `profile.userId` directly:

```typescript
export const createWeeklyPlanNoteAction = withTelemetry(
  "createWeeklyPlanNoteAction",
  async (groupId: string, weekStartDate: string, content: string): Promise<{ data: null; error: string | null }> => {
    try {
      const profile = await requireRole("teacher");

      await query(`
        INSERT INTO weekly_plan_notes (group_id, week_start_date, content, created_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (group_id, week_start_date) DO UPDATE SET content = EXCLUDED.content
      `, [groupId, weekStartDate, content, profile.userId]);

      return { data: null, error: null };
    } catch (err) {
      console.error("createWeeklyPlanNoteAction", err);
      return { data: null, error: "Failed to save note" };
    }
  }
);

export const createWeeklyPlanQuestionAction = withTelemetry(
  "createWeeklyPlanQuestionAction",
  async (lessonId: string, activityId: string | null, content: string): Promise<{ data: null; error: string | null }> => {
    try {
      const profile = await requireAuthenticatedProfile();

      await query(`
        INSERT INTO weekly_plan_questions (lesson_id, activity_id, user_id, content)
        VALUES ($1, $2, $3, $4)
      `, [lessonId, activityId ?? null, profile.userId, content]);

      return { data: null, error: null };
    } catch (err) {
      console.error("createWeeklyPlanQuestionAction", err);
      return { data: null, error: "Failed to post question" };
    }
  }
);

export const createWeeklyPlanReplyAction = withTelemetry(
  "createWeeklyPlanReplyAction",
  async (questionId: string, content: string): Promise<{ data: null; error: string | null }> => {
    try {
      const profile = await requireRole("teacher");

      await query(`
        INSERT INTO weekly_plan_replies (question_id, user_id, content)
        VALUES ($1, $2, $3)
      `, [questionId, profile.userId, content]);

      return { data: null, error: null };
    } catch (err) {
      console.error("createWeeklyPlanReplyAction", err);
      return { data: null, error: "Failed to post reply" };
    }
  }
);
```

**Step 2: Re-export from server-updates.ts**

Find the exports block in `src/lib/server-updates.ts` and add:

```typescript
export {
  readWeeklyPlannerPupilAction,
  readWeeklyPlannerTeacherAction,
  createWeeklyPlanNoteAction,
  createWeeklyPlanQuestionAction,
  createWeeklyPlanReplyAction,
} from "./server-actions/weekly-planner";
```

**Step 3: Commit**

```bash
git add src/lib/server-actions/weekly-planner.ts src/lib/server-updates.ts
git commit -m "feat: add weekly planner mutation server actions"
```

---

### Task 6: Shared UI Components — WeekSection + GroupSection + LessonRow + ActivityRow

**Files:**
- Create: `src/components/weekly-planner/WeekSection.tsx`
- Create: `src/components/weekly-planner/GroupSection.tsx`
- Create: `src/components/weekly-planner/LessonRow.tsx`
- Create: `src/components/weekly-planner/ActivityRow.tsx`

**Step 1: Create `WeekSection.tsx`**

```tsx
import { formatDate, getWeekStart } from "@/lib/weekly-planner-utils";
import { WeeklyPlanGroup } from "@/types";
import { GroupSection } from "./GroupSection";

type Props = {
  weekStart: string;
  groups: WeeklyPlanGroup[];
  isTeacher?: boolean;
  onAddNote?: (weekStart: string) => void;
};

export function WeekSection({ weekStart, groups, isTeacher, onAddNote }: Props) {
  const label = formatDate(new Date(weekStart));

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Week of {label}</h2>
        {isTeacher && onAddNote && (
          <button
            onClick={() => onAddNote(weekStart)}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            + Add note
          </button>
        )}
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <GroupSection key={group.group_id} group={group} isTeacher={isTeacher} />
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">No lessons scheduled this week.</p>
        )}
      </div>
    </section>
  );
}
```

**Step 2: Create `GroupSection.tsx`**

```tsx
import { WeeklyPlanGroup } from "@/types";
import { LessonRow } from "./LessonRow";

type Props = {
  group: WeeklyPlanGroup;
  isTeacher?: boolean;
};

export function GroupSection({ group, isTeacher }: Props) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-medium text-sm text-muted-foreground mb-3 uppercase tracking-wide">
        {group.group_name}
      </h3>
      {group.note && (
        <div
          className="prose prose-sm dark:prose-invert mb-4 p-3 bg-muted rounded-md"
          dangerouslySetInnerHTML={{ __html: group.note.content }}
        />
      )}
      <div className="flex flex-col gap-2">
        {group.lessons.map((lesson) => (
          <LessonRow key={lesson.lesson_id} lesson={lesson} isTeacher={isTeacher} />
        ))}
        {group.lessons.length === 0 && (
          <p className="text-sm text-muted-foreground">No lessons assigned.</p>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create `LessonRow.tsx`**

```tsx
"use client";

import { useState } from "react";
import { WeeklyPlanLesson } from "@/types";
import { ActivityRow } from "./ActivityRow";
import { QuestionThread } from "./QuestionThread";
import { formatDate } from "@/lib/weekly-planner-utils";
import { MessageCircle } from "lucide-react";

type Props = {
  lesson: WeeklyPlanLesson;
  isTeacher?: boolean;
};

export function LessonRow({ lesson, isTeacher }: Props) {
  const [showThread, setShowThread] = useState(false);

  return (
    <div className="border rounded-md bg-background">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="font-medium text-sm">{lesson.title}</p>
          <p className="text-xs text-muted-foreground">{formatDate(lesson.start_date)}</p>
        </div>
        <button
          onClick={() => setShowThread((v) => !v)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-label="Toggle questions"
        >
          <MessageCircle className="size-4" />
          {lesson.question_count > 0 && (
            <span className="bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5">
              {lesson.question_count}
            </span>
          )}
        </button>
      </div>
      {showThread && (
        <div className="border-t px-4 py-3">
          <QuestionThread
            lessonId={lesson.lesson_id}
            activityId={null}
            questions={lesson.questions}
            replies={lesson.replies}
            isTeacher={isTeacher}
          />
        </div>
      )}
      {lesson.activities.length > 0 && (
        <div className="border-t">
          {lesson.activities.map((activity) => (
            <ActivityRow key={activity.activity_id} activity={activity} lessonId={lesson.lesson_id} isTeacher={isTeacher} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Create `ActivityRow.tsx`**

```tsx
"use client";

import { useState } from "react";
import { WeeklyPlanActivity } from "@/types";
import { QuestionThread } from "./QuestionThread";
import { MessageCircle } from "lucide-react";

type Props = {
  activity: WeeklyPlanActivity;
  lessonId: string;
  isTeacher?: boolean;
};

export function ActivityRow({ activity, lessonId, isTeacher }: Props) {
  const [showThread, setShowThread] = useState(false);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b last:border-b-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground inline-block" />
          <p className="text-sm">{activity.title}</p>
          <span className="text-xs text-muted-foreground capitalize">{activity.activity_type}</span>
        </div>
        <button
          onClick={() => setShowThread((v) => !v)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-label="Toggle questions"
        >
          <MessageCircle className="size-4" />
          {activity.question_count > 0 && (
            <span className="bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5">
              {activity.question_count}
            </span>
          )}
        </button>
      </div>
      {showThread && (
        <div className="px-4 py-3 bg-muted/40">
          <QuestionThread
            lessonId={lessonId}
            activityId={activity.activity_id}
            questions={activity.questions}
            replies={activity.replies}
            isTeacher={isTeacher}
          />
        </div>
      )}
    </div>
  );
}
```

**Step 5: Commit**

```bash
git add src/components/weekly-planner/
git commit -m "feat: add WeekSection, GroupSection, LessonRow, ActivityRow components"
```

---

### Task 7: QuestionThread Component

**Files:**
- Create: `src/components/weekly-planner/QuestionThread.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { WeeklyPlanQuestion, WeeklyPlanReply } from "@/types";
import { createWeeklyPlanQuestionAction, createWeeklyPlanReplyAction } from "@/lib/server-updates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  lessonId: string;
  activityId: string | null;
  questions: WeeklyPlanQuestion[];
  replies: WeeklyPlanReply[];
  isTeacher?: boolean;
};

export function QuestionThread({ lessonId, activityId, questions, replies, isTeacher }: Props) {
  const [localQuestions, setLocalQuestions] = useState(questions);
  const [newQuestion, setNewQuestion] = useState("");
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const repliesForQuestion = (qId: string) => replies.filter((r) => r.question_id === qId);

  const handleAskQuestion = () => {
    if (!newQuestion.trim()) return;
    startTransition(async () => {
      const { error } = await createWeeklyPlanQuestionAction(lessonId, activityId, newQuestion.trim());
      if (error) {
        toast.error(error);
        return;
      }
      setNewQuestion("");
      toast.success("Question posted");
    });
  };

  const handleReply = (questionId: string) => {
    const content = replyContent[questionId]?.trim();
    if (!content) return;
    startTransition(async () => {
      const { error } = await createWeeklyPlanReplyAction(questionId, content);
      if (error) {
        toast.error(error);
        return;
      }
      setReplyContent((prev) => ({ ...prev, [questionId]: "" }));
      toast.success("Reply posted");
    });
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      {localQuestions.length === 0 && (
        <p className="text-muted-foreground text-xs">No questions yet.</p>
      )}
      {localQuestions.map((q) => (
        <div key={q.id} className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <span className="font-medium shrink-0">{q.display_name}:</span>
            <span>{q.content}</span>
          </div>
          {repliesForQuestion(q.id).map((r) => (
            <div key={r.id} className="ml-4 flex items-start gap-2 text-xs text-muted-foreground">
              <span className="font-medium shrink-0">{r.display_name}:</span>
              <span>{r.content}</span>
            </div>
          ))}
          {isTeacher && (
            <div className="ml-4 flex gap-2">
              <Textarea
                rows={1}
                placeholder="Reply..."
                value={replyContent[q.id] ?? ""}
                onChange={(e) => setReplyContent((prev) => ({ ...prev, [q.id]: e.target.value }))}
                className="text-xs min-h-0 py-1"
              />
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleReply(q.id)}>
                Reply
              </Button>
            </div>
          )}
        </div>
      ))}
      {!isTeacher && (
        <div className="flex gap-2 mt-1">
          <Textarea
            rows={1}
            placeholder="Ask a question..."
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            className="text-xs min-h-0 py-1"
          />
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleAskQuestion}>
            Ask
          </Button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/weekly-planner/QuestionThread.tsx
git commit -m "feat: add QuestionThread component for pupil Q&A"
```

---

### Task 8: Install Tiptap + NoteEditor Component

**Files:**
- Create: `src/components/weekly-planner/NoteEditor.tsx`

**Step 1: Install Tiptap**

```bash
cd .worktrees/weekly-planner
pnpm add @tiptap/react @tiptap/pm @tiptap/starter-kit
```

**Step 2: Write `NoteEditor.tsx`**

```tsx
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createWeeklyPlanNoteAction } from "@/lib/server-updates";
import { Button } from "@/components/ui/button";

type Props = {
  groupId: string;
  weekStartDate: string;
  initialContent?: string;
  onSaved?: () => void;
};

export function NoteEditor({ groupId, weekStartDate, initialContent, onSaved }: Props) {
  const [isPending, startTransition] = useTransition();

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert min-h-[80px] max-w-none p-3 focus:outline-none",
      },
    },
  });

  const handleSave = () => {
    if (!editor) return;
    const html = editor.getHTML();
    startTransition(async () => {
      const { error } = await createWeeklyPlanNoteAction(groupId, weekStartDate, html);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Note saved");
      onSaved?.();
    });
  };

  return (
    <div className="border rounded-md bg-background">
      <div className="border-b px-3 py-1.5 flex gap-1 text-xs text-muted-foreground">
        <button onClick={() => editor?.chain().focus().toggleBold().run()} className="font-bold px-1">B</button>
        <button onClick={() => editor?.chain().focus().toggleItalic().run()} className="italic px-1">I</button>
        <button onClick={() => editor?.chain().focus().toggleBulletList().run()} className="px-1">• List</button>
      </div>
      <EditorContent editor={editor} />
      <div className="border-t px-3 py-2 flex justify-end gap-2">
        <Button size="sm" disabled={isPending} onClick={handleSave}>
          {isPending ? "Saving..." : "Save note"}
        </Button>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/components/weekly-planner/NoteEditor.tsx
git commit -m "feat: add Tiptap NoteEditor component for teacher notes"
```

---

### Task 9: TeacherSidebar Component

**Files:**
- Create: `src/components/weekly-planner/TeacherSidebar.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { cn } from "@/lib/utils";

type Group = { group_id: string; name: string };

type Props = {
  groups: Group[];
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
};

export function TeacherSidebar({ groups, selectedGroupId, onSelect }: Props) {
  return (
    <aside className="w-56 shrink-0 border-r bg-muted/20 h-full overflow-y-auto p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-2">
        Classes
      </p>
      <nav className="flex flex-col gap-0.5">
        {groups.map((group) => (
          <button
            key={group.group_id}
            onClick={() => onSelect(group.group_id)}
            className={cn(
              "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
              selectedGroupId === group.group_id && "bg-accent text-accent-foreground font-medium"
            )}
          >
            {group.name}
          </button>
        ))}
      </nav>
    </aside>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/weekly-planner/TeacherSidebar.tsx
git commit -m "feat: add TeacherSidebar component"
```

---

### Task 10: `/my-actions` Pupil Page

**Files:**
- Create: `src/app/my-actions/page.tsx`

**Step 1: Write the page**

```tsx
import { redirect } from "next/navigation";
import { requireAuthenticatedProfile } from "@/lib/auth";
import { readWeeklyPlannerPupilAction } from "@/lib/server-updates";
import { getWeekRange, defaultPupilDateRange } from "@/lib/weekly-planner-utils";
import { WeekSection } from "@/components/weekly-planner/WeekSection";

export default async function MyActionsPage() {
  const profile = await requireAuthenticatedProfile().catch(() => null);
  if (!profile) redirect("/signin");

  const { from, to } = defaultPupilDateRange();
  const weeks = getWeekRange(from, to);

  // Fetch data for each week in parallel
  const weekData = await Promise.all(
    weeks.map(async (weekStart) => {
      const iso = weekStart.toISOString().split("T")[0];
      const { data, error } = await readWeeklyPlannerPupilAction(iso, iso);
      return { weekStart: iso, groups: data ?? [], error };
    })
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">My Actions</h1>
      <div className="flex flex-col">
        {weekData.map(({ weekStart, groups }) => (
          <WeekSection key={weekStart} weekStart={weekStart} groups={groups as any} />
        ))}
      </div>
    </div>
  );
}
```

> **Note:** "Load past" / "Load future" pagination requires a client component wrapper. This initial version is a static server render. Add a `<PupilPlannerClient>` client component in a follow-up task if needed (see Task 12).

**Step 2: Verify page loads at http://localhost:3001/my-actions**

Sign in as a pupil. Should see weeks with lessons grouped by class.

**Step 3: Commit**

```bash
git add src/app/my-actions/
git commit -m "feat: add /my-actions pupil page"
```

---

### Task 11: `/actions` Teacher Page

**Files:**
- Create: `src/app/actions/page.tsx`
- Create: `src/app/actions/TeacherPlannerClient.tsx`

**Step 1: Fetch all groups and render shell in `page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { TeacherPlannerClient } from "./TeacherPlannerClient";

export default async function ActionsPage() {
  const profile = await requireRole("teacher").catch(() => null);
  if (!profile) redirect("/signin");

  const result = await query(`
    SELECT group_id, name FROM groups ORDER BY name
  `);
  const groups = result.rows as { group_id: string; name: string }[];

  return <TeacherPlannerClient groups={groups} />;
}
```

**Step 2: Write `TeacherPlannerClient.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { TeacherSidebar } from "@/components/weekly-planner/TeacherSidebar";
import { WeekSection } from "@/components/weekly-planner/WeekSection";
import { NoteEditor } from "@/components/weekly-planner/NoteEditor";
import { readWeeklyPlannerTeacherAction } from "@/lib/server-updates";
import { getWeekRange, defaultPupilDateRange } from "@/lib/weekly-planner-utils";

type Group = { group_id: string; name: string };
type Props = { groups: Group[] };

export function TeacherPlannerClient({ groups }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [weekData, setWeekData] = useState<any[]>([]);
  const [noteTarget, setNoteTarget] = useState<{ groupId: string; weekStart: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    const { from, to } = defaultPupilDateRange();
    const weeks = getWeekRange(from, to);

    startTransition(async () => {
      const results = await Promise.all(
        weeks.map(async (weekStart) => {
          const iso = weekStart.toISOString().split("T")[0];
          const { data } = await readWeeklyPlannerTeacherAction(groupId, iso, iso);
          return { weekStart: iso, lessons: data ?? [] };
        })
      );
      setWeekData(results);
    });
  };

  const selectedGroup = groups.find((g) => g.group_id === selectedGroupId);

  return (
    <div className="flex h-full">
      <TeacherSidebar
        groups={groups}
        selectedGroupId={selectedGroupId}
        onSelect={loadGroup}
      />
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">Actions</h1>
        {!selectedGroupId && (
          <p className="text-muted-foreground">Select a class from the sidebar.</p>
        )}
        {selectedGroupId && isPending && (
          <p className="text-muted-foreground">Loading...</p>
        )}
        {selectedGroupId && !isPending && weekData.map(({ weekStart, lessons }) => (
          <WeekSection
            key={weekStart}
            weekStart={weekStart}
            groups={[{
              group_id: selectedGroupId,
              group_name: selectedGroup?.name ?? "",
              note: null,
              lessons,
            }]}
            isTeacher
            onAddNote={(ws) => setNoteTarget({ groupId: selectedGroupId, weekStart: ws })}
          />
        ))}
        {noteTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg shadow-lg w-full max-w-lg p-6">
              <h2 className="font-semibold mb-3">Add note for week of {noteTarget.weekStart}</h2>
              <NoteEditor
                groupId={noteTarget.groupId}
                weekStartDate={noteTarget.weekStart}
                onSaved={() => {
                  setNoteTarget(null);
                  loadGroup(noteTarget.groupId);
                }}
              />
              <button
                className="mt-3 text-sm text-muted-foreground underline"
                onClick={() => setNoteTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
```

**Step 3: Verify page loads at http://localhost:3001/actions**

Sign in as a teacher. Sidebar shows all groups. Clicking a group loads its weekly planner. "Add note" opens the editor.

**Step 4: Commit**

```bash
git add src/app/actions/
git commit -m "feat: add /actions teacher page with sidebar, weekly view, note editor"
```

---

### Task 12: Add Nav Links to SideNav

**Files:**
- Modify: `src/components/navigation/side-nav.tsx`

**Step 1: Add "Actions" to teacher Planning accordion**

In `side-nav.tsx`, find the Planning `AccordionContent` block (around line 153) and add:

```tsx
<NavLink href="/actions" onNavigate={onNavigate}>Actions</NavLink>
```

After the existing `<NavLink href="/assignments" ...>SoW</NavLink>` line.

**Step 2: Add "My Actions" to pupil tools accordion**

Find the pupil `AccordionContent` block (around line 221) and add:

```tsx
<NavLink href="/my-actions" onNavigate={onNavigate}>My Actions</NavLink>
```

After the existing `<NavLink href="/tasks" ...>My Tasks</NavLink>` line.

**Step 3: Verify nav links appear correctly for each role**

**Step 4: Commit**

```bash
git add src/components/navigation/side-nav.tsx
git commit -m "feat: add Actions and My Actions nav links to side-nav"
```

---

### Task 13: Load Past / Load Future Pagination (Pupil)

**Files:**
- Create: `src/app/my-actions/PupilPlannerClient.tsx`
- Modify: `src/app/my-actions/page.tsx`

**Step 1: Extract `PupilPlannerClient.tsx`**

Move the pupil page rendering into a client component that holds `fromDate` / `toDate` state and has "Load past" / "Load future" buttons:

```tsx
"use client";

import { useState, useTransition } from "react";
import { WeekSection } from "@/components/weekly-planner/WeekSection";
import { readWeeklyPlannerPupilAction } from "@/lib/server-updates";
import { getWeekRange, getWeekStart, formatDate } from "@/lib/weekly-planner-utils";
import { Button } from "@/components/ui/button";
import { WeeklyPlanGroup } from "@/types";

type WeekEntry = { weekStart: string; groups: WeeklyPlanGroup[] };

type Props = { initialWeeks: WeekEntry[] };

export function PupilPlannerClient({ initialWeeks }: Props) {
  const [weeks, setWeeks] = useState<WeekEntry[]>(initialWeeks);
  const [isPending, startTransition] = useTransition();

  const earliest = weeks[weeks.length - 1]?.weekStart;
  const latest = weeks[0]?.weekStart;

  const loadPast = () => {
    if (!earliest) return;
    startTransition(async () => {
      const newTo = new Date(earliest);
      newTo.setDate(newTo.getDate() - 7);
      const newFrom = new Date(newTo);
      newFrom.setDate(newFrom.getDate() - 21);
      const newWeeks = getWeekRange(newFrom, newTo);
      const entries = await Promise.all(
        newWeeks.map(async (ws) => {
          const iso = ws.toISOString().split("T")[0];
          const { data } = await readWeeklyPlannerPupilAction(iso, iso);
          return { weekStart: iso, groups: (data ?? []) as WeeklyPlanGroup[] };
        })
      );
      setWeeks((prev) => [...prev, ...entries]);
    });
  };

  const loadFuture = () => {
    if (!latest) return;
    startTransition(async () => {
      const newFrom = new Date(latest);
      newFrom.setDate(newFrom.getDate() + 7);
      const newTo = new Date(newFrom);
      newTo.setDate(newTo.getDate() + 21);
      const newWeeks = getWeekRange(newFrom, newTo);
      const entries = await Promise.all(
        newWeeks.map(async (ws) => {
          const iso = ws.toISOString().split("T")[0];
          const { data } = await readWeeklyPlannerPupilAction(iso, iso);
          return { weekStart: iso, groups: (data ?? []) as WeeklyPlanGroup[] };
        })
      );
      setWeeks((prev) => [...entries, ...prev]);
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex justify-center mb-4">
        <Button variant="outline" size="sm" disabled={isPending} onClick={loadFuture}>
          Load future weeks
        </Button>
      </div>
      {weeks.map(({ weekStart, groups }) => (
        <WeekSection key={weekStart} weekStart={weekStart} groups={groups} />
      ))}
      <div className="flex justify-center mt-4">
        <Button variant="outline" size="sm" disabled={isPending} onClick={loadPast}>
          Load past weeks
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Update `page.tsx` to use `PupilPlannerClient`**

```tsx
import { redirect } from "next/navigation";
import { requireAuthenticatedProfile } from "@/lib/auth";
import { readWeeklyPlannerPupilAction } from "@/lib/server-updates";
import { getWeekRange, defaultPupilDateRange } from "@/lib/weekly-planner-utils";
import { PupilPlannerClient } from "./PupilPlannerClient";
import { WeeklyPlanGroup } from "@/types";

export default async function MyActionsPage() {
  const profile = await requireAuthenticatedProfile().catch(() => null);
  if (!profile) redirect("/signin");

  const { from, to } = defaultPupilDateRange();
  const weeks = getWeekRange(from, to);

  const initialWeeks = await Promise.all(
    weeks.map(async (weekStart) => {
      const iso = weekStart.toISOString().split("T")[0];
      const { data } = await readWeeklyPlannerPupilAction(iso, iso);
      return { weekStart: iso, groups: (data ?? []) as WeeklyPlanGroup[] };
    })
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">My Actions</h1>
      <PupilPlannerClient initialWeeks={initialWeeks} />
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/my-actions/
git commit -m "feat: add load past/future pagination to My Actions page"
```

---

## Done

All tasks complete. Verify at:
- http://localhost:3001/my-actions — pupil weekly planner
- http://localhost:3001/actions — teacher planner with sidebar + note editor + Q&A
