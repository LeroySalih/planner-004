"use server"

import { z } from "zod"

import { query } from "@/lib/db"
import { requireAuthenticatedProfile, requireRole } from "@/lib/auth"
import { recomputeSubmissionAggregate } from "@/lib/scoring/aggregate-sc-marks"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { withTelemetry } from "@/lib/telemetry"

const ScMarkRowSchema = z.object({
  success_criteria_id: z.string(),
  description: z.string(),
  sc_type: z.enum(["binary", "levelled"]),
  descriptors: z.array(z.string()),
  awarded: z.number().int().min(0),
  available: z.number().int().min(1),
  feedback: z.string().nullable(),
  provenance: z.enum(["ai", "teacher", "legacy"]),
})

export type ScMarkRow = z.infer<typeof ScMarkRowSchema>

/**
 * Per-criterion marks for a submission, joined to the criterion's description
 * and descriptors so the marking UI can label each level.
 */
export async function readSubmissionScMarksAction(submissionId: string) {
  return withTelemetry(
    { routeTag: "sc-marks", functionName: "readSubmissionScMarksAction", params: { submissionId } },
    async () => {
    await requireRole("teacher")

    try {
      const { rows } = await query<{
        success_criteria_id: string
        description: string | null
        sc_type: string | null
        descriptors: string[] | null
        awarded: number
        available: number
        feedback: string | null
        provenance: string
      }>(
        `select m.success_criteria_id,
                sc.description,
                sc.sc_type,
                coalesce(
                  array(
                    select d.descriptor from success_criteria_descriptors d
                    where d.success_criteria_id = sc.success_criteria_id
                    order by d.level_index
                  ),
                  '{}'
                ) as descriptors,
                m.awarded,
                m.available,
                m.feedback,
                m.provenance
         from submission_sc_marks m
         join success_criteria sc on sc.success_criteria_id = m.success_criteria_id
         where m.submission_id = $1
         order by sc.order_index, sc.success_criteria_id`,
        [submissionId],
      )

      const data = rows.map((row) =>
        ScMarkRowSchema.parse({
          success_criteria_id: row.success_criteria_id,
          description: row.description ?? "",
          sc_type: row.sc_type === "levelled" ? "levelled" : "binary",
          descriptors: row.descriptors ?? [],
          awarded: Number(row.awarded),
          available: Number(row.available),
          feedback: row.feedback,
          provenance: ["ai", "teacher", "legacy"].includes(row.provenance) ? row.provenance : "ai",
        })
      )

      return { data, error: null }
    } catch (error) {
      console.error("[sc-marks] readSubmissionScMarksAction:error", error)
      return { data: null, error: "Unable to load criterion marks." }
    }
  })
}

/**
 * Pupil-facing read of their OWN criterion marks for an activity.
 *
 * Separate from readSubmissionScMarksAction, which is teacher-gated. Scoped by
 * construction: the submission is resolved from the caller's own id, so there
 * is no submission identifier a pupil could substitute to read someone else's
 * breakdown. A teacher previewing sees their own preview submission.
 */
export async function readMyScMarksForActivityAction(activityId: string) {
  const profile = await requireAuthenticatedProfile()

  try {
    const { rows } = await query<{
      success_criteria_id: string
      description: string | null
      sc_type: string | null
      descriptors: string[] | null
      awarded: number
      available: number
      feedback: string | null
    }>(
      `with latest as (
         select submission_id
         from submissions
         where activity_id = $1 and user_id = $2
         order by submitted_at desc nulls last
         limit 1
       )
       select m.success_criteria_id,
              sc.description,
              sc.sc_type,
              coalesce(
                array(
                  select d.descriptor from success_criteria_descriptors d
                  where d.success_criteria_id = sc.success_criteria_id
                  order by d.level_index
                ),
                '{}'
              ) as descriptors,
              m.awarded,
              m.available,
              m.feedback
       from submission_sc_marks m
       join latest on latest.submission_id = m.submission_id
       join success_criteria sc on sc.success_criteria_id = m.success_criteria_id
       order by sc.order_index, sc.success_criteria_id`,
      [activityId, profile.userId],
    )

    const data = rows.map((row) => ({
      success_criteria_id: row.success_criteria_id,
      description: row.description ?? "",
      sc_type: (row.sc_type === "levelled" ? "levelled" : "binary") as "binary" | "levelled",
      descriptors: row.descriptors ?? [],
      awarded: Number(row.awarded),
      available: Number(row.available),
      feedback: row.feedback,
    }))

    return { data, error: null }
  } catch (error) {
    console.error("[sc-marks] readMyScMarksForActivityAction:error", error)
    return { data: null, error: "Unable to load criterion marks." }
  }
}

/**
 * Override one criterion's marks.
 *
 * Q7: the submission total is always the sum of its criteria, so there is no
 * separate whole-activity override — the aggregate is recomputed from the rows.
 * The edited row is stamped `provenance='teacher'` so a later re-mark preserves
 * it while refreshing the rest.
 */
export async function updateScMarkAction(input: {
  submissionId: string
  successCriteriaId: string
  awarded: number
}) {
  return withTelemetry(
    { routeTag: "sc-marks", functionName: "updateScMarkAction", params: { submissionId: input.submissionId } },
    async () => {
    await requireRole("teacher")

    if (!Number.isInteger(input.awarded) || input.awarded < 0) {
      return { data: null, error: "Awarded marks must be a whole number of at least 0." }
    }

    try {
      const { rows: existing } = await query<{ available: number; activity_id: string }>(
        `select m.available, s.activity_id
         from submission_sc_marks m
         join submissions s on s.submission_id = m.submission_id
         where m.submission_id = $1 and m.success_criteria_id = $2
         limit 1`,
        [input.submissionId, input.successCriteriaId],
      )

      const row = existing[0]
      if (!row) {
        return { data: null, error: "No mark exists for that criterion yet." }
      }

      const available = Number(row.available)
      if (input.awarded > available) {
        return {
          data: null,
          error: `Awarded marks cannot exceed ${available} for this criterion.`,
        }
      }

      await query(
        `update submission_sc_marks
         set awarded = $3, provenance = 'teacher', marked_at = timezone('utc', now())
         where submission_id = $1 and success_criteria_id = $2`,
        [input.submissionId, input.successCriteriaId, input.awarded],
      )

      const aggregate = await recomputeSubmissionAggregate(input.submissionId, row.activity_id)

      const { rows: pupilRows } = await query<{ user_id: string }>(
        `select user_id from submissions where submission_id = $1`,
        [input.submissionId],
      )

      void emitSubmissionEvent("submission.updated", {
        submissionId: input.submissionId,
        activityId: row.activity_id,
        pupilId: pupilRows[0]?.user_id ?? "",
        markStatus: "marked",
        markedAt: new Date().toISOString(),
      })

      return {
        data: {
          awarded: input.awarded,
          available,
          aggregate,
        },
        error: null,
      }
    } catch (error) {
      console.error("[sc-marks] updateScMarkAction:error", error)
      return { data: null, error: "Unable to update criterion mark." }
    }
  })
}
