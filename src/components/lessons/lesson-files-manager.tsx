"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Download, RefreshCcw, Trash2, Upload } from "lucide-react"

import {
  deleteLessonFileAction,
  getLessonFileDownloadUrlAction,
  listLessonFilesAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

interface LessonFileInfo {
  name: string
  path: string
  created_at?: string | null
  updated_at?: string | null
  last_accessed_at?: string | null
  size?: number | null
  deletable?: boolean
  file_url?: string
  activity_title?: string
}

interface LessonFilesManagerProps {
  unitId: string
  lessonId: string
  initialFiles: LessonFileInfo[]
}

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

// Formatted manually from UTC parts (not Intl.DateTimeFormat) so the server and
// client render identical strings — combining date + time via ICU inserts
// "at" on some runtimes and "," on others, which breaks hydration.
const formatTimestamp = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const day = String(date.getUTCDate()).padStart(2, "0")
  const month = MONTH_ABBREVIATIONS[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  const hours = String(date.getUTCHours()).padStart(2, "0")
  const minutes = String(date.getUTCMinutes()).padStart(2, "0")
  return `${month} ${day}, ${year}, ${hours}:${minutes}`
}

export function LessonFilesManager({ unitId, lessonId, initialFiles }: LessonFilesManagerProps) {
  const [files, setFiles] = useState<LessonFileInfo[]>(initialFiles)
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isDragging, setIsDragging] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ total: number; completed: number }>({
    total: 0,
    completed: 0,
  })
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const isUploadingBatch = uploadProgress.total > 0 && uploadProgress.completed < uploadProgress.total
  const progressPercent = uploadProgress.total > 0
    ? Math.round((uploadProgress.completed / uploadProgress.total) * 100)
    : 0

  useEffect(() => {
    setFiles(initialFiles)
  }, [initialFiles])

  const refreshFiles = useCallback(async () => {
    setIsLoading(true)
    const result = await listLessonFilesAction(lessonId)
    if (result.error) {
      toast.error("Failed to load files", {
        description: result.error,
      })
      setIsLoading(false)
      return
    }
    setFiles(result.data ?? [])
    setIsLoading(false)
  }, [lessonId])

  const uploadFiles = (fileList: FileList) => {
    const filesArray = Array.from(fileList)
    if (filesArray.length === 0) return

    setUploadProgress({ total: filesArray.length, completed: 0 })

    startTransition(async () => {
      let successCount = 0
      for (const file of filesArray) {
        try {
          const formData = new FormData()
          formData.append("unitId", unitId)
          formData.append("lessonId", lessonId)
          formData.append("file", file)

          let result: { success: boolean; error?: string | null; files?: any[] | null }
          try {
            const response = await fetch("/api/lesson-files/upload", { method: "POST", body: formData })
            result = await response.json()
          } catch (err) {
            console.error("[lesson-files] Network error during upload", err)
            result = { success: false, error: "Network error, please try again." }
          }
          if (!result.success) {
            toast.error(`Failed to upload ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
          } else {
            successCount += 1
            if (Array.isArray(result.files)) {
              setFiles(result.files)
            }
          }
        } finally {
          setUploadProgress((prev) => {
            const nextCompleted = Math.min(prev.total, prev.completed + 1)
            return { total: prev.total, completed: nextCompleted }
          })
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} file${successCount === 1 ? "" : "s"} uploaded`)
        await refreshFiles()
      }

      setUploadProgress((prev) => ({ total: prev.total, completed: prev.total }))

      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          setUploadProgress({ total: 0, completed: 0 })
        }, 400)
      } else {
        setUploadProgress({ total: 0, completed: 0 })
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    })
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return
    uploadFiles(fileList)
  }

  const handleDelete = (fileName: string) => {
    startTransition(async () => {
      const result = await deleteLessonFileAction(unitId, lessonId, fileName)
      if (!result.success) {
        toast.error("Failed to delete file", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      toast.success("File deleted")
      if (Array.isArray(result.files)) {
        setFiles(result.files)
      } else {
        await refreshFiles()
      }
    })
  }

  const handleDownload = (file: LessonFileInfo) => {
    startTransition(async () => {
      if (file.file_url) {
        window.open(file.file_url, "_blank")
        return
      }
      const result = await getLessonFileDownloadUrlAction(lessonId, file.name)
      if (!result.success || !result.url) {
        toast.error("Failed to download file", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      window.open(result.url, "_blank")
    })
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!isDragging) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (isDragging) {
      setIsDragging(false)
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const { files: droppedFiles } = event.dataTransfer
    if (!droppedFiles || droppedFiles.length === 0) return
    uploadFiles(droppedFiles)
  }

  return (
    <div
      className="space-y-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {uploadProgress.total > 0 ? (
            <div className="mt-3 w-full max-w-xs space-y-1 sm:max-w-sm">
              <Progress value={progressPercent} />
              <p className="text-[11px] text-muted-foreground">
                Uploading {Math.min(uploadProgress.completed, uploadProgress.total)} of {uploadProgress.total}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            disabled={isPending}
            multiple
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
          >
            <Upload className="mr-2 h-4 w-4" /> Add File
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={refreshFiles} disabled={isPending || isLoading}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <div
        className={`rounded-md border border-dashed p-4 transition ${
          isDragging ? "border-primary bg-primary/10" : "border-border"
        }`}
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading files…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files have been uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.path}
                className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium break-all">{file.name}</p>
                  {file.activity_title && (
                    <p className="text-xs text-muted-foreground">From activity: {file.activity_title}</p>
                  )}
                  {formatTimestamp(file.updated_at) && (
                    <p className="text-xs text-muted-foreground">Updated {formatTimestamp(file.updated_at)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleDownload(file)} disabled={isPending}>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                  {(file.deletable ?? true) && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(file.name)}
                      disabled={isPending}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
