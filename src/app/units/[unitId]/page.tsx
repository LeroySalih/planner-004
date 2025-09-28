export const dynamic = "force-dynamic"

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
  listUnitFilesAction,
} from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ unitId: string }>
}) {
  await requireTeacherProfile()
  const { unitId } = await params

  const [
    unitResult,
    assignmentsResult,
    groupsResult,
    subjectsResult,
    learningObjectivesResult,
    lessonsResult,
    unitFilesResult,
  ] = await Promise.all([
    readUnitAction(unitId),
    readAssignmentsAction(),
    readGroupsAction(),
    readSubjectsAction(),
    readLearningObjectivesByUnitAction(unitId),
    readLessonsByUnitAction(unitId),
    listUnitFilesAction(unitId),
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

  if (unitFilesResult.error) {
    throw new Error(unitFilesResult.error)
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
        unitFiles={unitFilesResult.data ?? []}
      />
    </main>
  )
}
