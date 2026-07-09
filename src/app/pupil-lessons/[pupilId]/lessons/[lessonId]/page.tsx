import type { ReactNode } from "react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { format } from "date-fns"
import {
  ArrowLeft,
  Download,
  FileIcon,
  HelpCircle,
  Link as LinkIcon,
  Lock,
  Mic,
  Music2,
  Play,
  PlaySquare,
  TestTube,
  Video,
} from "lucide-react"

import { requireAuthenticatedProfile } from "@/lib/auth"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StartRevisionButton } from "@/components/revisions/start-revision-button"
import { PupilUploadActivity } from "@/components/pupil/pupil-upload-activity"
import { PupilUploadSpreadsheetActivity } from "@/components/pupil/pupil-upload-spreadsheet-activity"
import { PupilUploadWorksheetActivity } from "@/components/pupil/pupil-upload-worksheet-activity"


import { PupilMcqActivity } from "@/components/pupil/pupil-mcq-activity"
import { PupilMatcherActivity } from "@/components/pupil/pupil-matcher-activity"
import { PupilGroupItemsActivity } from "@/components/pupil/pupil-group-items-activity"
import { PupilDoFlashcardsActivity } from "@/components/pupil/pupil-do-flashcards-activity"
import { PupilFeedbackActivity } from "@/components/pupil/pupil-feedback-activity"
import { PupilShortTextActivity } from "@/components/pupil/pupil-short-text-activity"
import { PupilLongTextActivity } from "@/components/pupil/pupil-long-text-activity"
import { PupilUploadUrlActivity } from "@/components/pupil/pupil-upload-url-activity"
import { PupilSketchRenderActivity } from "@/components/lessons/activity-view/pupil-sketch-render-activity"
import { PupilShareMyWorkActivity } from "@/components/pupil/pupil-share-my-work-activity"
import { PupilReviewOthersWorkActivity } from "@/components/pupil/pupil-review-others-work-activity"

import { MediaImage } from "@/components/ui/media-image"
import {
  GroupItemsActivityBodySchema,
  GroupItemsSubmissionBodySchema,
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
  getActivityFileUrlValue,
  getActivityTextValue,
  getFlashcardsText,
  getRichTextMarkup,
  getYouTubeThumbnailUrl,
} from "@/components/lessons/activity-view/utils"
import { FeedbackVisibilityProvider } from "./feedback-visibility-debug"
import {
  ActivityMotion,
  LessonEnd,
  LessonHero,
  LessonScrollProgress,
  StickySectionHeading,
  type ScrollObjective,
  type ScrollObjectiveCriterion,
} from "@/components/lessons/lesson-scroll-layout"
import { LiveActivityShell } from "./live-activity-shell"
import { ActivitySidebar } from "@/components/lessons/activity-sidebar"

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

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return "No start date"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return format(parsed, "PPP")
}

function formatActivityType(type: string | null | undefined): string {
  if (!type) return ""
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function selectActivityIcon(type: string | null | undefined, hasAudio: boolean, linkUrl: string | null) {
  if (!type) {
    return hasAudio ? <Music2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null
  }

  const normalized = type.toLowerCase()

  if (normalized.includes("test")) {
    return <TestTube className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("download") || normalized.includes("file")) {
    return <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("audio") || normalized.includes("voice") || hasAudio) {
    return <Music2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("video") || (linkUrl && isYouTubeUrl(linkUrl))) {
    return <PlaySquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }

  return null
}

function isYouTubeUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be")
  } catch {
    return false
  }
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

