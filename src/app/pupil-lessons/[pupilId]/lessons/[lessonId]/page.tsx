import type { ReactNode } from "react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { differenceInCalendarDays, format, parseISO } from "date-fns"
import { ArrowLeft, Lock } from "lucide-react"

import { requireAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query, withDbClient } from "@/lib/db"
import { readLessonUnderstanding } from "@/lib/lesson-understanding/store"
import { lessonDueDate } from "@/lib/lesson-due-date"
import { resolveActivityImageUrl } from "@/lib/activity-assets"
import { loadPupilLessonsSummaries } from "@/lib/pupil-lessons-data"
import {
  checkLessonAccessForPupilAction,
  readLessonDetailBootstrapAction,
  listActivityFilesAction,
  listPupilActivitySubmissionsAction,
  getLatestSubmissionForActivityAction,
  readLessonSubmissionSummariesAction,
  getActivityFileDownloadUrlAction,
} from "@/lib/server-updates"
import { isScorableActivityType } from "@/dino.config"
import { cn } from "@/lib/utils"
import { findLessonResources } from "@/lib/lesson-resources"
import { loadCourseUnits, loadLessonPosition, loadSubmittedActivityIds } from "@/lib/pupil-lesson-article-data"
import { PupilUploadActivity } from "@/components/pupil/pupil-upload-activity"
import { PupilUploadCodeActivity } from "@/components/pupil/pupil-upload-code-activity"
import { highlightCode, renderTaskMarkup } from "@/lib/code-highlight"
import { PupilUploadSpreadsheetActivity } from "@/components/pupil/pupil-upload-spreadsheet-activity"
import { PupilUploadWorksheetActivity } from "@/components/pupil/pupil-upload-worksheet-activity"
import { PupilMcqActivity } from "@/components/pupil/pupil-mcq-activity"
import { PupilMatcherActivity } from "@/components/pupil/pupil-matcher-activity"
import { PupilGroupItemsActivity } from "@/components/pupil/pupil-group-items-activity"
import { PupilSequenceActivity } from "@/components/pupil/pupil-sequence-activity"
import { ImageLightbox } from "@/components/pupil/image-lightbox"
import { PupilDoFlashcardsActivity } from "@/components/pupil/pupil-do-flashcards-activity"
import { PupilFeedbackActivity } from "@/components/pupil/pupil-feedback-activity"
import { PupilShortTextActivity } from "@/components/pupil/pupil-short-text-activity"
import { PupilLongTextActivity } from "@/components/pupil/pupil-long-text-activity"
import { PupilUploadUrlActivity } from "@/components/pupil/pupil-upload-url-activity"
import { PupilSketchRenderActivity } from "@/components/lessons/activity-view/pupil-sketch-render-activity"
import { PupilShareMyWorkActivity } from "@/components/pupil/pupil-share-my-work-activity"
import { PupilReviewOthersWorkActivity } from "@/components/pupil/pupil-review-others-work-activity"
import { ArticleActivity, type ArticleActivityVariant } from "@/components/lesson-article/article-activity"
import { ArrowLeftIcon, LockIcon } from "@/components/lesson-article/icons"
import { LessonContents, type ContentsSection } from "@/components/lesson-article/lesson-contents"
import { LessonFooter } from "@/components/lesson-article/lesson-footer"
import { LessonObjectives } from "@/components/lesson-article/lesson-objectives"
import { LessonProgressProvider } from "@/components/lesson-article/lesson-progress"
import { ResourceCards } from "@/components/lesson-article/resource-cards"
import { lessonArticleFontClass } from "@/components/lesson-article/fonts"
import {
  GroupItemsActivityBodySchema,
  GroupItemsSubmissionBodySchema,
  SequenceActivityBodySchema,
  SequenceSubmissionBodySchema,
  LegacyMcqSubmissionBodySchema,
  LongTextSubmissionBodySchema,
  MatcherSubmissionBodySchema,
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
  UploadSpreadsheetActivityBodySchema,
  UploadSpreadsheetSubmissionBodySchema,
  UploadUrlSubmissionBodySchema,
} from "@/types"
import { extractScoreFromSubmission } from "@/lib/scoring/activity-scores"
import { fetchPupilActivityFeedbackMap, selectLatestFeedbackEntry } from "@/lib/feedback/pupil-activity-feedback"
import {
  getActivityTextValue,
  getDisplayWebpageBody,
  getFlashcardsText,
  getRichTextMarkup,
  getYouTubeVideoId,
} from "@/components/lessons/activity-view/utils"
import { FeedbackVisibilityProvider } from "./feedback-visibility-debug"
import { interventionAllowsPupil } from "@/lib/interventions/store"
import { isLessonLockedForUser } from "@/lib/lesson-lock"
import { LockedWhen } from "./locked-when"

type McqOption = { id: string; text: string }

function getMcqBodyServer(activity: { body_data: unknown }) {
  const defaultOptions: McqOption[] = [
    { id: "option-1", text: "Option 1" },
    { id: "option-2", text: "Option 2" },
  ]

  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { question: "", options: defaultOptions, correctOptionId: defaultOptions[0].id }
  }

  const record = activity.body_data as Record<string, unknown>
  const question = typeof record.question === "string" ? record.question : ""
  const optionsRaw = Array.isArray(record.options) ? record.options : []
  const options =
    optionsRaw.map((item, index) => {
      if (!item || typeof item !== "object") {
        return { id: `option-${index + 1}`, text: "" }
      }
      const option = item as Record<string, unknown>
      const id =
        typeof option.id === "string" && option.id.trim() !== ""
          ? option.id.trim()
          : `option-${index + 1}`
      const text = typeof option.text === "string" ? option.text : ""
      return { id, text }
    }) ?? defaultOptions

  const normalizedOptions = options.length > 0 ? options : defaultOptions
  const fallbackOptionId = normalizedOptions[0]?.id ?? defaultOptions[0].id
  const candidateCorrectId = typeof record.correctOptionId === "string" ? record.correctOptionId.trim() : null
  const correctOptionId = normalizedOptions.some((option) => option.id === candidateCorrectId)
    ? candidateCorrectId!
    : fallbackOptionId

  return {
    question,
    options: normalizedOptions,
    correctOptionId,
  }
}

function getShortTextBodyServer(activity: { body_data: unknown }) {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { question: "", modelAnswer: "" }
  }

  const record = activity.body_data as Record<string, unknown>
  const question = typeof record.question === "string" ? record.question : ""
  const modelAnswer = typeof record.modelAnswer === "string" ? record.modelAnswer : ""

  return { question, modelAnswer }
}

function getUploadUrlBodyServer(activity: { body_data: unknown }) {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { question: "" }
  }

  const record = activity.body_data as Record<string, unknown>
  const question = typeof record.question === "string" ? record.question : ""

  return { question }
}

function getLongTextBodyServer(activity: { body_data: unknown }) {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { question: "" }
  }

  const record = activity.body_data as Record<string, unknown>
  const question =
    typeof record.question === "string"
      ? record.question
      : typeof record.text === "string"
        ? record.text
        : ""

  return { question }
}

function shuffleArray<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function formatActivityType(type: string | null | undefined): string {
  if (!type) return ""
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function looksLikeImageUrl(url: string | null | undefined) {
  if (!url) return false
  const [base] = url.split("?")
  if (!base) return false
  return /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(base)
}

/** The heading shown in the Warm Study card header for an activity. */
function getActivityQuestion(activity: { body_data: unknown; title: string }): string {
  const body = activity.body_data
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>
    for (const key of ["question", "task", "instructions"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim().length > 0) return value.trim()
    }
  }
  return activity.title || ""
}

function extractActivityLink(activity: { body_data: unknown; title: string }) {
  const bodyData = activity.body_data
  if (typeof bodyData !== "object" || bodyData === null) {
    return null
  }

  const record = bodyData as Record<string, unknown>
  const candidateKeys = ["url", "fileUrl", "href", "videoUrl", "file_url"]

  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  const nestedLink = record.link
  if (typeof nestedLink === "object" && nestedLink !== null) {
    const nestedUrl = (nestedLink as Record<string, unknown>).url
    if (typeof nestedUrl === "string" && nestedUrl.trim().length > 0) {
      return nestedUrl.trim()
    }
  }

  return null
}

