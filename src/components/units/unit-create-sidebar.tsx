"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { X } from "lucide-react"

import type { Subjects, Unit } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createUnitAction } from "@/lib/server-updates"

interface UnitCreateSidebarProps {
  isOpen: boolean
  onClose: () => void
  subjects: Subjects
  onCreate: (unit: Unit) => void
}

export function UnitCreateSidebar({ isOpen, onClose, subjects, onCreate }: UnitCreateSidebarProps) {
  const [title, setTitle] = useState("")
  const [subject, setSubject] = useState<string>(subjects[0]?.subject ?? "")
  const [description, setDescription] = useState("")
  const [isPending, startTransition] = useTransition()

  if (!isOpen) {
    return null
  }

  const handleSave = () => {
    const name = title.trim()
    if (!name) {
      toast.error("Unit title is required")
      return
    }

    if (!subject) {
      toast.error("Please choose a subject")
      return
    }

    const generatedUnitId = generateUnitId(name)

    startTransition(async () => {
      try {
        const result = await createUnitAction(generatedUnitId, name, subject, description.trim() || null)

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        toast.success("Unit created")
        onCreate(result.data)
        setTitle("")
        setDescription("")
      } catch (error) {
        console.error("[v0] Failed to create unit:", error)
        toast.error("Failed to create unit", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
      <div className="relative ml-auto w-full max-w-md border-l bg-background shadow-xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Create Unit</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="unit-title">Title</Label>
              <Input
                id="unit-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Algebra Basics"
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-subject">Subject</Label>
              <Select value={subject} onValueChange={setSubject} disabled={isPending || subjects.length === 0}>
                <SelectTrigger id="unit-subject">
                  <SelectValue placeholder="Choose a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((item) => (
                    <SelectItem key={item.subject} value={item.subject}>
                      {item.subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-description">Description</Label>
              <Textarea
                id="unit-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe goals, scope, or resources for this unit"
                rows={4}
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button onClick={handleSave} disabled={isPending || !title.trim()}>
                Create Unit
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

function generateUnitId(title: string) {
  const slug = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (!slug) {
    return `UNIT-${Date.now()}`
  }

  return slug.length > 30 ? `${slug.slice(0, 30)}-${Date.now()}` : slug
}
