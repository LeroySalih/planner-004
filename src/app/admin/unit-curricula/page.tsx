export const dynamic = "force-dynamic"

import { UnitCurriculaAdmin } from "@/components/admin/unit-curricula-admin"
import { readMultiCurriculumUnitsAction } from "@/lib/server-actions/unit-curricula-admin"

export default async function UnitCurriculaAdminPage() {
  const result = await readMultiCurriculumUnitsAction()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Unit Curricula</h1>
        <p className="text-sm text-muted-foreground">
          Units that reference more than one curriculum. Keep a single curriculum per unit; the others&apos; learning
          objectives and success criteria are removed from the unit, its lessons and its activities.
        </p>
      </div>
      {result.error ? (
        <p className="text-sm text-destructive">{result.error}</p>
      ) : (
        <UnitCurriculaAdmin initialUnits={result.data} />
      )}
    </div>
  )
}
