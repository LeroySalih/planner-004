"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"

import type { Curriculum, Subjects } from "@/types"
import { updateCurriculumAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Download, Pencil } from "lucide-react"

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
  const [downloadingCurriculumId, setDownloadingCurriculumId] = useState<string | null>(null)

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

    const editingId = editing.curriculum_id

    startTransition(async () => {
      const result = await updateCurriculumAction(editingId, {
        title: trimmedTitle,
        subject: editSubject.trim() || null,
        description: editDescription.trim() || null,
      })

      const { data: updatedCurriculum, error: updateError } = result

      if (updateError || !updatedCurriculum) {
        toast.error("Failed to update curriculum", {
          description: updateError ?? "Please try again later.",
        })
        return
      }

      setItems((previous) =>
        sortCurricula(
          previous.map((item) => (item.curriculum_id === editingId ? updatedCurriculum : item)),
        ),
      )
      toast.success("Curriculum updated")
      handleCloseEdit(true)
    })
  }

  const handleExport = async (curriculum: Curriculum) => {
    const id = curriculum.curriculum_id
    setDownloadingCurriculumId(id)

    try {
      const response = await fetch(`/api/curriculum/${id}/export`)

      if (!response.ok) {
        let description = `${response.status} ${response.statusText}`
        const contentType = response.headers.get("content-type") ?? ""

        if (contentType.includes("application/json")) {
          const payload = await response.json().catch(() => null)
          if (payload?.error) {
            description = payload.error
          }
        }

        toast.error("Failed to export curriculum", {
          description,
        })
        return
      }

      const blob = await response.blob()
      const filenameFromHeader = extractFilenameFromContentDisposition(
        response.headers.get("Content-Disposition"),
      )
      const filename =
        filenameFromHeader ?? `${createDownloadFilename(curriculum.title, curriculum.curriculum_id)}.xlsx`

      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)

      toast.success("Curriculum exported", {
        description: `Downloaded ${curriculum.title}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error"
      console.error("Failed to export curriculum", error)
      toast.error("Failed to export curriculum", {
        description: message,
      })
    } finally {
      setDownloadingCurriculumId(null)
    }
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
                <CardTitle className="text-xl font-semibold text-foreground">
                  <Link
                    href={`/curriculum/${curriculum.curriculum_id}`}
                    className="inline-flex items-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {curriculum.title}
                  </Link>
                </CardTitle>
                <CardAction className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport(curriculum)}
                    disabled={downloadingCurriculumId === curriculum.curriculum_id}
                    aria-label={`Export curriculum ${curriculum.title} to Excel`}
                  >
                    {downloadingCurriculumId === curriculum.curriculum_id ? (
                      "Exporting..."
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                        Export
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenEdit(curriculum)}
                    className="text-primary"
                    aria-label={`Edit curriculum ${curriculum.title}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </CardAction>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => handleCloseEdit()}
                disabled={isPending}
              >
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

function extractFilenameFromContentDisposition(header: string | null) {
  if (!header) return null

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch (error) {
      console.error("Failed to decode filename from header", error)
    }
  }

  const fallbackMatch = header.match(/filename="?([^";]+)"?/i)
  return fallbackMatch?.[1] ?? null
}

function createDownloadFilename(title: string, fallbackId: string) {
  const normalized = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  if (normalized.length === 0) {
    return `curriculum-${fallbackId}`
  }

  return normalized.slice(0, 80)
}
