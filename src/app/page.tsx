export const dynamic = "force-dynamic"

import Link from "next/link"
import { Suspense } from "react"
import { requireTeacherProfile } from "@/lib/auth"
import {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  readGroupsAction,
} from "@/lib/server-updates"
import { RecentSubmissionsPanel } from "@/components/teacher-dashboard/recent-submissions-panel"
import { MarkingQueuePanel } from "@/components/teacher-dashboard/marking-queue-panel"
import { FlaggedPanel } from "@/components/teacher-dashboard/flagged-panel"
import { MentionsPanel } from "@/components/teacher-dashboard/mentions-panel"
import { DashboardClient } from "@/components/teacher-dashboard/dashboard-client"
import { ClassSidebar } from "@/components/teacher-dashboard/class-sidebar"

type Props = {
  searchParams: Promise<{ class?: string }>
}

export default async function TeacherDashboardPage({ searchParams }: Props) {
  const profile = await requireTeacherProfile()
  const { class: classParam } = await searchParams
  const groupId = classParam || undefined

  const [markingResult, flaggedResult, mentionsResult, groupsResult] = await Promise.all([
    readMarkingQueueAction(groupId),
    readFlaggedSubmissionsAction(groupId),
    readMentionsAction(groupId),
    readGroupsAction({ currentProfile: profile, routeTag: "dashboard" }),
  ])

  const initialMarkingCount = (markingResult.data ?? []).reduce((s, i) => s + i.submissionCount, 0)
  const initialFlaggedCount = (flaggedResult.data ?? []).length
  const initialMentionsCount = (mentionsResult.data ?? []).length

  const classes = (groupsResult.data ?? []).map((g) => ({
    groupId: g.group_id,
    subject: g.subject,
  }))

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email || "Teacher"

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{displayName}</span>
          <span className="text-xs text-muted-foreground">Teacher Dashboard</span>
        </div>
        <Link
          href="/assignments"
          className="rounded bg-muted px-3 py-1.5 text-xs text-blue-600 hover:bg-accent dark:text-blue-400"
        >
          Assignments →
        </Link>
      </div>

      <div className="flex min-h-[calc(100vh-49px)]">
        <ClassSidebar classes={classes} />

        <div className="flex-1">
          <DashboardClient
            initialMarkingCount={initialMarkingCount}
            initialFlaggedCount={initialFlaggedCount}
            initialMentionsCount={initialMentionsCount}
            groupId={groupId}
          >
            {/* 2×2 quad grid */}
            <div className="grid min-h-[calc(100vh-88px)] grid-cols-2 grid-rows-2">
              {/* Top-left: Recent Submissions (client component) */}
              <div className="max-h-[50vh] overflow-y-auto border-b border-r border-border">
                <RecentSubmissionsPanel groupId={groupId} />
              </div>

              {/* Top-right: Needs Review */}
              <div className="max-h-[50vh] overflow-y-auto border-b border-border">
                <Suspense fallback={<PanelSkeleton />}>
                  <MarkingQueuePanel groupId={groupId} />
                </Suspense>
              </div>

              {/* Bottom-left: Flagged by Pupil */}
              <div className="max-h-[50vh] overflow-y-auto border-r border-border">
                <Suspense fallback={<PanelSkeleton />}>
                  <FlaggedPanel groupId={groupId} />
                </Suspense>
              </div>

              {/* Bottom-right: Mentions */}
              <div className="max-h-[50vh] overflow-y-auto">
                <Suspense fallback={<PanelSkeleton />}>
                  <MentionsPanel groupId={groupId} />
                </Suspense>
              </div>
            </div>
          </DashboardClient>
        </div>
      </div>
    </main>
  )
}

function PanelSkeleton() {
  return (
    <div className="animate-pulse p-4">
      <div className="mb-3 h-3 w-24 rounded bg-muted" />
      <div className="flex flex-wrap gap-1.5">
        <div className="h-16 w-28 rounded bg-muted" />
        <div className="h-16 w-28 rounded bg-muted" />
        <div className="h-16 w-28 rounded bg-muted" />
      </div>
    </div>
  )
}
