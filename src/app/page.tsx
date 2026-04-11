export const dynamic = "force-dynamic"

import { requireTeacherProfile } from "@/lib/auth"
import { readDashboardProgressAction } from "@/lib/server-updates"
import { ProgressDashboard } from "@/components/teacher-dashboard/progress-dashboard"

export default async function TeacherDashboardPage() {
  const profile = await requireTeacherProfile()
  const result = await readDashboardProgressAction()
  const items = result.data ?? []

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email || "Teacher"

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{displayName}</span>
          <span className="text-xs text-muted-foreground">Teacher Dashboard</span>
        </div>
        <div className="flex gap-2">
          <div className="border-b-2 border-primary px-4 py-1.5 text-xs font-semibold text-primary">
            Progress
          </div>
        </div>
      </div>

      <ProgressDashboard items={items} />
    </main>
  )
}
