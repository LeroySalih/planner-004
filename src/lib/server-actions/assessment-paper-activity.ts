"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getAuthenticatedProfile, hasRole, requireRole } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  listHeldQuestionsToSend,
  queueHeldAssessmentQuestions,
  setAssessmentQuestions,
} from "@/lib/assessment-paper/store"
import { readAssessmentPaperSetup } from "@/lib/assessment-paper/setup"
import {
  ASSESSMENT_PAPER_UPLOAD_MAX_BYTES,
  listUnmarkedScriptSubmissions,
  markingAssignmentIdFor,
  storePaperFile,
} from "@/lib/assessment-paper/files"
import { proposeMarkSchemeSplit } from "@/lib/assessment-paper/mark-scheme-split"
import { listUnmarkedPowerPointSubmissions } from "@/lib/powerpoint-assessment/files"
import { isPowerPointAssessmentType } from "@/dino.config"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { withTelemetry } from "@/lib/telemetry"

// Teacher setup of an assessment-paper activity in the lesson editor. The
// generic activity save handles the title and instructions; everything here
// saves on its own: the questions (the only way this type's criteria and
// max_marks change) and the paper files.

const ROUTE_TAG = "/lessons:assessment-paper"

const QuestionInputSchema = z.object({
  label: z.string().trim().min(1, "Every question needs a label."),
  maxMarks: z.number().int().min(1),
  questionText: z.string().nullable().optional(),
  markScheme: z.string().nullable().optional(),
  marking: z.enum(["ai", "ai_check", "teacher"]).optional(),
  /** Label of an earlier question on the paper (error carried forward), or null. */
  dependsOn: z.string().trim().min(1).nullable().optional(),
  /**
   * PowerPoint assessment only: the question's evidence sources, checked by
   * the store against the activity's upload slots. Omitted: unchanged (an
   * assessment paper's editor never sends it).
   */
  evidence: z.array(z.unknown()).max(20).optional(),
  criteria: z
    .array(z.object({ successCriteriaId: z.string().min(1), maxMarks: z.number().int().min(1) }))
    .min(1),
})

const QuestionsInputSchema = z.array(QuestionInputSchema).max(200)

const PaperFileKindSchema = z.enum(["question_paper", "mark_scheme"])

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? fallback
  return error instanceof Error ? error.message : fallback
}

async function revalidateLesson(lessonId: string) {
  const { rows } = await query<{ unit_id: string | null }>("select unit_id from lessons where lesson_id = $1", [
    lessonId,
  ])
  revalidatePath(`/lessons/${lessonId}`)
  if (rows[0]?.unit_id) revalidatePath(`/units/${rows[0].unit_id}`)
}

/**
 * The paper's setup for the editor and the teacher views. Teachers only, but
 * a pupil's view calls it too, so it refuses rather than redirecting.
 */
export async function readAssessmentPaperSetupAction(activityId: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "readAssessmentPaperSetupAction", params: { activityId } },
    async () => {
      const profile = await getAuthenticatedProfile()
      if (!hasRole(profile, "teacher")) return { data: null, error: "Teachers only." }
      try {
        return { data: await readAssessmentPaperSetup(activityId), error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to read setup", error)
        return { data: null, error: errorMessage(error, "Unable to load the assessment paper.") }
      }
    },
  )
}

/**
 * Replace the questions in full. The store validates the allocations, refuses
 * to drop a question with marks, applies the unit's curriculum guard to new
 * criteria, and moves max_marks and the activity's criteria with the
 * questions.
 */
export async function saveAssessmentQuestionsAction(activityId: string, questions: unknown) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "saveAssessmentQuestionsAction", params: { activityId } },
    async () => {
      await requireRole("teacher")
      try {
        const parsed = QuestionsInputSchema.parse(questions)
        await setAssessmentQuestions(activityId, parsed)
        const setup = await readAssessmentPaperSetup(activityId)
        await revalidateLesson(setup.lessonId)
        return { data: setup, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to save questions", error)
        return { data: null, error: errorMessage(error, "Unable to save the questions.") }
      }
    },
  )
}

