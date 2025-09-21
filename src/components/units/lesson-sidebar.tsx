"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Download, ExternalLink, Trash2, X } from "lucide-react"
import {
  createLessonAction,
  deactivateLessonAction,
  updateLessonAction,
  listLessonFilesAction,
  uploadLessonFileAction,
  deleteLessonFileAction,
  getLessonFileDownloadUrlAction,
  listLessonLinksAction,
  createLessonLinkAction,
  deleteLessonLinkAction,
} from "@/lib/server-updates"

interface LessonSidebarProps {
  unitId: string
  lesson: LessonWithObjectives | null
  isOpen: boolean
  onClose: () => void
  onCreateOrUpdate: (lesson: LessonWithObjectives) => void
  onDeactivate: (lessonId: string) => void
  learningObjectives: LearningObjectiveWithCriteria[]
}

interface LessonFileInfo {
  name: string
  path: string
  created_at?: string
  updated_at?: string
  size?: number
}

interface LessonLinkInfo {
  lesson_link_id: string
  url: string
  description: string | null
}

export function LessonSidebar({
  unitId,
  lesson,
  isOpen,
  onClose,
  onCreateOrUpdate,
  onDeactivate,
  learningObjectives,
}: LessonSidebarProps) {
  const [isPending, startTransition] = useTransition()
  const [title, setTitle] = useState("")
  const [isConfirmingDeactivate, setIsConfirmingDeactivate] = useState(false)
  const [selectedObjectiveIds, setSelectedObjectiveIds] = useState<string[]>([])
  const [files, setFiles] = useState<LessonFileInfo[]>([])
  const [isFilesLoading, setIsFilesLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [links, setLinks] = useState<LessonLinkInfo[]>([])
  const [isLinksLoading, setIsLinksLoading] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkDescription, setLinkDescription] = useState("")

  const sortedObjectives = [...learningObjectives].sort((a, b) => {
    const aOrder = a.order_by ?? Number.MAX_SAFE_INTEGER
    const bOrder = b.order_by ?? Number.MAX_SAFE_INTEGER
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }
    return a.title.localeCompare(b.title)
  })

  useEffect(() => {
    if (!isOpen) return

    setTitle(lesson?.title ?? "")
    setIsConfirmingDeactivate(false)
    const availableIds = new Set(
      learningObjectives.map((objective) => objective.learning_objective_id),
    )
    setSelectedObjectiveIds(
      lesson?.lesson_objectives
        ?.map((entry) => entry.learning_objective_id)
        .filter((id) => availableIds.has(id)) ?? [],
    )

    if (lesson) {
      setIsFilesLoading(true)
      listLessonFilesAction(lesson.lesson_id)
        .then((result) => {
          if (result.error) {
            toast.error("Failed to load lesson files", {
              description: result.error,
            })
            return
          }
          setFiles(result.data ?? [])
        })
        .finally(() => setIsFilesLoading(false))

      setIsLinksLoading(true)
      listLessonLinksAction(lesson.lesson_id)
        .then((result) => {
          if (result.error) {
            toast.error("Failed to load lesson links", {
              description: result.error,
            })
            return
          }
          setLinks(result.data ?? [])
        })
        .finally(() => setIsLinksLoading(false))
    } else {
      setFiles([])
      setLinks([])
    }
  }, [isOpen, lesson, learningObjectives])

  const refreshFiles = useCallback(async () => {
    if (!lesson) return
    setIsFilesLoading(true)
    const result = await listLessonFilesAction(lesson.lesson_id)
    if (result.error) {
      toast.error("Failed to refresh files", {
        description: result.error,
      })
    } else {
      setFiles(result.data ?? [])
    }
    setIsFilesLoading(false)
  }, [lesson])

  const refreshLinks = useCallback(async () => {
    if (!lesson) return
    setIsLinksLoading(true)
    const result = await listLessonLinksAction(lesson.lesson_id)
    if (result.error) {
      toast.error("Failed to refresh lesson links", {
        description: result.error,
      })
    } else {
      setLinks(result.data ?? [])
    }
    setIsLinksLoading(false)
  }, [lesson])

  if (!isOpen) {
    return null
  }

  const isEditing = Boolean(lesson)

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!lesson) return
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return

    const file = fileList[0]
    const formData = new FormData()
    formData.append("unitId", unitId)
    formData.append("lessonId", lesson.lesson_id)
    formData.append("file", file)

    startTransition(async () => {
      const result = await uploadLessonFileAction(formData)

      if (!result.success) {
        toast.error("Failed to upload file", {
          description: result.error ?? "Please try again later.",
        })
      } else {
        toast.success("File uploaded")
        await refreshFiles()
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    })
  }

  const handleFileDelete = (fileName: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await deleteLessonFileAction(unitId, lesson.lesson_id, fileName)
      if (!result.success) {
        toast.error("Failed to delete file", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      toast.success("File deleted")
      await refreshFiles()
    })
  }

  const handleFileDownload = (fileName: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await getLessonFileDownloadUrlAction(lesson.lesson_id, fileName)
      if (!result.success || !result.url) {
        toast.error("Failed to download file", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      window.open(result.url, "_blank")
    })
  }

  const handleAddLink = () => {
    if (!lesson) return
    const url = linkUrl.trim()
    if (!url) {
      toast.error("Link URL is required")
      return
    }

    startTransition(async () => {
      const result = await createLessonLinkAction(unitId, lesson.lesson_id, url, linkDescription.trim() || null)
      if (!result.success) {
        toast.error("Failed to add link", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      toast.success("Link added")
      setLinkUrl("")
      setLinkDescription("")
      await refreshLinks()
    })
  }

  const handleDeleteLink = (lessonLinkId: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await deleteLessonLinkAction(unitId, lessonLinkId)
      if (!result.success) {
        toast.error("Failed to delete link", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      toast.success("Link deleted")
      await refreshLinks()
    })
  }

  const handleSave = () => {
    if (title.trim().length === 0) {
      toast.error("Lesson title is required")
      return
    }

    startTransition(async () => {
      try {
        if (lesson) {
          const result = await updateLessonAction(
            lesson.lesson_id,
            unitId,
            title.trim(),
            selectedObjectiveIds,
          )

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Lesson updated")
        } else {
          const result = await createLessonAction(unitId, title.trim(), selectedObjectiveIds)

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Lesson created")
        }

        onClose()
      } catch (error) {
        console.error("[v0] Failed to save lesson:", error)
        toast.error("Failed to save lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  const handleDeactivate = () => {
    if (!lesson) return

    startTransition(async () => {
      try {
        const result = await deactivateLessonAction(lesson.lesson_id, unitId)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        onDeactivate(lesson.lesson_id)
        toast.success("Lesson deactivated")
        onClose()
      } catch (error) {
        console.error("[v0] Failed to deactivate lesson:", error)
        toast.error("Failed to deactivate lesson", {
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
            <CardTitle className="text-xl font-semibold">
              {isEditing ? "Edit Lesson" : "Add Lesson"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="lesson-title">Title</Label>
              <Input
                id="lesson-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Lesson title"
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label>Learning Objectives</Label>
              <div className="space-y-2">
                {sortedObjectives.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No learning objectives available for this unit yet.
                  </p>
                )}
                {sortedObjectives.map((objective) => {
                  const isChecked = selectedObjectiveIds.includes(objective.learning_objective_id)
                  return (
                    <label
                      key={objective.learning_objective_id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          setSelectedObjectiveIds((prev) => {
                            if (checked === true) {
                              if (prev.includes(objective.learning_objective_id)) return prev
                              return [...prev, objective.learning_objective_id]
                            }
                            return prev.filter((id) => id !== objective.learning_objective_id)
                          })
                        }}
                        disabled={isPending}
                      />
                      <span>{objective.title}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {lesson && (
              <div className="space-y-3">
                <Label>Lesson Links</Label>
                <div className="space-y-2">
                  <Input
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder="https://example.com"
                    disabled={isPending}
                  />
                  <Input
                    value={linkDescription}
                    onChange={(event) => setLinkDescription(event.target.value)}
                    placeholder="Description (optional)"
                    disabled={isPending}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddLink}
                      disabled={isPending || !linkUrl.trim()}
                    >
                      Add Link
                    </Button>
                  </div>
                </div>
                {isLinksLoading ? (
                  <p className="text-sm text-muted-foreground">Loading links...</p>
                ) : links.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No links added yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {links.map((link) => (
                      <li
                        key={link.lesson_link_id}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium break-all">{link.url}</span>
                          {link.description && (
                            <span className="text-xs text-muted-foreground">{link.description}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            onClick={() => window.open(link.url, "_blank")}
                            aria-label={`Open ${link.url}`}
                            disabled={isPending}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="destructive"
                            onClick={() => handleDeleteLink(link.lesson_link_id)}
                            aria-label={`Delete link ${link.url}`}
                            disabled={isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {lesson && (
              <div className="space-y-3">
                <Label className="flex items-center justify-between">
                  <span>Lesson Files</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload
                  </Button>
                </Label>
                <input
                  ref={fileInputRef}
                  id="lesson-file-upload"
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isPending}
                />
                {isFilesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading files...</p>
                ) : files.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {files.map((file) => (
                      <li
                        key={file.path}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{file.name}</span>
                          {file.size ? (
                            <span className="text-xs text-muted-foreground">
                              {formatFileSize(file.size)}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            onClick={() => handleFileDownload(file.name)}
                            disabled={isPending}
                            aria-label={`Download ${file.name}`}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="destructive"
                            onClick={() => handleFileDelete(file.name)}
                            disabled={isPending}
                            aria-label={`Delete ${file.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <Button onClick={handleSave} disabled={isPending || title.trim().length === 0}>
                {isEditing ? "Save Changes" : "Create Lesson"}
              </Button>

              {isEditing && lesson?.active !== false && (
                <div className="space-y-3">
                  {!isConfirmingDeactivate ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setIsConfirmingDeactivate(true)}
                      disabled={isPending}
                    >
                      Deactivate Lesson
                    </Button>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                      <p className="text-destructive">
                        Are you sure? Learners will no longer see this lesson.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleDeactivate}
                          disabled={isPending}
                        >
                          Yes, deactivate
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsConfirmingDeactivate(false)}
                          disabled={isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
