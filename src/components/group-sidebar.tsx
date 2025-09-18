"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X } from "lucide-react"
import type { Subject, Group } from "@/types/assignment"

interface GroupSidebarProps {
  isOpen: boolean
  onClose: () => void
  subjects: Subject[]
  onSave: (groupId: string, subjectId: string) => void
  editingGroup?: Group | null
  onUpdate?: (oldGroupId: string, newGroupId: string, subjectId: string) => void
}

export function GroupSidebar({ isOpen, onClose, subjects, onSave, editingGroup, onUpdate }: GroupSidebarProps) {
  const [groupId, setGroupId] = useState("")
  const [subjectId, setSubjectId] = useState("")

  useEffect(() => {
    if (editingGroup) {
      setGroupId(editingGroup.group_id)
      const matchingSubject = subjects.find((s) => s.name === editingGroup.subject)
      setSubjectId(matchingSubject?.subject_id || "")
      console.log("[v0] Setting subject for editing:", {
        groupSubject: editingGroup.subject,
        matchingSubject,
        subjectId: matchingSubject?.subject_id,
      })
    } else {
      setGroupId("")
      setSubjectId("")
    }
  }, [editingGroup, subjects])

  const handleSave = () => {
    if (groupId.trim() && subjectId) {
      const selectedSubject = subjects.find((s) => s.subject_id === subjectId)
      const subjectName = selectedSubject?.name || subjectId

      if (editingGroup && onUpdate) {
        onUpdate(editingGroup.group_id, groupId.trim(), subjectName)
      } else {
        onSave(groupId.trim(), subjectName)
      }

      setGroupId("")
      setSubjectId("")
      onClose()
    }
  }

  const handleCancel = () => {
    setGroupId("")
    setSubjectId("")
    onClose()
  }

  if (!isOpen) {
    return null
  }

  const title = editingGroup ? "Edit Group" : "Add New Group"
  const buttonText = editingGroup ? "Update Group" : "Add Group"

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
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.subject_id} value={subject.subject_id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-4">
              <Button onClick={handleSave} className="w-full" disabled={!groupId.trim() || !subjectId}>
                {buttonText}
              </Button>
              <Button onClick={handleCancel} variant="outline" className="w-full bg-transparent">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
