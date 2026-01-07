"use client"

import { useState } from "react"
import { Check, Loader2, Search } from "lucide-react"
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

type ProfileWithRoles = {
  userId: string
  email: string | null
  firstName: string | null
  lastName: string | null
  roles: string[]
}

const AVAILABLE_ROLES = ["admin", "teacher", "pupil", "technician"]

export function RoleManager({ initialProfiles }: { initialProfiles: ProfileWithRoles[] }) {
  const [profiles, setProfiles] = useState(initialProfiles)
  const [filter, setFilter] = useState("")
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, boolean>>({})

  const filteredProfiles = profiles.filter((profile) => {
    const term = filter.toLowerCase()
    return (
      profile.email?.toLowerCase().includes(term) ||
      profile.firstName?.toLowerCase().includes(term) ||
      profile.lastName?.toLowerCase().includes(term)
    )
  })

  const toggleRole = async (userId: string, roleId: string, currentHasRole: boolean) => {
    const key = `${userId}-${roleId}`
    if (pendingUpdates[key]) return

    setPendingUpdates((prev) => ({ ...prev, [key]: true }))

    // Optimistic update
    setProfiles((prev) =>
      prev.map((p) => {
        if (p.userId !== userId) return p
        const newRoles = currentHasRole
          ? p.roles.filter((r) => r !== roleId)
          : [...p.roles, roleId]
        return { ...p, roles: newRoles }
      })
    )

    try {
      const action = currentHasRole ? removeRoleAction : assignRoleAction
      const result = await action(userId, roleId)

      if (!result.success) {
        throw new Error(result.error)
      }
      toast.success(`Role ${roleId} ${currentHasRole ? "removed" : "added"}`)
    } catch (error) {
      console.error("Failed to toggle role", error)
      toast.error("Failed to update role")
      // Revert optimistic update
      setProfiles((prev) =>
        prev.map((p) => {
          if (p.userId !== userId) return p
          const newRoles = currentHasRole
            ? [...p.roles, roleId] // Re-add if removal failed
            : p.roles.filter((r) => r !== roleId) // Remove if add failed
          return { ...p, roles: newRoles }
        })
      )
    } finally {
      setPendingUpdates((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
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
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProfiles.map((profile) => (
                <TableRow key={profile.userId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {profile.firstName} {profile.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">{profile.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {profile.roles.map((role) => (
                        <Badge key={role} variant="secondary" className="text-xs">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          Edit Roles
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Assign Roles</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {AVAILABLE_ROLES.map((role) => {
                          const hasRole = profile.roles.includes(role)
                          const isPending = pendingUpdates[`${profile.userId}-${role}`]
                          return (
                            <DropdownMenuCheckboxItem
                              key={role}
                              checked={hasRole}
                              onCheckedChange={() => toggleRole(profile.userId, role, hasRole)}
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
                  </TableCell>
                </TableRow>
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
