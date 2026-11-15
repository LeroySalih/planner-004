import "server-only"

import type { PoolClient } from "pg"

import { query, withDbClient } from "@/lib/db"
import { isQuestionMarkedActivityType } from "@/dino.config"

// A pupil flags one question of a question-marked activity for their teacher
// to check (migration 144). Each flag is a row that ends one of two ways: the
// pupil withdraws it, or a teacher resolves it. The question's marks are
// snapshotted at both ends, so whether the teacher changed the mark is read
// from the snapshots (flagOutcome) rather than stored.
//
// submissions.is_flagged is kept equal to "has an open question flag" after
// every change here, so the results grid's flag icon and Clear flag work for
// these activities as for any other.

export type QuestionFlagOutcome = "changed" | "unchanged" | "withdrawn"

type MarkSnapshot = Array<{ success_criteria_id: string; awarded: number }>

export type QuestionFlagHistoryEntry = {
  flagId: string
  flaggedAt: string
  /** Null unless the pupil withdrew it. */
  withdrawnAt: string | null
  /** Null unless a teacher resolved it. */
  resolvedAt: string | null
  /** The question's mark when it was flagged; null if it had none. */
  awardedAtFlag: number | null
  /** The question's mark when a teacher resolved it; null if withdrawn. */
  awardedAtResolve: number | null
  outcome: QuestionFlagOutcome
}

export type QuestionFlagState = {
  open: { flagId: string; flaggedAt: string; awardedAtFlag: number | null } | null
  /** Flags that have ended, newest first. */
  history: QuestionFlagHistoryEntry[]
}

/** What the submission row looks like after a flag change, for the submission.updated event. */
export type FlaggedSubmission = {
  submissionId: string
  activityId: string
  pupilId: string
  submittedAt: string | null
  body: unknown
  isFlagged: boolean
}

/**
 * Whether a resolved flag's question was re-marked: any criterion's mark, or
 * the question's, differs between the snapshot at flag time and at resolve.
 */
export function flagOutcome(row: {
  withdrawn_at: Date | string | null
  awarded_at_flag: number | null
  awarded_at_resolve: number | null
  marks_at_flag: MarkSnapshot | null
  marks_at_resolve: MarkSnapshot | null
}): QuestionFlagOutcome {
  if (row.withdrawn_at) return "withdrawn"
  if ((row.awarded_at_flag ?? null) !== (row.awarded_at_resolve ?? null)) return "changed"
  const before = new Map((row.marks_at_flag ?? []).map((m) => [m.success_criteria_id, Number(m.awarded)]))
  const after = new Map((row.marks_at_resolve ?? []).map((m) => [m.success_criteria_id, Number(m.awarded)]))
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(id) !== after.get(id)) return "changed"
  }
  return "unchanged"
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      const result = await fn(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })
}

/** Lock the submission row, so a flag and a mark change on it take turns. */
async function lockSubmission(client: PoolClient, submissionId: string): Promise<void> {
  const { rows } = await client.query<{ type: string | null }>(
    `select a.type from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1
      for update of s`,
    [submissionId],
  )
  if (!rows[0]) throw new Error("Submission not found.")
  if (!isQuestionMarkedActivityType(rows[0].type)) throw new Error("This activity has no questions to flag.")
}

/** The question's mark and its criteria's marks as they stand. */
async function snapshotMarks(
  client: PoolClient,
  submissionId: string,
  questionId: string,
): Promise<{ awarded: number | null; marks: MarkSnapshot }> {
  const { rows } = await client.query<{ awarded: number | null; marks: MarkSnapshot }>(
    `select (select awarded from submission_question_marks
              where submission_id = $1 and question_id = $2) as awarded,
            coalesce((select jsonb_agg(jsonb_build_object('success_criteria_id', success_criteria_id, 'awarded', awarded)
                                       order by success_criteria_id)
                        from submission_question_criterion_marks
                       where submission_id = $1 and question_id = $2), '[]'::jsonb) as marks`,
    [submissionId, questionId],
  )
  return { awarded: rows[0]?.awarded ?? null, marks: rows[0]?.marks ?? [] }
}

/** is_flagged = the submission has an open question flag. */
async function syncIsFlagged(client: PoolClient, submissionId: string): Promise<FlaggedSubmission> {
  const { rows } = await client.query<{
    activity_id: string
    user_id: string
    submitted_at: Date | null
    body: unknown
    is_flagged: boolean
  }>(
    `update submissions s
        set is_flagged = exists (select 1 from submission_question_flags f
                                  where f.submission_id = s.submission_id
                                    and f.withdrawn_at is null and f.resolved_at is null)
      where s.submission_id = $1
      returning s.activity_id, s.user_id, s.submitted_at, s.body, s.is_flagged`,
    [submissionId],
  )
  const row = rows[0]
  return {
    submissionId,
    activityId: row.activity_id,
    pupilId: row.user_id,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    body: row.body,
    isFlagged: row.is_flagged,
  }
}

