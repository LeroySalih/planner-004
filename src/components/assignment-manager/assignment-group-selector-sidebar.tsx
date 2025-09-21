"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { X } from "lucide-react"

import type { Groups } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createWildcardRegExp } from "@/lib/utils"

interface AssignmentGroupSelectorSidebarProps {
  isOpen: boolean
  groups: Groups
  selectedGroupIds: string[]
  onSave: (groupIds: string[]) => void
  onClose: () => void
}

export function AssignmentGroupSelectorSidebar({
  isOpen,
  groups,
  selectedGroupIds,
  onSave,
  onClose,
}: AssignmentGroupSelectorSidebarProps) {
  const [selection, setSelection] = useState<string[]>(selectedGroupIds)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    if (!isOpen) return
    setSelection(selectedGroupIds)
    setFilter("")
  }, [isOpen, selectedGroupIds])

  if (!isOpen) {
    return null
  }

  const filteredGroups = groups.filter((group) => {
    const term = filter.trim()
    if (!term) return true

    const searchRegex = createWildcardRegExp(term)
    if (!searchRegex) return true

    return (
      searchRegex.test(group.group_id) ||
      searchRegex.test(group.subject) ||
      searchRegex.test(group.join_code ?? "")
    )
  })

  const toggleGroup = (groupId: string, checked: boolean) => {
    setSelection((prev) => {
      if (checked) {
        if (prev.includes(groupId)) return prev
        return [...prev, groupId]
      }
      return prev.filter((id) => id !== groupId)
    })
  }

  const handleSave = () => {
    if (selection.length === 0) {
      toast.error("Select at least one group")
      return
    }
    onSave(selection)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md border-l bg-background shadow-xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Select Groups</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex h-full flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="group-filter">Search</Label>
              <Input
                id="group-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search by group, subject, or join code"
              />
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border p-3">
              {filteredGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No groups match your search.</p>
              ) : (
                filteredGroups.map((group) => {
                  const isChecked = selection.includes(group.group_id)
                  return (
                    <label
                      key={group.group_id}
                      className="flex items-start justify-between gap-3 rounded-md border border-transparent px-2 py-1 hover:border-border"
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => toggleGroup(group.group_id, Boolean(checked))}
                        />
                        <div>
                          <div className="font-medium leading-none">{group.group_id}</div>
                          <div className="text-xs text-muted-foreground">
                            {group.subject}
                            {group.join_code ? ` · Join code: ${group.join_code}` : ""}
                          </div>
                        </div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={handleSave} disabled={selection.length === 0}>
                Save Selection
              </Button>
              <Button variant="outline" className="bg-transparent" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
