import "server-only"

import { query } from "@/lib/db"
import { isPracticalAssessmentType } from "@/dino.config"
import { assertPupilSitsAssessment } from "@/lib/assessment-paper/files"
import {
  buildPupilAssessmentFeedback,
  powerPointMarkState,
  powerPointQuestionShownToPupil,
  type PupilAssessmentFeedback,
  type PupilPowerPointMarkState,
} from "@/lib/assessment-paper/pupil-feedback"
import { assessmentScriptUrl, pupilFeedbackVisible, readAssessmentPaperResult } from "@/lib/assessment-paper/results"
import { assessmentFeedbackPdfUrl } from "@/lib/assessment-paper/urls"
import { isLessonLockedForUser } from "@/lib/lesson-lock"
import { LESSONS_BUCKET, listSuppliedImages, readPracticalSlots } from "@/lib/powerpoint-assessment/files"
import { practicalTypeConfig } from "@/lib/practical-assessment/types"
import { pastVersionNames } from "@/lib/storage/file-versions"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { lessonDownloadFileName } from "@/lib/storage/pupil-file-name"
import type { PracticalUploadSlotKind } from "@/types"

// A practical assessment (PowerPoint or database) on the pupil's lesson page:
// the task, the files the pupil needs (for a database, the starting database
// among them, as an ordinary activity file), one upload slot per file they
// hand in, Hand in, where marking has got to and, once feedback is released,
// their marks task by task.
//
// Built on the server for the pupil, so it carries nothing that is not
// theirs to see: never the mark scheme (its PDF or any question's text), the
// evidence each question reads, what the reader extracted, the marker's
// evidence note, the AI's own mark beside a teacher's, or the submission's
// mark_error (it is written for the teacher and can name questions and their
// mark schemes). A file the reader refused shows its reader message, which is
// written for whoever uploaded the file.

export type PupilPowerPointSlot = {
  key: string
  label: string
  kind: PracticalUploadSlotKind
  required: boolean
  hint: string | null
  file: {
    name: string
    bytes: number
    uploadedAt: string
    /** The pupil's own file; null while downloads are blocked (locked lesson). */
    url: string | null
    /** The reader's message when it could not read this file. */
    readError: string | null
  } | null
}

/** `downloadName` is `name` with the lesson title in front, as /api/files sends it. */
export type PupilPowerPointDownload = { name: string; downloadName: string; url: string }

export type PupilPowerPointView = {
  activityId: string
  pupilId: string
  instructions: string | null
  /** Null when there is none, while downloads are blocked, or the pupil does not sit it. */
  questionPaperUrl: string | null
  /** The activity's files and the images the task supplies (PowerPoint only). Empty while downloads are blocked. */
  downloads: PupilPowerPointDownload[]
  suppliedImages: PupilPowerPointDownload[]
  /** Downloads are blocked: the lesson is locked for this pupil. */
  downloadsBlocked: boolean
  slots: PupilPowerPointSlot[]
  /** Labels of required slots with no file. */
  missingRequired: string[]
  handedIn: boolean
  markState: PupilPowerPointMarkState
  /** Some file could not be read (shown on its slot). */
  hasReadError: boolean
  /** Only once handed in, marked (or marked by the teacher) and visible to the viewer. */
  feedback: PupilAssessmentFeedback | null
  /** The activity is not set up for pupils yet (no upload slots). */
  notSetUp: boolean
}

