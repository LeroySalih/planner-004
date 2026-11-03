"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { isQuestionMarkedActivityType } from "@/dino.config"
import { readAssessmentPaperSetup } from "@/lib/assessment-paper/setup"
import { withTelemetry } from "@/lib/telemetry"

// Per-paper settings saved from the assessment-paper editor. Each is one key
// on the activity's body_data; the sheet's own Save keeps keys it does not
// send (updateLessonActivityAction), so neither save drops the other's.

const ROUTE_TAG = "/lessons:assessment-paper"

const MarkSchemeVisibilityInputSchema = z.object({
  activityId: z.string().min(1),
  show: z.boolean(),
})

/** Whether the pupils' feedback PDF includes each question's mark scheme (default yes). */
export async function setAssessmentMarkSchemeVisibilityAction(input: z.infer<typeof MarkSchemeVisibilityInputSchema>) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "setAssessmentMarkSchemeVisibilityAction", params: input },
    async () => {
      await requireRole("teacher")
      try {
        const parsed = MarkSchemeVisibilityInputSchema.parse(input)
        const { rows } = await query<{ type: string | null; lesson_id: string; unit_id: string | null }>(
          `select a.type, a.lesson_id, l.unit_id
             from activities a join lessons l on l.lesson_id = a.lesson_id
            where a.activity_id = $1`,
          [parsed.activityId],
        )
        const row = rows[0]
        if (!row) throw new Error("Activity not found.")
        if (!isQuestionMarkedActivityType(row.type)) throw new Error("This activity is not an assessment paper.")
        await query(
          `update activities
              set body_data = coalesce(body_data, '{}'::jsonb) || jsonb_build_object('showMarkSchemeToPupils', $2::boolean)
            where activity_id = $1`,
          [parsed.activityId, parsed.show],
        )
        revalidatePath(`/lessons/${row.lesson_id}`)
        if (row.unit_id) revalidatePath(`/units/${row.unit_id}`)
        return { data: await readAssessmentPaperSetup(parsed.activityId), error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to save the mark scheme setting", error)
        return { data: null, error: error instanceof Error ? error.message : "Unable to save the setting." }
      }
    },
  )
}