function extractAudioUrl(activity: { body_data: unknown; type?: string | null }) {
  const normalizedType = typeof activity.type === "string" ? activity.type.toLowerCase() : ""
  if (normalizedType === "display-image") {
    return null
  }

  const bodyData = activity.body_data
  if (typeof bodyData !== "object" || bodyData === null) {
    return null
  }

  const record = bodyData as Record<string, unknown>
  const candidateKeys = ["audioFile", "audioUrl"]

  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  const voiceField = record.voice
  if (typeof voiceField === "string" && voiceField.trim().length > 0) {
    return voiceField.trim()
  }

  if (typeof voiceField === "object" && voiceField !== null) {
    const nestedRecord = voiceField as Record<string, unknown>
    const nestedUrl = nestedRecord.audioFile ?? nestedRecord.url
    if (typeof nestedUrl === "string" && nestedUrl.trim().length > 0) {
      return nestedUrl.trim()
    }
  }

  return null
}

function extractUploadInstructions(activity: { body_data: unknown }) {
  const bodyData = activity.body_data
  if (typeof bodyData !== "object" || bodyData === null) {
    return ""
  }

  const record = bodyData as Record<string, unknown>
  const instructions = record.instructions
  return typeof instructions === "string" ? instructions : ""
}

export default async function PupilLessonFriendlyPage({
  params,
}: {
  params: Promise<{ pupilId: string; lessonId: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const { pupilId, lessonId } = await params

  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/pupil-lessons/${encodeURIComponent(profile.userId)}`)
  }

  if (!profile.isTeacher) {
    // Another pupil's intervention looks exactly like a lesson that does not exist.
    if (!(await interventionAllowsPupil(pupilId, lessonId))) {
      notFound()
    }
    const access = await checkLessonAccessForPupilAction(pupilId, lessonId)
    if (!access.accessible) {
      return (
        <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-20 text-center">
          <Lock className="h-16 w-16 text-muted-foreground" />
          <h1 className="text-2xl font-semibold text-foreground">This lesson is not available</h1>
          <p className="text-muted-foreground">This lesson is not currently available to you. Please contact your teacher if you think this is an error.</p>
          <Link
            href={`/pupil-lessons/${encodeURIComponent(pupilId)}`}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to My Lessons
          </Link>
        </main>
      )
    }
  }

  const [summaries, lessonDetailResult, lessonSubmissionSummaries] = await Promise.all([
    loadPupilLessonsSummaries(pupilId),
    readLessonDetailBootstrapAction(lessonId),
    readLessonSubmissionSummariesAction(lessonId, { userId: pupilId }),
  ])

  const summary = summaries[0]
  const lessonPayload = lessonDetailResult.data
  const lesson = lessonPayload?.lesson ?? null
  if (!lesson) {
    notFound()
  }

  // Same rule as /lessons/[id]: dropping it from the lists is not enough if the
  // URL still renders it. A teacher reviewing a pupil's work keeps seeing it.
  if (!hasRole(profile, "teacher")) {
    const { rows } = await query<{ hidden_from_pupils: boolean }>(
      "select hidden_from_pupils from lessons where lesson_id = $1",
      [lessonId],
    )
    if (rows[0]?.hidden_from_pupils) {
      notFound()
    }
  }

  const unit = lessonPayload?.unit ?? null
  const activities = (lessonPayload?.lessonActivities ?? []).filter((activity) => activity.active !== false)
  const lessonFiles = lessonPayload?.lessonFiles ?? []

  const activityIds = activities.map((activity) => activity.activity_id)
  const latestFeedbackByActivity = new Map<string, string | null>()
  if (activityIds.length > 0) {
    try {
      const feedbackLookup = await fetchPupilActivityFeedbackMap({
        activityIds,
        pupilIds: [pupilId],
      })
      if (feedbackLookup.error) {
        console.error("[pupil-lessons] Failed to load pupil feedback entries:", feedbackLookup.error)
      } else {
        for (const rows of feedbackLookup.data.values()) {
          const latest = selectLatestFeedbackEntry(rows, ["teacher", "ai", "auto"])
          if (latest) {
            const trimmed =
              typeof latest.feedback_text === "string" && latest.feedback_text.trim().length > 0
                ? latest.feedback_text.trim()
                : null
            latestFeedbackByActivity.set(latest.activity_id, trimmed)
          }
        }
      }
    } catch (error) {
      console.error("[pupil-lessons] Unexpected error loading pupil feedback entries:", error)
    }
  }

  const displayImageUrlEntries = await Promise.all(
    activities
      .filter((activity) => activity.type === "display-image")
      .map(async (activity) => {
        const url = await resolveActivityImageUrl(lesson.lesson_id, activity)
        return [activity.activity_id, url ?? null] as const
      }),
  )
  const displayImageUrlMap = new Map(displayImageUrlEntries)
  
  const fileDownloadActivities = activities.filter((activity) => activity.type === "file-download")
  const fileDownloadUrlEntries = await Promise.all(
    fileDownloadActivities.map(async (activity) => {
      const filesResult = await listActivityFilesAction(lesson.lesson_id, activity.activity_id)
      if (filesResult.error || !filesResult.data || filesResult.data.length === 0) {
        return [activity.activity_id, [] as { name: string; url: string | null | undefined }[]] as const
      }
      
      const filesWithUrls = await Promise.all(
        filesResult.data.map(async (file) => {
          const urlResult = await getActivityFileDownloadUrlAction(lesson.lesson_id, activity.activity_id, file.name)
          return { name: file.name, url: urlResult.success ? urlResult.url : null }
        })
      )
      
      return [activity.activity_id, filesWithUrls] as const
    })
  )
  const fileDownloadUrlMap = new Map(fileDownloadUrlEntries)

  const uploadActivities = activities.filter((activity) => activity.type === "upload-file")

  const uploadActivityData = await Promise.all(
    uploadActivities.map(async (activity) => {
      const submissionsResult = await listPupilActivitySubmissionsAction(
        lesson.lesson_id,
        activity.activity_id,
        pupilId,
      )

      return {
        activityId: activity.activity_id,
        submissions: submissionsResult.error ? [] : submissionsResult.data ?? [],
      }
    }),
  )

  const submissionMap = new Map(uploadActivityData.map((item) => [item.activityId, item.submissions]))

  const uploadCodeActivities = activities.filter((activity) => activity.type === "upload-code")
  const uploadCodeEntries = await Promise.all(
    uploadCodeActivities.map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      const body = (result.data?.body ?? null) as { code?: unknown } | null
      const code = typeof body?.code === "string" ? body.code : ""
      const bodyData = (activity.body_data ?? {}) as Record<string, unknown>
      const language =
        typeof bodyData.language === "string" && bodyData.language.trim() ? bodyData.language : "python"
      return {
        activityId: activity.activity_id,
        html: code ? highlightCode(code, language) : null,
      }
    }),
  )
  const uploadCodeHtmlMap = new Map(uploadCodeEntries.map((entry) => [entry.activityId, entry.html]))

  const uploadSpreadsheetActivities = activities.filter((activity) => activity.type === "upload-spreadsheet")
  const uploadSpreadsheetFileNameEntries = await Promise.all(
    uploadSpreadsheetActivities.map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      const body = (result.data?.body ?? null) as { fileName?: string } | null
      const fileName = typeof body?.fileName === "string" && body.fileName.trim().length > 0 ? body.fileName : null
      return [activity.activity_id, fileName] as const
    }),
  )
  const uploadSpreadsheetFileNameMap = new Map(uploadSpreadsheetFileNameEntries)

  const uploadWorksheetActivities = activities.filter(
    (activity) => activity.type === "upload-worksheet" || activity.type === "mark-worksheet",
  )
  const uploadWorksheetFileEntries = await Promise.all(
    uploadWorksheetActivities.map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      const body = (result.data?.body ?? null) as { fileName?: string; filePath?: string } | null
      const fileName = typeof body?.fileName === "string" && body.fileName.trim().length > 0 ? body.fileName : null
      const filePath = typeof body?.filePath === "string" && body.filePath.trim().length > 0 ? body.filePath : null
      const fileUrl = filePath ? `/api/files/${filePath.split("/").map(encodeURIComponent).join("/")}` : null
      return [activity.activity_id, { fileName, fileUrl }] as const
    }),
  )
  const uploadWorksheetFileNameMap = new Map(
    uploadWorksheetFileEntries.map(([activityId, { fileName }]) => [activityId, fileName]),
  )
  const uploadWorksheetFileUrlMap = new Map(
    uploadWorksheetFileEntries.map(([activityId, { fileUrl }]) => [activityId, fileUrl]),
  )

  // Load share-my-work submissions (own files for each activity)
  type ShareMyWorkData = { submissionId: string | null; files: Array<{ fileId: string; fileName: string; mimeType: string; order: number }> }
  const shareMyWorkActivities = activities.filter((activity) => activity.type === "share-my-work")
  const shareMyWorkDataEntries = await Promise.all(
    shareMyWorkActivities.map(async (activity): Promise<[string, ShareMyWorkData]> => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (!result.data) return [activity.activity_id, { submissionId: null, files: [] }]
      const body = (result.data.body ?? {}) as { files?: Array<{ fileId: string; fileName: string; mimeType: string; order: number }> }
      return [activity.activity_id, {
        submissionId: result.data.submission_id,
        files: Array.isArray(body.files) ? body.files : [],
      }]
    }),
  )
  const shareMyWorkDataMap = new Map(shareMyWorkDataEntries)

  const mcqActivities = activities.filter((activity) => activity.type === "multiple-choice-question")
  const activityFeedbackMap = new Map<string, string | null>()
  const activityModelAnswerMap = new Map<string, string | null>()

  await Promise.all(
    [...uploadSpreadsheetActivities, ...uploadWorksheetActivities].map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return
      }
      const extraction = extractScoreFromSubmission(activity.type ?? "", result.data.body, [], activity.max_marks ?? 1, {
        question: null,
        correctAnswer: null,
        optionTextMap: undefined,
      })
      activityFeedbackMap.set(
        activity.activity_id,
        extraction.feedback ?? extraction.autoFeedback ?? null,
      )
    }),
  )

  const mcqSubmissionEntries = await Promise.all(
    mcqActivities.map(async (activity) => {
      const mcqBody = getMcqBodyServer(activity)
      const optionTextMap = Object.fromEntries(
        mcqBody.options.map((option) => [option.id, option.text?.trim() || option.id]),
      )
      const correctOptionText = optionTextMap[mcqBody.correctOptionId] ?? null
      const questionText = mcqBody.question?.trim() || null
      activityModelAnswerMap.set(activity.activity_id, correctOptionText)

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return { activityId: activity.activity_id, optionId: null as string | null }
      }

      const parsedBody = McqSubmissionBodySchema.safeParse(result.data.body)
      if (parsedBody.success) {
        const extraction = extractScoreFromSubmission(activity.type ?? "", result.data.body, [], activity.max_marks ?? 1, {
          question: questionText,
          correctAnswer: correctOptionText,
          optionTextMap,
        })
      const latestFeedback = latestFeedbackByActivity.get(activity.activity_id)
      activityFeedbackMap.set(
        activity.activity_id,
        latestFeedback ?? extraction.feedback ?? extraction.autoFeedback ?? null,
      )
        return {
          activityId: activity.activity_id,
          optionId: parsedBody.data.answer_chosen,
        }
      }

      const legacyBody = LegacyMcqSubmissionBodySchema.safeParse(result.data.body)
      if (legacyBody.success) {
        return {
          activityId: activity.activity_id,
          optionId: legacyBody.data.optionId,
        }
      }

      console.warn("[pupil-lessons] Ignoring malformed MCQ submission body", parsedBody.error)
      return { activityId: activity.activity_id, optionId: null as string | null }
    }),
  )

  const mcqSelectionMap = new Map(mcqSubmissionEntries.map((entry) => [entry.activityId, entry.optionId]))

  const matcherActivities = activities.filter((activity) => activity.type === "matcher")

  const matcherSubmissionEntries = await Promise.all(
    matcherActivities.map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return {
          activityId: activity.activity_id,
          layout: [] as { pairId: string; promptSide: "term" | "definition" }[],
          answers: {} as Record<string, string | null>,
        }
      }

      const parsedBody = MatcherSubmissionBodySchema.safeParse(result.data.body)
      if (!parsedBody.success) {
        console.warn("[pupil-lessons] Ignoring malformed matcher submission body", parsedBody.error)
        return {
          activityId: activity.activity_id,
          layout: [] as { pairId: string; promptSide: "term" | "definition" }[],
          answers: {} as Record<string, string | null>,
        }
      }

      return {
        activityId: activity.activity_id,
        layout: parsedBody.data.layout,
        answers: parsedBody.data.answers,
      }
    }),
  )

  const matcherDataMap = new Map(matcherSubmissionEntries.map((entry) => [entry.activityId, entry]))

  const groupItemsActivities = activities.filter((activity) => activity.type === "group-items")

  const groupItemsSubmissionEntries = await Promise.all(
    groupItemsActivities.map(async (activity) => {
      const parsedActivityBody = GroupItemsActivityBodySchema.safeParse(activity.body_data)
      const groups = parsedActivityBody.success
        ? parsedActivityBody.data.groups.map((group) => ({ id: group.id, name: group.name }))
        : []
      const items = parsedActivityBody.success
        ? parsedActivityBody.data.items.map((item) => ({
            id: item.id,
            text: item.text,
            imageUrl: item.imageUrl ?? null,
          }))
        : []

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return {
          activityId: activity.activity_id,
          groups,
          items,
          itemOrder: [] as string[],
          placements: {} as Record<string, string | null>,
        }
      }

      const parsedBody = GroupItemsSubmissionBodySchema.safeParse(result.data.body)
      if (!parsedBody.success) {
        console.warn("[pupil-lessons] Ignoring malformed group-items submission body", parsedBody.error)
        return {
          activityId: activity.activity_id,
          groups,
          items,
          itemOrder: [] as string[],
          placements: {} as Record<string, string | null>,
        }
      }

      return {
        activityId: activity.activity_id,
        groups,
        items,
        itemOrder: parsedBody.data.itemOrder,
        placements: parsedBody.data.placements,
      }
    }),
  )

  const groupItemsDataMap = new Map(groupItemsSubmissionEntries.map((entry) => [entry.activityId, entry]))

  const sequenceActivities = activities.filter((activity) => activity.type === "sequence")

  const sequenceSubmissionEntries = await Promise.all(
    sequenceActivities.map(async (activity) => {
      const parsedActivityBody = SequenceActivityBodySchema.safeParse(activity.body_data)
      const terms = parsedActivityBody.success
        ? parsedActivityBody.data.terms.map((term) => ({ id: term.id, text: term.text }))
        : []
      const termIds = terms.map((term) => term.id)

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      let savedOrder: string[] = []
      let correctIds: string[] = []
      let attempts = 0
      if (!result.error && result.data) {
        const parsedBody = SequenceSubmissionBodySchema.safeParse(result.data.body)
        if (parsedBody.success) {
          savedOrder = parsedBody.data.order
          correctIds = parsedBody.data.correctIds
          attempts = result.data.attempt_number
        }
      }

      // Display order: the pupil's saved arrangement if still valid, otherwise a
      // shuffle. The correct order is never sent to the client.
      const validSaved =
        savedOrder.length === termIds.length && termIds.every((id) => savedOrder.includes(id))
      const displayOrder = validSaved ? savedOrder : shuffleArray(termIds)
      const termsById = new Map(terms.map((term) => [term.id, term]))
      const orderedTerms = displayOrder
        .map((id) => termsById.get(id))
        .filter((term): term is { id: string; text: string } => Boolean(term))

      return {
        activityId: activity.activity_id,
        terms: orderedTerms,
        correctIds,
        attempts,
      }
    }),
  )

  const sequenceDataMap = new Map(sequenceSubmissionEntries.map((entry) => [entry.activityId, entry]))

  const shortTextActivities = activities.filter((activity) => activity.type === "short-text-question")
  const longTextActivities = activities.filter(
    (activity) => activity.type === "long-text-question" || activity.type === "text-question",
  )

  const shortTextSubmissionEntries = await Promise.all(
    shortTextActivities.map(async (activity) => {
      const shortTextBody = getShortTextBodyServer(activity)
      const modelAnswer = shortTextBody.modelAnswer?.trim() || null
      const questionText = shortTextBody.question?.trim() || null
      activityModelAnswerMap.set(activity.activity_id, modelAnswer)

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return { activityId: activity.activity_id, answer: "", submissionId: null, isFlagged: false, resubmitRequested: false, resubmitNote: null as string | null }
      }

      const parsedBody = ShortTextSubmissionBodySchema.safeParse(result.data.body)
      if (parsedBody.success) {
        const extraction = extractScoreFromSubmission(activity.type ?? "", result.data.body, [], activity.max_marks ?? 1, {
          question: questionText,
          correctAnswer: modelAnswer,
          optionTextMap: undefined,
        })
        const latestFeedback = latestFeedbackByActivity.get(activity.activity_id)
        activityFeedbackMap.set(
          activity.activity_id,
          latestFeedback ?? extraction.feedback ?? extraction.autoFeedback ?? null,
        )
        return {
          activityId: activity.activity_id,
          answer: parsedBody.data.answer ?? "",
          submissionId: result.data.submission_id,
          isFlagged: result.data.is_flagged ?? false,
          resubmitRequested: result.data.resubmit_requested ?? false,
          resubmitNote: result.data.resubmit_note ?? null,
        }
      }

      return { activityId: activity.activity_id, answer: "", submissionId: result.data.submission_id, isFlagged: result.data.is_flagged ?? false, resubmitRequested: result.data.resubmit_requested ?? false, resubmitNote: result.data.resubmit_note ?? null }
    }),
  )

  const shortTextDataMap = new Map(shortTextSubmissionEntries.map((entry) => [entry.activityId, entry]))

  await Promise.all(
    uploadSpreadsheetActivities.map(async (activity) => {
      const activityBody = UploadSpreadsheetActivityBodySchema.safeParse(activity.body_data)
      const questionText = activityBody.success ? activityBody.data.task?.trim() || null : null

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return
      }

      const parsedBody = UploadSpreadsheetSubmissionBodySchema.safeParse(result.data.body)
      if (!parsedBody.success) {
        return
      }

      const extraction = extractScoreFromSubmission(activity.type ?? "", result.data.body, [], activity.max_marks ?? 1, {
        question: questionText,
        correctAnswer: null,
        optionTextMap: undefined,
      })
      const latestFeedback = latestFeedbackByActivity.get(activity.activity_id)
      activityFeedbackMap.set(
        activity.activity_id,
        latestFeedback ?? extraction.feedback ?? extraction.autoFeedback ?? null,
      )
    }),
  )

  const longTextSubmissionEntries = await Promise.all(
    longTextActivities.map(async (activity) => {
      const longTextBody = getLongTextBodyServer(activity)
      const questionText = longTextBody.question?.trim() || null
      activityModelAnswerMap.set(activity.activity_id, null)

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return { activityId: activity.activity_id, answer: "" }
      }

      const parsedBody = LongTextSubmissionBodySchema.safeParse(result.data.body)
      if (parsedBody.success) {
        const extraction = extractScoreFromSubmission(activity.type ?? "", result.data.body, [], activity.max_marks ?? 1, {
          question: questionText,
          correctAnswer: null,
          optionTextMap: undefined,
        })
        const latestFeedback = latestFeedbackByActivity.get(activity.activity_id)
        activityFeedbackMap.set(
          activity.activity_id,
          latestFeedback ?? extraction.feedback ?? extraction.autoFeedback ?? null,
        )
        return {
          activityId: activity.activity_id,
          answer: parsedBody.data.answer ?? "",
        }
      }

      return { activityId: activity.activity_id, answer: "" }
    }),
  )

  const longTextAnswerMap = new Map(longTextSubmissionEntries.map((entry) => [entry.activityId, entry.answer ?? ""]))

  const uploadUrlActivities = activities.filter((activity) => activity.type === "upload-url")
  const uploadUrlSubmissionEntries = await Promise.all(
    uploadUrlActivities.map(async (activity) => {
      const uploadUrlBody = getUploadUrlBodyServer(activity)
      const questionText = uploadUrlBody.question?.trim() || null
      activityModelAnswerMap.set(activity.activity_id, null)

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return {
          activityId: activity.activity_id,
          answer: "",
          submissionId: null,
          isFlagged: false,
          resubmitRequested: false,
          resubmitNote: null as string | null,
        }
      }

      const parsedBody = UploadUrlSubmissionBodySchema.safeParse(result.data.body)
      if (parsedBody.success) {
        const extraction = extractScoreFromSubmission(activity.type ?? "", result.data.body, [], activity.max_marks ?? 1, {
          question: questionText,
          correctAnswer: null,
          optionTextMap: undefined,
        })
        const latestFeedback = latestFeedbackByActivity.get(activity.activity_id)
        activityFeedbackMap.set(
          activity.activity_id,
          latestFeedback ?? extraction.feedback ?? extraction.autoFeedback ?? null,
        )
        return {
          activityId: activity.activity_id,
          answer: parsedBody.data.url ?? "",
          submissionId: result.data.submission_id,
          isFlagged: result.data.is_flagged ?? false,
          resubmitRequested: result.data.resubmit_requested ?? false,
          resubmitNote: result.data.resubmit_note ?? null,
        }
      }

      return {
        activityId: activity.activity_id,
        answer: "",
        submissionId: result.data.submission_id,
        isFlagged: result.data.is_flagged ?? false,
        resubmitRequested: result.data.resubmit_requested ?? false,
        resubmitNote: result.data.resubmit_note ?? null,
      }
    }),
  )

  const uploadUrlDataMap = new Map(uploadUrlSubmissionEntries.map((entry) => [entry.activityId, entry]))

  const sketchRenderActivities = activities.filter((activity) => activity.type === "sketch-render")
  const sketchRenderSubmissionEntries = await Promise.all(
    sketchRenderActivities.map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return { activityId: activity.activity_id, submission: null }
      }
      return { activityId: activity.activity_id, submission: result.data }
    })
  )
  const sketchRenderSubmissionMap = new Map(sketchRenderSubmissionEntries.map((entry) => [entry.activityId, entry.submission]))

  const isPupilViewer = profile.userId === pupilId
  const isTeacher = profile.isTeacher
  // A locked lesson is read-only for this pupil (migration 111). The server
  // refuses their writes, uploads and downloads too; this only stops the page
  // offering them. A teacher viewing a pupil's page sees the same banner.
  const isLocked = await isLessonLockedForUser(pupilId, lesson.lesson_id)
  const canWork = isPupilViewer && !isLocked
  const canDownload = isTeacher || !isLocked

  const assignments = summary
    ? summary.sections.flatMap((section) =>
        section.groups.flatMap((group) =>
          group.lessons
            .filter((lessonEntry) => lessonEntry.lessonId === lesson.lesson_id)
            .map((lessonEntry) => ({
              date: section.date,
              groupId: group.groupId,
              subject: group.subject,
              feedbackVisible: lessonEntry.feedbackVisible ?? false,
              assignmentId: `${group.groupId}__${lessonEntry.lessonId}`,
            })),
        ),
      )
    : []
  const realAssignmentIds = assignments.map((assignment) => assignment.assignmentId)
  // Teacher preview self-test: when a teacher previews a lesson that isn't
  // assigned to them, give the page a synthetic assignment id so their own
  // answers still enqueue for AI marking (queue -> n8n). Marking is applied to
  // the teacher's submission by (activity_id, user_id); the synthetic id only
  // shapes the queue payload and the realtime channel, so LiveActivityShell
  // (which shows feedback to teachers as soon as it's marked) surfaces it live.
  const isTeacherPreview = isTeacher && realAssignmentIds.length === 0
  // An intervention is never assigned to a class, so it has no real assignment
  // id. It gets a synthetic one, as a teacher preview does, so AI-marked
  // answers still enqueue and feedback still arrives live. Whether its marks
  // and feedback show is the intervention's own switch (on by default).
  const { rows: kindRows } = await query<{
    kind: string
    description: string | null
    feedback_visible: boolean | null
    due_date: Date | string | null
  }>(
    `select l.kind, l.description,
            (select ia.feedback_visible from intervention_assignments ia
              where ia.lesson_id = l.lesson_id and ia.active) as feedback_visible,
            (select ia.due_date from intervention_assignments ia
              where ia.lesson_id = l.lesson_id and ia.active) as due_date
       from lessons l where l.lesson_id = $1`,
    [lesson.lesson_id],
  )
  const isIntervention = kindRows[0]?.kind === "intervention"
  const assignmentIds = isTeacherPreview
    ? [`preview__${lesson.lesson_id}`]
    : isIntervention && realAssignmentIds.length === 0
      ? [`intervention__${lesson.lesson_id}`]
      : realAssignmentIds
  const initialFeedbackVisible = isIntervention
    ? kindRows[0]?.feedback_visible !== false
    : assignments.some((assignment) => assignment.feedbackVisible)

  // The latest attempt at each activity, so any marked answer can be flagged
  // for the teacher to check again, not only short-text ones.
  const { rows: latestFlagRows } = await query<{ activity_id: string; submission_id: string; is_flagged: boolean | null }>(
    `select distinct on (activity_id) activity_id, submission_id, is_flagged
       from submissions
      where user_id = $1 and activity_id = any($2::text[])
      order by activity_id, attempt_number desc, submitted_at desc nulls last, submission_id desc`,
    [pupilId, activities.map((activity) => activity.activity_id)],
  )
  const latestFlagMap = new Map(
    latestFlagRows.map((row) => [row.activity_id, { submissionId: row.submission_id, isFlagged: row.is_flagged === true }]),
  )

  const activityScoreMap = new Map<string, number | null | undefined>()
  const activityMarksMap = new Map<string, { marksAwarded: number | null; maxMarks: number } | undefined>()
  if (!lessonSubmissionSummaries.error) {
    (lessonSubmissionSummaries.data ?? []).forEach((entry) => {
      const viewerScore = entry.scores.find((score) => score.userId === pupilId)

      // If viewerScore is undefined, no submission exists (undefined).
      // If viewerScore exists but score is null/undefined, it's unmarked (null).
      // If score is a number, it's marked (number).
      let value: number | null | undefined = undefined
      if (viewerScore) {
          value = typeof viewerScore.score === "number" && Number.isFinite(viewerScore.score)
              ? viewerScore.score
              : null
      }

      activityScoreMap.set(entry.activityId, value)

      if (viewerScore) {
        activityMarksMap.set(entry.activityId, {
          marksAwarded: viewerScore.marksAwarded ?? null,
          maxMarks: viewerScore.maxMarks ?? 1,
        })
      }
    })
  }

  const formatScoreLabel = (score: number | null | undefined, activityId?: string) => {
    if (score === null) {
      const marksInfo = activityId ? activityMarksMap.get(activityId) : undefined
      if (marksInfo && marksInfo.marksAwarded !== null) {
        return `${marksInfo.marksAwarded}/${marksInfo.maxMarks}`
      }
      return "—"
    }
    if (typeof score === "number" && Number.isFinite(score)) {
      const marksInfo = activityId ? activityMarksMap.get(activityId) : undefined
      if (marksInfo && marksInfo.marksAwarded !== null) {
        return `${marksInfo.marksAwarded}/${marksInfo.maxMarks}`
      }
      return `${Math.round(score * 100)}%`
    }
    return "No score yet"
  }


  // --- Article data ---------------------------------------------------------
  const groupId = assignments[0]?.groupId ?? null
  // An intervention carries its own due date; a class lesson is due a week after it is taught.
  const dueDate = isIntervention ? toIsoDate(kindRows[0]?.due_date ?? null) : lessonDueDate(toIsoDate(assignments[0]?.date ?? null))
  const releasedToViewer = initialFeedbackVisible || isTeacher

  const lessonLinks = lesson.lesson_links ?? []
  const resources = findLessonResources({
    lessonId: lesson.lesson_id,
    activities: activities.map((activity) => {
      const webpage = activity.type === "display-webpage" ? getDisplayWebpageBody(activity) : null
      return {
        activityId: activity.activity_id,
        type: activity.type ?? "",
        title: activity.title ?? "",
        files: fileDownloadUrlMap.get(activity.activity_id) ?? [],
        linkUrl: webpage ? webpage.url || null : extractActivityLink(activity),
        webpageHref: webpage?.htmlFile ? `/api/activity-webpage/${encodeURIComponent(activity.activity_id)}` : null,
      }
    }),
    links: lessonLinks.map((link) => ({ url: link.url, description: link.description ?? null })),
    lessonFiles,
  })
  const resourceActivityIds = new Set(resources.map((resource) => resource.activityId).filter(Boolean))

  // The teacher's Display Section activities make the sections, each holding
  // the activities after it. A lesson without any is grouped by activity type.
  // Sections left empty (once resource cards are taken out) are dropped.
  const sections = buildSections(activities, resourceActivityIds).filter((section) => section.items.length > 0)
  if (sections.length === 0 && resources.length > 0) {
    sections.push({ key: "resources", title: "Resources", introHtml: null, items: [] })
  }
  const ordered = sections.flatMap((section) => section.items)
  const activityNumbers = new Map(ordered.map((activity, index) => [activity.activity_id, index + 1]))

  const countable = ordered.filter((activity) => isCountable(activity.type))
  const countableIds = countable.map((activity) => activity.activity_id)
  const [submittedIds, position, courseUnits, understanding] = await Promise.all([
    loadSubmittedActivityIds(pupilId, countableIds),
    unit ? loadLessonPosition(unit.unit_id, lesson.lesson_id, groupId) : Promise.resolve(null),
    groupId ? loadCourseUnits(groupId, pupilId, unit?.unit_id ?? null) : Promise.resolve([]),
    withDbClient((client) => readLessonUnderstanding(client, pupilId, lesson.lesson_id)),
  ])
  const totalMarks = countable.reduce((sum, activity) => sum + (activity.max_marks ?? 1), 0)
  const awarded = releasedToViewer
    ? countable.reduce((sum, activity) => sum + (activityMarksMap.get(activity.activity_id)?.marksAwarded ?? 0), 0)
    : null
  const remainingWork = countableIds.filter((id) => !submittedIds.includes(id)).length
  const dueTone = dueDateTone(dueDate, remainingWork)

  // Learning objectives, each with its success criteria.
  const criteriaByObjective = new Map<string, Array<{ id: string; text: string; level: number | null }>>()
  for (const sc of lesson.lesson_success_criteria ?? []) {
    const key = sc.learning_objective_id ?? "__ungrouped__"
    const bucket = criteriaByObjective.get(key) ?? []
    bucket.push({ id: sc.success_criteria_id, text: sc.description?.trim() || sc.title, level: sc.level ?? null })
    criteriaByObjective.set(key, bucket)
  }
  const objectives = (lesson.lesson_objectives ?? [])
    .slice()
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    .map((lo) => ({
      id: lo.learning_objective_id,
      title: lo.learning_objective?.title ?? lo.title ?? lo.learning_objective_id,
      criteria: (criteriaByObjective.get(lo.learning_objective_id) ?? []).sort((a, b) => (a.level ?? 0) - (b.level ?? 0)),
    }))
  const ungroupedCriteria = criteriaByObjective.get("__ungrouped__") ?? []
  if (ungroupedCriteria.length > 0) objectives.push({ id: "__ungrouped__", title: "Success criteria", criteria: ungroupedCriteria })

  const contentsSections: ContentsSection[] = sections.map((section, index) => ({
    anchorId: `section-${section.key}`,
    number: index + 1,
    title: section.title,
    items: section.items.map((activity) => ({
      activityId: activity.activity_id,
      anchorId: `activity-${activity.activity_id}`,
      title: activityTitle(activity),
      countable: isCountable(activity.type),
    })),
  }))

  let figureNumber = 0
  const backHref = `/pupil-lessons/${encodeURIComponent(pupilId)}`

  const renderActivity = (activity: (typeof activities)[number]) => {
    const number = activityNumbers.get(activity.activity_id) ?? 0
    const anchorId = `activity-${activity.activity_id}`
    const rawScore = activityScoreMap.get(activity.activity_id)
    const scorable = isCountable(activity.type)
    const feedbackText = activityFeedbackMap.get(activity.activity_id) ?? null

    const frame = (
      body: ReactNode,
      opts: {
        variant: ArticleActivityVariant
        title?: string
        question?: string
        inputId?: string
        flag?: { submissionId: string; isFlagged: boolean }
      },
    ) => (
      <ArticleActivity
        key={activity.activity_id}
        activityId={activity.activity_id}
        pupilId={pupilId}
        anchorId={anchorId}
        number={number}
        variant={opts.variant}
        title={opts.title ?? activityTitle(activity)}
        question={opts.question}
        inputId={opts.inputId}
        flag={opts.flag ?? (scorable ? latestFlagMap.get(activity.activity_id) : undefined)}
        scorable={scorable}
        maxMarks={activity.max_marks ?? 1}
        scoreLabel={formatScoreLabel(rawScore, activity.activity_id)}
        isMarked={typeof rawScore === "number"}
        isPendingMarking={rawScore === null}
        feedbackText={feedbackText}
        modelAnswer={activityModelAnswerMap.get(activity.activity_id)}
        viewerIsTeacher={isTeacher}
      >
        {body}
      </ArticleActivity>
    )

    switch (activity.type) {
      case "short-text-question": {
        const data = shortTextDataMap.get(activity.activity_id)
        const inputId = `answer-${activity.activity_id}`
        return frame(
          <PupilShortTextActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canAnswer={canWork}
            inputId={inputId}
            initialAnswer={data?.answer ?? ""}
            initialResubmitRequested={data?.resubmitRequested ?? false}
            resubmitNote={data?.resubmitNote ?? null}
            feedbackAssignmentIds={assignmentIds}
          />,
          {
            variant: "field",
            question: getActivityQuestion(activity),
            inputId,
            flag: data?.submissionId ? { submissionId: data.submissionId, isFlagged: data.isFlagged } : undefined,
          },
        )
      }
      case "long-text-question":
      case "text-question": {
        // The answer field's own id, set by the component.
        const inputId = `long-text-answer-${activity.activity_id}`
        return frame(
          <PupilLongTextActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canAnswer={canWork}
            initialAnswer={longTextAnswerMap.get(activity.activity_id) ?? ""}
            feedbackAssignmentIds={assignmentIds}
          />,
          { variant: "field", question: getLongTextBodyServer(activity).question || activity.title, inputId },
        )
      }
      case "multiple-choice-question":
        return frame(
          <PupilMcqActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canAnswer={canWork}
            initialSelection={mcqSelectionMap.get(activity.activity_id) ?? null}
            feedbackAssignmentIds={assignmentIds}
          />,
          { variant: "question", question: getActivityQuestion(activity) },
        )
      case "upload-code": {
        const body = (activity.body_data ?? {}) as Record<string, unknown>
        const language = typeof body.language === "string" && body.language.trim() ? body.language : "python"
        return frame(
          <PupilUploadCodeActivity
            lessonId={lesson.lesson_id}
            activityId={activity.activity_id}
            language={language}
            starterCode={typeof body.starterCode === "string" ? body.starterCode : ""}
            assignmentId={assignmentIds[0] ?? null}
            readOnly={!canWork}
            submittedHtml={uploadCodeHtmlMap.get(activity.activity_id) ?? null}
            taskHtml={renderTaskMarkup(typeof body.task === "string" ? body.task : "")}
          />,
          { variant: "task", title: activity.title || "Code task" },
        )
      }
      case "upload-url": {
        const data = uploadUrlDataMap.get(activity.activity_id)
        return frame(
          <PupilUploadUrlActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canAnswer={canWork}
            initialAnswer={data?.answer ?? ""}
            initialSubmissionId={data?.submissionId ?? null}
            initialIsFlagged={data?.isFlagged ?? false}
            initialResubmitRequested={data?.resubmitRequested ?? false}
            resubmitNote={data?.resubmitNote ?? null}
            feedbackAssignmentIds={assignmentIds}
          />,
          { variant: "task" },
        )
      }
      case "upload-file":
        return frame(
          <PupilUploadActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            instructions={extractUploadInstructions(activity)}
            initialSubmissions={submissionMap.get(activity.activity_id) ?? []}
            canUpload={canWork}
            feedbackAssignmentIds={assignmentIds}
          />,
          { variant: "task", title: activity.title || "Upload your work" },
        )
      case "upload-spreadsheet":
        return frame(
          <PupilUploadSpreadsheetActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canUpload={canWork}
            initialFileName={uploadSpreadsheetFileNameMap.get(activity.activity_id) ?? null}
            feedbackAssignmentIds={assignmentIds}
          />,
          { variant: "task", title: activity.title || "Upload a spreadsheet" },
        )
      case "upload-worksheet":
      case "mark-worksheet":
        return frame(
          <PupilUploadWorksheetActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canUpload={canWork}
            initialFileName={uploadWorksheetFileNameMap.get(activity.activity_id) ?? null}
            initialFileUrl={uploadWorksheetFileUrlMap.get(activity.activity_id) ?? null}
            feedbackAssignmentIds={assignmentIds}
            {...(activity.type === "mark-worksheet"
              ? { uploadEndpoint: "/api/pupil-submission/mark-worksheet", stagedSubmit: true }
              : {})}
          />,
          { variant: "task", title: activity.title || "Upload your worksheet" },
        )
      case "matcher":
        return frame(
          <PupilMatcherActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canAnswer={canWork}
            initialLayout={matcherDataMap.get(activity.activity_id)?.layout ?? []}
            initialAnswers={matcherDataMap.get(activity.activity_id)?.answers ?? {}}
          />,
          { variant: "task" },
        )
      case "group-items":
        return frame(
          <PupilGroupItemsActivity
            lessonId={lesson.lesson_id}
            activityId={activity.activity_id}
            title={activity.title}
            pupilId={pupilId}
            canAnswer={canWork}
            groups={groupItemsDataMap.get(activity.activity_id)?.groups ?? []}
            items={groupItemsDataMap.get(activity.activity_id)?.items ?? []}
            initialItemOrder={groupItemsDataMap.get(activity.activity_id)?.itemOrder ?? []}
            initialPlacements={groupItemsDataMap.get(activity.activity_id)?.placements ?? {}}
          />,
          { variant: "task" },
        )
      case "sequence":
        return frame(
          <PupilSequenceActivity
            lessonId={lesson.lesson_id}
            activityId={activity.activity_id}
            pupilId={pupilId}
            canAnswer={canWork}
            terms={sequenceDataMap.get(activity.activity_id)?.terms ?? []}
            initialCorrectIds={sequenceDataMap.get(activity.activity_id)?.correctIds ?? []}
            initialAttempts={sequenceDataMap.get(activity.activity_id)?.attempts ?? 0}
          />,
          { variant: "task" },
        )
      case "do-flashcards":
        return frame(
          <LockedWhen locked={isPupilViewer && isLocked}>
            <PupilDoFlashcardsActivity activity={activity} pupilId={pupilId} initialScore={rawScore ?? null} />
          </LockedWhen>,
          { variant: "task" },
        )
      case "sketch-render":
        return frame(
          <LockedWhen locked={isPupilViewer && isLocked}>
            <PupilSketchRenderActivity
              activity={activity}
              userId={pupilId}
              submission={sketchRenderSubmissionMap.get(activity.activity_id) ?? null}
              assignmentId={assignmentIds[0]}
            />
          </LockedWhen>,
          { variant: "task" },
        )
      case "share-my-work":
        return frame(
          <PupilShareMyWorkActivity
            lessonId={lesson.lesson_id}
            activity={activity}
            pupilId={pupilId}
            canUpload={canWork}
            initialFiles={shareMyWorkDataMap.get(activity.activity_id)?.files ?? []}
            initialSubmissionId={shareMyWorkDataMap.get(activity.activity_id)?.submissionId ?? null}
          />,
          { variant: "task" },
        )
      case "review-others-work":
        return frame(
          <LockedWhen locked={isPupilViewer && isLocked}>
            <PupilReviewOthersWorkActivity activity={activity} pupilId={pupilId} />
          </LockedWhen>,
          { variant: "task" },
        )
      case "feedback":
        return frame(
          <PupilFeedbackActivity
            activity={activity}
            lessonId={lesson.lesson_id}
            assignmentIds={assignmentIds}
            initialVisible={initialFeedbackVisible}
          />,
          { variant: "task" },
        )
      case "display-image": {
        figureNumber += 1
        const url = displayImageUrlMap.get(activity.activity_id) ?? (looksLikeImageUrl(extractActivityLink(activity)) ? extractActivityLink(activity) : null)
        const caption = `Figure ${figureNumber}.${activity.title ? ` ${activity.title}` : ""}`
        return (
          <figure key={activity.activity_id} id={anchorId} className="scroll-mt-28">
            {url ? (
              <ImageLightbox
                src={url}
                alt={activity.title || caption}
                label="Open full size"
                triggerClassName="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-la-border bg-la-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={activity.title || caption} loading="lazy" className="mx-auto max-h-[480px] w-full object-contain" />
              </ImageLightbox>
            ) : (
              <p className="rounded-xl border border-dashed border-la-input p-6 text-sm text-la-muted">
                This image isn&apos;t available yet. Please let your teacher know.
              </p>
            )}
            <figcaption className="mt-2 text-sm text-la-muted">{caption}</figcaption>
          </figure>
        )
      }
      case "show-video": {
        const link = extractActivityLink(activity)
        const embed = link ? videoEmbedUrl(link) : null
        return (
          <figure key={activity.activity_id} id={anchorId} className="scroll-mt-28">
            {embed ? (
              <div className="aspect-video w-full overflow-hidden rounded-xl border border-la-border bg-black">
                <iframe
                  src={embed}
                  title={activity.title || "Lesson video"}
                  className="h-full w-full"
                  loading="lazy"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[72px] items-center rounded-xl border border-la-border bg-la-card p-4 font-semibold text-la-green hover:border-la-green"
              >
                Watch the video (opens in a new tab)
              </a>
            ) : (
              <p className="rounded-xl border border-dashed border-la-input p-6 text-sm text-la-muted">
                Your teacher has not added the video yet.
              </p>
            )}
            <figcaption className="mt-2 text-sm text-la-muted">Video.{activity.title ? ` ${activity.title}` : ""}</figcaption>
          </figure>
        )
      }
      case "display-webpage": {
        const webpage = getDisplayWebpageBody(activity)
        const href = webpage.htmlFile
          ? `/api/activity-webpage/${encodeURIComponent(activity.activity_id)}`
          : webpage.url || null
        return (
          <LinkCard
            key={activity.activity_id}
            id={anchorId}
            title={activity.title || "Web page"}
            detail={href ? "Opens in a new tab" : "Your teacher has not added a page or link yet."}
            href={href}
          />
        )
      }
      case "file-download": {
        const files = fileDownloadUrlMap.get(activity.activity_id) ?? []
        const link = extractActivityLink(activity)
        return (
          <div key={activity.activity_id} id={anchorId} className="scroll-mt-28 rounded-xl border border-la-border bg-la-card p-4">
            <h3 className="font-semibold text-la-ink">{activity.title || "Download"}</h3>
            {extractUploadInstructions(activity) ? (
              <p className="mt-1 text-[15px] text-la-muted">{extractUploadInstructions(activity)}</p>
            ) : null}
            {!canDownload ? (
              <p className="mt-2 text-sm text-la-muted">Downloads are switched off while this lesson is locked.</p>
            ) : files.length > 0 || link ? (
              <ul className="mt-2 divide-y divide-la-border">
                {(files.length > 0 ? files : [{ name: "Download file", url: link }]).map((file) => (
                  <li key={file.name}>
                    <a
                      href={file.url ?? "#"}
                      download
                      className="flex min-h-11 items-center justify-between gap-3 py-2 text-[15px] font-medium text-la-green hover:text-la-green-hover"
                    >
                      <span className="truncate">{file.name}</span>
                      <span className="flex-none text-xs font-semibold text-la-muted">{fileBadge(file.name)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-la-muted">Your teacher has not attached a file yet.</p>
            )}
          </div>
        )
      }
      case "display-key-terms": {
        const body = (activity.body_data ?? {}) as Record<string, unknown>
        const markup = getRichTextMarkup(typeof body.markdown === "string" ? body.markdown : "")
        return (
          <div key={activity.activity_id} id={anchorId} className="scroll-mt-28 rounded-xl border border-la-border bg-la-card p-5">
            <h3 className="mb-2 font-semibold text-la-ink">{activity.title || "Key terms"}</h3>
            {markup ? <div className={PROSE} dangerouslySetInnerHTML={{ __html: markup }} /> : null}
          </div>
        )
      }
      case "voice": {
        const audioUrl = extractAudioUrl(activity)
        return (
          <div key={activity.activity_id} id={anchorId} className="scroll-mt-28">
            {activity.title ? <h3 className="mb-2 text-[20px] font-semibold text-la-ink">{activity.title}</h3> : null}
            {audioUrl ? (
              <audio className="w-full" controls preload="none" src={audioUrl}>
                Your browser does not support the audio element.
              </audio>
            ) : (
              <p className="text-sm text-la-muted">There is no recording yet.</p>
            )}
          </div>
        )
      }
      default: {
        // text, display-flashcards and anything without its own renderer: read it.
        const markup = getRichTextMarkup(
          activity.type === "display-flashcards" ? getFlashcardsText(activity) : getActivityTextValue(activity),
        )
        const isExamTip = ((activity.body_data ?? {}) as Record<string, unknown>).displayType === "exam-tip"
        return (
          <div
            key={activity.activity_id}
            id={anchorId}
            className={cn("scroll-mt-28", isExamTip && "rounded-xl border-l-4 border-la-green bg-la-green-pale p-5")}
          >
            {activity.title ? (
              <h3 className="mb-2 text-[20px] font-semibold text-la-ink">
                {isExamTip ? `Exam tip: ${activity.title}` : activity.title}
              </h3>
            ) : isExamTip ? (
              <h3 className="mb-2 text-[20px] font-semibold text-la-ink">Exam tip</h3>
            ) : null}
            {markup ? <div className={PROSE} dangerouslySetInnerHTML={{ __html: markup }} /> : null}
          </div>
        )
      }
    }
  }

  // Consecutive images sit side by side, two to a row.
  const renderSectionItems = (items: typeof activities) => {
    const blocks: ReactNode[] = []
    for (let i = 0; i < items.length; i += 1) {
      const activity = items[i]
      const next = items[i + 1]
      if (activity.type === "display-image" && next?.type === "display-image") {
        blocks.push(
          <div key={`pair-${activity.activity_id}`} className="grid gap-6 sm:grid-cols-2">
            {renderActivity(activity)}
            {renderActivity(next)}
          </div>,
        )
        i += 1
      } else {
        blocks.push(renderActivity(activity))
      }
    }
    return blocks
  }

  const metaParts = [
    dueDate ? (
      <span
        key="due"
        className={cn(
          "rounded-full px-2.5 py-0.5",
          dueTone === "overdue" && "bg-la-red-bg font-semibold text-la-red",
          dueTone === "soon" && "bg-la-amber-bg font-semibold text-la-amber",
        )}
      >
        {dueTone === "overdue" ? "Overdue · " : ""}Due {format(parseISO(dueDate), "EEE d MMM yyyy")}
      </span>
    ) : null,
    totalMarks > 0 ? <span key="marks">{totalMarks} marks</span> : null,
    <span key="count">
      {ordered.length} {ordered.length === 1 ? "activity" : "activities"}
    </span>,
  ].filter(Boolean)

  return (
    <FeedbackVisibilityProvider
      assignmentIds={assignmentIds}
      lessonId={lesson.lesson_id}
      pupilId={pupilId}
      initialVisible={initialFeedbackVisible}
    >
      <LessonProgressProvider lessonId={lesson.lesson_id} countableIds={countableIds} initialDoneIds={submittedIds}>
        <div
          className={cn(
            "lesson-article min-h-screen bg-la-bg font-[family-name:var(--font-inter)] text-[16px] text-la-ink",
            lessonArticleFontClass,
          )}
        >
          <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 pb-24 sm:px-6 min-[900px]:flex-row min-[900px]:gap-12 min-[900px]:pt-10">
            <LessonContents
              sections={contentsSections}
              awarded={awarded}
              totalMarks={totalMarks}
              course={groupId ? { units: courseUnits, pupilId } : null}
              fontClass={lessonArticleFontClass}
            />

            <main id="lesson-top" className="min-w-0 max-w-[720px] flex-1 pt-8 min-[900px]:pt-0">
              <Link
                href={backHref}
                className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-sm text-la-muted hover:text-la-ink"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                My lessons
              </Link>

              <header>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-la-green">
                  {[unit?.title, position?.number ? `Lesson ${position.number} of ${position.total}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <h1 className="mt-3 text-balance font-[family-name:var(--font-source-serif)] text-[38px] font-semibold leading-[1.1] tracking-tight sm:text-[56px]">
                  {lesson.title}
                </h1>
                {kindRows[0]?.description ? (
                  <p className="mt-4 max-w-[640px] font-[family-name:var(--font-source-serif)] text-[20px] leading-relaxed text-la-muted">
                    {kindRows[0].description}
                  </p>
                ) : null}
                <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-la-muted">
                  {metaParts.map((part, index) => (
                    // The separator ends the item before it, so a wrapped line never starts with one.
                    <span key={index} className="inline-flex items-center gap-3">
                      {part}
                      {index < metaParts.length - 1 ? <span aria-hidden="true">·</span> : null}
                    </span>
                  ))}
                </p>
              </header>

              {isLocked ? (
                <p
                  role="status"
                  className="mt-6 flex items-start gap-2 rounded-xl border border-la-amber/30 bg-la-amber-bg px-4 py-3 text-[15px] text-la-amber"
                >
                  <LockIcon className="mt-0.5 h-4 w-4 flex-none" />
                  <span>
                    <strong className="font-semibold">This lesson is locked.</strong>{" "}
                    {isPupilViewer
                      ? "You can read it, but you can't change answers, upload or download files."
                      : "This pupil can read it but cannot change answers, upload or download files."}
                  </span>
                </p>
              ) : null}

              {objectives.length > 0 ? (
                <LessonObjectives storageKey={`${pupilId}:${lesson.lesson_id}`} objectives={objectives} />
              ) : null}

              {sections.length === 0 ? (
                <p className="mt-12 text-la-muted">There aren&apos;t any activities in this lesson yet.</p>
              ) : (
                sections.map((section, index) => (
                  <section
                    key={section.key}
                    id={`section-${section.key}`}
                    aria-labelledby={`section-${section.key}-title`}
                    className="mt-16 scroll-mt-28"
                  >
                    <h2
                      id={`section-${section.key}-title`}
                      className="font-[family-name:var(--font-source-serif)] text-[28px] font-semibold leading-tight sm:text-[34px]"
                    >
                      <span className="text-la-green">{index + 1}.</span> {section.title}
                    </h2>
                    {section.introHtml ? (
                      <div
                        className="mt-3 font-[family-name:var(--font-source-serif)] text-[20px] leading-relaxed text-la-muted [&_p]:m-0"
                        dangerouslySetInnerHTML={{ __html: section.introHtml }}
                      />
                    ) : null}
                    <div className="mt-8 flex flex-col gap-12">
                      {index === 0 ? <ResourceCards resources={resources} canDownload={canDownload} /> : null}
                      {renderSectionItems(section.items)}
                    </div>
                  </section>
                ))
              )}

              {lessonFiles.length > 0 ? (
                <p className="mt-16 border-t border-la-border pt-8 text-[15px] text-la-muted">
                  Your teacher also has {lessonFiles.length === 1 ? "a file" : "files"} for this lesson (
                  {lessonFiles.map((file) => file.name).join(", ")}). Ask them for a copy.
                </p>
              ) : null}

              <LessonFooter
                lessonId={lesson.lesson_id}
                pupilId={pupilId}
                initialUnderstanding={understanding}
                canAnswer={isPupilViewer && !isTeacher}
                nextLesson={
                  position?.next
                    ? {
                        href: `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(position.next.lessonId)}`,
                        title: position.next.title,
                      }
                    : null
                }
              />
            </main>
          </div>
        </div>
      </LessonProgressProvider>
    </FeedbackVisibilityProvider>
  )
}

const PROSE =
  "prose max-w-none text-[17px] leading-relaxed text-la-ink prose-headings:text-la-ink prose-a:text-la-green prose-strong:text-la-ink prose-img:rounded-xl dark:prose-invert"

type ArticleSection = {
  key: string
  title: string
  /** Rich text under the heading: a Display Section's description. */
  introHtml: string | null
  items: LessonActivityRow[]
}

type LessonActivityRow = { activity_id: string; type: string | null; title: string; body_data: unknown }

/**
 * The lesson's sections. Display Section activities are the teacher's
 * structure: each starts a section of the activities after it, and anything
 * before the first one becomes an "Introduction". Without any, activities are
 * grouped by type (learn, practise, check, explain), keeping their order.
 * Resource activities shown as cards are left out of both.
 */
function buildSections<T extends LessonActivityRow>(activities: T[], resourceIds: Set<string | null>): Array<ArticleSection & { items: T[] }> {
  const shown = (activity: T) => !resourceIds.has(activity.activity_id)

  if (activities.some((activity) => activity.type === "display-section")) {
    const sections: Array<ArticleSection & { items: T[] }> = []
    for (const activity of activities) {
      if (activity.type === "display-section") {
        sections.push({
          key: activity.activity_id,
          title: activity.title?.trim() || "Section",
          introHtml: sectionDescriptionHtml(activity.body_data),
          items: [],
        })
      } else if (shown(activity)) {
        if (sections.length === 0) sections.push({ key: "introduction", title: "Introduction", introHtml: null, items: [] })
        sections[sections.length - 1].items.push(activity)
      }
    }
    return sections
  }

  return TYPE_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    introHtml: section.intro ? `<p>${section.intro}</p>` : null,
    items: activities.filter((activity) => shown(activity) && sectionForType(activity.type) === section.key),
  }))
}

