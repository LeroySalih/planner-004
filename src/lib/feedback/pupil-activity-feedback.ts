import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import {
  PupilActivityFeedbackRowSchema,
  type FeedbackSource,
  type PupilActivityFeedbackRow,
} from "@/types"

type SupabaseClientLike = SupabaseClient<any, "public", any>

const FeedbackRowArraySchema = z.array(PupilActivityFeedbackRowSchema)

export type FeedbackLookupKey = `${string}::${string}`

export type FeedbackLookupMap = Map<FeedbackLookupKey, PupilActivityFeedbackRow[]>

export async function fetchPupilActivityFeedbackMap(
  supabase: SupabaseClientLike,
  filters: { activityIds: string[]; pupilIds: string[] },
): Promise<{ data: FeedbackLookupMap; error: Error | null }> {
  const { activityIds, pupilIds } = filters
  const lookup: FeedbackLookupMap = new Map()

  if (activityIds.length === 0 || pupilIds.length === 0) {
    return { data: lookup, error: null }
  }

  const { data, error } = await supabase
    .from("pupil_activity_feedback")
    .select("feedback_id, activity_id, pupil_id, submission_id, source, score, feedback_text, created_at, created_by")
    .in("activity_id", activityIds)
    .in("pupil_id", pupilIds)
    .order("created_at", { ascending: false })

  if (error) {
    return { data: lookup, error: new Error(error.message) }
  }

  const parsed = FeedbackRowArraySchema.safeParse(data ?? [])
  if (!parsed.success) {
    return { data: lookup, error: new Error(parsed.error.message) }
  }

  for (const row of parsed.data) {
    const key: FeedbackLookupKey = `${row.pupil_id}::${row.activity_id}`
    const existing = lookup.get(key) ?? []
    existing.push(row)
    lookup.set(key, existing)
  }

  return { data: lookup, error: null }
}

type InsertFeedbackEntryInput = {
  supabase: SupabaseClientLike
  activityId: string
  pupilId: string
  submissionId?: string | null
  source: FeedbackSource
  score?: number | null
  feedbackText?: string | null
  createdBy?: string | null
}

export async function insertPupilActivityFeedbackEntry(input: InsertFeedbackEntryInput): Promise<boolean> {
  const { supabase, activityId, pupilId, submissionId, source, score, feedbackText, createdBy } = input

  const normalisedScore =
    typeof score === "number" && Number.isFinite(score) ? Math.min(Math.max(score, 0), 1) : null
  const text = typeof feedbackText === "string" ? feedbackText.trim() : null

  const { error } = await supabase.from("pupil_activity_feedback").insert({
    activity_id: activityId,
    pupil_id: pupilId,
    submission_id: submissionId ?? null,
    source,
    score: normalisedScore,
    feedback_text: text && text.length > 0 ? text : null,
    created_by: createdBy ?? null,
  })

  if (error) {
    console.error("[feedback] Failed to insert pupil activity feedback entry:", error, {
      activityId,
      pupilId,
      source,
    })
    return false
  }

  return true
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
