import { notFound } from "next/navigation"

import { readCurriculumDetailAction, readUnitsAction } from "@/lib/server-updates"
import type { CurriculumDetail, Units } from "@/types"

import CurriculumPrototypeClient from "./curriculum-prototype-client"

export default async function CurriculumDetailPage({
  params,
}: {
  params: Promise<{ curriculumId: string }>
}) {
  const { curriculumId } = await params

  const [curriculumResult, unitsResult] = await Promise.all([
    readCurriculumDetailAction(curriculumId),
    readUnitsAction(),
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

  return (
    <CurriculumPrototypeClient
      curriculum={curriculum as CurriculumDetail}
      units={units}
      unitsError={unitsResult.error}
    />
  )
}
