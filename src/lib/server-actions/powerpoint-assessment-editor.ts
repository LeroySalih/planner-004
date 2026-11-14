"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getAuthenticatedProfile, hasRole, requireRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { listSuppliedImages } from "@/lib/powerpoint-assessment/files"
import { checkActivityEvidenceTemplate, renameSuppliedImage } from "@/lib/powerpoint-assessment/editor"
import { withTelemetry } from "@/lib/telemetry"

// The lesson editor's PowerPoint assessment setup. The body (instructions,
// upload slots, evidence template) saves through updateLessonActivityAction
// and the questions through saveAssessmentQuestionsAction; these are the
// rest. Teachers only.

const ROUTE_TAG = "/lessons:powerpoint-assessment"

const IdSchema = z.string().trim().min(1)

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? fallback
  return error instanceof Error ? error.message : fallback
}

async function revalidateActivityLesson(activityId: string) {
  const { rows } = await query<{ lesson_id: string; unit_id: string | null }>(
    `select a.lesson_id, l.unit_id from activities a join lessons l on l.lesson_id = a.lesson_id
      where a.activity_id = $1`,
    [activityId],
  )
  if (!rows[0]) return
  revalidatePath(`/lessons/${rows[0].lesson_id}`)
  if (rows[0].unit_id) revalidatePath(`/units/${rows[0].unit_id}`)
}

/**
 * The images the task supplies, for the editor's grid and the teacher's
 * summary. Teachers only; refuses rather than redirecting, as the summary
 * may render for anyone.
 */
export async function listSuppliedImagesAction(activityId: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "listSuppliedImagesAction", params: { activityId } },
    async () => {
      const profile = await getAuthenticatedProfile()
      if (!hasRole(profile, "teacher")) return { data: null, error: "Teachers only." }
      try {
        return { data: await listSuppliedImages(IdSchema.parse(activityId)), error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to list supplied images", error)
        return { data: null, error: errorMessage(error, "Unable to load the supplied images.") }
      }
    },
  )
}

/** Rename a supplied image (the name the reader reports it by). */
export async function renameSuppliedImageAction(activityId: string, from: string, to: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "renameSuppliedImageAction", params: { activityId, from, to } },
    async () => {
      await requireRole("teacher")
      try {
        const activity = IdSchema.parse(activityId)
        await renameSuppliedImage(activity, IdSchema.parse(from), z.string().parse(to))
        await revalidateActivityLesson(activity)
        return { data: { images: await listSuppliedImages(activity) }, error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to rename supplied image", error)
        return { data: null, error: errorMessage(error, "Unable to rename the image.") }
      }
    },
  )
}

/**
 * Check an activity .docx as the evidence template (the saved choice when no
 * name is given) against the headings the questions' evidence_section sources
 * read. The missing ones are a warning: a pupil's copy of the template would
 * not have them either.
 */
export async function checkEvidenceTemplateAction(activityId: string, fileName?: string | null) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "checkEvidenceTemplateAction", params: { activityId, fileName } },
    async () => {
      await requireRole("teacher")
      try {
        const name = fileName == null ? null : z.string().parse(fileName)
        return { data: await checkActivityEvidenceTemplate(IdSchema.parse(activityId), name), error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to check the evidence template", error)
        return { data: null, error: errorMessage(error, "Unable to check the evidence template.") }
      }
    },
  )
}
