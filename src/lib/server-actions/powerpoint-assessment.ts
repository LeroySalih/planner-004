"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { hasRole, requireAuthenticatedProfile, requireRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { pupilWorkLockedMessage } from "@/lib/lesson-lock"
import {
  SUPPLIED_IMAGE_MAX_BYTES,
  handInPowerPointAssessment,
  listSuppliedImages,
  readPracticalSlots,
  removePracticalFile,
  removeSuppliedImage,
  storeSuppliedImage,
} from "@/lib/powerpoint-assessment/files"
import { readPupilPowerPointView } from "@/lib/powerpoint-assessment/pupil-view"
import { withTelemetry } from "@/lib/telemetry"

// A PowerPoint assessment's files: the pupil's slots and Hand in, and the
// images a teacher supplies with the task. A pupil's file itself is uploaded
// through POST /api/pupil-submission/practical (a presentation can be larger
// than the server-action body limit).

const ROUTE_TAG = "/lessons:powerpoint-assessment"

const IdSchema = z.string().trim().min(1)
const SlotKeySchema = z.string().regex(/^[a-z0-9-]+$/, "Unknown upload slot.")
const GroupAssignmentIdSchema = z.string().trim().min(1).nullable().optional()

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

/** Each upload slot and the pupil's file in it. The pupil themselves, or a teacher. */
export async function readPowerPointAssessmentSlotsAction(activityId: string, pupilId: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "readPowerPointAssessmentSlotsAction", params: { activityId, pupilId } },
    async () => {
      const profile = await requireAuthenticatedProfile()
      try {
        const activity = IdSchema.parse(activityId)
        const pupil = IdSchema.parse(pupilId)
        if (profile.userId !== pupil && !hasRole(profile, "teacher")) {
          return { data: null, error: "You can only see your own files." }
        }
        return { data: await readPracticalSlots(activity, pupil), error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to read slots", error)
        return { data: null, error: errorMessage(error, "Unable to load your files.") }
      }
    },
  )
}

/**
 * The pupil's own view on their lesson page (readPupilPowerPointView): the
 * pupil themselves, or a teacher. Feedback only once visible to a pupil.
 */
export async function readMyPowerPointAssessmentViewAction(activityId: string, pupilId: string) {
  return withTelemetry(
    { routeTag: "/pupil-lessons:powerpoint-assessment", functionName: "readMyPowerPointAssessmentViewAction", params: { activityId, pupilId } },
    async () => {
      const profile = await requireAuthenticatedProfile()
      try {
        const activity = IdSchema.parse(activityId)
        const pupil = IdSchema.parse(pupilId)
        const isTeacher = hasRole(profile, "teacher")
        if (profile.userId !== pupil && !isTeacher) return { data: null, error: "You can only see your own work." }
        return { data: await readPupilPowerPointView(activity, pupil, isTeacher), error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to read pupil view", error)
        return { data: null, error: errorMessage(error, "Unable to load this assessment.") }
      }
    },
  )
}

/**
 * Hand in: marking starts. Refused, naming them, while a required slot is
 * empty. The pupil themselves (not in a locked lesson), or a teacher.
 */
export async function handInPowerPointAssessmentAction(
  activityId: string,
  pupilId: string,
  groupAssignmentId?: string | null,
) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "handInPowerPointAssessmentAction", params: { activityId, pupilId } },
    async () => {
      const profile = await requireAuthenticatedProfile()
      try {
        const activity = IdSchema.parse(activityId)
        const pupil = IdSchema.parse(pupilId)
        const isTeacher = hasRole(profile, "teacher")
        if (profile.userId !== pupil && !isTeacher) {
          return { data: null, error: "You can only hand in your own work." }
        }
        const locked = await pupilWorkLockedMessage(pupil, activity)
        if (locked) return { data: null, error: locked }
        const result = await handInPowerPointAssessment(
          activity,
          pupil,
          { userId: profile.userId, isTeacher },
          { groupAssignmentId: GroupAssignmentIdSchema.parse(groupAssignmentId) },
        )
        return { data: result, error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to hand in", error)
        return { data: null, error: errorMessage(error, "Unable to hand in.") }
      }
    },
  )
}

/**
 * Remove the file in one slot: the pupil before they hand in (not in a
 * locked lesson), or a teacher at any time (after hand-in that clears the
 * marking and sends it again).
 */
export async function removePracticalFileAction(
  activityId: string,
  pupilId: string,
  slotKey: string,
  groupAssignmentId?: string | null,
) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "removePracticalFileAction", params: { activityId, pupilId, slotKey } },
    async () => {
      const profile = await requireAuthenticatedProfile()
      try {
        const activity = IdSchema.parse(activityId)
        const pupil = IdSchema.parse(pupilId)
        const slot = SlotKeySchema.parse(slotKey)
        const isTeacher = hasRole(profile, "teacher")
        if (!isTeacher) {
          if (profile.userId !== pupil) return { data: null, error: "You can only remove your own files." }
          const locked = await pupilWorkLockedMessage(pupil, activity)
          if (locked) return { data: null, error: locked }
        }
        // After hand-in the store refuses a pupil (checked under its lock).
        await removePracticalFile({
          activityId: activity,
          pupilId: pupil,
          slotKey: slot,
          byTeacher: isTeacher,
          groupAssignmentId: GroupAssignmentIdSchema.parse(groupAssignmentId),
        })
        return { data: await readPracticalSlots(activity, pupil), error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to remove file", error)
        return { data: null, error: errorMessage(error, "Unable to remove the file.") }
      }
    },
  )
}

/**
 * Upload (or replace) an image the task supplies (formData: activityId, file,
 * name?). Teachers only. The warnings say when it is so like another supplied
 * image that the reader may confuse them.
 */
export async function uploadSuppliedImageAction(formData: FormData) {
  const activityId = formData.get("activityId")
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "uploadSuppliedImageAction", params: { activityId } },
    async () => {
      const profile = await requireRole("teacher")
      try {
        const activity = IdSchema.parse(activityId)
        const file = formData.get("file")
        if (!(file instanceof File)) throw new Error("No file provided.")
        if (file.size > SUPPLIED_IMAGE_MAX_BYTES) throw new Error("A supplied image must be 10 MB or smaller.")
        const name = formData.get("name")
        const stored = await storeSuppliedImage({
          activityId: activity,
          fileName: file.name,
          bytes: Buffer.from(await file.arrayBuffer()),
          name: typeof name === "string" && name.trim() ? name.trim() : undefined,
          uploadedBy: profile.userId,
        })
        await revalidateActivityLesson(activity)
        return {
          data: { image: stored.image, replaced: stored.replaced, warnings: stored.warnings, images: await listSuppliedImages(activity) },
          error: null,
        }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to upload supplied image", error)
        return { data: null, error: errorMessage(error, "Unable to upload the image.") }
      }
    },
  )
}

/** Remove a supplied image. Teachers only. */
export async function removeSuppliedImageAction(activityId: string, name: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "removeSuppliedImageAction", params: { activityId, name } },
    async () => {
      await requireRole("teacher")
      try {
        const activity = IdSchema.parse(activityId)
        const imageName = IdSchema.parse(name)
        const { removed } = await removeSuppliedImage(activity, imageName)
        if (!removed) return { data: null, error: `No supplied image "${imageName}".` }
        await revalidateActivityLesson(activity)
        return { data: { images: await listSuppliedImages(activity) }, error: null }
      } catch (error) {
        console.error("[powerpoint-assessment] failed to remove supplied image", error)
        return { data: null, error: errorMessage(error, "Unable to remove the image.") }
      }
    },
  )
}
