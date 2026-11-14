import "server-only"

import { query } from "@/lib/db"
import { isPowerPointAssessmentType } from "@/dino.config"
import { assertPupilSitsAssessment } from "@/lib/assessment-paper/files"
import {
  assessmentScriptUrl,
  pupilFeedbackVisible,
  readAssessmentPaperResult,
  readOverallTeacherFeedback,
} from "@/lib/assessment-paper/results"
import { effectiveQuestionCriterionFeedback } from "@/lib/assessment-paper/store"
import { assessmentFeedbackPdfUrl } from "@/lib/assessment-paper/urls"
import { isLessonLockedForUser } from "@/lib/lesson-lock"
import { LESSONS_BUCKET, listSuppliedImages, readPracticalSlots } from "@/lib/powerpoint-assessment/files"
import { pastVersionNames } from "@/lib/storage/file-versions"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { PowerPointAssessmentActivityBodySchema, type PowerPointUploadSlotKind } from "@/types"

// A PowerPoint assessment on the pupil's lesson page: the task, the files the
// pupil needs, one upload slot per file they hand in, Hand in, where marking
// has got to and, once feedback is released, their marks task by task.
//
// Built on the server for the pupil, so it carries nothing that is not
// theirs to see: never the mark scheme (its PDF or any question's text), the
// evidence each question reads, what the reader extracted, the marker's
// evidence note, the AI's own mark beside a teacher's, or the submission's
// mark_error (it is written for the teacher and can name questions and their
// mark schemes). A file the reader refused shows its reader message, which is
// written for whoever uploaded the file.

export type PupilPowerPointMarkState =
  /** Not handed in yet (files may be uploaded). */
  | "not-handed-in"
  /** Handed in, marking queued or under way. */
  | "waiting"
  /** Every question marked. */
  | "marked"
  /** Handed in but stopped: a file could not be read, or the teacher has something to look at. */
  | "held"

export type PupilPowerPointSlot = {
  key: string
  label: string
  kind: PowerPointUploadSlotKind
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

export type PupilPowerPointDownload = { name: string; url: string }

export type PupilPowerPointCriterionComment =
  | { source: "teacher"; text: string }
  | { source: "ai"; whyNotAwarded: string | null; howToImprove: string | null }

export type PupilPowerPointQuestionFeedback = {
  label: string
  questionText: string | null
  /** Null when this question has no mark yet. */
  awarded: number | null
  available: number
  /** One per criterion that has something to say, in criterion order. */
  comments: PupilPowerPointCriterionComment[]
}

export type PupilPowerPointFeedback = {
  maxMarks: number
  /** Null until any question is marked. */
  marksAwarded: number | null
  /** The teacher's overall comment on the activity. */
  teacherComment: string | null
  /** The feedback PDF, built when it is downloaded; null while downloads are blocked (locked lesson). */
  feedbackPdfUrl: string | null
  questions: PupilPowerPointQuestionFeedback[]
}

export type PupilPowerPointView = {
  activityId: string
  pupilId: string
  instructions: string | null
  /** Null when there is none, while downloads are blocked, or the pupil does not sit it. */
  questionPaperUrl: string | null
  /** The activity's files and the images the task supplies. Empty while downloads are blocked. */
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
  feedback: PupilPowerPointFeedback | null
  /** The activity is not set up for pupils yet (no upload slots). */
  notSetUp: boolean
}

const IN_FLIGHT = new Set(["waiting", "marking", "queued", "pending"])

/** Where a pupil's PowerPoint work has got to, as they see it (and as their feedback PDF follows). */
export function powerPointMarkState(handedIn: boolean, markStatus: string | null): PupilPowerPointMarkState {
  if (!handedIn) return "not-handed-in"
  if (markStatus === "marked") return "marked"
  if (markStatus && IN_FLIGHT.has(markStatus)) return "waiting"
  // null after hand-in (held with a reason), 'marking-error', 'reading-error'.
  return "held"
}

/**
 * Whether a pupil sees a question's marks: all of them once the work is
 * marked; on held work only a question with a teacher's mark on it
 * (question provenance 'teacher'), never the marker's marks or 0s on the rest.
 */
export function powerPointQuestionShownToPupil(
  markState: PupilPowerPointMarkState,
  question: { provenance: string | null },
): boolean {
  return markState === "marked" || question.provenance === "teacher"
}

/** The activity's own files (current versions only), as the lesson's file-download activities list them. */
async function readActivityDownloads(lessonId: string, activityId: string): Promise<PupilPowerPointDownload[]> {
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
    .filter((file): file is PupilPowerPointDownload => file !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The pupil's view of a PowerPoint assessment. `viewerIsTeacher` skips the
 * feedback-visibility check and the lesson lock (a teacher previewing, or
 * looking at a pupil's page).
 */
export async function readPupilPowerPointView(
  activityId: string,
  pupilId: string,
  viewerIsTeacher: boolean,
): Promise<PupilPowerPointView> {
  const { rows } = await query<{ lesson_id: string; type: string | null; body_data: unknown }>(
    "select lesson_id, type, body_data from activities where activity_id = $1",
    [activityId],
  )
  const activity = rows[0]
  if (!activity) throw new Error("Activity not found.")
  if (!isPowerPointAssessmentType(activity.type)) throw new Error("This activity is not a PowerPoint assessment.")
  const lessonId = activity.lesson_id
  const body = PowerPointAssessmentActivityBodySchema.safeParse(activity.body_data ?? {})
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
        listSuppliedImages(activityId).then((images) => images.map((image) => ({ name: image.file_name, url: image.url }))),
      ])
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
): Promise<PupilPowerPointFeedback | null> {
  // Never half-marked work while the marker is still going.
  if (markState === "waiting") return null
  if (!viewerIsTeacher && !(await pupilFeedbackVisible(activityId, pupilId))) return null

  const result = await readAssessmentPaperResult(activityId, pupilId)
  // Held work shows only what a teacher has marked, and nothing at all until
  // there is one (powerPointQuestionShownToPupil).
  const held = markState !== "marked"
  const shown = (question: (typeof result.questions)[number]) => powerPointQuestionShownToPupil(markState, question)
  if (held && !result.questions.some(shown)) return null
  const marksAwarded = held
    ? result.questions.filter(shown).reduce((sum, question) => sum + (question.awarded ?? 0), 0)
    : result.marksAwarded

  return {
    maxMarks: result.maxMarks,
    marksAwarded,
    teacherComment: await readOverallTeacherFeedback(activityId, pupilId),
    feedbackPdfUrl: downloadsBlocked ? null : assessmentFeedbackPdfUrl(activityId, pupilId),
    questions: result.questions.map((question) => ({
      label: question.label,
      questionText: question.questionText,
      awarded: shown(question) ? question.awarded : null,
      available: question.available,
      comments: !shown(question) ? [] : question.criteria.flatMap((criterion): PupilPowerPointCriterionComment[] => {
        const shown = effectiveQuestionCriterionFeedback(criterion)
        if (!shown) return []
        // Only the fields a pupil reads, whatever the helper returns.
        return shown.source === "teacher"
          ? [{ source: "teacher", text: shown.text }]
          : [{ source: "ai", whyNotAwarded: shown.whyNotAwarded, howToImprove: shown.howToImprove }]
      }),
    })),
  }
}
