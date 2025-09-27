import Link from "next/link"

import { readGroupsAction } from "@/lib/server-updates"
import { GroupsFilterControls } from "./groups-filter-controls"

function buildWildcardRegex(pattern: string) {
  const escaped = Array.from(pattern)
    .map((char) => {
      if (char === "?") {
        return "."
      }
      return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
    .join("")

  return new RegExp(escaped, "i")
}

export default async function GroupsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q: rawFilter = "" } = await searchParams
  const filter = rawFilter.trim()

  const result = await readGroupsAction()
  const groups = result.data ?? []
  const error = result.error

  const filteredGroups = (() => {
    if (!filter) return groups

    let regex: RegExp | null = null
    try {
      regex = buildWildcardRegex(filter)
    } catch (buildError) {
      console.error("Failed to build wildcard regex", buildError)
      return []
    }

    return groups.filter((group) => regex!.test(group.group_id) || regex!.test(group.subject))
  })()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 text-slate-900">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Groups</p>
          <div>
            <h1 className="text-3xl font-semibold text-white">Group Directory</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-200">
              Browse all active teaching groups. Select a group to review its details and pupil membership.
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load groups: {error}
        </div>
      ) : null}

      <GroupsFilterControls initialValue={filter} />

      {groups.length === 0 && !error ? (
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-slate-600">
          No groups found yet. Create a group to see it listed here.
        </div>
      ) : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {filteredGroups.map((group) => (
          <Link
            key={group.group_id}
            href={`/groups/${encodeURIComponent(group.group_id)}`}
            className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition hover:border-primary hover:shadow"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">{group.group_id}</h2>
              <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-700">
                {group.subject}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-600">Join code: {group.join_code}</p>
          </Link>
        ))}
      </section>

      {filter && filteredGroups.length === 0 && groups.length > 0 ? (
        <p className="mt-6 text-sm text-slate-600">No groups match the current filter.</p>
      ) : null}
    </main>
  )
}
