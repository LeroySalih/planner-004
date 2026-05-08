export const dynamic = "force-dynamic"

import { requireTeacherProfile } from "@/lib/auth"
import { ScheduledLessonsTable } from "@/components/assignment-manager/scheduled-lessons-table"

export default async function AssignmentsPage() {
  await requireTeacherProfile()

  return (
    <main className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Scheduled Lessons</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Lessons are scheduled via the Planner</p>
      </div>
      <ScheduledLessonsTable />
    </main>
  )
}
