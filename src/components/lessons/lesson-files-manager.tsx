"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Download, RefreshCcw, Trash2, Upload } from "lucide-react"

import {
  deleteLessonFileAction,
  getLessonFileDownloadUrlAction,
  listLessonFilesAction,
  uploadLessonFileAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"

interface LessonFileInfo {
  name: string
  path: string
  created_at?: string
  updated_at?: string
  size?: number
}

interface LessonFilesManagerProps {
  unitId: string
  lessonId: string
  initialFiles: LessonFileInfo[]
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
})

const formatTimestamp = (value?: string) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return dateFormatter.format(date)
}

export function LessonFilesManager({ unitId, lessonId, initialFiles }: LessonFilesManagerProps) {
  const [files, setFiles] = useState<LessonFileInfo[]>(initialFiles)
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

    startTransition(async () => {
      let successCount = 0
      for (const file of filesArray) {
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
          successCount += 1
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} file${successCount === 1 ? "" : "s"} uploaded`)
        await refreshFiles()
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
      await refreshFiles()
    })
  }

  const handleDownload = (fileName: string) => {
    startTransition(async () => {
      const result = await getLessonFileDownloadUrlAction(lessonId, fileName)
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
          <p className="text-sm text-muted-foreground">
            Upload resources for this lesson. Files are stored securely in Supabase under
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">{lessonId}</code>.
          </p>
          <p className="text-xs text-muted-foreground">Drag and drop multiple files or use the add button.</p>
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
                  {formatTimestamp(file.updated_at) && (
                    <p className="text-xs text-muted-foreground">Updated {formatTimestamp(file.updated_at)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleDownload(file.name)} disabled={isPending}>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(file.name)}
                    disabled={isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
