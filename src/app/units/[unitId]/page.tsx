export const dynamic = "force-dynamic"

import { Suspense } from "react"
import { performance } from "node:perf_hooks"

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
import { withTelemetry } from "@/lib/telemetry"

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ unitId: string }>
}) {
  const teacherProfile = await requireTeacherProfile()
  const authEnd = performance.now()
  const { unitId } = await params

  const [
    unitResult,
    assignmentsResult,
    groupsResult,
    subjectsResult,
    learningObjectivesResult,
    lessonsResult,
    unitFilesResult,
  ] = await withTelemetry(
    {
      routeTag: "/units/[unitId]",
      functionName: "UnitDetailPage.loadData",
      params: { unitId },
      authEndTime: authEnd,
    },
    () =>
      Promise.all([
        readUnitAction(unitId, { routeTag: "/units/[unitId]", authEndTime: authEnd, currentProfile: teacherProfile }),
        readAssignmentsAction({ routeTag: "/units/[unitId]", authEndTime: authEnd }),
        readGroupsAction({ routeTag: "/units/[unitId]", authEndTime: authEnd, currentProfile: teacherProfile }),
        readSubjectsAction({ routeTag: "/units/[unitId]", authEndTime: authEnd, currentProfile: teacherProfile }),
        readLearningObjectivesByUnitAction(unitId, {
          routeTag: "/units/[unitId]",
          authEndTime: authEnd,
        }),
        readLessonsByUnitAction(unitId, { routeTag: "/units/[unitId]", authEndTime: authEnd }),
        listUnitFilesAction(unitId, { routeTag: "/units/[unitId]", authEndTime: authEnd }),
      ]),
  )

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
    <Suspense fallback={<div className="container mx-auto p-6">Loading unit...</div>}>
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
    </Suspense>
  )
}
