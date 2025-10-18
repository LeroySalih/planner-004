export const dynamic = "force-dynamic"

import AssignmentManager  from "@/components/assignment-manager"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { readGroupsAction } from "@/lib/server-actions/groups"
import {
  readAssignmentsAction,
  readSubjectsAction,
  readUnitsAction,
  readLessonsAction,
  readLessonAssignmentsAction,
  readLessonAssignmentScoreSummariesAction,
} from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"

export default async function Home() {

  await requireTeacherProfile()

  const {data:groups, error: groupsError} = await readGroupsAction();
  const {data:subjects, error: subjectsError} = await readSubjectsAction();
  const {data:assignments, error: assignmentsError} = await readAssignmentsAction();
  const {data:units, error: unitsError} = await readUnitsAction();
  const {data:lessonsWithDetails, error: lessonsError} = await readLessonsAction();
  const {data:lessonAssignments, error: lessonAssignmentsError} = await readLessonAssignmentsAction();

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

  if (lessonsError){
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Lessons</h1>
      <p className="text-red-600">There was an error loading the lessons: {lessonsError}</p>
    </div>
  }

  if (lessonAssignmentsError){
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Lesson Assignments</h1>
      <p className="text-red-600">There was an error loading the lesson assignments: {lessonAssignmentsError}</p>
    </div>
  }

  const summaryPairs = Array.from(
    new Map(
      (lessonAssignments ?? []).map((assignment) => [
        `${assignment.group_id}::${assignment.lesson_id}`,
        { groupId: assignment.group_id, lessonId: assignment.lesson_id },
      ]),
    ).values(),
  )

  const { data: lessonScoreSummaries, error: lessonScoreSummariesError } =
    await readLessonAssignmentScoreSummariesAction({ pairs: summaryPairs })

  if (lessonScoreSummariesError) {
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Lesson Scores</h1>
      <p className="text-red-600">There was an error loading the lesson score summaries: {lessonScoreSummariesError}</p>
    </div>
  }


  const lessons = (lessonsWithDetails ?? []).map((lesson) => ({
    lesson_id: lesson.lesson_id,
    unit_id: lesson.unit_id,
    title: lesson.title,
    order_by: lesson.order_by ?? 0,
    active: lesson.active ?? true,
  }))


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
        lessons={lessons.filter((lesson) => lesson.active ?? true)}
        lessonAssignments={lessonAssignments}
        lessonScoreSummaries={lessonScoreSummaries}
      />
    </main>
  )
}
