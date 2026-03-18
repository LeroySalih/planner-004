export const dynamic = "force-dynamic"

import Link from "next/link"
import { Suspense } from "react"
import { requireTeacherProfile } from "@/lib/auth"
import { readMarkingQueueAction, readFlaggedSubmissionsAction, readMentionsAction } from "@/lib/server-updates"
import { RecentSubmissionsPanel } from "@/components/teacher-dashboard/recent-submissions-panel"
import { MarkingQueuePanel } from "@/components/teacher-dashboard/marking-queue-panel"
import { FlaggedPanel } from "@/components/teacher-dashboard/flagged-panel"
import { MentionsPanel } from "@/components/teacher-dashboard/mentions-panel"
import { DashboardClient } from "@/components/teacher-dashboard/dashboard-client"

export default async function TeacherDashboardPage() {
  const profile = await requireTeacherProfile()

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
        {/* 2×2 quad grid */}
        <div className="grid min-h-[calc(100vh-88px)] grid-cols-2 grid-rows-2">
          {/* Top-left: Recent Submissions (client component) */}
          <div className="max-h-[50vh] overflow-y-auto border-b border-r border-slate-800">
            <RecentSubmissionsPanel />
          </div>

          {/* Top-right: Needs Review */}
          <div className="max-h-[50vh] overflow-y-auto border-b border-slate-800">
            <Suspense fallback={<PanelSkeleton />}>
              <MarkingQueuePanel />
            </Suspense>
          </div>

          {/* Bottom-left: Flagged by Pupil */}
          <div className="max-h-[50vh] overflow-y-auto border-r border-slate-800">
            <Suspense fallback={<PanelSkeleton />}>
              <FlaggedPanel />
            </Suspense>
          </div>

          {/* Bottom-right: Mentions */}
          <div className="max-h-[50vh] overflow-y-auto">
            <Suspense fallback={<PanelSkeleton />}>
              <MentionsPanel />
            </Suspense>
          </div>
        </div>
      </DashboardClient>
    </main>
  )
}

function PanelSkeleton() {
  return (
    <div className="animate-pulse p-4">
      <div className="mb-3 h-3 w-24 rounded bg-slate-800" />
      <div className="flex flex-wrap gap-1.5">
        <div className="h-16 w-28 rounded bg-slate-800" />
        <div className="h-16 w-28 rounded bg-slate-800" />
        <div className="h-16 w-28 rounded bg-slate-800" />
      </div>
    </div>
  )
}