/** The activity's own files (current versions only), as the lesson's file-download activities list them. */
async function readActivityDownloads(lessonId: string, activityId: string): Promise<Array<{ name: string; url: string }>> {
  const storage = createLocalStorageClient(LESSONS_BUCKET)
  const directory = `lessons/${lessonId}/activities/${activityId}`
  const { data, error } = await storage.list(directory, { limit: 100 })
  if (error || !data) return []
  const pastVersions = pastVersionNames(data.map((file) => file.name))
  const files = await Promise.all(
    data
      .filter((file) => !pastVersions.has(file.name))
      .map(async (file) => {
        const signed = await storage.createSignedUrl(`${directory}/${file.name}`)
        return signed.data?.signedUrl ? { name: file.name, url: signed.data.signedUrl } : null
      }),
  )
  return files
    .filter((file): file is { name: string; url: string } => file !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The pupil's view of a practical assessment. `viewerIsTeacher` skips the
 * feedback-visibility check and the lesson lock (a teacher previewing, or
 * looking at a pupil's page).
 */
export async function readPupilPowerPointView(
  activityId: string,
  pupilId: string,
  viewerIsTeacher: boolean,
): Promise<PupilPowerPointView> {
  const { rows } = await query<{ lesson_id: string; lesson_title: string | null; type: string | null; body_data: unknown }>(
    `select a.lesson_id, l.title as lesson_title, a.type, a.body_data
       from activities a join lessons l on l.lesson_id = a.lesson_id where a.activity_id = $1`,
    [activityId],
  )
  const activity = rows[0]
  if (!activity) throw new Error("Activity not found.")
  if (!isPracticalAssessmentType(activity.type)) throw new Error("This activity is not a practical assessment.")
  const config = practicalTypeConfig(activity.type)
  const lessonId = activity.lesson_id
  const parsed = config.bodySchema.safeParse(activity.body_data ?? {})
  const body = parsed.success
    ? { success: true as const, data: parsed.data as { instructions?: string; questionPaperPath?: string } }
    : { success: false as const }
  const rawInstructions = (activity.body_data as { instructions?: unknown } | null)?.instructions
  const instructions = body.success
    ? body.data.instructions?.trim() || null
    : typeof rawInstructions === "string"
      ? rawInstructions.trim() || null
      : null

  const downloadsBlocked = !viewerIsTeacher && (await isLessonLockedForUser(pupilId, lessonId))
  const sits = viewerIsTeacher
    ? true
    : await assertPupilSitsAssessment(activityId, pupilId).then(
        () => true,
        () => false,
      )

  const [downloads, suppliedImages] = downloadsBlocked
    ? [[], []]
    : await Promise.all([
        readActivityDownloads(lessonId, activityId),
        config.hasSuppliedImages
          ? listSuppliedImages(activityId).then((images) => images.map((image) => ({ name: image.file_name, url: image.url })))
          : Promise.resolve([]),
      ]).then((lists) =>
        lists.map((files) =>
          files.map((file) => ({ ...file, downloadName: lessonDownloadFileName(activity.lesson_title, file.name) })),
        ),
      )
  const questionPaperPath = body.success ? body.data.questionPaperPath ?? null : null
  const questionPaperUrl =
    questionPaperPath && !downloadsBlocked && sits ? assessmentScriptUrl(questionPaperPath) : null

  const base = {
    activityId,
    pupilId,
    instructions,
    questionPaperUrl,
    downloads,
    suppliedImages,
    downloadsBlocked,
  }

  if (!body.success) {
    return {
      ...base,
      slots: [],
      missingRequired: [],
      handedIn: false,
      markState: "not-handed-in",
      hasReadError: false,
      feedback: null,
      notSetUp: true,
    }
  }

  const state = await readPracticalSlots(activityId, pupilId)
  const slots = state.slots.map((slot): PupilPowerPointSlot => ({
    key: slot.key,
    label: slot.label,
    kind: slot.kind,
    required: slot.required,
    hint: slot.hint,
    file: slot.file
      ? {
          name: slot.file.name,
          bytes: slot.file.bytes,
          uploadedAt: slot.file.uploadedAt,
          url: downloadsBlocked ? null : slot.file.url,
          readError: slot.file.evidenceStatus === "error" ? slot.file.evidenceError || "This file could not be read." : null,
        }
      : null,
  }))
  const markState = powerPointMarkState(state.handedIn, state.markStatus)

  return {
    ...base,
    slots,
    missingRequired: state.missingRequired,
    handedIn: state.handedIn,
    markState,
    hasReadError: slots.some((slot) => slot.file?.readError),
    feedback: state.handedIn ? await readFeedback(activityId, pupilId, viewerIsTeacher, markState, downloadsBlocked) : null,
    notSetUp: false,
  }
}

async function readFeedback(
  activityId: string,
  pupilId: string,
  viewerIsTeacher: boolean,
  markState: PupilPowerPointMarkState,
  downloadsBlocked: boolean,
): Promise<PupilAssessmentFeedback | null> {
  // Never half-marked work while the marker is still going.
  if (markState === "waiting") return null
  if (!viewerIsTeacher && !(await pupilFeedbackVisible(activityId, pupilId))) return null

  const result = await readAssessmentPaperResult(activityId, pupilId)
  // Held work shows only what a teacher has marked, and nothing at all until
  // there is one (powerPointQuestionShownToPupil).
  const shown = (question: { provenance: string | null }) => powerPointQuestionShownToPupil(markState, question)
  if (markState !== "marked" && !result.questions.some(shown)) return null
  return buildPupilAssessmentFeedback(result, {
    shown,
    feedbackPdfUrl: downloadsBlocked ? null : assessmentFeedbackPdfUrl(activityId, pupilId),
  })
}
