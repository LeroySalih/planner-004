export const dynamic = "force-dynamic"

import { SharedSowAdmin } from "@/components/admin/shared-sow-admin"
import {
  readHalfTermsAction,
  readSharedSowDetailAction,
  readSharedSowScopesAction,
  readSharedSowUnitsAction,
  readUnitsAction,
} from "@/lib/server-updates"
import { fetchActiveAcademicYears, resolveCurrentAcademicYear } from "@/lib/academic-year"

export default async function SharedSowAdminPage() {
  const [scopesResult, years, currentYear, unitsResult] = await Promise.all([
    readSharedSowScopesAction(),
    fetchActiveAcademicYears(),
    resolveCurrentAcademicYear(),
    readUnitsAction(),
  ])

  const scopes = scopesResult.data ?? []
  const year = years.includes(currentYear) ? currentYear : (years[0] ?? currentYear)

  // Open on the first subject and year group that has classes, so the page
  // arrives showing a plan rather than an empty chooser.
  const first = scopes[0] ?? null
  const [halfTermsResult, initialUnitsResult, initialDetailResult] = await Promise.all([
    readHalfTermsAction(year),
    first
      ? readSharedSowUnitsAction({
        academicYear: year,
        subject: first.subject,
        yearGroup: first.yearGroup,
      })
      : Promise.resolve({ data: [], error: null }),
    first
      ? readSharedSowDetailAction({
        academicYear: year,
        subject: first.subject,
        yearGroup: first.yearGroup,
      })
      : Promise.resolve({ data: [], error: null }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scheme of Work</h1>
        <p className="text-sm text-muted-foreground">
          Which units a subject teaches in each half term. Every class in that subject and
          year group follows this plan; a teacher can add extra units to their own class but
          cannot change what is planned here.
        </p>
      </div>

      {scopesResult.error ? (
        <p className="text-sm text-destructive">{scopesResult.error}</p>
      ) : scopes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active classes have both a subject and a year group, so there is nothing to plan
          yet.
        </p>
      ) : (
        <SharedSowAdmin
          scopes={scopes}
          years={years}
          initialYear={year}
          initialHalfTerms={halfTermsResult.data ?? []}
          initialSharedUnits={initialUnitsResult.data ?? []}
          initialDetail={initialDetailResult.data ?? []}
          units={unitsResult.data ?? []}
        />
      )}
    </div>
  )
}
