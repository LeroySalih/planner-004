import { readGroupsAction } from "@/lib/server-updates"
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

  const result = await readGroupsAction({ currentProfile: teacherProfile, filter })
  const groups = result.data ?? []
  return <GroupsPageClient groups={groups} initialFilter={filter} error={result.error ?? null} currentProfile={teacherProfile} />
}
