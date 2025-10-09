import { notFound } from "next/navigation"

import { readCurriculumDetailAction, readLessonsAction, readUnitsAction } from "@/lib/server-updates"
import type { CurriculumDetail, LessonWithObjectives, Units } from "@/types"

import CurriculumPrototypeClient from "./curriculum-prototype-client"
import { requireTeacherProfile } from "@/lib/auth"

export default async function CurriculumDetailPage({
  params,
}: {
  params: Promise<{ curriculumId: string }>
}) {
  await requireTeacherProfile()
  const { curriculumId } = await params

  const [curriculumResult, unitsResult, lessonsResult] = await Promise.all([
    readCurriculumDetailAction(curriculumId),
    readUnitsAction(),
    readLessonsAction(),
  ])

  if (curriculumResult.error) {
    throw new Error(curriculumResult.error)
  }

  const curriculum = curriculumResult.data

  if (!curriculum) {
    notFound()
  }

  if (unitsResult.error) {
    console.warn("[curricula] Failed to load units for curriculum view", unitsResult.error)
  }

  const units: Units = unitsResult.data ?? []
  const lessons: LessonWithObjectives[] = (lessonsResult.data ?? []) as LessonWithObjectives[]

  return (
    <CurriculumPrototypeClient
      curriculum={curriculum as CurriculumDetail}
      units={units}
      unitsError={unitsResult.error}
      lessons={lessons}
      lessonsError={lessonsResult.error}
    />
  )
}
