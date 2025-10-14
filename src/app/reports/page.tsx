import { readGroupsAction, readGroupAction } from "@/lib/server-updates"
import { ReportsTable } from "./reports-table"
import { requireTeacherProfile } from "@/lib/auth"

export default async function ReportsLandingPage() {
  await requireTeacherProfile()
  const groupsResult = await readGroupsAction()
  if (groupsResult.error) {
    throw new Error(groupsResult.error)
  }

  const groups = groupsResult.data ?? []

  const pupilMap = new Map<
    string,
    {
      name: string
      groups: Set<string>
    }
  >()

  await Promise.all(
    groups.map(async (group) => {
      const detailed = await readGroupAction(group.group_id)
      if (detailed.error && !detailed.data) {
        console.error("[reports] Failed to load group detail", group.group_id, detailed.error)
        return
      }
      const memberships = detailed.data?.members ?? []

      memberships
        .filter((member) => member.role.toLowerCase() === "pupil")
        .forEach((member) => {
          const first = member.profile?.first_name?.trim() ?? ""
          const last = member.profile?.last_name?.trim() ?? ""
          const displayName = `${first} ${last}`.trim()
          const existing = pupilMap.get(member.user_id)
          if (existing) {
            existing.groups.add(group.group_id)
          } else {
            pupilMap.set(member.user_id, {
              name: displayName.length > 0 ? displayName : member.user_id,
              groups: new Set([group.group_id]),
            })
          }
        })
    }),
  )

  const pupils = Array.from(pupilMap.entries())
    .map(([pupilId, info]) => ({
      pupilId,
      name: info.name,
      groups: Array.from(info.groups).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h1 id="reports-page-title" className="text-3xl font-semibold text-white">
              Reports
            </h1>
          </div>
          <p className="text-sm text-slate-200">
            Browse groups and access individual pupil reports. Use the filter to quickly find pupils or groups.
          </p>
        </div>
      </header>


      <ReportsTable pupils={pupils} />
    </main>
  )
}
