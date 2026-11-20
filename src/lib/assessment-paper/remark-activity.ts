import "server-only"

import { query } from "@/lib/db"
import { isAssessmentPaperType, isPracticalAssessmentType } from "@/dino.config"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { markingAssignmentIdFor } from "@/lib/assessment-paper/files"
import { clearForReread } from "@/lib/assessment-paper/store"
import { RESEND_FAILED_MESSAGE, practicalAssignmentIdFor } from "@/lib/powerpoint-assessment/files"

// remark_assessment_activity: read the pupils' work again and mark it again
// from the start, on an assessment paper or a practical (PowerPoint or
// database) assessment. A re-read is what picks up a new reader (the cache
// key of a practical file's evidence carries the reader's version), and the
// read then queues one mark per question as on hand-in (completeAssessmentRead):
// teacher-only, blank, held and fully teacher-marked questions are not sent.
// A teacher's own marks, comments and (assessment paper) edited
// transcriptions are kept. Pupils' open question flags are left as they are.

/** What remark_assessment_activity did, or (dry run) would do. Pupil ids only, never names. */
export type ActivityRemark = {
  activity_id: string
  type: string
  dry_run: boolean
  /** Latest submissions cleared and sent to be read again (dry run: that would be). */
  queued: number
  queued_pupil_ids: string[]
  skipped: {
    /** Practical: not handed in. */
    not_handed_in: string[]
    /** Assessment paper: the newest script did not pass the front sheet check, or there is none. */
    no_passed_script: string[]
    /** A read is already waiting or running: it reads the files as they are now. */
    already_reading: string[]
    /** Every question the marker marks is marked in full by a teacher. */
    nothing_to_remark: string[]
    /** A pupil asked for by id has no submission on the activity. */
    no_submission: string[]
  }
  /** Sent, but the queue held the work (a required file missing, say): its marks are cleared. */
  held: Array<{ pupil_id: string; reason: string }>
  /** Could not be sent; recorded on the submission for the teacher. */
  failed: Array<{ pupil_id: string; error: string }>
}

type LatestRow = {
  submission_id: string
  user_id: string
  submission_status: string | null
  front_sheet_check: string | null
  has_pages: boolean
  reading: boolean
  teacher_marked: boolean
}

/**
 * Every pupil's latest submission on the activity, with what decides whether
 * it is read again: handed in (practical), the newest script's front sheet
 * check (paper), an open read job, and whether every question the marker
 * marks (not teacher-only) has every criterion marked by a teacher.
 */
async function readLatestSubmissions(activityId: string, pupilIds: string[] | null): Promise<LatestRow[]> {
  const { rows } = await query<LatestRow>(
    `with latest as (
       select distinct on (s.user_id) s.submission_id, s.user_id, s.submission_status
         from submissions s
        where s.activity_id = $1 and ($2::text[] is null or s.user_id = any($2::text[]))
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select l.submission_id, l.user_id, l.submission_status,
            script.front_sheet_check,
            coalesce(cardinality(script.page_paths), 0) > 0 as has_pages,
            exists (select 1 from external_jobs j
                     where j.job_type = 'ai_read' and j.status in ('pending', 'processing')
                       and j.payload->>'submissionId' = l.submission_id) as reading,
            not exists (select 1 from activity_questions q
                          join activity_question_criteria c on c.question_id = q.question_id
                         where q.activity_id = $1 and q.marking <> 'teacher'
                           and not exists (select 1 from submission_question_criterion_marks m
                                            where m.submission_id = l.submission_id
                                              and m.question_id = c.question_id
                                              and m.success_criteria_id = c.success_criteria_id
                                              and m.provenance = 'teacher')) as teacher_marked
       from latest l
       left join lateral (
         select sc.front_sheet_check, sc.page_paths from assessment_scripts sc
          where sc.submission_id = l.submission_id
          order by sc.uploaded_at desc, sc.script_id desc
          limit 1
       ) script on true
      order by l.user_id`,
    [activityId, pupilIds],
  )
  return rows
}

/**
 * Read and mark again every pupil's latest submission on a question-marked
 * activity (or only `pupilIds`'), as described above. Refused for any other
 * activity type and for a paper folded in from the old assessments module,
 * which keeps its marks. Per submission, under its row lock (clearForReread):
 * open read and mark jobs dropped, the marker's work cleared; then the read
 * is queued (enqueueMarkingTasks). One pupil's queue failure is recorded on
 * their submission and reported, not thrown. `dryRun` changes nothing.
 */
