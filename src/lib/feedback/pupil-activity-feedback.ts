import { z } from "zod"

import {
  PupilActivityFeedbackRowSchema,
  type FeedbackSource,
  type PupilActivityFeedbackRow,
} from "@/types"
import { query } from "@/lib/db"

const FeedbackRowArraySchema = z.array(PupilActivityFeedbackRowSchema)

export type FeedbackLookupKey = `${string}::${string}`

export type FeedbackLookupMap = Map<FeedbackLookupKey, PupilActivityFeedbackRow[]>

export async function fetchPupilActivityFeedbackMap(
  filters: { activityIds: string[]; pupilIds: string[] },
): Promise<{ data: FeedbackLookupMap; error: Error | null }> {
  const { activityIds, pupilIds } = filters
  const lookup: FeedbackLookupMap = new Map()

  if (activityIds.length === 0 || pupilIds.length === 0) {
    return { data: lookup, error: null }
  }

  try {
    const { rows } = await query(
      `
        select f.feedback_id,
               f.activity_id,
               f.pupil_id,
               f.submission_id,
               f.source,
               f.score,
               f.feedback_text,
               f.created_at,
               f.created_by
        from pupil_activity_feedback f
        -- Feedback belongs to an attempt: only comments on the pupil's latest
        -- attempt are current. Earlier attempts' comments stay for audit.
        -- Rows with no submission_id predate that link and are kept.
        left join lateral (
          select s.submission_id
            from submissions s
           where s.activity_id = f.activity_id and s.user_id = f.pupil_id
           order by s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
           limit 1
        ) latest on true
        where f.activity_id = any($1::text[])
          and f.pupil_id = any($2::text[])
          and (f.submission_id is null or latest.submission_id is null or f.submission_id = latest.submission_id)
        order by f.created_at desc
      `,
      [activityIds, pupilIds],
    )

    const parsed = FeedbackRowArraySchema.safeParse(rows ?? [])
    if (!parsed.success) {
      return { data: lookup, error: new Error(parsed.error.message) }
    }

    for (const row of parsed.data) {
      const key: FeedbackLookupKey = `${row.pupil_id}::${row.activity_id}`
      const existing = lookup.get(key) ?? []
      existing.push(row)
      lookup.set(key, existing)
    }
  } catch (error) {
    return { data: lookup, error: error instanceof Error ? error : new Error("Unable to load feedback.") }
  }

  return { data: lookup, error: null }
}

type InsertFeedbackEntryInput = {
  activityId: string
  pupilId: string
  submissionId?: string | null
  source: FeedbackSource
  score?: number | null
  feedbackText?: string | null
  createdBy?: string | null
}

export async function insertPupilActivityFeedbackEntry(input: InsertFeedbackEntryInput): Promise<boolean> {
  const { activityId, pupilId, submissionId, source, score, feedbackText, createdBy } = input

  const normalisedScore =
    typeof score === "number" && Number.isFinite(score) ? Math.min(Math.max(score, 0), 1) : null
  const text = typeof feedbackText === "string" ? feedbackText.trim() : null

  try {
    await query(
      `
        insert into pupil_activity_feedback (
          activity_id, pupil_id, submission_id, source, score, feedback_text, created_by
        ) values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        activityId,
        pupilId,
        submissionId ?? null,
        source,
        normalisedScore,
        text && text.length > 0 ? text : null,
        createdBy ?? null,
      ],
    )
    return true
  } catch (error) {
    console.error("[feedback] Failed to insert pupil activity feedback entry:", error, {
      activityId,
      pupilId,
      source,
    })
    return false
  }
}

export function selectLatestFeedbackEntry(
  rows: PupilActivityFeedbackRow[] | undefined,
  sources: FeedbackSource | FeedbackSource[],
): PupilActivityFeedbackRow | null {
  if (!rows || rows.length === 0) {
    return null
  }

  const sourceList = Array.isArray(sources) ? sources : [sources]
  return rows.find((row) => sourceList.includes(row.source)) ?? null
}
