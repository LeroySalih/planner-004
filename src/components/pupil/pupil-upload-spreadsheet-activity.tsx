"use client"

import { useCallback, useRef, useState, useTransition, type ChangeEvent } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, Upload } from "lucide-react"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { getRichTextMarkup } from "@/components/lessons/activity-view/utils"

const ALLOWED_EXTENSION = ".xlsx"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

interface PupilUploadSpreadsheetActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canUpload: boolean
  initialFileName?: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  scoreLabel?: string
  feedbackText?: string | null
}

export function PupilUploadSpreadsheetActivity({
  lessonId,
  activity,
  pupilId,
  canUpload,
  initialFileName = null,
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
  scoreLabel = "In progress",
  feedbackText,
}: PupilUploadSpreadsheetActivityProps) {
  const [isPending, startTransition] = useTransition()
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(initialFileName)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Guards against concurrent uploads caused by rapid double-tap or duplicate
  // onChange events, same as pupil-upload-activity.tsx.
  const uploadInProgress = useRef(false)

  const task = (activity.body_data as any)?.task ?? ""
  const hasTask = typeof task === "string" && task.trim().length > 0

  const uploadDisabled = !canUpload || isPending

  const beginUpload = useCallback(
    (incoming: FileList | File[]) => {
      if (uploadInProgress.current) return
      uploadInProgress.current = true

      const files = Array.from(incoming ?? []).filter((file) => file.size > 0)
      if (files.length === 0) {
        uploadInProgress.current = false
        return
      }

      const file = files[0]

      if (!file.name.toLowerCase().endsWith(ALLOWED_EXTENSION)) {
        toast.error(`Upload failed for ${file.name}`, {
          description: "Only .xlsx files are allowed.",
        })
        uploadInProgress.current = false
        return
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`Upload failed for ${file.name}`, {
          description: "File exceeds 5MB limit.",
        })
        uploadInProgress.current = false
        return
      }

      startTransition(async () => {
        try {
          setSelectedFileName(file.name)

          const formData = new FormData()
          formData.append("lessonId", lessonId)
          formData.append("activityId", activity.activity_id)
          formData.append("pupilId", pupilId)
          formData.append("file", file)
          if (feedbackAssignmentIds.length > 0) {
            formData.append("groupAssignmentId", feedbackAssignmentIds[0])
          }

          let result: { success: boolean; error?: string }
          try {
            const response = await fetch("/api/pupil-submission/upload-spreadsheet", {
              method: "POST",
              body: formData,
            })
            result = await response.json()
          } catch (err) {
            console.error("[pupil-upload-spreadsheet] Network error during upload", err)
            result = { success: false, error: "Network error, please try again." }
          }

          if (!result.success) {
            toast.error(`Upload failed for ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
            setSelectedFileName(null)
            return
          }

          toast.success(`Uploaded ${file.name}`)
          setUploadedFileName(file.name)
          setSelectedFileName(null)
        } finally {
          uploadInProgress.current = false
        }
      })
    },
    [activity.activity_id, feedbackAssignmentIds, lessonId, pupilId],
  )

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (isPending) {
        event.target.value = ""
        return
      }
      const files = event.target.files
      if (!files || files.length === 0) {
        setSelectedFileName(null)
        return
      }
      beginUpload(files)
      event.target.value = ""
    },
    [beginUpload, isPending],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload || uploadDisabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragActive(true)
  }, [canUpload, uploadDisabled])

  const handleDragLeave = useCallback(() => {
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload || uploadDisabled) return
    event.preventDefault()
    setIsDragActive(false)
    const files = event.dataTransfer.files
    if (!files || files.length === 0) {
      return
    }
    beginUpload(files)
  }, [beginUpload, canUpload, uploadDisabled])

  return (
    <div className="space-y-3">
      {hasTask ? (
        <div
          className="prose prose-sm max-w-none text-pa-muted-3"
          dangerouslySetInnerHTML={{ __html: getRichTextMarkup(task) ?? "" }}
        />
      ) : null}

      {canUpload ? (
        <div className="space-y-3">
          <label className="text-sm font-medium text-pa-ink" htmlFor={`upload-spreadsheet-${activity.activity_id}`}>
            Upload your spreadsheet
          </label>
          <div
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              "flex flex-col items-center justify-center gap-2 rounded-pa-box border-2 border-dashed border-pa-field-border bg-pa-field p-4 text-center transition",
              canUpload && !uploadDisabled ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              isDragActive ? "border-pa-green bg-pa-green/5" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              if (uploadDisabled) return
              fileInputRef.current?.click()
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (uploadDisabled) return
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                fileInputRef.current?.click()
              }
            }}
          >
            <Upload className="h-5 w-5 text-pa-muted-3" />
            <p className="text-sm font-medium text-pa-ink">Drag & drop your file here</p>
            <p className="text-xs text-pa-muted-3">or click to browse your device</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation()
                if (uploadDisabled) return
                fileInputRef.current?.click()
              }}
              disabled={uploadDisabled}
            >
              Choose file
            </Button>
            <input
              ref={fileInputRef}
              id={`upload-spreadsheet-${activity.activity_id}`}
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={uploadDisabled}
              onChange={handleFileChange}
            />
          </div>
          {selectedFileName ? (
            <p className="text-xs text-pa-muted-3">Uploading: {selectedFileName}</p>
          ) : null}
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-pa-muted-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
            </div>
          ) : null}
          {uploadedFileName ? (
            <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-pa-field-border bg-pa-field px-[13px] py-[11px]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-pa-green" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-pa-ink">{uploadedFileName}</p>
                <p className="text-xs text-pa-muted-3">Uploaded</p>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-pa-muted-3">
            Files are stored securely so your teacher can review them later. You can re-upload at any time.
          </p>
        </div>
      ) : (
        <p className="text-xs text-pa-muted-3">
          Uploading is disabled in read-only mode. Sign in as the pupil to submit work.
        </p>
      )}
    </div>
  )
}
