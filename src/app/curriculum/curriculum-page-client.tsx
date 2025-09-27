"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"

import type { Curriculum, Subjects } from "@/types"
import { updateCurriculumAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { CreateCurriculumSheet } from "./_components/create-curriculum-sheet"

interface CurriculumPageClientProps {
  curricula: Curriculum[]
  subjects: Subjects
  error: string | null
  subjectsError: string | null
  createAction: (formData: FormData) => Promise<void>
}

export function CurriculumPageClient({
  curricula,
  subjects,
  error,
  subjectsError,
  createAction,
}: CurriculumPageClientProps) {
  const [items, setItems] = useState<Curriculum[]>(() => sortCurricula(curricula))
  const [editing, setEditing] = useState<Curriculum | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editSubject, setEditSubject] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setItems(sortCurricula(curricula))
  }, [curricula])

  const hasItems = items.length > 0

  const sortedSubjects = useMemo(() => {
    const unique = new Set<string>()
    subjects.forEach((subject) => {
      if (subject.subject) {
        unique.add(subject.subject)
      }
    })
    items.forEach((curriculum) => {
      if (curriculum.subject) {
        unique.add(curriculum.subject)
      }
    })
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [subjects, items])

  const handleOpenEdit = (curriculum: Curriculum) => {
    setEditing(curriculum)
    setEditTitle(curriculum.title)
    setEditSubject(curriculum.subject ?? "")
    setEditDescription(curriculum.description ?? "")
  }

  const handleCloseEdit = (force = false) => {
    if (isPending && !force) return
    setEditing(null)
    setEditTitle("")
    setEditSubject("")
    setEditDescription("")
  }

  const handleSaveEdit = () => {
    if (!editing) return

    const trimmedTitle = editTitle.trim()
    if (trimmedTitle.length === 0) {
      toast.error("Curriculum title is required")
      return
    }

    startTransition(async () => {
      const result = await updateCurriculumAction(editing.curriculum_id, {
        title: trimmedTitle,
        subject: editSubject.trim() || null,
        description: editDescription.trim() || null,
      })

      if (result.error || !result.data) {
        toast.error("Failed to update curriculum", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setItems((previous) =>
        sortCurricula(
          previous.map((item) => (item.curriculum_id === editing.curriculum_id ? result.data : item)),
        ),
      )
      toast.success("Curriculum updated")
      handleCloseEdit(true)
    })
  }

  return (
    <main className="container mx-auto max-w-4xl px-6 py-12">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-wide text-slate-300">Curricula</p>
          <h1 className="text-3xl font-semibold text-white">Curriculum Explorer</h1>
          <p className="text-sm text-slate-300">
            Prototype hub for upcoming curriculum tooling. Choose a curriculum below to open its dedicated prototype
            space.
          </p>
        </div>
      </header>

      <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Create New Curriculum</h2>
            <p className="text-sm text-muted-foreground">Launch the sidebar to capture the curriculum details.</p>
          </div>
          <CreateCurriculumSheet action={createAction} subjects={subjects} subjectsError={subjectsError} />
        </div>
      </section>

      {error ? (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Unable to load curricula: {error}
        </div>
      ) : null}

      {!hasItems && !error ? (
        <div className="mt-8 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No curricula found yet. Once curricula are created they will appear here.
        </div>
      ) : null}

      {hasItems ? (
        <section className="mt-8 grid gap-4">
          {items.map((curriculum) => (
            <Card key={curriculum.curriculum_id} className="border-border shadow-sm">
              <CardHeader className="space-y-1">
                <CardTitle className="text-xl font-semibold text-foreground">{curriculum.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {curriculum.description ? (
                  <p className="text-sm text-muted-foreground">{curriculum.description}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">No description provided.</p>
                )}
                <p className="text-sm text-muted-foreground">
                  Subject: {curriculum.subject ?? "Not assigned"}
                </p>
                <div className="flex flex-col gap-2 text-sm font-medium text-primary sm:flex-row sm:items-center sm:gap-4">
                  <Link href={`/curriculum/${curriculum.curriculum_id}`} className="hover:underline">
                    View curriculum →
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(curriculum)}
                    className="inline-flex items-center text-primary hover:underline"
                  >
                    Edit
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <Sheet open={Boolean(editing)} onOpenChange={(open) => (!open ? handleCloseEdit() : null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Edit curriculum</SheetTitle>
            <SheetDescription>Update the core details shown on the curriculum overview.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="edit-curriculum-title">Title</Label>
              <Input
                id="edit-curriculum-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-curriculum-subject">Subject</Label>
              <Input
                id="edit-curriculum-subject"
                value={editSubject}
                onChange={(event) => setEditSubject(event.target.value)}
                list="curriculum-subject-options"
                disabled={isPending}
              />
              {sortedSubjects.length > 0 ? (
                <datalist id="curriculum-subject-options">
                  {sortedSubjects.map((subject) => (
                    <option key={subject} value={subject} />
                  ))}
                </datalist>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-curriculum-description">Description</Label>
              <Textarea
                id="edit-curriculum-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={4}
                disabled={isPending}
              />
            </div>
          </div>
          <SheetFooter>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={handleCloseEdit} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveEdit} disabled={isPending}>
                {isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </main>
  )
}

function sortCurricula(curricula: Curriculum[]) {
  return [...curricula].sort((a, b) => a.title.localeCompare(b.title))
}
