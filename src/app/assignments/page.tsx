export const dynamic = "force-dynamic"

import AssignmentManager from "@/components/assignment-manager"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { readAssignmentsBootstrapAction, readLessonAssignmentScoreSummariesAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import type { Assignments, Groups, LessonAssignments, Lessons, Subjects, Units } from "@/types"

export default async function Home() {
  const teacherProfile = await requireTeacherProfile()

  const { data: bootstrapData, error: bootstrapError } = await readAssignmentsBootstrapAction()

  if (bootstrapError || !bootstrapData) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Error Loading Assignments</h1>
        <p className="text-red-600">
          There was an error loading the assignment data: {bootstrapError ?? "Unknown error."}
        </p>
      </div>
    )
  }

  const bootstrap =
    (Array.isArray(bootstrapData) && bootstrapData.length > 0 ? bootstrapData[0] ?? {} : bootstrapData) as {
      groups?: unknown[]
      subjects?: unknown[]
      assignments?: unknown[]
      units?: unknown[]
      lessons?: unknown[]
      lessonAssignments?: unknown[]
    }

  const groups = (bootstrap.groups ?? []) as Groups
  const subjects = (bootstrap.subjects ?? []) as Subjects
  const assignments = (bootstrap.assignments ?? []) as Assignments
  const units = (bootstrap.units ?? []) as Units
  const lessons = (bootstrap.lessons ?? []) as Lessons
  const lessonAssignments = (bootstrap.lessonAssignments ?? []) as LessonAssignments

  const summaryPairs = Array.from(
    new Map(
      (lessonAssignments ?? []).map((assignment) => [
        `${assignment.group_id}::${assignment.lesson_id}`,
        { groupId: assignment.group_id, lessonId: assignment.lesson_id },
      ]),
    ).values(),
  )

  const { data: lessonScoreSummaries, error: lessonScoreSummariesError } =
    summaryPairs.length === 0
      ? { data: [], error: null }
      : await readLessonAssignmentScoreSummariesAction({ pairs: summaryPairs }, { profile: teacherProfile })

  if (lessonScoreSummariesError) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Error Loading Lesson Scores</h1>
        <p className="text-red-600">
          There was an error loading the lesson score summaries: {lessonScoreSummariesError}
        </p>
      </div>
    )
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
        lessons={(lessons ?? []).filter((lesson) => lesson.active ?? true)}
        lessonAssignments={lessonAssignments}
        lessonScoreSummaries={lessonScoreSummaries}
      />
    </main>
  )
}
