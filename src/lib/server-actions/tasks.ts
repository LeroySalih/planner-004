"use server";

import { query } from "@/lib/db";

export type PupilTask = {
  type: "resubmit" | "underperforming";
  lessonId: string;
  lessonTitle: string;
  unitTitle: string;
  subject: string | null;
  startDate: string | null;
  activityId?: string | null;
  activityTitle?: string | null;
  resubmitNote?: string | null;
  lessonScore?: number | null;
  lessonMaxScore?: number | null;
};

export type PupilTaskGroup = {
  subject: string;
  tasks: PupilTask[];
};

export async function readPupilTasksAction(userId: string): Promise<{
  data: PupilTaskGroup[] | null;
  error: string | null;
}> {
  if (!userId || userId.trim().length === 0) {
    return { data: null, error: "Missing user identifier." };
  }

  try {
    const normalizedUserId = userId.trim();

    // 1. Resubmit tasks: submissions with resubmit_requested = true
    const { rows: resubmitRows } = await query<{
      lesson_id: string;
      lesson_title: string;
      unit_title: string;
      subject: string | null;
      start_date: string | Date | null;
      activity_id: string;
      activity_title: string;
      resubmit_note: string | null;
    }>(
      `
      select distinct on (s.activity_id)
        a.lesson_id,
        coalesce(l.title, 'Untitled lesson') as lesson_title,
        coalesce(u.title, 'Untitled unit') as unit_title,
        g.subject,
        la.start_date,
        a.activity_id,
        coalesce(a.title, 'Activity') as activity_title,
        s.resubmit_note
      from submissions s
      join activities a on a.activity_id = s.activity_id
      join lessons l on l.lesson_id = a.lesson_id
      join units u on u.unit_id = l.unit_id
      join lesson_assignments la on la.lesson_id = l.lesson_id
      join group_membership gm on gm.group_id = la.group_id and gm.user_id = $1
      join groups g on g.group_id = la.group_id
      where s.user_id = $1
        and s.resubmit_requested = true
        and coalesce(l.active, true) = true
        and coalesce(a.active, true) = true
        and coalesce(g.active, true) = true
      order by s.activity_id, s.submitted_at desc
      `,
      [normalizedUserId],
    );

    // 2. Underperforming tasks: overdue lessons with < 80% score
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

    const { rows: underperformingRows } = await query<{
      lesson_id: string;
      lesson_title: string;
      unit_title: string;
      subject: string | null;
      start_date: string | Date | null;
      score: number;
      max_score: number;
    }>(
      `
      with pupil_lessons as (
        select
          la.lesson_id,
          coalesce(l.title, 'Untitled lesson') as lesson_title,
          coalesce(u.title, 'Untitled unit') as unit_title,
          g.subject,
          la.start_date
        from lesson_assignments la
        join lessons l on l.lesson_id = la.lesson_id
        join units u on u.unit_id = l.unit_id
        join group_membership gm on gm.group_id = la.group_id and gm.user_id = $1
        join groups g on g.group_id = la.group_id
        where coalesce(l.active, true) = true
          and coalesce(g.active, true) = true
          and la.start_date is not null
          and (la.start_date::date + interval '7 days') < now()
      ),
      scorable_activities as (
        select a.activity_id, a.lesson_id
        from activities a
        where a.lesson_id in (select lesson_id from pupil_lessons)
          and a.type = any($2::text[])
          and coalesce(a.active, true) = true
      ),
      latest_submissions as (
        select distinct on (s.activity_id)
          s.activity_id,
          coalesce(
            (s.body->>'teacher_override_score')::float,
            (s.body->>'ai_model_score')::float,
            (s.body->>'score')::float,
            case when (s.body->>'is_correct')::boolean is true then 1.0 else 0.0 end
          ) as score
        from submissions s
        join scorable_activities sa on sa.activity_id = s.activity_id
        where s.user_id = $1
        order by s.activity_id, s.submitted_at desc
      ),
      lesson_scores as (
        select
          sa.lesson_id,
          count(sa.activity_id)::int as max_score,
          coalesce(sum(ls.score), 0) as score
        from scorable_activities sa
        left join latest_submissions ls on ls.activity_id = sa.activity_id
        group by sa.lesson_id
        having count(sa.activity_id) > 0
      )
      select
        pl.lesson_id,
        pl.lesson_title,
        pl.unit_title,
        pl.subject,
        pl.start_date,
        ls.score,
        ls.max_score
      from pupil_lessons pl
      join lesson_scores ls on ls.lesson_id = pl.lesson_id
      where ls.max_score > 0
        and (ls.score / ls.max_score) < 0.8
      `,
      [normalizedUserId, scorableTypes],
    );

    // Combine into tasks grouped by subject
    const tasksBySubject = new Map<string, PupilTask[]>();

    for (const row of resubmitRows) {
      const subject = row.subject ?? "Subject not set";
      const tasks = tasksBySubject.get(subject) ?? [];
      tasks.push({
        type: "resubmit",
        lessonId: row.lesson_id,
        lessonTitle: row.lesson_title,
        unitTitle: row.unit_title,
        subject: row.subject,
        startDate: row.start_date instanceof Date
          ? row.start_date.toISOString()
          : typeof row.start_date === "string" ? row.start_date : null,
        activityId: row.activity_id,
        activityTitle: row.activity_title,
        resubmitNote: row.resubmit_note,
      });
      tasksBySubject.set(subject, tasks);
    }

    // Deduplicate underperforming: skip lessons already in resubmit
    const resubmitLessonIds = new Set(resubmitRows.map((r) => r.lesson_id));
    for (const row of underperformingRows) {
      if (resubmitLessonIds.has(row.lesson_id)) continue;
      const subject = row.subject ?? "Subject not set";
      const tasks = tasksBySubject.get(subject) ?? [];
      tasks.push({
        type: "underperforming",
        lessonId: row.lesson_id,
        lessonTitle: row.lesson_title,
        unitTitle: row.unit_title,
        subject: row.subject,
        startDate: row.start_date instanceof Date
          ? row.start_date.toISOString()
          : typeof row.start_date === "string" ? row.start_date : null,
        lessonScore: typeof row.score === "number"
          ? row.score
          : parseFloat(row.score as any),
        lessonMaxScore: typeof row.max_score === "number"
          ? row.max_score
          : parseInt(row.max_score as any, 10),
      });
      tasksBySubject.set(subject, tasks);
    }

    // Sort tasks within each subject by date descending
    const groups: PupilTaskGroup[] = Array.from(tasksBySubject.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subject, tasks]) => ({
        subject,
        tasks: tasks.sort((a, b) => {
          const dateA = a.startDate ? Date.parse(a.startDate) : 0;
          const dateB = b.startDate ? Date.parse(b.startDate) : 0;
          return dateB - dateA;
        }),
      }));

    return { data: groups, error: null };
  } catch (error) {
    console.error("[tasks] Failed to load pupil tasks:", error);
    return { data: null, error: "Unable to load tasks." };
  }
}
