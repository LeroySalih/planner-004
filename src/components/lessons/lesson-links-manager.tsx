"use client"

import { useEffect, useState, useTransition, type ClipboardEvent } from "react"
import { toast } from "sonner"
import { Pencil, Plus, Trash2 } from "lucide-react"

import type { LessonLink } from "@/types"
import {
  createLessonLinkAction,
  deleteLessonLinkAction,
  updateLessonLinkAction,
  fetchLessonLinkMetadataAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface LessonLinksManagerProps {
  unitId: string
  lessonId: string
  initialLinks: LessonLink[]
}

export function LessonLinksManager({ unitId, lessonId, initialLinks }: LessonLinksManagerProps) {
  const [links, setLinks] = useState<LessonLink[]>(initialLinks)
  const [isPending, startTransition] = useTransition()
  const [isFetchingMetadata, startMetadataTransition] = useTransition()
  const [newUrl, setNewUrl] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editUrl, setEditUrl] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [lastFetchedNewUrl, setLastFetchedNewUrl] = useState<string | null>(null)
  const [lastFetchedEditUrl, setLastFetchedEditUrl] = useState<string | null>(null)

  const isBusy = isPending || isFetchingMetadata

  useEffect(() => {
    setLinks(initialLinks)
  }, [initialLinks])

  const resetNewForm = () => {
    setNewUrl("")
    setNewDescription("")
    setLastFetchedNewUrl(null)
  }

  const fetchMetadata = (value: string, mode: "new" | "edit") => {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(trimmed)
    } catch {
      return
    }

    startMetadataTransition(async () => {
      try {
        const result = await fetchLessonLinkMetadataAction(parsedUrl.toString())
        if (result.success && result.title) {
          if (mode === "new") {
            setNewDescription((prev) => (prev.trim().length === 0 ? result.title : prev))
          } else {
            setEditDescription((prev) => (prev.trim().length === 0 ? result.title : prev))
          }
        }
      } catch (error) {
        console.error("[v0] Failed to fetch link metadata:", error)
      } finally {
        if (mode === "new") {
          setLastFetchedNewUrl(parsedUrl.toString())
        } else {
          setLastFetchedEditUrl(parsedUrl.toString())
        }
      }
    })
  }

  const handleNewUrlChange = (value: string) => {
    setNewUrl(value)
    setLastFetchedNewUrl(null)
  }

  const handleNewUrlPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData?.getData("text") ?? ""
    if (!text) return
    event.preventDefault()
    event.currentTarget.value = text
    setNewUrl(text)
    setLastFetchedNewUrl(null)
  }

  const handleNewUrlBlur = () => {
    const url = newUrl.trim()
    if (url.length === 0) {
      return
    }

    try {
      // eslint-disable-next-line no-new
      new URL(url)
    } catch {
      setNewUrl("")
      setLastFetchedNewUrl(null)
      toast.error("Enter a valid URL")
      return
    }

    if (lastFetchedNewUrl === url) {
      return
    }

    fetchMetadata(url, "new")
  }

  const handleEditUrlChange = (value: string) => {
    setEditUrl(value)
    setLastFetchedEditUrl(null)
  }

  const handleEditUrlPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData?.getData("text") ?? ""
    if (!text) return
    event.preventDefault()
    event.currentTarget.value = text
    setEditUrl(text)
    setLastFetchedEditUrl(null)
  }

  const handleEditUrlBlur = () => {
    const url = editUrl.trim()
    if (url.length === 0) {
      return
    }

    try {
      // eslint-disable-next-line no-new
      new URL(url)
    } catch {
      setEditUrl("")
      setLastFetchedEditUrl(null)
      toast.error("Enter a valid URL")
      return
    }

    if (lastFetchedEditUrl === url) {
      return
    }

    fetchMetadata(url, "edit")
  }

  const handleAddLink = () => {
    const url = newUrl.trim()
    if (!url) {
      toast.error("Link URL is required")
      return
    }

    startTransition(async () => {
      const result = await createLessonLinkAction(unitId, lessonId, url, newDescription.trim() || null)
      if (!result.success || !result.data) {
        toast.error("Failed to add link", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setLinks((prev) => [...prev, result.data!])
      resetNewForm()
      toast.success("Link added")
    })
  }

  const handleDeleteLink = (lessonLinkId: string) => {
    startTransition(async () => {
      const result = await deleteLessonLinkAction(unitId, lessonId, lessonLinkId)
      if (!result.success) {
        toast.error("Failed to delete link", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setLinks((prev) => prev.filter((link) => link.lesson_link_id !== lessonLinkId))
      toast.success("Link deleted")
    })
  }

  const startEditing = (link: LessonLink) => {
    setEditingId(link.lesson_link_id)
    setEditUrl(link.url)
    setEditDescription(link.description ?? "")
    setLastFetchedEditUrl(link.url?.trim() ?? null)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditUrl("")
    setEditDescription("")
    setLastFetchedEditUrl(null)
  }

  const handleUpdateLink = () => {
    if (!editingId) return
    const url = editUrl.trim()
    if (!url) {
      toast.error("Link URL is required")
      return
    }

    startTransition(async () => {
      const result = await updateLessonLinkAction(unitId, lessonId, editingId, url, editDescription.trim() || null)
      if (!result.success || !result.data) {
        toast.error("Failed to update link", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setLinks((prev) =>
        prev.map((link) => (link.lesson_link_id === editingId ? (result.data as LessonLink) : link)),
      )
      cancelEditing()
      toast.success("Link updated")
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-link-url">Link URL</Label>
              <Input
                id="new-link-url"
                value={newUrl}
                onChange={(event) => handleNewUrlChange(event.target.value)}
                onPaste={handleNewUrlPaste}
                onBlur={handleNewUrlBlur}
                placeholder="https://example.com"
                disabled={isBusy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-link-description">Description</Label>
              <Input
                id="new-link-description"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="Optional description"
                disabled={isBusy}
              />
            </div>
          </div>
          <Button
            onClick={handleAddLink}
            disabled={isBusy || newUrl.trim().length === 0}
            className="sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" /> Add Link
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Existing Links</h3>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No links have been added yet.</p>
        ) : (
          <ul className="space-y-3">
            {links.map((link) => {
              const isEditing = editingId === link.lesson_link_id
              const displayTitle = link.description?.trim() || "View resource"
              return (
                <li key={link.lesson_link_id} className="rounded-md border border-border p-4">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`edit-url-${link.lesson_link_id}`}>Link URL</Label>
                          <Input
                            id={`edit-url-${link.lesson_link_id}`}
                            value={editUrl}
                            onChange={(event) => handleEditUrlChange(event.target.value)}
                            onPaste={handleEditUrlPaste}
                            onBlur={handleEditUrlBlur}
                            disabled={isBusy}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`edit-description-${link.lesson_link_id}`}>Description</Label>
                          <Input
                            id={`edit-description-${link.lesson_link_id}`}
                            value={editDescription}
                            onChange={(event) => setEditDescription(event.target.value)}
                            disabled={isBusy}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={handleUpdateLink} disabled={isBusy}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEditing} disabled={isBusy}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {displayTitle}
                          </a>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="icon" variant="ghost" onClick={() => startEditing(link)} disabled={isBusy}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteLink(link.lesson_link_id)}
                            disabled={isBusy}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
