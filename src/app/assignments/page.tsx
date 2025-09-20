import AssignmentManager  from "@/components/assignment-manager"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { readGroupsAction } from "@/lib/server-actions/groups"
import { readAssignmentsAction, readSubjectsAction, readUnitsAction } from "@/lib/server-updates"

export default async function Home() {

  const {data:groups, error: groupsError} = await readGroupsAction();
  const {data:subjects, error: subjectsError} = await readSubjectsAction();
  const {data:assignments, error: assignmentsError} = await readAssignmentsAction();
  const {data:units, error: unitsError} = await readUnitsAction();

  if (groupsError)  {
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Groups</h1>
      <p className="text-red-600">There was an error loading the groups: {groupsError}</p>
    </div>
  }

  if (subjectsError)  {
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Subjects</h1>
      <p className="text-red-600">There was an error loading the subjects: {subjectsError}</p>
    </div>
  }

  if (assignmentsError){
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Assignments</h1>
      <p className="text-red-600">There was an error loading the assignments: {assignmentsError}</p>
    </div>
  }

  if (unitsError){
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Units</h1>
      <p className="text-red-600">There was an error loading the units: {unitsError}</p>
    </div>
  }


  return (
    <main className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Assignment Manager</h1>
        <Link href="/units">
          <Button variant="outline">
            <BookOpen className="h-4 w-4 mr-2" />
            View All Units
          </Button>
        </Link>
      </div>
      <AssignmentManager
        groups={groups}
        subjects={subjects}
        assignments={assignments}
        units={(units ?? []).filter((unit) => unit.active ?? true)}
      />
    </main>
  )
}
