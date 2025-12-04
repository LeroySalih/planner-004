"use client"

import { useCallback, useEffect, useRef, useState, useTransition, type ChangeEvent } from "react"
import { toast } from "sonner"
import { Download, Loader2, Trash2, Upload } from "lucide-react"

import type { LessonActivity, SubmissionStatus } from "@/types"
import {
  listPupilActivitySubmissionsAction,
  uploadPupilActivitySubmissionAction,
  deletePupilActivitySubmissionAction,
  getPupilActivitySubmissionUrlAction,
  updatePupilSubmissionStatusAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"

export interface ActivityFileInfo {
  name: string
  path: string
  size?: number
  status: SubmissionStatus
  submissionId?: string | null
  submittedAt?: string | null
}

interface PupilUploadActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  instructions: string
  initialSubmissions: ActivityFileInfo[]
  canUpload: boolean
  stepNumber: number
  onSubmissionsChange?: (files: ActivityFileInfo[]) => void
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
}

export function PupilUploadActivity({
  lessonId,
  activity,
  pupilId,
  instructions,
  initialSubmissions,
  canUpload,
  stepNumber,
  onSubmissionsChange,
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
}: PupilUploadActivityProps) {
  const normalizeFiles = useCallback(
    (files: ActivityFileInfo[]) =>
      files.map((file) => ({
        ...file,
        status: file.status ?? "inprogress",
        submissionId: file.submissionId ?? null,
        submittedAt: file.submittedAt ?? null,
      })),
    [],
  )

  const [isPending, startTransition] = useTransition()
  const [submissions, setSubmissions] = useState<ActivityFileInfo[]>(() =>
    normalizeFiles(initialSubmissions),
  )
  const [statusPendingPath, setStatusPendingPath] = useState<string | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { currentVisible } = useFeedbackVisibility({
    assignmentIds: feedbackAssignmentIds ?? [],
    lessonId: feedbackLessonId ?? lessonId,
    initialVisible: feedbackInitiallyVisible ?? false,
  })

  const hasInstructions = instructions.trim().length > 0

  const uploadDisabled = !canUpload || isPending || currentVisible

  const refreshSubmissions = useCallback(async () => {
    try {
      const result = await listPupilActivitySubmissionsAction(lessonId, activity.activity_id, pupilId)
      if (result.error) {
        toast.error("Unable to refresh uploads", {
          description: result.error,
        })
        return false
      }
      const files = normalizeFiles(result.data ?? [])
      setSubmissions((prev) => {
        const next = files.length === 0 && prev.length > 0 ? prev : files
        if (next !== prev) {
          onSubmissionsChange?.(next)
        }
        return next
      })
      return true
    } catch (error) {
      console.error("[pupil-upload] Failed to refresh submissions", error)
      toast.error("Unable to refresh uploads", { description: "Network error, please try again." })
      return false
    }
  }, [activity.activity_id, lessonId, normalizeFiles, onSubmissionsChange, pupilId])

  useEffect(() => {
    if (!pupilId) {
      return
    }
    void refreshSubmissions()
  }, [pupilId, refreshSubmissions])

  const beginUpload = useCallback(
    (incoming: FileList | File[]) => {
      const files = Array.from(incoming ?? []).filter((file) => file.size > 0)
      if (files.length === 0) {
        return
      }

      const file = files[0]

      startTransition(async () => {
        setSelectedFileName(file.name)

        const formData = new FormData()
        formData.append("lessonId", lessonId)
        formData.append("activityId", activity.activity_id)
        formData.append("pupilId", pupilId)
        formData.append("file", file)

        try {
          const existing = submissions[0]
          if (existing) {
            const { success, error } = await deletePupilActivitySubmissionAction(
              lessonId,
              activity.activity_id,
              pupilId,
              existing.name,
            )
            if (!success) {
              toast.error("Unable to replace previous file", {
                description: error ?? "Please try again later.",
              })
              setSelectedFileName(null)
              return
            }
          }

          const result = await uploadPupilActivitySubmissionAction(formData)
          if (!result.success) {
            toast.error(`Upload failed for ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
            setSelectedFileName(null)
            return
          }
        } catch (error) {
          console.error("[pupil-upload] Upload failed", error)
          toast.error(`Upload failed for ${file.name}`, {
            description: "Network error, please try again later.",
          })
          setSelectedFileName(null)
          return
        }

        toast.success(`Uploaded ${file.name}`)

        const optimisticEntry: ActivityFileInfo = {
          name: file.name,
          path: `${lessonId}/activities/${activity.activity_id}/${pupilId}/${file.name}`,
          size: file.size,
          status: "inprogress",
          submissionId: null,
          submittedAt: new Date().toISOString(),
        }

        setSubmissions([optimisticEntry])
        onSubmissionsChange?.([optimisticEntry])

        setSelectedFileName(null)
        await refreshSubmissions()
      })
    },
    [activity.activity_id, lessonId, onSubmissionsChange, pupilId, refreshSubmissions, startTransition, submissions],
  )

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) {
        setSelectedFileName(null)
        return
      }
      beginUpload(files)
      event.target.value = ""
    },
    [beginUpload],
  )

  const handleDownloadSubmission = useCallback(
    async (fileName: string) => {
      startTransition(async () => {
        try {
          const result = await getPupilActivitySubmissionUrlAction(
            lessonId,
            activity.activity_id,
            pupilId,
            fileName,
          )
          if (!result.success || !result.url) {
            toast.error("Unable to download upload", {
              description: result.error ?? "Please try again later.",
            })
            return
          }
          window.open(result.url, "_blank")
        } catch (error) {
          console.error("[pupil-upload] Download failed", error)
          toast.error("Unable to download upload", { description: "Network error, please try again." })
        }
      })
    },
    [activity.activity_id, lessonId, pupilId],
  )

  const handleDeleteSubmission = useCallback(
    async (fileName: string) => {
      startTransition(async () => {
        try {
          const result = await deletePupilActivitySubmissionAction(
            lessonId,
            activity.activity_id,
            pupilId,
            fileName,
          )
          if (!result.success) {
            toast.error("Unable to delete file", {
              description: result.error ?? "Please try again later.",
            })
            return
          }
        } catch (error) {
          console.error("[pupil-upload] Delete failed", error)
          toast.error("Unable to delete file", { description: "Network error, please try again." })
          return
        }
        toast.success("Upload removed")
        await refreshSubmissions()
      })
    },
    [activity.activity_id, lessonId, pupilId, refreshSubmissions],
  )

  const handleStatusChange = useCallback(
    (file: ActivityFileInfo, nextStatus: SubmissionStatus) => {
      if (!canUpload) return
      startTransition(async () => {
        setStatusPendingPath(file.path)
        try {
          const result = await updatePupilSubmissionStatusAction({
            lessonId,
            activityId: activity.activity_id,
            pupilId,
            status: nextStatus,
          })

          if (!result.success) {
            toast.error("Unable to update status", {
              description: result.error ?? "Please try again later.",
            })
            return
          }

          toast.success("Status updated")
          await refreshSubmissions()
        } catch (error) {
          console.error("[pupil-lessons] Failed to update upload status", error)
          toast.error("Unable to update status", {
            description: "Please try again later.",
          })
        } finally {
          setStatusPendingPath(null)
        }
      })
    },
    [activity.activity_id, canUpload, lessonId, pupilId, refreshSubmissions],
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
    <div className="space-y-3 px-1">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Step {stepNumber}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">{activity.title}</h3>
              {activity.is_homework ? (
                <Badge variant="destructive" className="uppercase tracking-wide">
                  Homework
                </Badge>
              ) : null}
            </div>
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-primary">Upload file</span>
        </div>
      </div>

      {hasInstructions ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{instructions}</p>
      ) : null}

      {canUpload ? (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground" htmlFor={`upload-${activity.activity_id}`}>
            Upload your work
          </label>
          <div
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/40 p-4 text-center transition",
              canUpload && !uploadDisabled ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              isDragActive ? "border-primary bg-primary/5" : "",
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
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">Drag & drop your file here</p>
            <p className="text-xs text-muted-foreground">or click to browse your device</p>
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
              id={`upload-${activity.activity_id}`}
              type="file"
              className="hidden"
              disabled={uploadDisabled}
              onChange={handleFileChange}
              multiple
            />
          </div>
          {selectedFileName ? (
            <p className="text-xs text-muted-foreground">Uploading: {selectedFileName}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Files are stored securely so your teacher can review them later.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Uploading is disabled in read-only mode. Sign in as the pupil to submit work.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Your uploads</p>
        {isPending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
          </div>
        ) : null}
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {submissions.map((file) => {
              const statusDisabled = isPending || statusPendingPath === file.path || !canUpload
              return (
                <li key={file.path} className="rounded-md border border-border/60 px-3 py-2">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="truncate pr-4 font-medium" title={file.name}>
                        {file.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</span>
                        <Select
                          value={file.status}
                          onValueChange={(value) => handleStatusChange(file, value as SubmissionStatus)}
                          disabled={statusDisabled}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue aria-label={file.status} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inprogress">In progress</SelectItem>
                            <SelectItem value="submitted">Submitted</SelectItem>
                          </SelectContent>
                        </Select>
                        {statusPendingPath === file.path ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        onClick={() => handleDownloadSubmission(file.name)}
                        disabled={isPending}
                        aria-label={`Download ${file.name}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {canUpload ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="destructive"
                          onClick={() => handleDeleteSubmission(file.name)}
                          disabled={isPending}
                          aria-label={`Delete ${file.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
