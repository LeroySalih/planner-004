import "server-only"

import { query } from "@/lib/db"
import { isAssessmentPaperType, isPracticalAssessmentType } from "@/dino.config"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { markingAssignmentIdFor } from "@/lib/assessment-paper/files"
import { clearForReread, listQuestionsToRemark, remarkAssessmentQuestions, type RemarkCandidate } from "@/lib/assessment-paper/store"
import { RESEND_FAILED_MESSAGE, practicalAssignmentIdFor } from "@/lib/powerpoint-assessment/files"

// remark_assessment_activity: read the pupils' work again and mark it again
// from the start, on an assessment paper or a practical (PowerPoint or
// database) assessment. A re-read is what picks up a new reader (the cache
// key of a practical file's evidence carries the reader's version), and the
// read then queues one mark per question as on hand-in (completeAssessmentRead):
// teacher-only, blank, held and fully teacher-marked questions are not sent.
// A teacher's own marks, comments and (assessment paper) edited
// transcriptions are kept. Pupils' open question flags are left as they are.
//
// With `questions` (labels) only those questions change:
//   practical  the files are read again (a new reader takes effect only on a
//              read), but the clear, the stored answers, the blank zeros and
//              the mark jobs are those questions' only: the read job's
//              payload carries their ids (completeAssessmentRead).
//   paper      the script is NOT read again: a paper's read is one model call
//              over every page and would redo every question's transcription.
//              The questions are marked again from the stored transcriptions
//              (remarkAssessmentQuestions, as after a mark scheme change).

