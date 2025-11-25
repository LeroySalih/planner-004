"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import type { FormEvent } from "react"
import { X, Loader2 } from "lucide-react"
import { toast } from "sonner"

import type { LessonWithObjectives } from "@/types"
import {
  type LessonHeaderUpdateState,
  updateLessonHeaderAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

interface LessonHeaderSidebarProps {
  lesson: LessonWithObjectives
  isOpen: boolean
  onClose: () => void
  onUpdated: (lesson: LessonWithObjectives) => void
}

export function LessonHeaderSidebar({ lesson, isOpen, onClose, onUpdated }: LessonHeaderSidebarProps) {
  const [title, setTitle] = useState(lesson.title ?? "")
  const [isActive, setIsActive] = useState(lesson.active !== false)
  const [state, formAction, pending] = useActionState<LessonHeaderUpdateState, FormData>(
    updateLessonHeaderAction,
    {
      status: "idle",
      message: null,
      lesson: null,
    },
  )
  const [pendingTransition, startTransition] = useTransition()

  useEffect(() => {
    if (!isOpen) return
    setTitle(lesson.title ?? "")
    setIsActive(lesson.active !== false)
  }, [isOpen, lesson])

  useEffect(() => {
    if (state.status === "success" && state.lesson) {
      onUpdated(state.lesson)
      toast.success(state.message ?? "Lesson updated.")
      onClose()
    } else if (state.status === "error" && state.message) {
      toast.error(state.message)
    }
  }, [state, onClose, onUpdated])

  if (!isOpen) {
    return null
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return

    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      toast.error("Lesson title is required.")
      return
    }

    const formData = new FormData()
    formData.set("lessonId", lesson.lesson_id)
    formData.set("title", trimmedTitle)
    formData.set("active", isActive ? "true" : "false")
    startTransition(() => {
      formAction(formData)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 ml-auto flex h-full w-full max-w-md flex-col bg-background shadow-2xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b">
            <div className="space-y-1">
              <CardTitle>Edit lesson details</CardTitle>
              <p className="text-sm text-muted-foreground">Update the lesson title and active status.</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close editor">
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-6">
            <form className="flex flex-1 flex-col gap-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="lesson-title">Lesson title</Label>
                <Input
                  id="lesson-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Enter lesson title"
                  disabled={pending}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="lesson-active" className="mb-1 block">
                    Active
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Toggle to control whether this lesson is available to learners.
                  </p>
                </div>
                <Switch
                  id="lesson-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  disabled={pending}
                />
              </div>

              {state.status === "error" && state.message ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {state.message}
                </div>
              ) : null}

              <div className="mt-auto flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={pending || pendingTransition}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || pendingTransition || title.trim().length === 0}>
                  {pending || pendingTransition ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
