"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import type { Group } from "@/types"
import { createGroupAction, updateGroupAction } from "@/lib/server-updates"
import { GroupsFilterControls } from "./groups-filter-controls"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface GroupsPageClientProps {
  groups: Group[]
  initialFilter: string
  error: string | null
}

export function GroupsPageClient({ groups: initialGroups, initialFilter, error }: GroupsPageClientProps) {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>(() => sortGroups(initialGroups))
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [filter, setFilter] = useState(() => initialFilter)
  const [activeJoinCode, setActiveJoinCode] = useState<string | null>(null)
  const [siteUrl, setSiteUrl] = useState<string>("")

  useEffect(() => {
    setGroups(sortGroups(initialGroups))
  }, [initialGroups])

  useEffect(() => {
    setFilter(initialFilter)
  }, [initialFilter])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSiteUrl(window.location.origin)
    }
  }, [])

  const filteredGroups = useMemo(() => {
    const trimmedFilter = filter.trim()
    if (!trimmedFilter) {
      return groups
    }

    try {
      const regex = buildWildcardRegex(trimmedFilter)
      return groups.filter((group) => regex.test(group.group_id) || regex.test(group.subject ?? ""))
    } catch (buildError) {
      console.error("[groups] Failed to build wildcard regex", buildError)
      return []
    }
  }, [filter, groups])

  const handleFilterChange = useCallback((nextFilter: string) => {
    setFilter(nextFilter)
  }, [])

  const handleGroupsCreated = (created: Group[]) => {
    if (created.length === 0) {
      return
    }
    setGroups((previous) => sortGroups([...previous, ...created]))
    router.refresh()
  }

  const handleGroupUpdated = (updated: Group, previousId: string) => {
    setGroups((previous) =>
      sortGroups(
        previous.map((group) => (group.group_id === previousId ? updated : group)),
      ),
    )
    router.refresh()
  }

  const handleJoinCodeClick = useCallback((code: string | null) => {
    if (!code) {
      return
    }
    setActiveJoinCode(code)
  }, [])

  const handleJoinCodeClose = useCallback(() => {
    setActiveJoinCode(null)
  }, [])

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 text-slate-900">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Groups</p>
            <div>
              <h1 className="text-3xl font-semibold text-white">Group Directory</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-200">
                Browse all active teaching groups. Select a group to review its details and pupil membership.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-200">
              Use the filter to quickly jump to a group. Need a new class? Add it right from here.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="w-full sm:w-auto"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add groups
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load groups: {error}
        </div>
      ) : null}

      <GroupsFilterControls value={filter} onValueChange={handleFilterChange} />

      {groups.length === 0 && !error ? (
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-slate-600">
          No groups found yet. Create a group to see it listed here.
        </div>
      ) : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {filteredGroups.map((group) => (
          <Card key={group.group_id} className="flex flex-col border-border shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-xl font-semibold text-slate-900">{group.group_id}</CardTitle>
                <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-100 bg-primary/80">
                  {group.subject}
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">Join code:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => handleJoinCodeClick(group.join_code ?? null)}
                    disabled={!group.join_code}
                    className="font-mono tracking-[0.35em] uppercase"
                    aria-label={`Display join code for ${group.group_id}`}
                  >
                    {group.join_code ?? "—"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button asChild size="sm" className="w-full sm:w-auto">
                  <Link href={`/groups/${encodeURIComponent(group.group_id)}`}>View group</Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setEditingGroup(group)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {filter && filteredGroups.length === 0 && groups.length > 0 ? (
        <p className="mt-6 text-sm text-slate-600">No groups match the current filter.</p>
      ) : null}

      <CreateGroupsSidebar
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleGroupsCreated}
        existingSubjects={deriveSubjectOptions(groups)}
      />

      <EditGroupSidebar
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
        onUpdated={handleGroupUpdated}
      />

      <Dialog
        open={Boolean(activeJoinCode)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleJoinCodeClose()
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-none w-screen h-dvh translate-x-[-50%] translate-y-[-50%] border-none bg-transparent p-0 shadow-none"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-10 bg-slate-950 px-6 text-white">
            <DialogTitle className="text-sm uppercase tracking-[0.5em] text-white/60">Join Code</DialogTitle>
            <p className="text-6xl font-semibold tracking-[0.4em] text-white sm:text-8xl">{activeJoinCode}</p>
            <div className="text-center">
              <p className="text-lg text-white/80">Share this code with your class and have them visit:</p>
              <p className="mt-2 text-2xl font-medium text-white">{siteUrl || ""}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={handleJoinCodeClose}
              className="text-base bg-white text-slate-900 hover:bg-white/80 hover:text-slate-900"
            >
              Close display
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}

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

function sortGroups(groups: Group[]) {
  return [...groups].sort((a, b) => a.group_id.localeCompare(b.group_id))
}

function deriveSubjectOptions(groups: Group[]) {
  const subjects = new Set<string>()
  groups.forEach((group) => {
    if (group.subject) {
      subjects.add(group.subject)
    }
  })
  return Array.from(subjects).sort((a, b) => a.localeCompare(b))
}

interface CreateGroupsSidebarProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (groups: Group[]) => void
  existingSubjects: string[]
}

function CreateGroupsSidebar({ isOpen, onClose, onCreated, existingSubjects }: CreateGroupsSidebarProps) {
  const [groupNames, setGroupNames] = useState("")
  const [subject, setSubject] = useState(existingSubjects[0] ?? "")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (isOpen) {
      setSubject(existingSubjects[0] ?? "")
    }
  }, [isOpen, existingSubjects])

  if (!isOpen) {
    return null
  }

  const handleCreate = () => {
    const subjectValue = subject.trim()
    if (!subjectValue) {
      toast.error("Subject is required")
      return
    }

    const parsedNames = Array.from(
      new Set(
        groupNames
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      ),
    )

    if (parsedNames.length === 0) {
      toast.error("Enter at least one group name")
      return
    }

    startTransition(async () => {
      const created: Group[] = []
      const failed: { name: string; message: string }[] = []

      for (const name of parsedNames) {
        try {
          const result = await createGroupAction(name, subjectValue)
          if (!result.data || result.error) {
            throw new Error(result.error ?? "Unknown error")
          }

          created.push({
            group_id: result.data.group_id,
            subject: result.data.subject,
            join_code: result.data.join_code ?? "",
            active: result.data.active ?? true,
          })
        } catch (error) {
          console.error("[groups] Failed to create group", name, error)
          failed.push({
            name,
            message: error instanceof Error ? error.message : "Unable to create group",
          })
        }
      }

      if (created.length > 0) {
        onCreated(created)
        toast.success(`Created ${created.length} group${created.length > 1 ? "s" : ""}`)
        setGroupNames("")
      }

      if (failed.length > 0) {
        toast.error("Some groups could not be created", {
          description: failed.map((entry) => `${entry.name}: ${entry.message}`).join("\n"),
        })
      } else {
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col border-l bg-background shadow-xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Add groups</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="group-names">Group names</Label>
              <Textarea
                id="group-names"
                value={groupNames}
                onChange={(event) => setGroupNames(event.target.value)}
                placeholder="e.g. 25-10-MA, 25-11-SC"
                rows={4}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Separate multiple group names with commas. A join code is generated automatically for each group.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="group-subject">Subject</Label>
              <Input
                id="group-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="e.g. Mathematics"
                disabled={isPending}
                list="group-subject-options"
              />
              {existingSubjects.length > 0 ? (
                <datalist id="group-subject-options">
                  {existingSubjects.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button onClick={handleCreate} disabled={isPending}>
                {isPending ? "Creating..." : "Create"}
              </Button>
              <Button variant="outline" className="bg-transparent" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

interface EditGroupSidebarProps {
  group: Group | null
  onClose: () => void
  onUpdated: (group: Group, previousId: string) => void
}

function EditGroupSidebar({ group, onClose, onUpdated }: EditGroupSidebarProps) {
  const [groupId, setGroupId] = useState(group?.group_id ?? "")
  const [subject, setSubject] = useState(group?.subject ?? "")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setGroupId(group?.group_id ?? "")
    setSubject(group?.subject ?? "")
  }, [group])

  if (!group) {
    return null
  }

  const handleUpdate = () => {
    const trimmedId = groupId.trim()
    const trimmedSubject = subject.trim()

    if (!trimmedId) {
      toast.error("Group name is required")
      return
    }

    if (!trimmedSubject) {
      toast.error("Subject is required")
      return
    }

    startTransition(async () => {
      const response = await updateGroupAction(group.group_id, trimmedId, trimmedSubject)

      if (!response.success) {
        toast.error("Failed to update group", {
          description: response.error ?? "Please try again later.",
        })
        return
      }

      toast.success("Group updated")
      onUpdated(
        {
          group_id: trimmedId,
          subject: trimmedSubject,
          join_code: group.join_code,
          active: group.active,
        },
        group.group_id,
      )
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col border-l bg-background shadow-xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Edit group</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="edit-group-id">Group name</Label>
              <Input
                id="edit-group-id"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-group-subject">Subject</Label>
              <Input
                id="edit-group-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-group-join-code">Join code</Label>
              <Input id="edit-group-join-code" value={group.join_code ?? ""} readOnly disabled={isPending} />
              <p className="text-xs text-muted-foreground">Join codes are generated automatically and cannot be edited.</p>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button onClick={handleUpdate} disabled={isPending}>
                {isPending ? "Saving..." : "Save changes"}
              </Button>
              <Button variant="outline" className="bg-transparent" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
