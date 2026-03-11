"use server";

import { query } from "@/lib/db";
import { requireAuthenticatedProfile, requireRole } from "@/lib/auth";
import { withTelemetry } from "@/lib/telemetry";
import { WeeklyPlanGroup } from "@/types";

// ─── Row shapes ───────────────────────────────────────────────────────────────

type GroupRow = { group_id: string; group_name: string };

type LessonRow = { lesson_id: string; title: string; unit_title: string | null; start_date: string };

type NoteRow = {
  id: string;
  group_id: string;
  week_start_date: string;
  content: string;
  created_by: string;
  created_at: string;
};

type ActivityRow = {
  activity_id: string;
  title: string;
  activity_type: string;
  order_by: number;
};

type QuestionRow = {
  id: string;
  lesson_id: string;
  activity_id: string | null;
  user_id: string;
  display_name: string;
  content: string;
  created_at: string;
};

type ReplyRow = {
  id: string;
  question_id: string;
  user_id: string;
  display_name: string;
  content: string;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weekEndStr(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

async function fetchActivitiesWithQA(lessonId: string) {
  const activitiesResult = await query<ActivityRow>(
    `SELECT activity_id, title, type AS activity_type, order_by
     FROM activities
     WHERE lesson_id = $1 AND (active IS NULL OR active = true)
     ORDER BY order_by`,
    [lessonId],
  );

  const activities = [];
  for (const activity of activitiesResult.rows) {
    const actQResult = await query<QuestionRow>(
      `SELECT wpq.id, wpq.lesson_id, wpq.activity_id, wpq.user_id,
              COALESCE(NULLIF(TRIM(CONCAT(pr.first_name, ' ', pr.last_name)), ''), wpq.user_id) AS display_name,
              wpq.content, wpq.created_at::text AS created_at
       FROM weekly_plan_questions wpq
       JOIN profiles pr ON pr.user_id = wpq.user_id
       WHERE wpq.activity_id = $1
       ORDER BY wpq.created_at`,
      [activity.activity_id],
    );

    const actQuestions = actQResult.rows;

    const actRepliesResult =
      actQuestions.length > 0
        ? await query<ReplyRow>(
            `SELECT wpr.id, wpr.question_id, wpr.user_id,
                    COALESCE(NULLIF(TRIM(CONCAT(pr.first_name, ' ', pr.last_name)), ''), wpr.user_id) AS display_name,
                    wpr.content, wpr.created_at::text AS created_at
             FROM weekly_plan_replies wpr
             JOIN profiles pr ON pr.user_id = wpr.user_id
             WHERE wpr.question_id = ANY($1::text[])
             ORDER BY wpr.created_at`,
            [actQuestions.map((q) => q.id)],
          )
        : { rows: [] as ReplyRow[] };

    activities.push({
      activity_id: activity.activity_id,
      title: activity.title,
      activity_type: activity.activity_type,
      order_by: activity.order_by,
      question_count: actQuestions.filter((q) =>
        !actRepliesResult.rows.some((r) => r.question_id === q.id)
      ).length,
      questions: actQuestions,
      replies: actRepliesResult.rows,
    });
  }

  return activities;
}

async function fetchLessonsWithQA(groupId: string, weekStart: string) {
  const end = weekEndStr(weekStart);

  const lessonsResult = await query<LessonRow>(
    `SELECT la.lesson_id, l.title, u.title AS unit_title, la.start_date::text AS start_date
     FROM lesson_assignments la
     JOIN lessons l ON l.lesson_id = la.lesson_id
     JOIN units u ON u.unit_id = l.unit_id
     WHERE la.group_id = $1
       AND la.start_date >= $2
       AND la.start_date <= $3
       AND l.active = true
     ORDER BY la.start_date`,
    [groupId, weekStart, end],
  );

  const lessons = [];
  for (const lesson of lessonsResult.rows) {
    const questionsResult = await query<QuestionRow>(
      `SELECT wpq.id, wpq.lesson_id, wpq.activity_id, wpq.user_id,
              COALESCE(NULLIF(TRIM(CONCAT(pr.first_name, ' ', pr.last_name)), ''), wpq.user_id) AS display_name,
              wpq.content, wpq.created_at::text AS created_at
       FROM weekly_plan_questions wpq
       JOIN profiles pr ON pr.user_id = wpq.user_id
       WHERE wpq.lesson_id = $1 AND wpq.activity_id IS NULL
       ORDER BY wpq.created_at`,
      [lesson.lesson_id],
    );

    const lessonQuestions = questionsResult.rows;

    const lessonRepliesResult =
      lessonQuestions.length > 0
        ? await query<ReplyRow>(
            `SELECT wpr.id, wpr.question_id, wpr.user_id,
                    COALESCE(NULLIF(TRIM(CONCAT(pr.first_name, ' ', pr.last_name)), ''), wpr.user_id) AS display_name,
                    wpr.content, wpr.created_at::text AS created_at
             FROM weekly_plan_replies wpr
             JOIN profiles pr ON pr.user_id = wpr.user_id
             WHERE wpr.question_id = ANY($1::text[])
             ORDER BY wpr.created_at`,
            [lessonQuestions.map((q) => q.id)],
          )
        : { rows: [] as ReplyRow[] };

    const activities = await fetchActivitiesWithQA(lesson.lesson_id);

    lessons.push({
      lesson_id: lesson.lesson_id,
      title: lesson.title,
      unit_title: lesson.unit_title,
      start_date: lesson.start_date,
      question_count: lessonQuestions.filter((q) =>
        !lessonRepliesResult.rows.some((r) => r.question_id === q.id)
      ).length,
      questions: lessonQuestions,
      replies: lessonRepliesResult.rows,
      activities,
      lesson_score: null,
      lesson_max_score: null,
      lesson_has_submission: false,
      lesson_has_score: false,
    });
  }

  return lessons;
}

// ─── Pupil: fetch groups + lessons + activities + Q&A for one week ─────────────

export async function readWeeklyPlannerPupilAction(
  weekStart: string,
): Promise<{ data: WeeklyPlanGroup[] | null; error: string | null }> {
  return withTelemetry(
    { routeTag: "weekly-planner", functionName: "readWeeklyPlannerPupilAction" },
    async () => {
      try {
        const profile = await requireAuthenticatedProfile();

        const groupsResult = await query<GroupRow>(
          `SELECT g.group_id, g.subject AS group_name
           FROM group_membership gm
           JOIN groups g ON g.group_id = gm.group_id
           WHERE gm.user_id = $1
           ORDER BY g.subject`,
          [profile.userId],
        );

        if (groupsResult.rows.length === 0) {
          return { data: [], error: null };
        }

        const groups: WeeklyPlanGroup[] = [];

        for (const group of groupsResult.rows) {
          const noteResult = await query<NoteRow>(
            `SELECT id, group_id, week_start_date::text AS week_start_date, content, created_by, created_at::text AS created_at
             FROM weekly_plan_notes
             WHERE group_id = $1 AND week_start_date = $2`,
            [group.group_id, weekStart],
          );

          const lessons = await fetchLessonsWithQA(group.group_id, weekStart);

          groups.push({
            group_id: group.group_id,
            group_name: group.group_name,
            note: noteResult.rows[0] ?? null,
            lessons,
          });
        }

        // Fetch lesson scores for all lessons in one query
        const allLessonIds = groups.flatMap((g) => g.lessons.map((l) => l.lesson_id));
        if (allLessonIds.length > 0) {
          const scorableTypes = [
            "multiple-choice-question",
            "short-text-question",
            "text-question",
            "long-text-question",
            "upload-file",
            "upload-url",
            "feedback",
            "sketch-render",
          ];
          const scoresResult = await query<{ lesson_id: string; score: number; max_score: number; has_submission: boolean; has_score: boolean }>(
            `WITH latest_submissions AS (
               SELECT DISTINCT ON (s.activity_id) s.activity_id,
                 compute_submission_base_score(s.body, a.type) AS score
               FROM submissions s
               JOIN activities a ON a.activity_id = s.activity_id
               WHERE s.user_id = $1
                 AND a.type = ANY($3::text[])
               ORDER BY s.activity_id, s.submitted_at DESC
             ),
             lesson_scores AS (
               SELECT a.lesson_id,
                 count(a.activity_id)::int AS max_score,
                 coalesce(sum(ls.score), 0) AS score,
                 bool_or(ls.activity_id IS NOT NULL) AS has_submission,
                 bool_or(ls.score IS NOT NULL) AS has_score
               FROM activities a
               LEFT JOIN latest_submissions ls ON ls.activity_id = a.activity_id
               WHERE a.lesson_id = ANY($2::text[])
                 AND a.type = ANY($3::text[])
                 AND (a.active IS NULL OR a.active = true)
               GROUP BY a.lesson_id
               HAVING count(a.activity_id) > 0
             )
             SELECT lesson_id, score, max_score, has_submission, has_score FROM lesson_scores`,
            [profile.userId, allLessonIds, scorableTypes],
          );
          const scoreMap = new Map(scoresResult.rows.map((r) => [r.lesson_id, r]));
          for (const group of groups) {
            for (const lesson of group.lessons) {
              const s = scoreMap.get(lesson.lesson_id);
              if (s) {
                lesson.lesson_max_score = s.max_score;
                lesson.lesson_has_submission = s.has_submission ?? false;
                lesson.lesson_has_score = s.has_score ?? false;
                if (s.has_score) {
                  lesson.lesson_score = s.score;
                }
              }
            }
          }
        }

        return { data: groups, error: null };
      } catch (err) {
        console.error("readWeeklyPlannerPupilAction", err);
        return { data: null, error: "Failed to load weekly planner" };
      }
    },
  );
}

// ─── Teacher: fetch one group's planner for one week ──────────────────────────

export async function readWeeklyPlannerTeacherAction(
  groupId: string,
  weekStart: string,
): Promise<{ data: WeeklyPlanGroup | null; error: string | null }> {
  return withTelemetry(
    { routeTag: "weekly-planner", functionName: "readWeeklyPlannerTeacherAction" },
    async () => {
      try {
        await requireRole("teacher");

        const groupResult = await query<GroupRow>(
          `SELECT group_id, subject AS group_name FROM groups WHERE group_id = $1`,
          [groupId],
        );
        if (groupResult.rows.length === 0) return { data: null, error: "Group not found" };
        const group = groupResult.rows[0];

        const noteResult = await query<NoteRow>(
          `SELECT id, group_id, week_start_date::text AS week_start_date, content, created_by, created_at::text AS created_at
           FROM weekly_plan_notes
           WHERE group_id = $1 AND week_start_date = $2`,
          [groupId, weekStart],
        );

        const lessons = await fetchLessonsWithQA(groupId, weekStart);

        return {
          data: {
            group_id: group.group_id,
            group_name: group.group_name,
            note: noteResult.rows[0] ?? null,
            lessons,
          },
          error: null,
        };
      } catch (err) {
        console.error("readWeeklyPlannerTeacherAction", err);
        return { data: null, error: "Failed to load teacher planner" };
      }
    },
  );
}

// ─── Teacher: fetch all groups ─────────────────────────────────────────────────

export async function readAllGroupsAction(): Promise<{ data: { group_id: string; subject: string }[] | null; error: string | null }> {
  return withTelemetry(
    { routeTag: "weekly-planner", functionName: "readAllGroupsAction" },
    async () => {
      try {
        await requireRole("teacher");
        const result = await query<{ group_id: string; subject: string }>(
          `SELECT group_id, subject FROM groups WHERE active = true ORDER BY subject, group_id`
        );
        return { data: result.rows, error: null };
      } catch (err) {
        console.error("readAllGroupsAction", err);
        return { data: null, error: "Failed to load groups" };
      }
    }
  );
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createWeeklyPlanNoteAction(
  groupId: string,
  weekStartDate: string,
  content: string,
): Promise<{ data: null; error: string | null }> {
  return withTelemetry(
    { routeTag: "weekly-planner", functionName: "createWeeklyPlanNoteAction" },
    async () => {
      try {
        const profile = await requireRole("teacher");

        await query(
          `INSERT INTO weekly_plan_notes (group_id, week_start_date, content, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (group_id, week_start_date) DO UPDATE SET content = EXCLUDED.content`,
          [groupId, weekStartDate, content, profile.userId],
        );

        return { data: null, error: null };
      } catch (err) {
        console.error("createWeeklyPlanNoteAction", err);
        return { data: null, error: "Failed to save note" };
      }
    },
  );
}

export async function deleteWeeklyPlanNoteAction(
  groupId: string,
  weekStartDate: string,
): Promise<{ data: null; error: string | null }> {
  return withTelemetry(
    { routeTag: "weekly-planner", functionName: "deleteWeeklyPlanNoteAction" },
    async () => {
      try {
        await requireRole("teacher");
        await query(
          `DELETE FROM weekly_plan_notes WHERE group_id = $1 AND week_start_date = $2`,
          [groupId, weekStartDate],
        );
        return { data: null, error: null };
      } catch (err) {
        console.error("deleteWeeklyPlanNoteAction", err);
        return { data: null, error: "Failed to delete note" };
      }
    },
  );
}

export async function createWeeklyPlanQuestionAction(
  lessonId: string,
  activityId: string | null,
  content: string,
): Promise<{ data: null; error: string | null }> {
  return withTelemetry(
    { routeTag: "weekly-planner", functionName: "createWeeklyPlanQuestionAction" },
    async () => {
      try {
        const profile = await requireAuthenticatedProfile();

        await query(
          `INSERT INTO weekly_plan_questions (lesson_id, activity_id, user_id, content)
           VALUES ($1, $2, $3, $4)`,
          [lessonId, activityId, profile.userId, content],
        );

        return { data: null, error: null };
      } catch (err) {
        console.error("createWeeklyPlanQuestionAction", err);
        return { data: null, error: "Failed to post question" };
      }
    },
  );
}

export async function createWeeklyPlanReplyAction(
  questionId: string,
  content: string,
): Promise<{ data: null; error: string | null }> {
  return withTelemetry(
    { routeTag: "weekly-planner", functionName: "createWeeklyPlanReplyAction" },
    async () => {
      try {
        const profile = await requireRole("teacher");

        await query(
          `INSERT INTO weekly_plan_replies (question_id, user_id, content)
           VALUES ($1, $2, $3)`,
          [questionId, profile.userId, content],
        );

        return { data: null, error: null };
      } catch (err) {
        console.error("createWeeklyPlanReplyAction", err);
        return { data: null, error: "Failed to post reply" };
      }
    },
  );
}
