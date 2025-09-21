export const dynamic = "force-dynamic"

import { LessonsPageClient } from "@/components/lessons/lessons-page-client"
import { readLessonsAction, readSubjectsAction, readUnitsAction } from "@/lib/server-updates"

export default async function LessonsPage() {
  const [lessonsResult, unitsResult, subjectsResult] = await Promise.all([
    readLessonsAction(),
    readUnitsAction(),
    readSubjectsAction(),
  ])

  if (lessonsResult.error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Lessons</h1>
        <p className="text-red-600">{lessonsResult.error}</p>
      </div>
    )
  }

  if (unitsResult.error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Units</h1>
        <p className="text-red-600">{unitsResult.error}</p>
      </div>
    )
  }

  if (subjectsResult.error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Subjects</h1>
        <p className="text-red-600">{subjectsResult.error}</p>
      </div>
    )
  }

  return (
    <LessonsPageClient
      lessons={lessonsResult.data ?? []}
      units={unitsResult.data ?? []}
      subjects={subjectsResult.data ?? []}
    />
  )
}
