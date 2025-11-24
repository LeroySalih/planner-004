import { readGroupsAction } from "@/lib/server-updates"
import { GroupsPageClient } from "./groups-page-client"
import { requireTeacherProfile } from "@/lib/auth"

export default async function GroupsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const teacherProfile = await requireTeacherProfile()
  const { q: rawFilter = "" } = await searchParams
  const filter = rawFilter.trim()

  const result = await readGroupsAction({ currentProfile: teacherProfile, filter })
  return (
    <GroupsPageClient
      groups={result.data ?? []}
      initialFilter={filter}
      error={result.error ?? null}
      currentProfile={teacherProfile}
    />
  )
}
