export const dynamic = "force-dynamic"

import AssignmentManager from "@/components/assignment-manager"
import { ClassFilter } from "@/components/assignment-manager/class-filter"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { readAssignmentsBootstrapForGroupsAction, readLessonAssignmentScoreSummariesAction, listDateCommentsAction, readGroupsAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import type { Assignments, AssignmentsBootstrapPayload, DateComments, Groups, LessonAssignments, Lessons, Subjects, Units } from "@/types"

const DEFAULT_CLASSES = ["25-11-DT"]

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ classes?: string }>
}) {
  const teacherProfile = await requireTeacherProfile()

  // Load all active groups for the class filter dropdown
  const { data: allGroupsData } = await readGroupsAction({ currentProfile: teacherProfile })
  const allGroups = (allGroupsData ?? []).map((g) => ({
    group_id: g.group_id,
    subject: g.subject,
  }))

  // Determine selected classes from query params
  const params = await searchParams
  const classesParam = params.classes
  const selectedGroupIds = classesParam
    ? classesParam.split(",").map((c) => c.trim()).filter(Boolean)
    : DEFAULT_CLASSES

  // Resolve group IDs case-insensitively against known groups
  const groupIdMap = new Map(allGroups.map((g) => [g.group_id.toLowerCase(), g.group_id]))
  const resolvedGroupIds = selectedGroupIds
    .map((id) => groupIdMap.get(id.toLowerCase()))
    .filter((id): id is string => id != null)

  if (resolvedGroupIds.length === 0) {
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
        <div className="mb-4">
          <ClassFilter allGroups={allGroups} selectedGroupIds={[]} />
        </div>
        <p className="text-muted-foreground">Select one or more classes to view assignments.</p>
      </main>
    )
  }

  const { data: bootstrapData, error: bootstrapError } = await readAssignmentsBootstrapForGroupsAction(resolvedGroupIds)

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

  const bootstrap = (bootstrapData ?? {}) as AssignmentsBootstrapPayload

  const groups = (bootstrap.groups ?? []) as Groups
  const subjects = (bootstrap.subjects ?? []) as Subjects
  const assignments = (bootstrap.assignments ?? []) as Assignments
  const units = (bootstrap.units ?? []) as Units
  const lessons = (bootstrap.lessons ?? []) as Lessons
  const lessonAssignments = (bootstrap.lessonAssignments ?? []) as LessonAssignments

  // Compute a generous date range for date comments (1 year back, 1 year forward from today)
  const today = new Date()
  const commentsStartDate = new Date(today)
  commentsStartDate.setFullYear(commentsStartDate.getFullYear() - 1)
  const commentsEndDate = new Date(today)
  commentsEndDate.setFullYear(commentsEndDate.getFullYear() + 1)
  const formatIso = (d: Date) => d.toISOString().slice(0, 10)

  const { data: dateComments } = await listDateCommentsAction(
    formatIso(commentsStartDate),
    formatIso(commentsEndDate),
  )

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
      <div className="mb-4">
        <ClassFilter allGroups={allGroups} selectedGroupIds={resolvedGroupIds} />
      </div>
      <AssignmentManager
        groups={groups}
        subjects={subjects}
        assignments={assignments}
        units={(units ?? []).filter((unit) => unit.active ?? true)}
        lessons={(lessons ?? []).filter((lesson) => lesson.active ?? true)}
        lessonAssignments={lessonAssignments}
        lessonScoreSummaries={lessonScoreSummaries}
        dateComments={(dateComments ?? []) as DateComments}
      />
    </main>
  )
}
