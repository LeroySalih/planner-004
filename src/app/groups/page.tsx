import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readGroupsAction } from "@/lib/server-updates"

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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Groups</p>
        <h1 className="text-3xl font-semibold text-primary">Group Directory</h1>
        <p className="text-muted-foreground">
          Browse all active teaching groups. Select a group to review its details and pupil membership.
        </p>
      </header>

      {error ? (
        <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load groups: {error}
        </div>
      ) : null}

      <form className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center" action="/groups" method="get">
        <div className="flex flex-1 items-center gap-2">
          <Input
            name="q"
            defaultValue={filter}
            placeholder="Filter by group or subject (use '?' as wildcard)"
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary">
            Apply filter
          </Button>
          {filter ? (
            <Link
              href="/groups"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {groups.length === 0 && !error ? (
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
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
              <h2 className="text-xl font-semibold text-foreground">{group.group_id}</h2>
              <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary">
                {group.subject}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Join code: {group.join_code}</p>
          </Link>
        ))}
      </section>

      {filter && filteredGroups.length === 0 && groups.length > 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No groups match the current filter.</p>
      ) : null}
    </main>
  )
}
