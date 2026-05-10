import { createElement } from "react"
import type { ReactElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import type { DocumentProps } from "@react-pdf/renderer"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import {
  readUnitAction,
  readLearningObjectivesByUnitAction,
  readLessonsByUnitAction,
  readFileDownloadActivitiesByUnitAction,
} from "@/lib/server-updates"
import { UnitReportDocument } from "@/components/pdf/unit-report-document"
import type {
  UnitReportDocumentProps,
  UnitReportLo,
  UnitReportLesson,
  UnitReportSc,
} from "@/components/pdf/unit-report-document"

const ROUTE_TAG = "/api/unit-report/[unitId]"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ unitId: string }> },
) {
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { unitId } = await params

  const [unitResult, losResult, lessonsResult, fileActivities] =
    await Promise.all([
      readUnitAction(unitId, { routeTag: ROUTE_TAG, authEndTime: null }),
      readLearningObjectivesByUnitAction(unitId, {
        routeTag: ROUTE_TAG,
        authEndTime: null,
      }),
      readLessonsByUnitAction(unitId, {
        routeTag: ROUTE_TAG,
        authEndTime: null,
      }),
      readFileDownloadActivitiesByUnitAction(unitId),
    ])

  if (!unitResult.data) {
    return new Response("Unit not found", { status: 404 })
  }

  const unit = unitResult.data
  const rawLos = losResult.data ?? []
  const rawLessons = lessonsResult.data ?? []

  // Build file-name map keyed by lessonId
  const filesByLesson = new Map<string, string[]>()
  for (const { lessonId, fileName } of fileActivities) {
    if (!filesByLesson.has(lessonId)) filesByLesson.set(lessonId, [])
    filesByLesson.get(lessonId)!.push(fileName)
  }

  // If no unit-level LOs, aggregate from lesson objectives
  const effectiveLos = rawLos.length > 0
    ? rawLos
    : (() => {
        const loMap = new Map<string, {
          learning_objective_id: string
          title: string
          order_index: number | null
          seenScIds: Set<string>
          success_criteria: UnitReportSc[]
        }>()
        for (const lesson of rawLessons) {
          for (const lo of lesson.lesson_objectives ?? []) {
            if (!loMap.has(lo.learning_objective_id)) {
              loMap.set(lo.learning_objective_id, {
                learning_objective_id: lo.learning_objective_id,
                title: lo.title,
                order_index: lo.order_by ?? null,
                seenScIds: new Set(),
                success_criteria: [],
              })
            }
            const entry = loMap.get(lo.learning_objective_id)!
            for (const sc of lesson.lesson_success_criteria ?? []) {
              const scLoId = (sc as Record<string, unknown>).learning_objective_id as string | undefined
              if (
                (scLoId === lo.learning_objective_id || !scLoId) &&
                !entry.seenScIds.has(sc.success_criteria_id)
              ) {
                entry.seenScIds.add(sc.success_criteria_id)
                entry.success_criteria.push({
                  success_criteria_id: sc.success_criteria_id,
                  description: sc.description ?? (sc as Record<string, unknown>).title as string ?? "",
                  level: typeof sc.level === "number" ? sc.level : null,
                  order_index: ((sc as Record<string, unknown>).order_index as number | null | undefined) ?? null,
                  learning_objective_id: lo.learning_objective_id,
                })
              }
            }
          }
        }
        return [...loMap.values()]
      })()

  const learningObjectives: UnitReportLo[] = effectiveLos.map((lo) => {
    // Handle both full LO shape (from readLearningObjectivesByUnitAction)
    // and synthetic shape (aggregated from lessons)
    const isFullLo = "assessment_objective_id" in lo
    if (isFullLo) {
      const fullLo = lo as typeof rawLos[number]
      return {
        learning_objective_id: fullLo.learning_objective_id,
        title: fullLo.title,
        order_index: fullLo.order_index ?? null,
        spec_ref: fullLo.spec_ref ?? null,
        assessment_objective_id: fullLo.assessment_objective_id ?? null,
        assessment_objective_code: fullLo.assessment_objective_code ?? null,
        assessment_objective_title: fullLo.assessment_objective_title ?? null,
        assessment_objective_order_index: fullLo.assessment_objective_order_index ?? null,
        success_criteria: (fullLo.success_criteria ?? []).map((sc): UnitReportSc => ({
          success_criteria_id: sc.success_criteria_id,
          description: sc.description,
          level: typeof sc.level === "number" ? sc.level : null,
          order_index: sc.order_index ?? null,
          learning_objective_id: fullLo.learning_objective_id,
        })),
      }
    }
    // Synthetic LO from lesson aggregation
    const synthLo = lo as {
      learning_objective_id: string
      title: string
      order_index: number | null
      success_criteria: UnitReportSc[]
    }
    return {
      learning_objective_id: synthLo.learning_objective_id,
      title: synthLo.title,
      order_index: synthLo.order_index,
      spec_ref: null,
      assessment_objective_id: null,
      assessment_objective_code: null,
      assessment_objective_title: null,
      assessment_objective_order_index: null,
      success_criteria: synthLo.success_criteria,
    }
  })

  const lessons: UnitReportLesson[] = rawLessons.map((lesson) => {
    const lessonScs: UnitReportSc[] = (lesson.lesson_success_criteria ?? []).map((sc): UnitReportSc => ({
      success_criteria_id: sc.success_criteria_id,
      description: sc.description ?? sc.title ?? "",
      level: typeof sc.level === "number" ? sc.level : null,
      order_index: null,
      learning_objective_id: sc.learning_objective_id ?? undefined,
    }))

    return {
      lesson_id: lesson.lesson_id,
      title: lesson.title,
      order_by: lesson.order_by ?? null,
      lesson_objectives: (lesson.lesson_objectives ?? []).map((lo) => ({
        learning_objective_id: lo.learning_objective_id,
        title: lo.title,
        order_by: lo.order_by ?? null,
        spec_ref: null,
      })),
      lesson_success_criteria: lessonScs,
      lesson_links: (lesson.lesson_links ?? []).map((link) => ({
        url: link.url,
        description: link.description ?? null,
      })),
      file_names: filesByLesson.get(lesson.lesson_id) ?? [],
    }
  })

  const props: UnitReportDocumentProps = {
    unitTitle: unit.title,
    subject: unit.subject,
    year: unit.year ?? null,
    description: unit.description ?? null,
    learningObjectives,
    lessons,
  }

  const docElement = createElement(UnitReportDocument, props) as unknown as ReactElement<DocumentProps>
  const buffer = await renderToBuffer(docElement)

  const safeTitle = unit.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeTitle}-report.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
