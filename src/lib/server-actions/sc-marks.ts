"use server"

import { z } from "zod"

import { query, withDbClient } from "@/lib/db"
import { recalculateActivityMaxMarks } from "@/lib/scoring/derive-max-marks"
import { requireAuthenticatedProfile, requireRole } from "@/lib/auth"
import { effectiveCriterionFeedback } from "@/lib/scoring/aggregate-sc-marks"
import {
  applyTeacherActivityFeedback,
  applyTeacherActivityOverride,
  applyTeacherScFeedback,
  applyTeacherScMark,
} from "@/lib/feedback/teacher-feedback"
import { withTelemetry } from "@/lib/telemetry"

const ScMarkRowSchema = z.object({
  success_criteria_id: z.string(),
  description: z.string(),
  sc_type: z.enum(["binary", "levelled"]),
  descriptors: z.array(z.string()),
  awarded: z.number().int().min(0),
  available: z.number().int().min(1),
  /** The comment to display: teacher's if set, otherwise the AI's. */
  feedback: z.string().nullable(),
  /** The teacher's own comment, for editing. Null when they have not written one. */
  teacher_feedback: z.string().nullable(),
  provenance: z.enum(["ai", "teacher", "legacy"]),
  /** False for a criterion with no mark recorded yet; it counts as 0. */
  marked: z.boolean(),
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
        teacher_feedback: string | null
        provenance: string | null
      }>(
        // Every criterion on the activity, marked or not: only AI marking
        // writes these rows, so hand-marked work has none until the teacher
        // marks a criterion. A row whose criterion has since been unlinked is
        // still listed, as before.
        `with ids as (
           select acs.success_criteria_id
           from submissions s
           join activity_success_criteria acs on acs.activity_id = s.activity_id
           where s.submission_id = $1
           union
           select success_criteria_id from submission_sc_marks where submission_id = $1
         )
         select ids.success_criteria_id,
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
                coalesce(m.awarded, 0) as awarded,
                coalesce(m.available, sc_available_marks(sc.success_criteria_id)) as available,
                m.feedback,
                m.teacher_feedback,
                m.provenance
         from ids
         join success_criteria sc on sc.success_criteria_id = ids.success_criteria_id
         left join submission_sc_marks m
           on m.submission_id = $1 and m.success_criteria_id = ids.success_criteria_id
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
          feedback: effectiveCriterionFeedback({ ...row, provenance: row.provenance ?? "ai" }),
          teacher_feedback: row.teacher_feedback,
          provenance: row.provenance && ["ai", "teacher", "legacy"].includes(row.provenance) ? row.provenance : "ai",
          marked: row.provenance !== null,
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
 * Criterion marks for one pupil's latest submission to an activity.
 *
 * `pupilId` defaults to the caller, which is the pupil's own view. A different
 * pupil may only be requested by a teacher — `/pupil-lessons/[pupilId]` is a
 * teacher-facing route, so without this a teacher viewing a pupil's work would
 * silently see their own (empty) marks instead of the pupil's.
 */
export async function readMyScMarksForActivityAction(
  activityId: string,
  pupilId?: string,
) {
  const profile = await requireAuthenticatedProfile()

  const targetPupilId = pupilId ?? profile.userId
  if (targetPupilId !== profile.userId) {
    await requireRole("teacher")
  }

  try {
    const { rows } = await query<{
      success_criteria_id: string
      description: string | null
      sc_type: string | null
      descriptors: string[] | null
      awarded: number
      available: number
      feedback: string | null
      teacher_feedback: string | null
      provenance: string
    }>(
      `with latest as (
         select submission_id
         from submissions
         where activity_id = $1 and user_id = $2
         order by attempt_number desc, submitted_at desc nulls last
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
              m.feedback,
              m.teacher_feedback,
              m.provenance
       from submission_sc_marks m
       join latest on latest.submission_id = m.submission_id
       join success_criteria sc on sc.success_criteria_id = m.success_criteria_id
       order by sc.order_index, sc.success_criteria_id`,
      [activityId, targetPupilId],
    )

    const data = rows.map((row) => ({
      success_criteria_id: row.success_criteria_id,
      description: row.description ?? "",
      sc_type: (row.sc_type === "levelled" ? "levelled" : "binary") as "binary" | "levelled",
      descriptors: row.descriptors ?? [],
      awarded: Number(row.awarded),
      available: Number(row.available),
      feedback: effectiveCriterionFeedback(row),
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
  /** Optional teacher comment saved alongside the mark. */
  feedback?: string | null
}) {
  return withTelemetry(
    { routeTag: "sc-marks", functionName: "updateScMarkAction", params: { submissionId: input.submissionId } },
    async () => {
    await requireRole("teacher")

    return applyTeacherScMark(input)
  })
}

/**
 * Set (or clear) a teacher's comment on one criterion, without changing the
 * mark. The comment always overrides the AI's wherever it is displayed, and the
 * submission's combined feedback is refreshed so reports see it too.
 */
export async function updateScFeedbackAction(input: {
  submissionId: string
  successCriteriaId: string
  feedback: string | null
}) {
  await requireRole("teacher")

  return applyTeacherScFeedback(input)
}

/**
 * The teacher's overall comment on an activity marked by criteria, saved
 * without a mark: the total comes from the criteria.
 */
export async function updateActivityFeedbackAction(input: {
  submissionId: string
  feedback: string | null
}) {
  const teacher = await requireRole("teacher")
  try {
    return await applyTeacherActivityFeedback(input, teacher.userId)
  } catch (error) {
    console.error("[sc-marks] updateActivityFeedbackAction:error", error)
    return { success: false as const, error: "Unable to save feedback." }
  }
}

/**
 * The criteria on an activity, unmarked, for a pupil who has not submitted it,
 * so the teacher still sees the rubric and can mark against it.
 */
export async function readActivityCriteriaForMarkingAction(activityId: string) {
  await requireRole("teacher")
  try {
    const { rows } = await query<{
      success_criteria_id: string
      description: string | null
      sc_type: string | null
      descriptors: string[] | null
      available: number
    }>(
      `select sc.success_criteria_id,
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
              sc_available_marks(sc.success_criteria_id) as available
       from activity_success_criteria acs
       join success_criteria sc on sc.success_criteria_id = acs.success_criteria_id
       where acs.activity_id = $1
       order by sc.order_index, sc.success_criteria_id`,
      [activityId],
    )
    const data = rows.map((row) =>
      ScMarkRowSchema.parse({
        success_criteria_id: row.success_criteria_id,
        description: row.description ?? "",
        sc_type: row.sc_type === "levelled" ? "levelled" : "binary",
        descriptors: row.descriptors ?? [],
        awarded: 0,
        available: Number(row.available),
        feedback: null,
        teacher_feedback: null,
        provenance: "teacher",
        marked: false,
      })
    )
    return { data, error: null }
  } catch (error) {
    console.error("[sc-marks] readActivityCriteriaForMarkingAction:error", error)
    return { data: null, error: "Unable to load the success criteria." }
  }
}

/**
 * Record a submission on the pupil's behalf, every criterion at 0, so the
 * teacher can mark work the pupil handed in some other way.
 */
export async function startCriteriaMarkingAction(input: { activityId: string; pupilId: string }) {
  const teacher = await requireRole("teacher")
  try {
    const outcome = await applyTeacherActivityOverride(
      { activityId: input.activityId, pupilId: input.pupilId, submissionId: null, marksOverride: 0, feedback: null },
      teacher.userId,
    )
    if (!outcome.success || !outcome.submissionId) {
      return { data: null, error: outcome.success ? "Unable to record a submission." : outcome.error }
    }
    return { data: { submissionId: outcome.submissionId }, error: null }
  } catch (error) {
    console.error("[sc-marks] startCriteriaMarkingAction:error", error)
    return { data: null, error: "Unable to record a submission." }
  }
}

/**
 * Bring an activity's criterion marks into line with its criteria as they are
 * now: max marks re-derived, each pupil's marks moved to the criteria's current
 * marks available, and totals rewritten. The curriculum builder does this on
 * every change; this is for anything that changed some other way.
 */
export async function refreshActivityCriteriaAction(activityId: string) {
  await requireRole("teacher")
  try {
    const changed = await withDbClient(async (client) => {
      await client.query("BEGIN")
      try {
        await recalculateActivityMaxMarks(client, activityId)
        const { rows } = await client.query<{ changed: number }>(
          "select refresh_activity_criteria($1) as changed",
          [activityId],
        )
        await client.query("COMMIT")
        return Number(rows[0]?.changed ?? 0)
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
    return { data: { changed }, error: null }
  } catch (error) {
    console.error("[sc-marks] refreshActivityCriteriaAction:error", error)
    return { data: null, error: "Unable to refresh the criteria." }
  }
}
