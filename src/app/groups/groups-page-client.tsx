"use client"

import React, { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpCircle, Plus, PowerOff, X } from "lucide-react"
import { toast } from "sonner"

import type { Group } from "@/types"
import type { AuthenticatedProfile } from "@/lib/server-actions/groups"
import { createGroupAction, deactivateGroupsAction, promoteGroupsAction, updateGroupAction } from "@/lib/server-updates"
import { computePromotedGroupId } from "@/lib/groups/promote"
import { GroupsFilterControls } from "./groups-filter-controls"
import { GroupsList } from "./groups-list"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface GroupsPageClientProps {
  groups: Group[]
  initialFilter: string
  initialShowInactive: boolean
  error: string | null
  currentProfile: AuthenticatedProfile
  subjects: string[]
}

export function GroupsPageClient({ groups: initialGroups, initialFilter, initialShowInactive, error, currentProfile, subjects }: GroupsPageClientProps) {
  const router = useRouter()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [filter, setFilter] = useState(() => initialFilter)
  const [showInactive, setShowInactive] = useState(() => initialShowInactive)
  const [activeJoinCode, setActiveJoinCode] = useState<string | null>(null)
  const [siteUrl, setSiteUrl] = useState<string>("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [promoteTargets, setPromoteTargets] = useState<Group[] | null>(null)
  const [isPromoting, startPromoteTransition] = useTransition()
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false)
  const [isDeactivating, startDeactivateTransition] = useTransition()

  useEffect(() => {
    setFilter(initialFilter)
  }, [initialFilter])

  useEffect(() => {
    setShowInactive(initialShowInactive)
  }, [initialShowInactive])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSiteUrl(window.location.origin)
    }
  }, [])

  const groups = useMemo(() => sortGroups(initialGroups), [initialGroups])

  // Drop any selections whose group is no longer listed (e.g. after promotion).
  useEffect(() => {
    setSelectedIds((previous) => {
      const available = new Set(groups.map((group) => group.group_id))
      const next = new Set([...previous].filter((id) => available.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [groups])

  const handleToggleSelect = useCallback((groupId: string, selected: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (selected) {
        next.add(groupId)
      } else {
        next.delete(groupId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(groups.map((group) => group.group_id)))
  }, [groups])

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const runPromotion = useCallback(
    (targets: Group[]) => {
      const groupIds = targets.map((group) => group.group_id)
      startPromoteTransition(async () => {
        const response = await promoteGroupsAction({ groupIds })

        const succeeded = response.results.filter((result) => result.success)
        const failed = response.results.filter((result) => !result.success)

        if (succeeded.length > 0) {
          toast.success(
            `Promoted ${succeeded.length} group${succeeded.length > 1 ? "s" : ""}`,
            {
              description: succeeded
                .map((result) => `${result.sourceGroupId} → ${result.newGroupId}`)
                .join("\n"),
            },
          )
        }

        if (response.error || failed.length > 0) {
          toast.error(response.error ?? "Some groups could not be promoted", {
            description: failed
              .map((result) => `${result.sourceGroupId}: ${result.error ?? "Failed"}`)
              .join("\n"),
          })
        }

        setPromoteTargets(null)
        setSelectedIds(new Set())
        router.refresh()
      })
    },
    [router],
  )

  const selectedGroups = useMemo(
    () => groups.filter((group) => selectedIds.has(group.group_id)),
    [groups, selectedIds],
  )

  const runDeactivation = useCallback(() => {
    const groupIds = [...selectedIds]
    startDeactivateTransition(async () => {
      const response = await deactivateGroupsAction({ groupIds })

      if (response.success) {
        toast.success(`Deactivated ${response.count} group${response.count === 1 ? "" : "s"}`)
      } else {
        toast.error(response.error ?? "Unable to deactivate groups")
      }

      setIsDeactivateOpen(false)
      setSelectedIds(new Set())
      router.refresh()
    })
  }, [selectedIds, router])

  const navigate = useCallback((nextFilter: string, nextShowInactive: boolean) => {
    const params = new URLSearchParams()
    if (nextFilter.trim().length > 0) {
      params.set("q", nextFilter.trim())
    }
    if (nextShowInactive) {
      params.set("inactive", "true")
    }
    const queryString = params.toString()
    router.replace(queryString ? `/groups?${queryString}` : "/groups")
  }, [router])

  const handleFilterChange = useCallback((nextFilter: string) => {
    setFilter(nextFilter)
    navigate(nextFilter, showInactive)
  }, [navigate, showInactive])

  const handleToggleInactive = useCallback((nextShowInactive: boolean) => {
    setShowInactive(nextShowInactive)
    navigate(filter, nextShowInactive)
  }, [navigate, filter])

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <GroupsFilterControls value={filter} onValueChange={handleFilterChange} />
        </div>
        <div className="flex items-center gap-2 sm:mt-6 sm:self-center">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={handleToggleInactive}
          />
          <Label htmlFor="show-inactive" className="text-sm text-slate-700">
            View inactive
          </Label>
        </div>
      </div>

      {groups.length === 0 && !error ? (
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-slate-600">
          No groups found yet. Create a group to see it listed here.
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleSelectAll}>
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleDeselectAll}
              disabled={selectedIds.size === 0}
            >
              Deselect all
            </Button>
            <span className="text-sm text-slate-600">
              {selectedIds.size} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIsDeactivateOpen(true)}
              disabled={selectedIds.size === 0 || isDeactivating || isPromoting}
            >
              <PowerOff className="mr-2 h-4 w-4" />
              Deactivate selected
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setPromoteTargets(selectedGroups)}
              disabled={selectedIds.size === 0 || isPromoting || isDeactivating}
            >
              <ArrowUpCircle className="mr-2 h-4 w-4" />
              Promote selected
            </Button>
          </div>
        </div>
      ) : null}

      <GroupsList
        groups={groups}
        onEdit={setEditingGroup}
        onJoinCodeClick={handleJoinCodeClick}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onPromote={(group) => setPromoteTargets([group])}
        isPromoting={isPromoting}
      />

      <CreateGroupsSidebar
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={() => router.refresh()}
        existingSubjects={subjects}
        currentProfile={currentProfile}
      />

      <EditGroupSidebar
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
        onUpdated={() => router.refresh()}
        currentProfile={currentProfile}
      />

      <AlertDialog
        open={isDeactivateOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isDeactivating) setIsDeactivateOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {selectedIds.size} group{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deactivated groups are hidden from the directory unless &ldquo;View inactive&rdquo; is on.
              You can reactivate a group any time from its edit panel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeactivating || selectedIds.size === 0}
              onClick={(event) => {
                event.preventDefault()
                runDeactivation()
              }}
            >
              {isDeactivating ? "Deactivating..." : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PromoteConfirmDialog
        targets={promoteTargets}
        isPromoting={isPromoting}
        onCancel={() => {
          if (!isPromoting) setPromoteTargets(null)
        }}
        onConfirm={runPromotion}
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

function sortGroups(groups: Group[]) {
  return [...groups].sort((a, b) => a.group_id.localeCompare(b.group_id))
}

interface PromoteConfirmDialogProps {
  targets: Group[] | null
  isPromoting: boolean
  onCancel: () => void
  onConfirm: (targets: Group[]) => void
}

function PromoteConfirmDialog({ targets, isPromoting, onCancel, onConfirm }: PromoteConfirmDialogProps) {
  const open = targets !== null && targets.length > 0

  const mappings = useMemo(
    () =>
      (targets ?? []).map((group) => ({
        group,
        newGroupId: computePromotedGroupId(group.group_id),
      })),
    [targets],
  )

  const validCount = mappings.filter((mapping) => mapping.newGroupId !== null).length

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Promote {mappings.length} group{mappings.length === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Each group is copied into the next school year with all its teachers and pupils. The
            original group stays active.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/60 p-3 text-sm">
          {mappings.map(({ group, newGroupId }) => (
            <li key={group.group_id} className="flex items-center justify-between gap-3">
              <span className="font-mono text-slate-800">{group.group_id}</span>
              {newGroupId ? (
                <span className="font-mono text-slate-800">→ {newGroupId}</span>
              ) : (
                <span className="text-destructive">Cannot be promoted</span>
              )}
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPromoting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPromoting || validCount === 0}
            onClick={(event) => {
              event.preventDefault()
              if (targets) onConfirm(targets)
            }}
          >
            {isPromoting ? "Promoting..." : "Promote"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface CreateGroupsSidebarProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (groups: Group[]) => void
  existingSubjects: string[]
  currentProfile: AuthenticatedProfile
}

function CreateGroupsSidebar({
  isOpen,
  onClose,
  onCreated,
  existingSubjects,
  currentProfile,
}: CreateGroupsSidebarProps) {
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
          const result = await createGroupAction(name, subjectValue, { currentProfile })
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
              {existingSubjects.length > 0 ? (
                <Select
                  value={subject}
                  onValueChange={(value) => setSubject(value)}
                  disabled={isPending}
                >
                  <SelectTrigger id="group-subject">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingSubjects.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="group-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="e.g. Mathematics"
                  disabled={isPending}
                />
              )}
              {existingSubjects.length === 0 ? (
                <p className="text-xs text-muted-foreground">No existing subjects yet. Type one to get started.</p>
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
  currentProfile: AuthenticatedProfile
}

function EditGroupSidebar({ group, onClose, onUpdated, currentProfile }: EditGroupSidebarProps) {
  const [groupId, setGroupId] = useState(group?.group_id ?? "")
  const [subject, setSubject] = useState(group?.subject ?? "")
  const [active, setActive] = useState(group?.active ?? true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setGroupId(group?.group_id ?? "")
    setSubject(group?.subject ?? "")
    setActive(group?.active ?? true)
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
      const response = await updateGroupAction(group.group_id, trimmedId, trimmedSubject, { currentProfile, active })

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
          active,
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

            <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive groups are hidden from the directory unless &ldquo;View inactive&rdquo; is on.
                </p>
              </div>
              <Switch
                checked={active}
                onCheckedChange={setActive}
                disabled={isPending}
                aria-label="Toggle group active"
              />
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