/**
 * The pupil flags a question: its marks are snapshotted and an open flag is
 * recorded (a second flag while one is open changes nothing).
 */
export async function flagAssessmentQuestion(
  submissionId: string,
  questionId: string,
  pupilId: string,
): Promise<FlaggedSubmission> {
  return inTransaction(async (client) => {
    await lockSubmission(client, submissionId)
    const snapshot = await snapshotMarks(client, submissionId, questionId)
    await client.query(
      `insert into submission_question_flags (submission_id, question_id, pupil_id, awarded_at_flag, marks_at_flag)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (submission_id, question_id) where withdrawn_at is null and resolved_at is null do nothing`,
      [submissionId, questionId, pupilId, snapshot.awarded, JSON.stringify(snapshot.marks)],
    )
    return syncIsFlagged(client, submissionId)
  })
}

/** The pupil takes back their open flag on a question before a teacher has dealt with it. */
export async function withdrawAssessmentQuestionFlag(submissionId: string, questionId: string): Promise<FlaggedSubmission> {
  return inTransaction(async (client) => {
    await lockSubmission(client, submissionId)
    await client.query(
      `update submission_question_flags set withdrawn_at = timezone('utc', now())
        where submission_id = $1 and question_id = $2 and withdrawn_at is null and resolved_at is null`,
      [submissionId, questionId],
    )
    return syncIsFlagged(client, submissionId)
  })
}

/**
 * A teacher deals with the open flag on one question, or (no `questionId`)
 * every open flag on the submission. Each question's marks are snapshotted
 * as they now stand.
 */
export async function resolveAssessmentQuestionFlags(
  submissionId: string,
  teacherId: string,
  questionId?: string | null,
): Promise<FlaggedSubmission & { resolved: number }> {
  return inTransaction(async (client) => {
    await lockSubmission(client, submissionId)
    const { rows: open } = await client.query<{ flag_id: string; question_id: string }>(
      `select flag_id, question_id from submission_question_flags
        where submission_id = $1 and ($2::uuid is null or question_id = $2)
          and withdrawn_at is null and resolved_at is null`,
      [submissionId, questionId ?? null],
    )
    for (const flag of open) {
      const snapshot = await snapshotMarks(client, submissionId, flag.question_id)
      await client.query(
        `update submission_question_flags
            set resolved_at = timezone('utc', now()), resolved_by = $2,
                awarded_at_resolve = $3, marks_at_resolve = $4::jsonb
          where flag_id = $1`,
        [flag.flag_id, teacherId, snapshot.awarded, JSON.stringify(snapshot.marks)],
      )
    }
    return { ...(await syncIsFlagged(client, submissionId)), resolved: open.length }
  })
}

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null)

/** Each flagged question on a submission: its open flag and the flags that have ended. */
export async function readQuestionFlags(submissionId: string | null): Promise<Map<string, QuestionFlagState>> {
  const flags = new Map<string, QuestionFlagState>()
  if (!submissionId) return flags
  const { rows } = await query<{
    flag_id: string
    question_id: string
    flagged_at: Date
    withdrawn_at: Date | null
    resolved_at: Date | null
    awarded_at_flag: number | null
    awarded_at_resolve: number | null
    marks_at_flag: MarkSnapshot | null
    marks_at_resolve: MarkSnapshot | null
  }>(
    `select flag_id, question_id, flagged_at, withdrawn_at, resolved_at, awarded_at_flag, awarded_at_resolve,
            marks_at_flag, marks_at_resolve
       from submission_question_flags
      where submission_id = $1
      order by flagged_at desc, flag_id desc`,
    [submissionId],
  )
  for (const row of rows) {
    const state = flags.get(row.question_id) ?? { open: null, history: [] }
    const awardedAtFlag = row.awarded_at_flag === null ? null : Number(row.awarded_at_flag)
    if (!row.withdrawn_at && !row.resolved_at) {
      state.open = { flagId: row.flag_id, flaggedAt: iso(row.flagged_at)!, awardedAtFlag }
    } else {
      state.history.push({
        flagId: row.flag_id,
        flaggedAt: iso(row.flagged_at)!,
        withdrawnAt: iso(row.withdrawn_at),
        resolvedAt: iso(row.resolved_at),
        awardedAtFlag,
        awardedAtResolve: row.awarded_at_resolve === null ? null : Number(row.awarded_at_resolve),
        outcome: flagOutcome(row),
      })
    }
    flags.set(row.question_id, state)
  }
  return flags
}

/**
 * What a pupil sees of a question's flags: whether one is open, and when the
 * latest flag was dealt with by a teacher, whether the mark changed. Never
 * who resolved it.
 */
export function pupilQuestionFlag(state: QuestionFlagState | undefined): {
  open: boolean
  lastOutcome: "changed" | "unchanged" | null
} {
  const last = state?.history[0]
  return {
    open: Boolean(state?.open),
    lastOutcome: !state?.open && last && last.outcome !== "withdrawn" ? last.outcome : null,
  }
}
