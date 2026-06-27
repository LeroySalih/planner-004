import { Suspense } from "react"

import { readGroupsAction, readSubjectsAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import { GroupsList } from "./groups-list"
import { GroupsPageClient } from "./groups-page-client"

export default async function GroupsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const teacherProfile = await requireTeacherProfile()
  const { q: rawFilter = "" } = await searchParams
  const filter = rawFilter.trim()

  const [result, subjectsResult] = await Promise.all([
    readGroupsAction({ currentProfile: teacherProfile, filter }),
    readSubjectsAction({ routeTag: "/groups", currentProfile: teacherProfile }),
  ])
  const groups = result.data ?? []
  const subjects = (subjectsResult.data ?? []).map((subject) => subject.subject)
  return (
    <Suspense fallback={<div className="container mx-auto px-6 py-8">Loading groups...</div>}>
      <GroupsPageClient
        groups={groups}
        initialFilter={filter}
        error={result.error ?? null}
        currentProfile={teacherProfile}
        subjects={subjects}
      />
    </Suspense>
  )
}
