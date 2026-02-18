"use client"

import { useCallback, useEffect, useRef, useState, useTransition, type DragEvent } from "react"
import { toast } from "sonner"
import { AlertTriangle, Flag, GripVertical, Loader2, MessageSquare, Trash2, Upload } from "lucide-react"

import type { LessonActivity } from "@/types"
import {
  uploadShareMyWorkImageAction,
  removeShareMyWorkImageAction,
  reorderShareMyWorkImagesAction,
  readReceivedCommentsAction,
  flagPeerReviewCommentAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface ShareMyWorkFile {
  fileId: string
  fileName: string
  mimeType: string
  order: number
}

interface ReceivedComment {
  commentId: string
  commentText: string
  isFlagged: boolean
  createdAt: string
  authorLabel: string
}

interface PupilShareMyWorkActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canUpload: boolean
  stepNumber: number
  initialFiles: ShareMyWorkFile[]
  initialSubmissionId: string | null
}

const ACCEPTED_TYPES = "image/png,image/jpeg,image/gif,image/webp"

export function PupilShareMyWorkActivity({
  lessonId,
  activity,
  pupilId,
  canUpload,
  stepNumber,
  initialFiles,
  initialSubmissionId,
}: PupilShareMyWorkActivityProps) {
  const [files, setFiles] = useState<ShareMyWorkFile[]>(
    () => [...initialFiles].sort((a, b) => a.order - b.order),
  )
  const [submissionId, setSubmissionId] = useState<string | null>(initialSubmissionId)
  const [isPending, startTransition] = useTransition()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [imageRevision, setImageRevision] = useState(0)
  const [receivedComments, setReceivedComments] = useState<ReceivedComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load comments received on this pupil's work
  useEffect(() => {
    if (files.length === 0) return // No work uploaded yet
    let cancelled = false

    const load = async () => {
      setCommentsLoading(true)
      try {
        const result = await readReceivedCommentsAction(activity.activity_id, pupilId)
        if (cancelled) return
        if (result.success && result.data) {
          setReceivedComments(result.data as ReceivedComment[])
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[peer-review] Failed to load received comments:", error)
        }
      } finally {
        if (!cancelled) setCommentsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [activity.activity_id, pupilId, files.length])

  const handleFlagComment = useCallback(
    (commentId: string) => {
      startTransition(async () => {
        const result = await flagPeerReviewCommentAction(commentId)
        if (!result.success) {
          toast.error(result.error ?? "Failed to flag comment")
          return
        }
        setReceivedComments((prev) =>
          prev.map((c) => c.commentId === commentId ? { ...c, isFlagged: true } : c),
        )
        toast.success("Comment flagged")
      })
    },
    [],
  )

  const handleUpload = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return

      const imageFiles = Array.from(fileList).filter((f) =>
        ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(f.type),
      )

      if (imageFiles.length === 0) {
        toast.error("Only PNG, JPEG, GIF, and WebP images are allowed")
        return
      }

      startTransition(async () => {
        for (const file of imageFiles) {
          if (file.size > 5 * 1024 * 1024) {
            toast.error(`${file.name} exceeds 5MB limit`)
            continue
          }

          const formData = new FormData()
          formData.append("lessonId", lessonId)
          formData.append("activityId", activity.activity_id)
          formData.append("file", file)

          const result = await uploadShareMyWorkImageAction(formData)
          if (!result.success) {
            toast.error(`Failed to upload ${file.name}`, {
              description: result.error ?? "Please try again.",
            })
          } else if (result.data) {
            setFiles((prev) => [
              ...prev,
              {
                fileId: result.data!.fileId,
                fileName: result.data!.fileName,
                mimeType: file.type,
                order: prev.length,
              },
            ])
            if (result.data.submissionId) {
              setSubmissionId(result.data.submissionId)
            }
            setImageRevision((r) => r + 1)
            toast.success(`${file.name} uploaded`)
          }
        }
      })

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [lessonId, activity.activity_id],
  )

  const handleRemove = useCallback(
    (fileName: string) => {
      startTransition(async () => {
        const result = await removeShareMyWorkImageAction(
          lessonId,
          activity.activity_id,
          fileName,
        )
        if (!result.success) {
          toast.error("Failed to remove image", {
            description: result.error ?? "Please try again.",
          })
          return
        }
        setFiles((prev) => {
          const next = prev.filter((f) => f.fileName !== fileName)
          next.forEach((f, i) => {
            f.order = i
          })
          return next
        })
        setImageRevision((r) => r + 1)
        toast.success("Image removed")
      })
    },
    [lessonId, activity.activity_id],
  )

  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    if (dragIndex === null || dragOverIndex === null || dragIndex === dragOverIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }

    const reordered = [...files]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(dragOverIndex, 0, moved)
    reordered.forEach((f, i) => {
      f.order = i
    })
    setFiles(reordered)
    setDragIndex(null)
    setDragOverIndex(null)

    startTransition(async () => {
      const result = await reorderShareMyWorkImagesAction(
        activity.activity_id,
        reordered.map((f) => f.fileName),
      )
      if (!result.success) {
        toast.error("Failed to save new order")
      }
      setImageRevision((r) => r + 1)
    })
  }

  const activityBody = activity.body_data as { name?: string } | null
  const collectionName = activityBody?.name ?? "work"

  // For own images we use the generic file API since the pupil owns them
  // The proxy is for anonymous viewing by reviewers
  const buildImageUrl = (index: number) => {
    if (!submissionId) return ""
    return `/api/peer-review/image/${submissionId}/${index}?v=${imageRevision}`
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{stepNumber}.</span>
        <div>
          <h3 className="font-medium text-foreground">{activity.title || "Share my work"}</h3>
          <p className="text-sm text-muted-foreground">
            Upload images of your {collectionName} to share with classmates for peer review.
          </p>
        </div>
      </div>

      {/* Uploaded files grid */}
      {files.length > 0 && submissionId && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {files.map((file, index) => (
            <div
              key={file.fileId}
              draggable={canUpload}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`group relative overflow-hidden rounded-lg border bg-muted/30 ${
                dragOverIndex === index ? "border-primary" : "border-border"
              }`}
            >
              <div className="aspect-square w-full overflow-hidden bg-muted">
                <img
                  src={buildImageUrl(index)}
                  alt={file.fileName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="flex items-center justify-between px-2 py-1">
                {canUpload && (
                  <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
                )}
                <span className="truncate text-xs text-muted-foreground">{file.fileName}</span>
                {canUpload && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(file.fileName)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload area */}
      {canUpload && (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {isPending ? "Uploading..." : "Upload images"}
          </Button>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, GIF, or WebP. Max 5MB per image.
          </p>
        </div>
      )}

      {/* Feedback received from reviewers */}
      {files.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-medium text-foreground">Feedback received</h4>
          </div>

          {commentsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading feedback...
            </div>
          ) : receivedComments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No feedback yet. Your classmates will be able to leave comments once they review your work.
            </p>
          ) : (
            <div className="space-y-2">
              {receivedComments.map((comment) => (
                <div
                  key={comment.commentId}
                  className={`rounded-md border p-3 text-sm ${
                    comment.isFlagged
                      ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                      : "border-border bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-xs text-muted-foreground">
                      {comment.authorLabel}
                    </span>
                    <div className="flex items-center gap-1">
                      {comment.isFlagged ? (
                        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Flagged
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-amber-600"
                          onClick={() => handleFlagComment(comment.commentId)}
                          disabled={isPending}
                        >
                          <Flag className="h-3 w-3" />
                          Flag
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-foreground">{comment.commentText}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
