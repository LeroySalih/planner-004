export const dynamic = "force-dynamic"

import { Suspense } from "react"
import { performance } from "node:perf_hooks"

import { UnitsPageClient } from "@/components/units/units-page-client"
import { readSubjectsAction, readUnitsAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"

export default async function UnitsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; subject?: string; inactive?: string }>
}) {
  const teacherProfile = await requireTeacherProfile()
  const authEnd = performance.now()

  const resolvedSearchParams = (await searchParams) ?? {}
  const filter = (resolvedSearchParams.q ?? "").trim()
  const subjectFilter = (resolvedSearchParams.subject ?? "").trim() || null
  const includeInactive = (resolvedSearchParams.inactive ?? "").trim() === "1"

  const [unitsResult, subjectsResult] = await withTelemetry(
    {
      routeTag: "/units",
      functionName: "UnitsPage.loadData",
      params: null,
      authEndTime: authEnd,
    },
    () =>
      Promise.all([
        readUnitsAction({
          routeTag: "/units",
          authEndTime: authEnd,
          currentProfile: teacherProfile,
          filter,
          subject: subjectFilter,
          includeInactive,
        }),
        readSubjectsAction({ routeTag: "/units", authEndTime: authEnd, currentProfile: teacherProfile }),
      ]),
  )

  const { data: units, error: unitsError } = unitsResult
  const { data: subjects, error: subjectsError } = subjectsResult

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

  return (
    <Suspense fallback={<div className="container mx-auto p-6">Loading units...</div>}>
      <UnitsPageClient
        units={units ?? []}
        subjects={subjects ?? []}
        initialFilter={{ search: filter, subject: subjectFilter, showInactive: includeInactive }}
      />
    </Suspense>
  )
}
