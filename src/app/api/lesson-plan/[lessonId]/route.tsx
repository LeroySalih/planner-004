import { createElement } from "react"
import type { ReactElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import type { DocumentProps } from "@react-pdf/renderer"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import {
  readAllLearningObjectivesAction,
  readLessonDetailBootstrapAction,
  readLessonReferenceDataAction,
} from "@/lib/server-updates"
import {
  extractYouTubeVideoId,
  fetchActivityImageAsDataUri,
  fetchAsDataUri,
  fetchYouTubeThumbnailAsDataUri,
  generateQrDataUri,
  getBaseUrl,
} from "@/lib/pdf-helpers"
import { LessonPlanDocument } from "@/components/pdf/lesson-plan-document"
import type {
  PdfActivity,
  PdfLearningObjective,
} from "@/components/pdf/lesson-plan-document"
import { McqActivityBodySchema, ShortTextActivityBodySchema } from "@/types"

const ROUTE_TAG = "/api/lesson-plan/[lessonId]"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Note: This checks the caller is an authenticated teacher but does not verify
  // the lesson belongs to a unit accessible to this teacher. This is acceptable
  // for a single-school deployment where all teachers share access to all content.
  const { lessonId } = await params
  const baseUrl = getBaseUrl(request)

  const [lessonResult, referenceResult] = await Promise.all([
    readLessonDetailBootstrapAction(lessonId, { routeTag: ROUTE_TAG, authEndTime: null }),
    readLessonReferenceDataAction(lessonId, { routeTag: ROUTE_TAG, authEndTime: null }),
  ])

  if (lessonResult.error || !lessonResult.data?.lesson) {
    return new Response("Lesson not found", { status: 404 })
  }

  const { lesson, unit, lessonActivities = [] } = lessonResult.data
  const curricula = referenceResult.data?.curricula ?? []
  const curriculumIds = curricula
    .map((c) => c.curriculum_id)
    .filter((id): id is string => Boolean(id))

  const loResult = await readAllLearningObjectivesAction({
    routeTag: ROUTE_TAG,
    authEndTime: null,
    curriculumIds,
    unitId: lesson.unit_id,
  })
  const allLos = loResult.data ?? []

  const lessonScIds = new Set(
    (lesson.lesson_success_criteria ?? []).map((sc) => sc.success_criteria_id),
  )

  const pdfLos: PdfLearningObjective[] = []
  for (const lo of allLos) {
    const linkedCriteria = (lo.success_criteria ?? []).filter((sc) =>
      lessonScIds.has(sc.success_criteria_id),
    )
    if (linkedCriteria.length === 0) continue
    pdfLos.push({
      id: lo.learning_objective_id,
      title: lo.title ?? "Untitled objective",
      criteria: linkedCriteria.map((sc) => ({
        id: sc.success_criteria_id,
        description: sc.description?.trim() || "Success criterion",
      })),
    })
  }

  const activeActivities = lessonActivities
    .filter((a) => a.active !== false)
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))

  const pdfActivities: PdfActivity[] = await Promise.all(
    activeActivities.map(async (activity): Promise<PdfActivity> => {
      const base = {
        id: activity.activity_id,
        title: activity.title || "Untitled activity",
        orderBy: activity.order_by ?? null,
      }
      const body = activity.body_data as Record<string, unknown> | null

      switch (activity.type) {
        case "multiple-choice-question": {
          const parsed = McqActivityBodySchema.safeParse(body)
          if (!parsed.success) return { ...base, kind: "other" as const }
          const { question, options, correctOptionId, imageFile, imageUrl } = parsed.data
          const rawImgUrl = imageFile ?? imageUrl ?? null
          const imageDataUri = rawImgUrl
            ? await fetchAsDataUri(rawImgUrl, baseUrl).catch(() => null)
            : null
          return {
            ...base,
            kind: "mcq" as const,
            question,
            options: options.map((o) => ({ id: o.id, text: o.text })),
            correctOptionId,
            imageDataUri,
          }
        }

        case "short-text-question": {
          const parsed = ShortTextActivityBodySchema.safeParse(body)
          if (!parsed.success) return { ...base, kind: "other" as const }
          return {
            ...base,
            kind: "short-text" as const,
            question: parsed.data.question,
            modelAnswer: parsed.data.modelAnswer,
          }
        }

        case "display-image": {
          const imageFile = body?.imageFile as string | undefined
          const imageUrl = (body?.imageUrl as string | undefined) ?? (body?.fileUrl as string | undefined)
          let imageDataUri: string | null = null
          if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
            // Absolute URL — fetch directly
            imageDataUri = await fetchAsDataUri(imageUrl, baseUrl).catch(() => null)
          } else if (imageFile) {
            // Local file — read from disk, bypassing the auth-gated /api/files route
            imageDataUri = await fetchActivityImageAsDataUri(
              activity.lesson_id,
              activity.activity_id,
              imageFile,
            ).catch(() => null)
          }
          return { ...base, kind: "image" as const, imageDataUri }
        }

        case "show-video": {
          // URL stored as fileUrl/file_url, not url
          const videoUrl = (body?.fileUrl as string | undefined) ?? (body?.file_url as string | undefined) ?? ""
          if (!videoUrl) return { ...base, kind: "other" as const }
          const videoId = extractYouTubeVideoId(videoUrl)
          const [thumbnailDataUri, qrDataUri] = await Promise.all([
            videoId ? fetchYouTubeThumbnailAsDataUri(videoId).catch(() => null) : Promise.resolve(null),
            generateQrDataUri(videoUrl).catch(() => null),
          ])
          return {
            ...base,
            kind: "video" as const,
            videoUrl,
            thumbnailDataUri,
            qrDataUri,
          }
        }

        case "display-flashcards": {
          const lines = (body?.lines as string | undefined) ?? ""
          const terms = lines
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              // Extract bold term: **term** anywhere in the sentence
              const match = line.match(/\*\*([^*]+)\*\*/)
              const term = match ? match[1].trim() : ""
              // Definition: strip all ** markers to get plain text
              const definition = line.replace(/\*\*/g, "").trim()
              return { term, definition }
            })
            .filter((row) => row.term.length > 0)
          return { ...base, kind: "key-terms" as const, terms }
        }

        case "text": {
          const content = (body?.text as string | undefined) ?? ""
          return { ...base, kind: "text" as const, content }
        }

        case "upload-file": {
          const instructions = (body?.instructions as string | undefined) ?? ""
          return { ...base, kind: "text" as const, content: instructions }
        }

        default:
          return { ...base, kind: "other" as const }
      }
    }),
  )

  const now = new Date()
  const generatedAt = [
    String(now.getDate()).padStart(2, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    now.getFullYear(),
  ].join("-")

  // @react-pdf/renderer's renderToBuffer expects ReactElement<DocumentProps>.
  // createElement returns ReactElement<LessonPlanDocumentProps> which TypeScript
  // considers incompatible, so we cast through unknown.
  const docElement = createElement(LessonPlanDocument, {
    unitTitle: unit?.title ?? "Unknown Unit",
    lessonTitle: lesson.title ?? "Untitled Lesson",
    generatedAt,
    learningObjectives: pdfLos,
    activities: pdfActivities,
  }) as unknown as ReactElement<DocumentProps>

  const buffer = await renderToBuffer(docElement)

  const safeTitle = (lesson.title ?? "lesson-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeTitle}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
