"use client"

import { useCallback, useRef, useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"
import { Upload } from "lucide-react"

import { Button } from "@/components/ui/button"

const UPLOAD_ENDPOINTS: Record<string, string> = {
  "upload-file": "/api/pupil-submission/upload",
  "upload-spreadsheet": "/api/pupil-submission/upload-spreadsheet",
  "upload-worksheet": "/api/pupil-submission/upload-worksheet",
  "mark-worksheet": "/api/pupil-submission/mark-worksheet",
}

// These types auto-enqueue AI marking server-side when a groupAssignmentId is sent.
const AI_MARKED_TYPES = new Set(["upload-spreadsheet", "upload-worksheet", "mark-worksheet"])

type TeacherSubmissionDropzoneProps = {
  enabled: boolean
  lessonId: string
  activityId: string
  activityType: string
  pupilId: string
  assignmentId: string
  disabled?: boolean
  onUploaded: () => void
  children: ReactNode
}

export function TeacherSubmissionDropzone({
  enabled,
  lessonId,
  activityId,
  activityType,
  pupilId,
  assignmentId,
  disabled = false,
  onUploaded,
  children,
}: TeacherSubmissionDropzoneProps) {
  const [isPending, startTransition] = useTransition()
  const [isDragActive, setIsDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Synchronous guard against duplicate concurrent uploads (mirrors PupilUploadActivity).
  const uploadInProgress = useRef(false)

  const endpoint = UPLOAD_ENDPOINTS[activityType]
  const isWorksheet = activityType === "upload-worksheet" || activityType === "mark-worksheet"
  const canUpload =
    enabled && Boolean(endpoint) && !disabled && !isPending && lessonId.length > 0 && pupilId.length > 0

  const beginUpload = useCallback(
    (incoming: FileList | File[]) => {
      if (!endpoint) return
      if (uploadInProgress.current) return
      uploadInProgress.current = true

      const files = Array.from(incoming ?? []).filter((file) => file.size > 0)
      if (files.length === 0) {
        uploadInProgress.current = false
        return
      }
      // upload-worksheet accepts multiple images under the "files" field; the
      // other upload routes take a single file under "file".
      const isWorksheet = activityType === "upload-worksheet" || activityType === "mark-worksheet"
      const selected = isWorksheet ? files : [files[0]]

      startTransition(async () => {
        try {
          const formData = new FormData()
          formData.append("lessonId", lessonId)
          formData.append("activityId", activityId)
          formData.append("pupilId", pupilId)
          if (isWorksheet) {
            for (const f of selected) {
              formData.append("files", f)
            }
          } else {
            formData.append("file", selected[0])
          }
          if (AI_MARKED_TYPES.has(activityType) && assignmentId) {
            formData.append("groupAssignmentId", assignmentId)
          }

          const label =
            selected.length > 1 ? `${selected.length} files` : selected[0].name

          let result: { success: boolean; error?: string }
          try {
            const response = await fetch(endpoint, { method: "POST", body: formData })
            result = await response.json()
          } catch (err) {
            console.error("[teacher-upload] Network error during upload", err)
            result = { success: false, error: "Network error, please try again." }
          }

          if (!result.success) {
            toast.error(`Upload failed for ${label}`, {
              description: result.error ?? "Please try again later.",
            })
            return
          }

          toast.success(`Uploaded ${label} on behalf of the pupil`)
          onUploaded()
        } finally {
          uploadInProgress.current = false
        }
      })
    },
    [activityId, activityType, assignmentId, endpoint, lessonId, onUploaded, pupilId],
  )

  if (!enabled) {
    return <>{children}</>
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragActive(true)
  }

  const handleDragLeave = () => setIsDragActive(false)

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    event.preventDefault()
    setIsDragActive(false)
    const files = event.dataTransfer.files
    if (files && files.length > 0) {
      beginUpload(files)
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={["rounded-md transition", isDragActive ? "ring-2 ring-primary ring-offset-1" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canUpload}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1 h-3.5 w-3.5" />
          {isPending ? "Uploading…" : "Upload for pupil"}
        </Button>
        <span className="text-[11px] text-muted-foreground">or drag &amp; drop a file here</span>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={isWorksheet}
          accept={isWorksheet ? "image/jpeg,image/png" : undefined}
          disabled={!canUpload}
          onChange={(event) => {
            const files = event.target.files
            if (files && files.length > 0) {
              beginUpload(files)
            }
            event.target.value = ""
          }}
        />
      </div>
    </div>
  )
}
