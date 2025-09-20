import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { UnitDetailView } from "@/components/units/unit-detail-view"
import {
  readAssignmentsAction,
  readLearningObjectivesByUnitAction,
  readLessonsByUnitAction,
  readGroupsAction,
  readSubjectsAction,
  readUnitAction,
} from "@/lib/server-updates"

export default async function UnitDetailPage({
  params,
}: {
  params: { unitId: string }
}) {
  const [
    unitResult,
    assignmentsResult,
    groupsResult,
    subjectsResult,
    learningObjectivesResult,
    lessonsResult,
  ] = await Promise.all([
    readUnitAction(params.unitId),
    readAssignmentsAction(),
    readGroupsAction(),
    readSubjectsAction(),
    readLearningObjectivesByUnitAction(params.unitId),
    readLessonsByUnitAction(params.unitId),
  ])

  if (unitResult.error) {
    throw new Error(unitResult.error)
  }

  if (assignmentsResult.error) {
    throw new Error(assignmentsResult.error)
  }

  if (groupsResult.error) {
    throw new Error(groupsResult.error)
  }

  if (subjectsResult.error) {
    throw new Error(subjectsResult.error)
  }

  if (learningObjectivesResult.error) {
    throw new Error(learningObjectivesResult.error)
  }

  if (lessonsResult.error) {
    throw new Error(lessonsResult.error)
  }

  const unit = unitResult.data

  if (!unit) {
    notFound()
  }

  const assignments = (assignmentsResult.data ?? []).filter(
    (assignment) => assignment.unit_id === unit.unit_id,
  )

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href="/units">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Units
        </Link>
      </Button>

      <UnitDetailView
        unit={unit}
        assignments={assignments}
        groups={groupsResult.data ?? []}
        subjects={subjectsResult.data ?? []}
        learningObjectives={learningObjectivesResult.data ?? []}
        lessons={lessonsResult.data ?? []}
      />
    </main>
  )
}