/** What remark_assessment_activity did, or (dry run) would do. Pupil ids only, never names. */
export type ActivityRemark = {
  activity_id: string
  type: string
  dry_run: boolean
  /** The labels re-marked, in paper order, or null for every question. */
  questions: string[] | null
  /** Latest submissions cleared and sent to be read (or, paper with `questions`, marked) again (dry run: that would be). */
  queued: number
  queued_pupil_ids: string[]
  /**
   * Paper with `questions`: per queued pupil, the named questions' mark jobs
   * queued, already waiting (they will use the current mark scheme) and
   * marked in full by a teacher (left). Empty otherwise: a practical read
   * queues its marks when it completes.
   */
  question_marks: Array<{ pupil_id: string; queued: number; already_queued: number; teacher_marked: number }>
  /** The sum of question_marks' queued. */
  question_marks_queued: number
  skipped: {
    /** Practical: not handed in. */
    not_handed_in: string[]
    /** Assessment paper: the newest script did not pass the front sheet check, or there is none. */
    no_passed_script: string[]
    /** A read is already waiting or running: it reads the files as they are now. */
    already_reading: string[]
    /** Every question the marker marks (with `questions`: every named one) is marked in full by a teacher. */
    nothing_to_remark: string[]
    /** A pupil asked for by id has no submission on the activity. */
    no_submission: string[]
    /** Paper with `questions`: the script's read has not completed, so there is no transcription to mark. */
    not_read: string[]
    /** Paper with `questions`: every named question is answered blank (0 with no model call), or a teacher marked the rest. */
    blank_answers: string[]
    /** Paper with `questions`: every named question still to mark has a mark job waiting already. */
    already_queued: string[]
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
async function readLatestSubmissions(
  activityId: string,
  pupilIds: string[] | null,
  questionIds: string[] | null,
): Promise<LatestRow[]> {
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
                           and ($3::text[] is null or q.question_id::text = any($3::text[]))
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
    [activityId, pupilIds, questionIds],
  )
  return rows
}

type NamedQuestion = { question_id: string; label: string }

/**
 * The questions `given` names (a label, any case and spacing, or a
 * question_id), duplicates dropped, in paper order. Refused, naming them,
 * when any is not on the activity, is marked by the teacher only, or has no
 * mark scheme text: nothing is written.
 */
async function resolveQuestions(activityId: string, given: string[]): Promise<NamedQuestion[]> {
  const { rows } = await query<NamedQuestion & { marking: string; has_scheme: boolean }>(
    `select question_id::text as question_id, label, marking,
            nullif(btrim(coalesce(mark_scheme, '')), '') is not null as has_scheme
       from activity_questions where activity_id = $1
      order by position, label`,
    [activityId],
  )
  const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase()
  const unknown: string[] = []
  const named = new Set<string>()
  for (const raw of given) {
    const text = raw.trim()
    const question = rows.find((q) => q.question_id === text) ?? rows.find((q) => key(q.label) === key(text))
    if (question) named.add(question.question_id)
    else unknown.push(raw)
  }
  if (unknown.length > 0) {
    throw new Error(
      `No question ${unknown.map((label) => `"${label}"`).join(", ")} on this activity. Its questions are: ${rows.map((q) => q.label).join(", ") || "none"}.`,
    )
  }
  const chosen = rows.filter((q) => named.has(q.question_id))
  const teacherOnly = chosen.filter((q) => q.marking === "teacher")
  if (teacherOnly.length > 0) {
    throw new Error(
      `Question${teacherOnly.length === 1 ? "" : "s"} ${teacherOnly.map((q) => q.label).join(", ")} ${teacherOnly.length === 1 ? "is" : "are"} marked by the teacher only: the AI does not mark ${teacherOnly.length === 1 ? "it" : "them"}. Leave ${teacherOnly.length === 1 ? "it" : "them"} out.`,
    )
  }
  const noScheme = chosen.filter((q) => !q.has_scheme)
  if (noScheme.length > 0) {
    throw new Error(
      `Question${noScheme.length === 1 ? "" : "s"} ${noScheme.map((q) => q.label).join(", ")} ${noScheme.length === 1 ? "has" : "have"} no mark scheme text, so ${noScheme.length === 1 ? "it" : "they"} cannot be marked. Add it first (set_assessment_activity_questions).`,
    )
  }
  return chosen.map(({ question_id, label }) => ({ question_id, label }))
}

/** Latest submissions with an answer row (the read completed) on any of `questionIds`. */
async function submissionsWithAnswers(submissionIds: string[], questionIds: string[]): Promise<Set<string>> {
  if (submissionIds.length === 0) return new Set()
  const { rows } = await query<{ submission_id: string }>(
    `select distinct submission_id from submission_question_answers
      where submission_id = any($1::text[]) and question_id::text = any($2::text[])`,
    [submissionIds, questionIds],
  )
  return new Set(rows.map((row) => row.submission_id))
}

/**
 * Read and mark again every pupil's latest submission on a question-marked
 * activity (or only `pupilIds`'), as described above. Refused for any other
 * activity type and for a paper folded in from the old assessments module,
 * which keeps its marks. Per submission, under its row lock (clearForReread):
 * open read and mark jobs dropped, the marker's work cleared; then the read
 * is queued (enqueueMarkingTasks). One pupil's queue failure is recorded on
 * their submission and reported, not thrown. `dryRun` changes nothing.
 * `questions` limits it to those questions (resolveQuestions refuses a bad
 * list before anything is read or written): a practical read limited to them,
 * or (paper) remarkPaperQuestions, with no read.
 */
export async function remarkAssessmentActivity(input: {
  activityId: string
  pupilIds?: string[] | null
  /** Only these questions (labels or ids); see the top of this file. Omitted or empty: every question. */
  questions?: string[] | null
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

  const named = input.questions && input.questions.length > 0 ? await resolveQuestions(activityId, input.questions) : null
  const questionIds = named ? named.map((q) => q.question_id) : null
  const pupilIds = input.pupilIds && input.pupilIds.length > 0 ? [...new Set(input.pupilIds)] : null
  const latest = await readLatestSubmissions(activityId, pupilIds, questionIds)
  const result: ActivityRemark = {
    activity_id: activityId,
    type: activity.type as string,
    dry_run: dryRun,
    questions: named ? named.map((q) => q.label) : null,
    queued: 0,
    queued_pupil_ids: [],
    question_marks: [],
    question_marks_queued: 0,
    skipped: {
      not_handed_in: [],
      no_passed_script: [],
      already_reading: [],
      nothing_to_remark: [],
      no_submission: [],
      not_read: [],
      blank_answers: [],
      already_queued: [],
    },
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

  if (!practical && questionIds) {
    await remarkPaperQuestions(result, activityId, eligible, questionIds, dryRun)
    if (!dryRun && result.question_marks_queued > 0) void triggerQueueProcessor()
    return result
  }

  if (dryRun) {
    result.queued_pupil_ids = eligible.map((row) => row.user_id)
    result.queued = eligible.length
    return result
  }

  for (const row of eligible) {
    const refusal = await clearForReread({
      activityId,
      submissionId: row.submission_id,
      ...(questionIds ? { questionIds } : {}),
    })
    if (refusal) {
      result.skipped[refusal].push(row.user_id)
      continue
    }
    try {
      const assignmentId = practical
        ? await practicalAssignmentIdFor(activityId, row.user_id)
        : await markingAssignmentIdFor(activityId, row.user_id)
      await enqueueMarkingTasks(assignmentId, [{ submissionId: row.submission_id }], questionIds ? { questionIds } : undefined)
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

/**
 * An assessment paper with `questions`: no re-read. Per eligible pupil, the
 * named questions that can be marked (selectRemarkCandidates: the read
 * completed, the answer not blank) are marked again from the stored
 * transcription (remarkAssessmentQuestions, under the submission's lock): the
 * marker's and legacy rows go, a teacher's rows and comments and the
 * transcription stay, a waiting job is left and a running one replaced.
 */
async function remarkPaperQuestions(
  result: ActivityRemark,
  activityId: string,
  eligible: LatestRow[],
  questionIds: string[],
  dryRun: boolean,
): Promise<void> {
  const answered = await submissionsWithAnswers(eligible.map((row) => row.submission_id), questionIds)
  const candidates = new Map<string, RemarkCandidate[]>()
  for (const candidate of await listQuestionsToRemark(activityId, questionIds)) {
    candidates.set(candidate.submissionId, [...(candidates.get(candidate.submissionId) ?? []), candidate])
  }

  for (const row of eligible) {
    if (!answered.has(row.submission_id)) {
      result.skipped.not_read.push(row.user_id)
      continue
    }
    let counts: { queued: number; already_queued: number; teacher_marked: number }
    if (dryRun) {
      const mine = candidates.get(row.submission_id) ?? []
      counts = {
        queued: mine.filter((c) => !c.teacherMarked && !c.pending).length,
        already_queued: mine.filter((c) => !c.teacherMarked && c.pending).length,
        teacher_marked: mine.filter((c) => c.teacherMarked).length,
      }
    } else {
      try {
        const remarked = await remarkAssessmentQuestions({
          activityId,
          submissionId: row.submission_id,
          assignmentId: await markingAssignmentIdFor(activityId, row.user_id),
          questionIds,
        })
        counts = {
          queued: remarked.queued.length,
          already_queued: remarked.alreadyQueued.length,
          teacher_marked: remarked.teacherMarked.length,
        }
      } catch (error) {
        // One transaction: nothing of this pupil's changed.
        console.error("[remark-activity] failed to send questions for marking", { submissionId: row.submission_id, error })
        result.failed.push({ pupil_id: row.user_id, error: error instanceof Error ? error.message : String(error) })
        continue
      }
    }
    if (counts.queued > 0) {
      result.queued_pupil_ids.push(row.user_id)
      result.question_marks.push({ pupil_id: row.user_id, ...counts })
      result.question_marks_queued += counts.queued
    } else if (counts.already_queued > 0) {
      result.skipped.already_queued.push(row.user_id)
    } else if (counts.teacher_marked > 0) {
      result.skipped.nothing_to_remark.push(row.user_id)
    } else {
      result.skipped.blank_answers.push(row.user_id)
    }
  }
  result.queued = result.queued_pupil_ids.length
}

/** One line for the tool's text result. */
export function describeActivityRemark(r: ActivityRemark): string {
  const skipped = [
    [r.skipped.not_handed_in.length, "not handed in"],
    [r.skipped.no_passed_script.length, "no passed script"],
    [r.skipped.already_reading.length, "already being read"],
    [r.skipped.nothing_to_remark.length, "marked in full by a teacher"],
    [r.skipped.no_submission.length, "no submission"],
    [r.skipped.not_read.length, "not read yet"],
    [r.skipped.blank_answers.length, "blank answers only"],
    [r.skipped.already_queued.length, "marks already waiting"],
  ] as const
  const skippedText = skipped.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`).join(", ")
  const pupils = `${r.queued} pupil${r.queued === 1 ? "" : "s"}`
  let action: string
  if (!r.questions) {
    action = r.dry_run ? `Dry run, nothing changed: would read and mark again ${pupils}.` : `Reading and marking again ${pupils}.`
  } else {
    const labels = r.questions.join(", ")
    const marks = `${r.question_marks_queued} question mark${r.question_marks_queued === 1 ? "" : "s"}`
    action = r.type === "assessment-paper"
      ? (r.dry_run ? `Dry run, nothing changed: would mark ${labels} again for ${pupils}` : `Marking ${labels} again for ${pupils}`)
        + ` from the stored transcriptions, not read again (${marks}).`
      : (r.dry_run ? `Dry run, nothing changed: would read again and mark ${labels} again for ${pupils}.` : `Reading again and marking ${labels} again for ${pupils}.`)
        + " Other questions are not changed."
  }
  return action
    + (skippedText ? ` Skipped: ${skippedText}.` : "")
    + (r.held.length > 0 ? ` Held: ${r.held.length}.` : "")
    + (r.failed.length > 0 ? ` Failed: ${r.failed.length}.` : "")
}