/** Type pill label/glyph for display-only activities (no marking chrome). */
const DISPLAY_META: Record<string, { typeLabel: string; typeGlyph?: string }> = {
  "display-image": { typeLabel: "Image", typeGlyph: "🖼" },
  "show-video": { typeLabel: "Video", typeGlyph: "▶" },
  "file-download": { typeLabel: "Download", typeGlyph: "⭳" },
  "display-flashcards": { typeLabel: "Flashcards", typeGlyph: "🂠" },
  text: { typeLabel: "Read", typeGlyph: "≡" },
  voice: { typeLabel: "Audio", typeGlyph: "♪" },
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
    const access = await checkLessonAccessForPupilAction(pupilId, lessonId)
    if (!access.accessible) {
      return (
        <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-20 text-center">
          {access.reason === "locked" ? (
            <>
              <Lock className="h-16 w-16 text-red-500" />
              <h1 className="text-2xl font-semibold text-foreground">This lesson is currently locked</h1>
              <p className="text-muted-foreground">Your teacher has locked this lesson. Please check back later or ask your teacher for more information.</p>
            </>
          ) : (
            <>
              <Lock className="h-16 w-16 text-muted-foreground" />
              <h1 className="text-2xl font-semibold text-foreground">This lesson is not available</h1>
              <p className="text-muted-foreground">This lesson is not currently available to you. Please contact your teacher if you think this is an error.</p>
            </>
          )}
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

  const uploadWorksheetActivities = activities.filter((activity) => activity.type === "upload-worksheet")
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
  const assignmentIds = assignments.map((assignment) => assignment.assignmentId)
  const initialFeedbackVisible = assignments.some((assignment) => assignment.feedbackVisible)

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


  // --- Scroll-layout data ---------------------------------------------------
  // Group success criteria under their learning objective for the opening hero.
  const criteriaByObjective = new Map<string, ScrollObjectiveCriterion[]>()
  for (const sc of lesson.lesson_success_criteria ?? []) {
    const key = sc.learning_objective_id ?? "__ungrouped__"
    const bucket = criteriaByObjective.get(key) ?? []
    bucket.push({
      id: sc.success_criteria_id,
      title: sc.title,
      description: sc.description ?? null,
      level: sc.level ?? null,
    })
    criteriaByObjective.set(key, bucket)
  }

  const heroObjectives: ScrollObjective[] = (lesson.lesson_objectives ?? [])
    .slice()
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    .map((lo) => ({
      id: lo.learning_objective_id,
      title: lo.learning_objective?.title ?? lo.title ?? lo.learning_objective_id,
      criteria: (criteriaByObjective.get(lo.learning_objective_id) ?? []).sort(
        (a, b) => (a.level ?? 0) - (b.level ?? 0),
      ),
    }))

  const heroUngroupedCriteria = criteriaByObjective.get("__ungrouped__") ?? []

  // Group activities under any `display-section` headings, preserving order.
  const segments: { section: (typeof activities)[number] | null; items: typeof activities }[] = []
  for (const activity of activities) {
    if (activity.type === "display-section") {
      segments.push({ section: activity, items: [] })
    } else {
      if (segments.length === 0) segments.push({ section: null, items: [] })
      segments[segments.length - 1].items.push(activity)
    }
  }

  // Number only the answerable/display activities (not the section headings).
  const activityNumbers = new Map<string, number>()
  let runningActivityNumber = 0
  for (const activity of activities) {
    if (activity.type === "display-section") continue
    runningActivityNumber += 1
    activityNumbers.set(activity.activity_id, runningActivityNumber)
  }
  const totalActivities = runningActivityNumber

  // Left-rail entries: one per activity (excluding section headings), with a
  // score once marked or a "Marking" chip while awaiting a mark.
  const sidebarItems = activities
    .filter((activity) => activity.type !== "display-section")
    .map((activity) => {
      const raw = activityScoreMap.get(activity.activity_id)
      return {
        activityId: activity.activity_id,
        anchorId: `activity-${activity.activity_id}`,
        number: activityNumbers.get(activity.activity_id) ?? 0,
        title:
          activity.title?.trim() ||
          getActivityQuestion(activity) ||
          formatActivityType(activity.type),
        scoreLabel:
          typeof raw === "number" ? formatScoreLabel(raw, activity.activity_id) : undefined,
        marking: raw === null,
      }
    })

  return (
    <FeedbackVisibilityProvider
      assignmentIds={assignmentIds}
      lessonId={lesson.lesson_id}
      initialVisible={initialFeedbackVisible}
    >
      <main className="relative bg-gradient-to-b from-background via-background to-muted/40">
        <LessonScrollProgress />

        <LessonHero
          lessonTitle={lesson.title}
          unitTitle={unit?.title ?? ""}
          objectives={heroObjectives}
          ungroupedCriteria={heroUngroupedCriteria}
          backHref={`/pupil-lessons/${encodeURIComponent(pupilId)}`}
          backLabel="Back to My Lessons"
          greetingName={summary?.name ?? null}
        />

        <div className="mx-auto flex w-full max-w-6xl gap-6 pb-40 pt-16">
          <aside className="hidden w-52 shrink-0 pl-4 md:block">
            <ActivitySidebar items={sidebarItems} />
          </aside>

          <div className="min-w-0 flex-1 px-6">
          {activities.length === 0 ? (
            <p className="text-center text-muted-foreground">
              There aren&apos;t any activities attached yet.
            </p>
          ) : (
            segments.map((segment, segmentIndex) => (
              <section key={segment.section?.activity_id ?? `segment-${segmentIndex}`}>
                {segment.section ? (
                  <StickySectionHeading title={segment.section.title} />
                ) : null}

                <div className="flex flex-col gap-12 sm:gap-16">
                  {segment.items.map((activity) => {
                  const index = (activityNumbers.get(activity.activity_id) ?? 1) - 1
                  const linkUrl = extractActivityLink(activity)
                  const activityFiles = fileDownloadUrlMap.get(activity.activity_id) ?? []
                  
                  const audioUrl = extractAudioUrl(activity)
                  const isDisplayImage = activity.type === "display-image"
                  const resolvedImageUrl = isDisplayImage
                    ? displayImageUrlMap.get(activity.activity_id) ?? (looksLikeImageUrl(linkUrl) ? linkUrl : null)
                    : null
                  const titleLink = !isDisplayImage || !resolvedImageUrl ? linkUrl : null
                  const icon = selectActivityIcon(activity.type, Boolean(audioUrl), titleLink)
                  const rawScore = activityScoreMap.get(activity.activity_id)
                  
                  let feedbackText =
                    activity.type === "feedback"
                      ? "Your teacher has shared feedback in this activity."
                      : activityFeedbackMap.get(activity.activity_id)

                  if (rawScore === null && !feedbackText) {
                      feedbackText = "Not Yet Marked"
                  }
                  
                  const modelAnswer = activityModelAnswerMap.get(activity.activity_id)

                  // Restyled types render inside the Warm Study shell (bare motion
                  // wrapper + LiveActivityShell). Anything not covered here falls
                  // through to the legacy ActivityReveal path below.
                  const shell = (
                    body: ReactNode,
                    opts: { typeLabel: string; typeGlyph?: string; question?: string; hideMarking?: boolean },
                  ) => (
                    <ActivityMotion key={activity.activity_id} index={index} id={`activity-${activity.activity_id}`}>
                      <LiveActivityShell
                        activityId={activity.activity_id}
                        question={opts.question ?? getActivityQuestion(activity)}
                        activityIndex={index + 1}
                        activityTotal={totalActivities}
                        typeLabel={opts.typeLabel}
                        typeGlyph={opts.typeGlyph}
                        hideMarking={opts.hideMarking}
                        scoreLabel={formatScoreLabel(rawScore, activity.activity_id)}
                        isMarked={typeof rawScore === "number"}
                        isPendingMarking={rawScore === null}
                        feedbackText={feedbackText}
                        modelAnswer={modelAnswer}
                        maxMarks={activity.max_marks ?? 1}
                      >
                        {body}
                      </LiveActivityShell>
                    </ActivityMotion>
                  )

                  if (activity.type === "short-text-question") {
                    return shell(
                      <PupilShortTextActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canAnswer={isPupilViewer}
                        initialAnswer={shortTextDataMap.get(activity.activity_id)?.answer ?? ""}
                        initialSubmissionId={shortTextDataMap.get(activity.activity_id)?.submissionId ?? null}
                        initialIsFlagged={shortTextDataMap.get(activity.activity_id)?.isFlagged ?? false}
                        initialResubmitRequested={shortTextDataMap.get(activity.activity_id)?.resubmitRequested ?? false}
                        resubmitNote={shortTextDataMap.get(activity.activity_id)?.resubmitNote ?? null}
                        feedbackAssignmentIds={assignmentIds}
                      />,
                      { typeLabel: "Short answer", typeGlyph: "✎" },
                    )
                  }

                  if (activity.type === "multiple-choice-question") {
                    return shell(
                      <PupilMcqActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canAnswer={isPupilViewer}
                        initialSelection={mcqSelectionMap.get(activity.activity_id) ?? null}
                        feedbackAssignmentIds={assignmentIds}
                      />,
                      { typeLabel: "Multiple choice", typeGlyph: "◉" },
                    )
                  }

                  if (activity.type === "long-text-question" || activity.type === "text-question") {
                    return shell(
                      <PupilLongTextActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canAnswer={isPupilViewer}
                        initialAnswer={longTextAnswerMap.get(activity.activity_id) ?? ""}
                        feedbackAssignmentIds={assignmentIds}
                      />,
                      { typeLabel: "Long answer", typeGlyph: "✎" },
                    )
                  }

                  if (activity.type === "upload-url") {
                    return shell(
                      <PupilUploadUrlActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canAnswer={isPupilViewer}
                        initialAnswer={uploadUrlDataMap.get(activity.activity_id)?.answer ?? ""}
                        initialSubmissionId={uploadUrlDataMap.get(activity.activity_id)?.submissionId ?? null}
                        initialIsFlagged={uploadUrlDataMap.get(activity.activity_id)?.isFlagged ?? false}
                        initialResubmitRequested={uploadUrlDataMap.get(activity.activity_id)?.resubmitRequested ?? false}
                        resubmitNote={uploadUrlDataMap.get(activity.activity_id)?.resubmitNote ?? null}
                        feedbackAssignmentIds={assignmentIds}
                      />,
                      { typeLabel: "Submit a link", typeGlyph: "🔗" },
                    )
                  }

                  if (activity.type === "upload-file") {
                    return shell(
                      <PupilUploadActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        instructions={extractUploadInstructions(activity)}
                        initialSubmissions={submissionMap.get(activity.activity_id) ?? []}
                        canUpload={isPupilViewer}
                        feedbackAssignmentIds={assignmentIds}
                      />,
                      { typeLabel: "File upload", typeGlyph: "⬆", question: activity.title || "Upload your work" },
                    )
                  }

                  if (activity.type === "upload-spreadsheet") {
                    return shell(
                      <PupilUploadSpreadsheetActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canUpload={isPupilViewer}
                        initialFileName={uploadSpreadsheetFileNameMap.get(activity.activity_id) ?? null}
                        feedbackAssignmentIds={assignmentIds}
                      />,
                      { typeLabel: "Spreadsheet", typeGlyph: "▦", question: activity.title || "Upload a spreadsheet" },
                    )
                  }

                  if (activity.type === "upload-worksheet") {
                    return shell(
                      <PupilUploadWorksheetActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canUpload={isPupilViewer}
                        initialFileName={uploadWorksheetFileNameMap.get(activity.activity_id) ?? null}
                        initialFileUrl={uploadWorksheetFileUrlMap.get(activity.activity_id) ?? null}
                        feedbackAssignmentIds={assignmentIds}
                      />,
                      { typeLabel: "Worksheet", typeGlyph: "▦", question: activity.title || "Upload a worksheet" },
                    )
                  }

                  if (activity.type === "matcher") {
                    return shell(
                      <PupilMatcherActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canAnswer={isPupilViewer}
                        initialLayout={matcherDataMap.get(activity.activity_id)?.layout ?? []}
                        initialAnswers={matcherDataMap.get(activity.activity_id)?.answers ?? {}}
                      />,
                      { typeLabel: "Match up", typeGlyph: "⇄" },
                    )
                  }

                  if (activity.type === "group-items") {
                    return shell(
                      <PupilGroupItemsActivity
                        lessonId={lesson.lesson_id}
                        activityId={activity.activity_id}
                        title={activity.title}
                        pupilId={pupilId}
                        canAnswer={isPupilViewer}
                        groups={groupItemsDataMap.get(activity.activity_id)?.groups ?? []}
                        items={groupItemsDataMap.get(activity.activity_id)?.items ?? []}
                        initialItemOrder={groupItemsDataMap.get(activity.activity_id)?.itemOrder ?? []}
                        initialPlacements={groupItemsDataMap.get(activity.activity_id)?.placements ?? {}}
                      />,
                      { typeLabel: "Sort into groups", typeGlyph: "▤" },
                    )
                  }

                  if (activity.type === "do-flashcards") {
                    return shell(
                      <PupilDoFlashcardsActivity
                        activity={activity}
                        pupilId={pupilId}
                        initialScore={rawScore ?? null}
                      />,
                      { typeLabel: "Flashcards", typeGlyph: "🂠" },
                    )
                  }

                  if (activity.type === "sketch-render") {
                    return shell(
                      <PupilSketchRenderActivity
                        activity={activity}
                        userId={pupilId}
                        submission={sketchRenderSubmissionMap.get(activity.activity_id) ?? null}
                        assignmentId={assignmentIds[0]}
                      />,
                      { typeLabel: "Sketch", typeGlyph: "✎" },
                    )
                  }

                  if (activity.type === "share-my-work") {
                    return shell(
                      <PupilShareMyWorkActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        canUpload={isPupilViewer}
                        initialFiles={shareMyWorkDataMap.get(activity.activity_id)?.files ?? []}
                        initialSubmissionId={shareMyWorkDataMap.get(activity.activity_id)?.submissionId ?? null}
                      />,
                      { typeLabel: "Share my work", typeGlyph: "⬆", hideMarking: true },
                    )
                  }

                  if (activity.type === "review-others-work") {
                    return shell(
                      <PupilReviewOthersWorkActivity activity={activity} pupilId={pupilId} />,
                      { typeLabel: "Review others' work", typeGlyph: "◎", hideMarking: true },
                    )
                  }

                  if (activity.type === "feedback") {
                    return shell(
                      <PupilFeedbackActivity
                        activity={activity}
                        lessonId={lesson.lesson_id}
                        assignmentIds={assignmentIds}
                        initialVisible={initialFeedbackVisible}
                      />,
                      { typeLabel: "Feedback", typeGlyph: "★", hideMarking: true },
                    )
                  }

                  const displayMeta = DISPLAY_META[activity.type ?? ""] ?? { typeLabel: "Activity" }
                  return shell(
                    activity.type === "file-download" && (activityFiles.length > 0 || linkUrl) ? (
                         <div className="rounded-md bg-card p-4 border border-border/60">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                                <Download className="h-5 w-5" />
                              </div>
                              <div className="space-y-1 w-full">
                                <h3 className="font-medium leading-none text-foreground">{activity.title}</h3>
                                <p className="text-sm text-muted-foreground">{extractUploadInstructions(activity) || "Download the attached file(s)."}</p>
                                
                                {activityFiles.length > 0 ? (
                                  <div className="mt-2 flex flex-col gap-2">
                                    {activityFiles.map((file, i) => (
                                      <Button key={i} asChild size="sm" variant="outline" className="justify-start gap-2 w-full sm:w-auto h-auto py-2">
                                        <a href={file.url ?? "#"} download target="_blank" rel="noopener noreferrer">
                                          <Download className="h-4 w-4 shrink-0" />
                                          <span className="truncate">{file.name}</span>
                                        </a>
                                      </Button>
                                    ))}
                                  </div>
                                ) : linkUrl ? (
                                  <Button asChild size="sm" variant="outline" className="mt-2 gap-2">
                                    <a href={linkUrl} download target="_blank" rel="noopener noreferrer">
                                      <Download className="h-4 w-4" />
                                      Download File
                                    </a>
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                         </div>
                      ) : activity.type === "show-video" && linkUrl ? (
                         (() => {
                            const thumbnailUrl = getYouTubeThumbnailUrl(linkUrl)
                            if (thumbnailUrl) {
                              return (
                                <div className="rounded-md bg-card p-4 border border-border/60">
                                   <div className="flex flex-col gap-3">
                                      <div className="flex items-center gap-2">
                                         <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                                            <Video className="h-5 w-5" />
                                         </div>
                                         <h3 className="font-medium leading-none text-foreground">{activity.title}</h3>
                                      </div>
                                      <a 
                                        href={linkUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="relative block w-full max-w-md aspect-video rounded-md overflow-hidden bg-muted group"
                                      >
                                        <img src={thumbnailUrl} alt={activity.title} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                                           <div className="rounded-full bg-white/90 p-3 shadow-lg transition-transform group-hover:scale-110">
                                              <Play className="h-6 w-6 text-primary fill-primary" />
                                           </div>
                                        </div>
                                      </a>
                                   </div>
                                </div>
                              )
                            }
                            // Fallback to generic rendering if no thumbnail
                            return (
                               <div className="flex items-start gap-2">
                                 <span className="text-xs font-semibold text-muted-foreground">{index + 1}.</span>
                                 <div className="flex flex-col gap-1">
                                   <div className="flex flex-wrap items-center gap-2">
                                     {icon}
                                     <Link
                                       href={linkUrl}
                                       target="_blank"
                                       className="font-medium text-blue-600 hover:underline"
                                     >
                                       {activity.title}
                                     </Link>
                                     <Badge variant="outline" className="text-[10px] font-normal">
                                        Video
                                     </Badge>
                                   </div>
                                 </div>
                               </div>
                            )
                         })()
                      ) : (
                        <>
                          <div className="flex items-start gap-2">
                            <span className="text-xs font-semibold text-muted-foreground">{index + 1}.</span>
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {icon}
                                {titleLink ? (
                                  <Link
                                    href={titleLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-primary underline-offset-4 hover:underline"
                                  >
                                    {activity.title}
                                  </Link>
                                ) : (
                                  <span className="font-medium text-foreground">{activity.title || formatActivityType(activity.type)}</span>
                                )}
                              </div>
                              {activity.title ? (
                                <span className="text-xs text-muted-foreground">{formatActivityType(activity.type)}</span>
                              ) : null}
                              {titleLink ? (
                                <span className="break-all text-xs text-muted-foreground">{titleLink}</span>
                              ) : null}
                            </div>
                          </div>

                          {(() => {
                            const textValue = activity.type === "display-flashcards"
                              ? getFlashcardsText(activity)
                              : getActivityTextValue(activity)
                            const htmlContent = getRichTextMarkup(textValue)

                            if (!htmlContent) return null

                            return (
                              <div
                                className="prose prose-sm mt-3 max-w-none text-muted-foreground dark:prose-invert"
                                dangerouslySetInnerHTML={{ __html: htmlContent }}
                              />
                            )
                          })()}

                          {isDisplayImage ? (
                            resolvedImageUrl ? (
                              <figure className="mt-3 space-y-2">
                                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-background max-h-[420px]">
                                  <MediaImage
                                    src={resolvedImageUrl}
                                    alt={activity.title || "Lesson activity image"}
                                    fill
                                    sizes="100vw"
                                    className="object-contain"
                                    loading="lazy"
                                  />
                                </div>
                                <div className="flex justify-end">
                                  <Link
                                    href={resolvedImageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                                  >
                                    Open full image
                                  </Link>
                                </div>
                              </figure>
                            ) : (
                              <p className="mt-3 text-xs text-muted-foreground">
                                This image isn&apos;t available yet. Please let your teacher know.
                              </p>
                            )
                      ) : audioUrl && activity.type !== "show-video" ? (
                        <audio className="mt-3 w-full" controls preload="none" src={audioUrl}>
                          Your browser does not support the audio element.
                        </audio>
                      ) : null}
                    </>
                  ),
                    { ...displayMeta, hideMarking: true, question: "" },
                  )
                })}
                </div>
              </section>
            ))
          )}

          <div className="mt-16 space-y-6">
        {(lesson.lesson_links?.length ?? 0) > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">Helpful Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <ul className="space-y-2">
                {lesson.lesson_links!.map((link) => (
                  <li key={link.lesson_link_id} className="rounded-md bg-muted/40 px-3 py-2">
                    <Link
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {link.description?.trim() || link.url}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {lessonFiles.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">Resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Ask your teacher for the latest copy of these resources:</p>
              <ul className="space-y-1">
                {lessonFiles.map((file) => (
                  <li key={file.path} className="rounded-md bg-muted/30 px-3 py-2">
                    {file.name}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
          </div>

          <LessonEnd />
          </div>
        </div>
      </main>
    </FeedbackVisibilityProvider>
  )
}
