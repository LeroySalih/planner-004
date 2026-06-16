"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { Check, Loader2, Lock, Search } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { assignRoleAction, removeRoleAction } from "@/lib/server-actions/roles"
import type { PupilActionState } from "@/app/groups/[groupId]/pupil-action-state"
import { initialPupilActionState } from "@/app/groups/[groupId]/pupil-action-state"

type ProfileWithRoles = {
  userId: string
  email: string | null
  firstName: string | null
  lastName: string | null
  roles: string[]
  locked: boolean
}

type RoleManagerProps = {
  initialProfiles: ProfileWithRoles[]
  resetPasswordAction: (state: PupilActionState, formData: FormData) => Promise<PupilActionState>
  unlockAction: (state: PupilActionState, formData: FormData) => Promise<PupilActionState>
}

const AVAILABLE_ROLES = ["admin", "teacher", "pupil", "technician"]

function useActionToast(state: PupilActionState) {
  const lastHandled = useRef<PupilActionState | null>(null)
  useEffect(() => {
    if (state.status === "idle" || lastHandled.current === state) return
    lastHandled.current = state
    const message = state.message ?? (state.status === "success" ? "Done." : "Action failed.")
    if (state.status === "success") toast.success(message)
    else toast.error(message)
  }, [state])
}

function ProfileRow({
  profile,
  resetPasswordAction,
  unlockAction,
  onRolesChange,
}: {
  profile: ProfileWithRoles
  resetPasswordAction: (state: PupilActionState, formData: FormData) => Promise<PupilActionState>
  unlockAction: (state: PupilActionState, formData: FormData) => Promise<PupilActionState>
  onRolesChange: (userId: string, newRoles: string[]) => void
}) {
  const [resetState, resetFormAction, resetPending] = useActionState(resetPasswordAction, initialPupilActionState)
  const [unlockState, unlockFormAction, unlockPending] = useActionState(unlockAction, initialPupilActionState)
  const [locked, setLocked] = useState(profile.locked)
  const [roles, setRoles] = useState(profile.roles)
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, boolean>>({})
  const [, startTransition] = useTransition()

  useActionToast(resetState)
  useActionToast(unlockState)

  useEffect(() => {
    if (unlockState.status === "success") setLocked(false)
  }, [unlockState.status])

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.userId

  const toggleRole = (roleId: string) => {
    const hasRole = roles.includes(roleId)
    const key = `${profile.userId}-${roleId}`
    if (pendingUpdates[key]) return

    setPendingUpdates((prev) => ({ ...prev, [key]: true }))
    const newRoles = hasRole ? roles.filter((r) => r !== roleId) : [...roles, roleId]
    setRoles(newRoles)
    onRolesChange(profile.userId, newRoles)

    startTransition(async () => {
      try {
        const action = hasRole ? removeRoleAction : assignRoleAction
        const result = await action(profile.userId, roleId)
        if (!result.success) throw new Error(result.error ?? "Failed")
        toast.success(`Role "${roleId}" ${hasRole ? "removed" : "added"}`)
      } catch {
        toast.error("Failed to update role")
        setRoles(roles)
        onRolesChange(profile.userId, roles)
      } finally {
        setPendingUpdates((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }
    })
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{displayName}</span>
            {locked || unlockPending ? (
              <form action={unlockFormAction}>
                <input type="hidden" name="userId" value={profile.userId} />
                <input type="hidden" name="displayName" value={displayName} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  className={`h-6 w-6 text-amber-600 ${unlockPending ? "animate-pulse opacity-70" : ""}`}
                  disabled={unlockPending}
                  title="Unlock sign-in"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span className="sr-only">Unlock sign-in</span>
                </Button>
              </form>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">{profile.email}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {roles.map((role) => (
            <Badge key={role} variant="secondary" className="text-xs">
              {role}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <form action={resetFormAction}>
            <input type="hidden" name="userId" value={profile.userId} />
            <input type="hidden" name="displayName" value={displayName} />
            <Button type="submit" variant="secondary" size="sm" className="text-xs" disabled={resetPending}>
              {resetPending ? "Resetting…" : "Reset Password"}
            </Button>
          </form>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs">Edit Roles</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Assign Roles</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {AVAILABLE_ROLES.map((role) => {
                const hasRole = roles.includes(role)
                const isPending = pendingUpdates[`${profile.userId}-${role}`]
                return (
                  <DropdownMenuCheckboxItem
                    key={role}
                    checked={hasRole}
                    onCheckedChange={() => toggleRole(role)}
                    disabled={isPending}
                  >
                    <div className="flex items-center gap-2">
                      <span>{role}</span>
                      {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    </div>
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function RoleManager({ initialProfiles, resetPasswordAction, unlockAction }: RoleManagerProps) {
  const [profiles, setProfiles] = useState(initialProfiles)
  const [filter, setFilter] = useState("")

  const filteredProfiles = profiles.filter((profile) => {
    const term = filter.toLowerCase()
    return (
      profile.email?.toLowerCase().includes(term) ||
      profile.firstName?.toLowerCase().includes(term) ||
      profile.lastName?.toLowerCase().includes(term)
    )
  })

  const handleRolesChange = (userId: string, newRoles: string[]) => {
    setProfiles((prev) => prev.map((p) => (p.userId === userId ? { ...p, roles: newRoles } : p)))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users & Roles</CardTitle>
        <CardDescription>Manage system access and permissions.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center mb-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search users..."
              className="pl-8"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProfiles.map((profile) => (
                <ProfileRow
                  key={profile.userId}
                  profile={profile}
                  resetPasswordAction={resetPasswordAction}
                  unlockAction={unlockAction}
                  onRolesChange={handleRolesChange}
                />
              ))}
              {filteredProfiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center h-24 text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
