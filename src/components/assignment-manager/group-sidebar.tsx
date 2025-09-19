"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X } from "lucide-react"
import type { Subjects, Group } from "@/types"

interface GroupSidebarProps {
  isOpen: boolean
  onClose: () => void
  subjects: Subjects
  onSave: (groupId: string, subjectId: string) => Promise<void>
  editingGroup?: Group | null
  onUpdate?: (oldGroupId: string, newGroupId: string, subjectId: string) => Promise<void>
  onDeactivate?: (groupId: string) => Promise<void>
}

export function GroupSidebar({ isOpen, onClose, subjects, onSave, editingGroup, onUpdate, onDeactivate }: GroupSidebarProps) {
  const [groupId, setGroupId] = useState("")
  const [subjectName, setSubjectName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState(false)

  useEffect(() => {
    if (editingGroup) {
      setGroupId(editingGroup.group_id)
      setSubjectName(editingGroup.subject)
      console.log("[v0] Setting subject for editing:", {
        groupSubject: editingGroup.subject,
        subjectName: editingGroup.subject,
      })
    } else {
      setGroupId("")
      setSubjectName("")
    }
    setConfirmRemoval(false)
    setIsRemoving(false)
  }, [editingGroup, subjects])

  const handleSave = async () => {
    if (groupId.trim() && subjectName && !isSubmitting && !isRemoving) {
      setIsSubmitting(true)

      try {
        if (editingGroup && onUpdate) {
          await onUpdate(editingGroup.group_id, groupId.trim(), subjectName)
          console.log("[v0] Updated group:", {
            oldGroupId: editingGroup.group_id,
            newGroupId: groupId.trim(),
            subjectName: subjectName,
          })
        } else {
          await onSave(groupId.trim(), subjectName)
        }

        setGroupId("")
        setSubjectName("")
        onClose()
      } catch (error) {
        console.error("[v0] Error saving group:", error)
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  const handleCancel = () => {
    setGroupId("")
    setSubjectName("")
    setConfirmRemoval(false)
    setIsRemoving(false)
    onClose()
  }

  const handleDeactivate = async () => {
    if (!editingGroup || !onDeactivate || isRemoving || isSubmitting) {
      return
    }

    if (!confirmRemoval) {
      setConfirmRemoval(true)
      return
    }

    setIsRemoving(true)

    try {
      await onDeactivate(editingGroup.group_id)
      setGroupId("")
      setSubjectName("")
      setConfirmRemoval(false)
      onClose()
    } catch (error) {
      console.error("[v0] Error deactivating group:", error)
    } finally {
      setIsRemoving(false)
    }
  }

  if (!isOpen) {
    return null
  }

  const title = editingGroup ? "Edit Group" : "Add New Group"
  const buttonText = editingGroup ? "Update Group" : "Add Group"
  const isProcessing = isSubmitting || isRemoving

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleCancel} />

      {/* Sidebar */}
      <div className="relative ml-auto w-96 bg-background shadow-xl border-l">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">{title}</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Group ID Input */}
            <div className="space-y-2">
              <Label htmlFor="group-id">Group ID</Label>
              <Input
                id="group-id"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="e.g., 25-12-MA"
                className="w-full"
              />
              <div className="text-xs text-muted-foreground">
                {editingGroup ? "Update the group identifier" : "Enter a unique identifier for the new group"}
              </div>
            </div>

            {/* Subject Selection */}
            <div className="space-y-2">
              <Label htmlFor="subject-select">Subject</Label>
              <Select value={subjectName} onValueChange={setSubjectName}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.subject} value={subject.subject}>
                      {subject.subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-4">
              <Button
                onClick={handleSave}
                className="w-full"
                disabled={!groupId.trim() || !subjectName || isProcessing}
              >
                {isSubmitting ? "Saving..." : buttonText}
              </Button>
              <Button
                onClick={handleCancel}
                variant="outline"
                className="w-full bg-transparent"
                disabled={isProcessing}
              >
                Cancel
              </Button>
              {editingGroup && onDeactivate && confirmRemoval && !isRemoving && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  This will deactivate the group and remove it from all planners. Click the button again to
                  confirm.
                </div>
              )}
              {editingGroup && onDeactivate && (
                <Button
                  onClick={handleDeactivate}
                  variant="destructive"
                  className="w-full"
                  disabled={isProcessing}
                >
                  {isRemoving ? "Removing..." : confirmRemoval ? "Confirm Remove" : "Remove Group"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
