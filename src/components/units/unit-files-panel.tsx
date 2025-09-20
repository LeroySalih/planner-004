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

export function UnitFilesPanel({ unitId, initialFiles }: UnitFilesPanelProps) {
  const [files, setFiles] = useState(initialFiles)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const resetInput = () => {
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  const handleUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList || fileList.length === 0) return

      const file = fileList[0]

      const formData = new FormData()
      formData.append("unitId", unitId)
      formData.append("file", file)

      startTransition(async () => {
        const result = await uploadUnitFileAction(formData)
        if (!result.success) {
          toast.error("Upload failed", {
            description: result.error ?? "Please try again later.",
          })
          resetInput()
          return
        }

        toast.success("File uploaded")

        const updatedList = await listFiles(unitId)
        if (updatedList) {
          setFiles(updatedList)
        }

        resetInput()
      })
    },
    [unitId],
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
            onChange={handleUpload}
            disabled={isPending}
            className="hidden"
            id="unit-file-upload"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload File
          </Button>
        </div>
      </CardHeader>
      <CardContent>
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
