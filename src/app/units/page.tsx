export const dynamic = "force-dynamic"

import { Suspense } from "react"
import { performance } from "node:perf_hooks"

import { readSubjectsAction, readUnitsAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
import { UnitSearchControls } from "./unit-search-controls"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { ArrowLeft, BookOpen } from "lucide-react"
import { truncateText } from "@/lib/utils"
import { AddUnitTrigger } from "./add-unit-trigger"

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

  const subjectOptions = Array.from(
    new Set((subjects ?? []).filter((s) => s.active !== false).map((s) => s.subject)),
  ).sort((a, b) => a.localeCompare(b))

  return (
    <Suspense fallback={<div className="container mx-auto p-6">Loading units...</div>}>
      <main className="container mx-auto p-6">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/assignments" className="text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="mr-2 inline h-4 w-4" />
            Back to Assignments
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold text-balance">Units Overview</h1>
          </div>
          <div className="ml-auto">
            <AddUnitTrigger subjects={subjects ?? []} />
          </div>
        </div>

        <UnitSearchControls subjectOptions={subjectOptions} />

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {(units ?? []).map((unit) => (
            <UnitCard key={unit.unit_id} unit={unit} />
          ))}
        </div>

        {(units ?? []).length === 0 ? (
          <div className="py-12 text-center">
            <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No units found</h3>
            <p className="text-muted-foreground">Try adjusting your search or subject filters.</p>
          </div>
        ) : null}
      </main>
    </Suspense>
  )
}

function UnitCard({
  unit,
}: {
  unit: {
    unit_id: string
    title: string
    subject: string
    description?: string | null
    active?: boolean | null
    year?: number | null
  }
}) {
  const isActive = unit.active ?? true
  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg font-semibold text-slate-900">{unit.title}</CardTitle>
          <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{unit.subject}</p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {unit.year ? <div className="text-xs font-medium text-slate-600">Year {unit.year}</div> : null}
        <p>{truncateText(unit.description ?? "", 140) || "No description provided."}</p>
        <Link href={`/units/${unit.unit_id}`} className="text-sm font-medium text-primary hover:underline">
          View unit →
        </Link>
      </CardContent>
    </Card>
  )
}