/** Upload (or replace) the question paper or mark scheme. PDF only. */
export async function uploadAssessmentPaperFileAction(formData: FormData) {
  const activityId = formData.get("activityId")
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "uploadAssessmentPaperFileAction", params: { activityId } },
    async () => {
      const profile = await requireRole("teacher")
      try {
        if (typeof activityId !== "string" || !activityId) throw new Error("Missing activity.")
        const kind = PaperFileKindSchema.parse(formData.get("kind"))
        const file = formData.get("file")
        if (!(file instanceof File)) throw new Error("No file provided.")
        if (file.size > ASSESSMENT_PAPER_UPLOAD_MAX_BYTES) throw new Error("The file exceeds the 25 MB limit.")
        await storePaperFile(activityId, kind, Buffer.from(await file.arrayBuffer()), profile.userId)
        const setup = await readAssessmentPaperSetup(activityId)
        await revalidateLesson(setup.lessonId)
        return { data: setup, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to upload paper file", error)
        return { data: null, error: errorMessage(error, "Unable to upload the file.") }
      }
    },
  )
}

/**
 * Send every script that passed the front sheet check and has never been
 * read or marked. Folded legacy papers and anything already marked are left
 * alone (see listUnmarkedScriptSubmissions). On a PowerPoint assessment, the
 * handed-in work that has never been read or marked, whose read is queued
 * again (see listUnmarkedPowerPointSubmissions).
 */
export async function sendUnmarkedAssessmentScriptsAction(activityId: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "sendUnmarkedAssessmentScriptsAction", params: { activityId } },
    async () => {
      await requireRole("teacher")
      try {
        const id = z.string().min(1).parse(activityId)
        const { rows: typeRows } = await query<{ type: string | null }>(
          "select type from activities where activity_id = $1",
          [id],
        )
        const submissions = isPowerPointAssessmentType(typeRows[0]?.type)
          ? await listUnmarkedPowerPointSubmissions(id)
          : await listUnmarkedScriptSubmissions(id)
        // Grouped by the marking assignment id, as the other marking paths
        // pass it; a pupil who has left the class still gets marked.
        const byAssignment = new Map<string, Array<{ submissionId: string }>>()
        for (const submission of submissions) {
          const assignmentId = await markingAssignmentIdFor(id, submission.pupilId)
          byAssignment.set(assignmentId, [...(byAssignment.get(assignmentId) ?? []), { submissionId: submission.submissionId }])
        }
        for (const [assignmentId, tasks] of byAssignment) {
          await enqueueMarkingTasks(assignmentId, tasks)
        }
        if (submissions.length > 0) void triggerQueueProcessor()
        const setup = await readAssessmentPaperSetup(id)
        await revalidateLesson(setup.lessonId)
        return { data: { setup, sent: submissions.length }, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to send scripts for marking", error)
        return { data: null, error: errorMessage(error, "Unable to send the scripts for marking.") }
      }
    },
  )
}

/**
 * Ask the model to split the paper's mark scheme PDF by question. Returns a
 * proposal per question beside its current text and saves nothing: the
 * teacher accepts what they want and saves the questions as usual.
 */
export async function splitAssessmentMarkSchemeAction(activityId: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "splitAssessmentMarkSchemeAction", params: { activityId } },
    async () => {
      await requireRole("teacher")
      try {
        const id = z.string().min(1).parse(activityId)
        return { data: await proposeMarkSchemeSplit(id), error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to split the mark scheme", error)
        return { data: null, error: errorMessage(error, "Unable to split the mark scheme.") }
      }
    },
  )
}

/**
 * Send the questions held at the read for want of a mark scheme, now that
 * they have one, on every pupil's script whose read is complete and that
 * nobody has marked (see listHeldQuestionsToSend).
 */
export async function sendHeldAssessmentQuestionsAction(activityId: string) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "sendHeldAssessmentQuestionsAction", params: { activityId } },
    async () => {
      await requireRole("teacher")
      try {
        const id = z.string().min(1).parse(activityId)
        const held = await listHeldQuestionsToSend(id)
        const pupilOf = new Map(held.map((row) => [row.submissionId, row.pupilId]))
        let sent = 0
        for (const [submissionId, pupilId] of pupilOf) {
          const queued = await queueHeldAssessmentQuestions({
            activityId: id,
            submissionId,
            assignmentId: await markingAssignmentIdFor(id, pupilId),
          })
          sent += queued.length
        }
        if (sent > 0) void triggerQueueProcessor()
        const setup = await readAssessmentPaperSetup(id)
        await revalidateLesson(setup.lessonId)
        return { data: { setup, sent, pupils: pupilOf.size }, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to send held questions", error)
        return { data: null, error: errorMessage(error, "Unable to send the held questions.") }
      }
    },
  )
}