function sectionDescriptionHtml(body: unknown): string | null {
  const description = (body as { description?: unknown } | null)?.description
  if (typeof description !== "string") return null
  if (description.replace(/<[^>]*>|&nbsp;/g, "").trim().length === 0) return null
  return getRichTextMarkup(description)
}

type TypeSectionKey = "learn" | "practise" | "check" | "explain"

const TYPE_SECTIONS: Array<{ key: TypeSectionKey; title: string; intro?: string }> = [
  { key: "learn", title: "Learn" },
  { key: "practise", title: "Practise" },
  { key: "check", title: "Check your understanding" },
  {
    key: "explain",
    title: "Explain in a few words",
    intro: "Your teacher marks these after the lesson. You can edit an answer until it is marked.",
  },
]

const LEARN_TYPES = new Set([
  "text",
  "display-image",
  "show-video",
  "display-webpage",
  "file-download",
  "display-flashcards",
  "display-key-terms",
  "voice",
])

function sectionForType(type: string | null | undefined): TypeSectionKey {
  if (type === "multiple-choice-question") return "check"
  if (type === "short-text-question" || type === "long-text-question" || type === "text-question") return "explain"
  if (!type || LEARN_TYPES.has(type)) return "learn"
  if (!isScorableActivityType(type) && !PRACTISE_EXTRA.has(type)) return "learn"
  return "practise"
}

