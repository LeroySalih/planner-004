"use client"

import { useCallback, useRef, useState, useTransition } from "react"
import { Download, File as FileIcon, Loader2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import {
  deleteUnitFileAction,
  getUnitFileDownloadUrlAction,
  uploadUnitFileAction,
  listUnitFilesAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface UnitFileInfo {
  name: string
  path: string
  created_at?: string
  updated_at?: string
  size?: number
}

interface UnitFilesPanelProps {
  unitId: string
  initialFiles: UnitFileInfo[]
}

type UploadProgressState = {
  completed: number
  successful: number
  total: number
}

export function UnitFilesPanel({ unitId, initialFiles }: UnitFilesPanelProps) {
  const [files, setFiles] = useState(initialFiles)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null)

  const resetInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }, [])

  const handleFilesUpload = useCallback(
    (fileList: FileList | File[]) => {
      const selectedFiles = Array.from(fileList).filter((file): file is File => file instanceof File && file.size > 0)

      if (selectedFiles.length === 0) {
        return
      }

      setUploadProgress({ completed: 0, successful: 0, total: selectedFiles.length })

      startTransition(async () => {
        const failed: { name: string; error?: string }[] = []
        let completedCount = 0
        let successfulCount = 0

        try {
          for (const file of selectedFiles) {
            const formData = new FormData()
            formData.append("unitId", unitId)
            formData.append("file", file)

            const result = await uploadUnitFileAction(formData)

            if (!result.success) {
              failed.push({ name: file.name, error: result.error ?? undefined })
            } else {
              successfulCount += 1
            }

            completedCount += 1
            const completedSnapshot = completedCount
            const successfulSnapshot = successfulCount

            setUploadProgress((prev) =>
              prev
                ? {
                    ...prev,
                    completed: completedSnapshot,
                    successful: successfulSnapshot,
                  }
                : prev,
            )
          }

          if (successfulCount > 0) {
            toast.success(
              successfulCount === 1
                ? "File uploaded"
                : `${successfulCount} files uploaded`,
            )

            const updatedList = await listFiles(unitId)
            if (updatedList) {
              setFiles(updatedList)
            }
          }

          if (failed.length > 0) {
            const failureDescription =
              failed.length === 1
                ? failed[0].error ?? "Please try again later."
                : `Unable to upload: ${failed.map((item) => item.name).join(", ")}`

            toast.error(
              failed.length === 1
                ? `Failed to upload ${failed[0].name}`
                : "Some files failed to upload",
              {
                description: failureDescription,
              },
            )
          }
        } finally {
          resetInput()
          setUploadProgress(null)
          setIsDragActive(false)
        }
      })
    },
    [resetInput, startTransition, unitId],
  )

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList || fileList.length === 0) {
        return
      }

      handleFilesUpload(fileList)
    },
    [handleFilesUpload],
  )

  const handleBrowseClick = useCallback(() => {
    if (isPending) {
      return
    }

    inputRef.current?.click()
  }, [isPending])

  const handleZoneKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        handleBrowseClick()
      }
    },
    [handleBrowseClick],
  )

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      if (isPending) {
        return
      }

      setIsDragActive(true)
    },
    [isPending],
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      if (isPending) {
        event.dataTransfer.dropEffect = "none"
        return
      }

      event.dataTransfer.dropEffect = "copy"
    },
    [isPending],
  )

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const relatedTarget = event.relatedTarget as Node | null
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
      return
    }

    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      if (isPending) {
        setIsDragActive(false)
        return
      }

      const fileList = event.dataTransfer.files
      setIsDragActive(false)

      if (!fileList || fileList.length === 0) {
        return
      }

      handleFilesUpload(fileList)
    },
    [handleFilesUpload, isPending],
  )

  const dropZoneClasses = cn(
    "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/40 p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    isDragActive && "border-primary bg-primary/10",
    isPending ? "cursor-not-allowed opacity-75" : "cursor-pointer",
  )

  const handleDelete = (fileName: string) => {
    startTransition(async () => {
      const result = await deleteUnitFileAction(unitId, fileName)
      if (!result.success) {
        toast.error("Delete failed", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      toast.success("File deleted")
      setFiles((prev) => prev.filter((file) => file.name !== fileName))
    })
  }

  const handleDownload = (fileName: string) => {
    startTransition(async () => {
      const result = await getUnitFileDownloadUrlAction(unitId, fileName)
      if (!result.success || !result.url) {
        toast.error("Download failed", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      window.open(result.url, "_blank")
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-xl font-semibold">Unit Files</CardTitle>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            onChange={handleFileInputChange}
            disabled={isPending}
            multiple
            className="hidden"
            id="unit-file-upload"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleBrowseClick}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload Files
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div
          role="button"
          tabIndex={0}
          aria-disabled={isPending}
          aria-busy={uploadProgress !== null}
          onClick={handleBrowseClick}
          onKeyDown={handleZoneKeyDown}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={dropZoneClasses}
        >
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm font-medium">
            {uploadProgress ? "Uploading files..." : "Drag and drop files here"}
          </div>
          {uploadProgress ? (
            <div className="w-full max-w-sm space-y-2">
              <Progress
                value={(uploadProgress.completed / uploadProgress.total) * 100}
                aria-label="Upload progress"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  Processed {uploadProgress.completed}/{uploadProgress.total}
                </span>
                <span>Uploaded {uploadProgress.successful}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              or click to browse your device
            </p>
          )}
        </div>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <FileIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <div className="font-medium">{file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {file.size ? formatFileSize(file.size) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => handleDownload(file.name)}
                    disabled={isPending}
                    aria-label={`Download ${file.name}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    onClick={() => handleDelete(file.name)}
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
      </CardContent>
    </Card>
  )
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function listFiles(unitId: string) {
  const result = await listUnitFilesAction(unitId)
  if (result.error) {
    toast.error("Failed to refresh files", {
      description: result.error,
    })
    return null
  }
  return result.data ?? []
}