export async function remarkAssessmentActivity(input: {
  activityId: string
  pupilIds?: string[] | null
  dryRun?: boolean
}): Promise<ActivityRemark> {
  const { activityId } = input
  const dryRun = input.dryRun ?? false
  const { rows: activityRows } = await query<{ type: string | null; folded: boolean }>(
    `select type, coalesce(body_data::jsonb ? 'foldedFromAssessmentIds', false) as folded
       from activities where activity_id = $1`,
    [activityId],
  )
  const activity = activityRows[0]
  if (!activity) throw new Error(`Activity ${activityId} not found.`)
  const practical = isPracticalAssessmentType(activity.type)
  if (!practical && !isAssessmentPaperType(activity.type)) {
    throw new Error(
      `Activity ${activityId} is a ${activity.type ?? "untyped activity"}: only an assessment paper, PowerPoint assessment or database assessment can be re-marked here.`,
    )
  }
  if (activity.folded) {
    throw new Error("This paper was folded in from the old assessments module and keeps its marks: it cannot be re-marked.")
  }

  const pupilIds = input.pupilIds && input.pupilIds.length > 0 ? [...new Set(input.pupilIds)] : null
  const latest = await readLatestSubmissions(activityId, pupilIds)
  const result: ActivityRemark = {
    activity_id: activityId,
    type: activity.type as string,
    dry_run: dryRun,
    queued: 0,
    queued_pupil_ids: [],
    skipped: { not_handed_in: [], no_passed_script: [], already_reading: [], nothing_to_remark: [], no_submission: [] },
    held: [],
    failed: [],
  }
  const found = new Set(latest.map((row) => row.user_id))
  result.skipped.no_submission = (pupilIds ?? []).filter((id) => !found.has(id))

  const eligible: LatestRow[] = []
  for (const row of latest) {
    if (practical && row.submission_status !== "submitted") result.skipped.not_handed_in.push(row.user_id)
    else if (!practical && !(row.front_sheet_check === "passed" && row.has_pages)) result.skipped.no_passed_script.push(row.user_id)
    else if (row.reading) result.skipped.already_reading.push(row.user_id)
    else if (row.teacher_marked) result.skipped.nothing_to_remark.push(row.user_id)
    else eligible.push(row)
  }

  if (dryRun) {
    result.queued_pupil_ids = eligible.map((row) => row.user_id)
    result.queued = eligible.length
    return result
  }

  for (const row of eligible) {
    const refusal = await clearForReread({ activityId, submissionId: row.submission_id })
    if (refusal) {
      result.skipped[refusal].push(row.user_id)
      continue
    }
    try {
      const assignmentId = practical
        ? await practicalAssignmentIdFor(activityId, row.user_id)
        : await markingAssignmentIdFor(activityId, row.user_id)
      await enqueueMarkingTasks(assignmentId, [{ submissionId: row.submission_id }])
    } catch (error) {
      console.error("[remark-activity] failed to send for marking", { submissionId: row.submission_id, error })
      await query("update submissions set mark_status = null, mark_error = $2 where submission_id = $1", [
        row.submission_id,
        RESEND_FAILED_MESSAGE,
      ]).catch((recordError) => console.error("[remark-activity] failed to record the send failure", recordError))
      result.failed.push({ pupil_id: row.user_id, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    const { rows } = await query<{ mark_status: string | null; mark_error: string | null }>(
      "select mark_status, mark_error from submissions where submission_id = $1",
      [row.submission_id],
    )
    if (rows[0]?.mark_status === "waiting") {
      result.queued_pupil_ids.push(row.user_id)
    } else {
      result.held.push({ pupil_id: row.user_id, reason: rows[0]?.mark_error?.trim() || "Not sent for marking." })
    }
  }
  result.queued = result.queued_pupil_ids.length
  if (result.queued > 0) void triggerQueueProcessor()
  return result
}

/** One line for the tool's text result. */
export function describeActivityRemark(r: ActivityRemark): string {
  const skipped = [
    [r.skipped.not_handed_in.length, "not handed in"],
    [r.skipped.no_passed_script.length, "no passed script"],
    [r.skipped.already_reading.length, "already being read"],
    [r.skipped.nothing_to_remark.length, "marked in full by a teacher"],
    [r.skipped.no_submission.length, "no submission"],
  ] as const
  const skippedText = skipped.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`).join(", ")
  const pupils = `${r.queued} pupil${r.queued === 1 ? "" : "s"}`
  return (r.dry_run ? `Dry run, nothing changed: would read and mark again ${pupils}.` : `Reading and marking again ${pupils}.`)
    + (skippedText ? ` Skipped: ${skippedText}.` : "")
    + (r.held.length > 0 ? ` Held: ${r.held.length}.` : "")
    + (r.failed.length > 0 ? ` Failed: ${r.failed.length}.` : "")
}