// Non-scorable types that are still something the pupil does.
const PRACTISE_EXTRA = new Set(["share-my-work", "review-others-work"])

/** Activities the pupil answers: these count for progress, marks and "done". */
function isCountable(type: string | null | undefined) {
  return Boolean(type) && isScorableActivityType(type!) && type !== "feedback" && type !== "voice"
}

function activityTitle(activity: { title: string; type: string | null; body_data: unknown }) {
  const title = activity.title?.trim()
  if (title) return title
  const question = getActivityQuestion(activity).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  return question.length > 0 ? (question.length > 60 ? `${question.slice(0, 57)}…` : question) : formatActivityType(activity.type)
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return format(value, "yyyy-MM-dd")
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

/** Overdue once the date has passed with work missing; due soon within three days. */
function dueDateTone(dueDate: string | null, remainingWork: number): "overdue" | "soon" | null {
  if (!dueDate || remainingWork === 0) return null
  const today = format(new Date(), "yyyy-MM-dd")
  if (dueDate < today) return "overdue"
  return differenceInCalendarDays(parseISO(dueDate), parseISO(today)) <= 3 ? "soon" : null
}

function fileBadge(name: string) {
  const extension = name.split(".").pop()
  return extension && extension !== name ? extension.toUpperCase() : ""
}

/** An embeddable player URL for YouTube or Vimeo, or null to link out instead. */
function videoEmbedUrl(url: string): string | null {
  const youtubeId = getYouTubeVideoId(url)
  if (youtubeId) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`
  try {
    const parsed = new URL(url)
    if (parsed.hostname.replace(/^www\./, "") === "vimeo.com") {
      const id = parsed.pathname.split("/").filter(Boolean)[0]
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`
    }
  } catch {
    return null
  }
  return null
}

function LinkCard({ id, title, detail, href }: { id: string; title: string; detail: string; href: string | null }) {
  const body = (
    <>
      <span className="block font-semibold text-la-ink">{title}</span>
      <span className="block text-sm text-la-muted">{detail}</span>
    </>
  )
  return href ? (
    <a
      id={id}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block min-h-[72px] scroll-mt-28 rounded-xl border border-la-border bg-la-card p-4 transition-colors hover:border-la-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green"
    >
      {body}
    </a>
  ) : (
    <div id={id} className="min-h-[72px] scroll-mt-28 rounded-xl border border-dashed border-la-input p-4">
      {body}
    </div>
  )
}
