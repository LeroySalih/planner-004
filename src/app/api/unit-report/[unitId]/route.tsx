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

  const learningObjectives: UnitReportLo[] = rawLos.map((lo) => ({
    learning_objective_id: lo.learning_objective_id,
    title: lo.title,
    order_index: lo.order_index ?? null,
    spec_ref: lo.spec_ref ?? null,
    assessment_objective_id: lo.assessment_objective_id ?? null,
    assessment_objective_code: lo.assessment_objective_code ?? null,
    assessment_objective_title: lo.assessment_objective_title ?? null,
    assessment_objective_order_index: lo.assessment_objective_order_index ?? null,
    success_criteria: (lo.success_criteria ?? []).map((sc): UnitReportSc => ({
      success_criteria_id: sc.success_criteria_id,
      description: sc.description,
      level: typeof sc.level === "number" ? sc.level : null,
      order_index: sc.order_index ?? null,
      learning_objective_id: lo.learning_objective_id,
    })),
  }))

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
