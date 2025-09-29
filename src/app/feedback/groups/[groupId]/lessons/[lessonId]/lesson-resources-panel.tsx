"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import type { ChangeEvent, DragEvent } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, FileDown, LinkIcon, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import {
  deleteLessonFileAction,
  getLessonFileDownloadUrlAction,
  listLessonFilesAction,
  uploadLessonFileAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"

type LessonResourceLink = {
  lesson_link_id: string
  url: string
  description: string | null
}

type LessonResourceFile = {
  name: string
  path: string
  created_at?: string
  updated_at?: string
  size?: number
}

type LessonResourcesPanelProps = {
  lessonId: string
  unitId: string
  links: LessonResourceLink[]
  files: LessonResourceFile[]
}

export function LessonResourcesPanel({ lessonId, unitId, links, files }: LessonResourcesPanelProps) {
  const [pendingFile, setPendingFile] = useState<string | null>(null)
  const [isDownloadPending, startDownload] = useTransition()
  const [isUploadPending, startUpload] = useTransition()
  const [isDeletePending, startDelete] = useTransition()
  const [fileItems, setFileItems] = useState<LessonResourceFile[]>(files)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    setFileItems(files)
  }, [files])

  const refreshFiles = useCallback(async () => {
    const result = await listLessonFilesAction(lessonId)
    if (result.error) {
      toast.error("Failed to refresh files", {
        description: result.error,
      })
      return
    }
    setFileItems(result.data ?? [])
  }, [lessonId])

  const uploadFiles = useCallback(
    (fileList: FileList | File[]) => {
      const entries = Array.from(fileList)
      if (entries.length === 0) return

      startUpload(async () => {
        let uploaded = 0

        for (const file of entries) {
          const formData = new FormData()
          formData.append("unitId", unitId)
          formData.append("lessonId", lessonId)
          formData.append("file", file)

          const result = await uploadLessonFileAction(formData)
          if (!result.success) {
            toast.error(`Failed to upload ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
          } else {
            uploaded += 1
          }
        }

        if (uploaded > 0) {
          toast.success(`${uploaded} file${uploaded === 1 ? "" : "s"} uploaded`)
          await refreshFiles()
        }

        if (fileInputRef.current) {
          fileInputRef.current.value = ""
        }
      })
    },
    [lessonId, refreshFiles, unitId, startUpload],
  )

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files
    if (!selected) return
    uploadFiles(selected)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!isDragging) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (isDragging) {
      setIsDragging(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const droppedFiles = event.dataTransfer.files
    if (!droppedFiles || droppedFiles.length === 0) return
    uploadFiles(droppedFiles)
  }

  const handleDelete = (fileName: string) => {
    setPendingDelete(fileName)
    startDelete(async () => {
      const result = await deleteLessonFileAction(unitId, lessonId, fileName)

      if (!result.success) {
        toast.error("Failed to delete file", {
          description: result.error ?? "Please try again later.",
        })
        setPendingDelete(null)
        return
      }

      toast.success("File removed")
      await refreshFiles()
      setPendingDelete(null)
    })
  }

  const handleDownload = (fileName: string) => {
    setPendingFile(fileName)
    startDownload(async () => {
      const result = await getLessonFileDownloadUrlAction(lessonId, fileName)

      if (!result.success || !result.url) {
        toast.error("Failed to download file", {
          description: result.error ?? "Please try again later.",
        })
        setPendingFile(null)
        return
      }

      window.open(result.url, "_blank", "noopener,noreferrer")
      setPendingFile(null)
    })
  }

  const hasLinks = links.length > 0
  const hasFiles = fileItems.length > 0

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm text-slate-900">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-muted/60"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-base font-semibold text-slate-900">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Lesson Resources
        </span>
        <span className="text-sm text-slate-600">
          {hasLinks ? `${links.length} link${links.length === 1 ? "" : "s"}` : "No links"}
          {" · "}
          {hasFiles ? `${fileItems.length} file${fileItems.length === 1 ? "" : "s"}` : "No files"}
        </span>
      </button>

      {isOpen ? (
        <div className="space-y-6 border-t border-border px-5 py-4">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lesson Links</h3>
            {hasLinks ? (
              <ul className="mt-3 space-y-3">
                {links.map((link) => (
                  <li
                  key={link.lesson_link_id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {link.description?.trim() || link.url}
                    </Link>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{link.url}</p>
                  </div>
                  <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </li>
              ))}
            </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No lesson links added yet.</p>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lesson Files</h3>
            {hasFiles ? (
              <ul className="mt-3 space-y-3">
                {fileItems.map((file) => {
                  const isFilePending = isDownloadPending && pendingFile === file.name
                const isDeleting = isDeletePending && pendingDelete === file.name
                return (
                  <li
                    key={file.path}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{file.name}</p>
                      {file.size ? (
                        <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(file.name)}
                        disabled={isFilePending || isDeleting}
                        className="inline-flex items-center gap-2"
                      >
                        <FileDown className="h-4 w-4" />
                        {isFilePending ? "Preparing..." : "Download"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(file.name)}
                        disabled={isDeleting || isUploadPending}
                        className="inline-flex items-center gap-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {isDeleting ? "Removing..." : "Remove"}
                      </Button>
                    </div>
                  </li>
                )
              })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No lesson files uploaded yet.</p>
            )}
          </section>

          <div
            className={`rounded-md border border-dashed p-4 transition ${
              isDragging ? "border-primary bg-primary/10" : "border-border"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <Upload className="h-6 w-6 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-slate-900">Drag and drop files to upload</p>
                <p className="text-xs text-muted-foreground">Files are automatically associated with this lesson.</p>
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadPending}
                >
                  Select Files
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={refreshFiles} disabled={isUploadPending}>
                  Refresh List
                </Button>
              </div>
              {isUploadPending ? <p className="text-xs text-muted-foreground">Uploading files...</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatSize(size?: number) {
  if (!size || size <= 0) return null
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const formatted = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${formatted} ${units[unitIndex]}`
}
