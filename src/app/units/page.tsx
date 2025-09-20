export const dynamic = "force-dynamic"

import { UnitsPageClient } from "@/components/units/units-page-client"
import { readSubjectsAction, readUnitsAction } from "@/lib/server-updates"

export default async function UnitsPage() {
  const [{ data: units, error: unitsError }, { data: subjects, error: subjectsError }] = await Promise.all([
    readUnitsAction(),
    readSubjectsAction(),
  ])

  if (unitsError) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Units</h1>
        <p className="text-red-600">There was an error loading the units: {unitsError}</p>
      </div>
    )
  }

  if (subjectsError) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Subjects</h1>
        <p className="text-red-600">There was an error loading the subjects: {subjectsError}</p>
      </div>
    )
  }

  return <UnitsPageClient units={units ?? []} subjects={subjects ?? []} />
}
