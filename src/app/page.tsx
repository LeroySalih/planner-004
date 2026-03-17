export const dynamic = "force-dynamic"

import Link from "next/link"
import { Suspense } from "react"
import { requireTeacherProfile } from "@/lib/auth"
import { readMarkingQueueAction, readFlaggedSubmissionsAction, readMentionsAction } from "@/lib/server-updates"
import { MarkingQueuePanel } from "@/components/teacher-dashboard/marking-queue-panel"
import { FlaggedPanel } from "@/components/teacher-dashboard/flagged-panel"
import { MentionsPanel } from "@/components/teacher-dashboard/mentions-panel"
import { DashboardClient } from "@/components/teacher-dashboard/dashboard-client"

export default async function TeacherDashboardPage() {
  const profile = await requireTeacherProfile()

  // Fetch initial counts for DashboardClient (panels fetch their own full data)
  const [markingResult, flaggedResult, mentionsResult] = await Promise.all([
    readMarkingQueueAction(),
    readFlaggedSubmissionsAction(),
    readMentionsAction(),
  ])

  const initialMarkingCount = (markingResult.data ?? []).reduce((s, i) => s + i.submissionCount, 0)
  const initialFlaggedCount = (flaggedResult.data ?? []).length
  const initialMentionsCount = (mentionsResult.data ?? []).length

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email || "Teacher"

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-100">{displayName}</span>
          <span className="text-xs text-slate-500">Teacher Dashboard</span>
        </div>
        <Link
          href="/assignments"
          className="rounded bg-slate-800 px-3 py-1.5 text-xs text-blue-300 hover:bg-slate-700"
        >
          Assignments →
        </Link>
      </div>

      <DashboardClient
        initialMarkingCount={initialMarkingCount}
        initialFlaggedCount={initialFlaggedCount}
        initialMentionsCount={initialMentionsCount}
      >
        {/* Panel layout: wide left + stacked right */}
        <div className="flex min-h-[calc(100vh-88px)]">
          <Suspense fallback={<PanelSkeleton className="flex-[2] border-r border-slate-800" />}>
            <MarkingQueuePanel />
          </Suspense>

          <div className="flex flex-1 flex-col">
            <Suspense fallback={<PanelSkeleton className="flex-1 border-b border-slate-800" />}>
              <FlaggedPanel />
            </Suspense>
            <Suspense fallback={<PanelSkeleton className="flex-1" />}>
              <MentionsPanel />
            </Suspense>
          </div>
        </div>
      </DashboardClient>
    </main>
  )
}

function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse p-4 ${className ?? ""}`}>
      <div className="mb-3 h-3 w-24 rounded bg-slate-800" />
      <div className="space-y-2">
        <div className="h-10 rounded bg-slate-800" />
        <div className="h-10 rounded bg-slate-800" />
        <div className="h-10 rounded bg-slate-800" />
      </div>
    </div>
  )
}
