"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, MessageSquare, Send, X } from "lucide-react"

import type { LessonActivity } from "@/types"
import {
  readShareActivitySubmissionsAction,
  readPeerReviewCommentsAction,
  createPeerReviewCommentAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"

interface SubmissionImage {
  url: string
  mimeType: string
}

interface Submission {
  submissionId: string
  userId?: string
  label: string
  images: SubmissionImage[]
}

interface Comment {
  commentId: string
  commentText: string
  isFlagged: boolean
  createdAt: string
  authorLabel: string
  authorUserId?: string
}

interface PupilReviewOthersWorkActivityProps {
  activity: LessonActivity
  pupilId: string
  stepNumber?: number
}

export function PupilReviewOthersWorkActivity({
  activity,
  pupilId,
  stepNumber,
}: PupilReviewOthersWorkActivityProps) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState("")
  const [isPending, startTransition] = useTransition()

  const activityBody = activity.body_data as { shareActivityId?: string } | null
  const shareActivityId = activityBody?.shareActivityId

  // Load submissions on mount
  useEffect(() => {
    if (!shareActivityId) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const result = await readShareActivitySubmissionsAction(
          shareActivityId,
          pupilId,
        )
        if (cancelled) return

        if (result.success && result.data) {
          setSubmissions(result.data as Submission[])
        } else {
          toast.error("Failed to load submissions")
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[peer-review] Failed to load submissions:", error)
          toast.error("Failed to load submissions")
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [shareActivityId, pupilId])

  // Load comments when a submission is selected
  const loadComments = useCallback(
    async (submission: Submission) => {
      setCommentsLoading(true)
      try {
        const result = await readPeerReviewCommentsAction(
          activity.activity_id,
          submission.submissionId,
        )
        if (result.success && result.data) {
          setComments(result.data as Comment[])
        }
      } catch (error) {
        console.error("[peer-review] Failed to load comments:", error)
      } finally {
        setCommentsLoading(false)
      }
    },
    [activity.activity_id],
  )

  const handleOpenSubmission = useCallback(
    (submission: Submission) => {
      setSelectedSubmission(submission)
      setSelectedImageIndex(0)
      setCommentText("")
      void loadComments(submission)
    },
    [loadComments],
  )

  const handleClose = useCallback(() => {
    setSelectedSubmission(null)
    setComments([])
    setCommentText("")
  }, [])

  const handleSubmitComment = useCallback(() => {
    if (!selectedSubmission || !commentText.trim()) return

    startTransition(async () => {
      const result = await createPeerReviewCommentAction({
        reviewActivityId: activity.activity_id,
        shareSubmissionId: selectedSubmission.submissionId,
        commentText: commentText.trim(),
      })

      if (!result.success) {
        toast.error(result.error ?? "Failed to post comment")
        return
      }

      toast.success("Comment posted")
      setCommentText("")
      void loadComments(selectedSubmission)
    })
  }, [selectedSubmission, commentText, activity.activity_id, loadComments])

  if (!shareActivityId) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-pa-muted-3">
          This activity is not configured yet. The teacher needs to link it to a &quot;Share my work&quot; activity.
        </p>
      </div>
    )
  }

  const totalImages = selectedSubmission?.images.length ?? 0

  return (
    <div className="space-y-3">
      <p className="text-xs text-pa-muted-3">
        Browse your classmates&apos; shared work and leave feedback.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-pa-muted-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading submissions...
        </div>
      ) : submissions.length === 0 ? (
        <p className="text-xs text-pa-muted-3">
          No classmates have shared their work yet. Check back later.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {submissions.map((submission) => (
            <button
              key={submission.submissionId}
              type="button"
              onClick={() => handleOpenSubmission(submission)}
              className="rounded-[14px] border-[1.5px] border-pa-field-border bg-pa-field p-3 text-left transition-colors hover:border-pa-green"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-pa-muted-3" />
                <span className="text-sm font-semibold text-pa-ink">{submission.label}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {submission.images.length} image{submission.images.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              {submission.images.length > 0 && (
                <div className="mt-2 flex gap-1 overflow-hidden">
                  {submission.images.slice(0, 3).map((img, i) => (
                    <div key={i} className="h-12 w-12 shrink-0 overflow-hidden rounded bg-pa-field">
                      <img
                        src={img.url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                  {submission.images.length > 3 && (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-pa-field text-xs text-pa-muted-3">
                      +{submission.images.length - 3}
                    </div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen review dialog */}
      <Dialog open={!!selectedSubmission} onOpenChange={(open) => { if (!open) handleClose() }}>
        <DialogContent
          showCloseButton={false}
          className="h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] p-0 gap-0 flex flex-col sm:max-w-[95vw]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <DialogTitle className="text-base font-medium">
              {selectedSubmission?.label}
            </DialogTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleClose}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>

          {/* Body: side-by-side image + comments */}
          <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
            {/* Left: Image viewer */}
            <div className="flex flex-1 flex-col items-center justify-center bg-pa-field p-4 min-h-0">
              {selectedSubmission && totalImages > 0 && (
                <>
                  <div className="relative flex flex-1 items-center justify-center w-full min-h-0">
                    {totalImages > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute left-0 z-10 h-10 w-10 rounded-full p-0"
                        onClick={() => setSelectedImageIndex((i) => Math.max(0, i - 1))}
                        disabled={selectedImageIndex === 0}
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </Button>
                    )}
                    <img
                      src={selectedSubmission.images[selectedImageIndex]?.url}
                      alt={`Image ${selectedImageIndex + 1}`}
                      className="max-h-full max-w-full object-contain rounded-lg"
                    />
                    {totalImages > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 z-10 h-10 w-10 rounded-full p-0"
                        onClick={() => setSelectedImageIndex((i) => Math.min(totalImages - 1, i + 1))}
                        disabled={selectedImageIndex === totalImages - 1}
                      >
                        <ChevronRight className="h-5 w-5" />
                      </Button>
                    )}
                  </div>
                  {totalImages > 1 && (
                    <div className="mt-2 flex gap-1.5">
                      {selectedSubmission.images.map((img, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSelectedImageIndex(i)}
                          className={`h-10 w-10 shrink-0 overflow-hidden rounded border-2 transition-colors ${
                            i === selectedImageIndex ? "border-pa-green" : "border-transparent"
                          }`}
                        >
                          <img
                            src={img.url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right: Comments panel */}
            <div className="flex w-full flex-col border-t border-pa-field-border sm:w-80 sm:border-t-0 sm:border-l">
              <div className="px-4 py-3 border-b border-pa-field-border">
                <h5 className="text-sm font-semibold text-pa-ink">
                  Your Comments
                </h5>
              </div>

              {/* Comments list */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
                {commentsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-pa-muted-3">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-xs text-pa-muted-3">
                    No comments yet. Leave your feedback below.
                  </p>
                ) : (
                  comments.map((comment) => (
                    <div
                      key={comment.commentId}
                      className={`rounded-pa-box border p-3 text-sm ${
                        comment.isFlagged
                          ? "border-pa-amber-tint bg-pa-amber-tint"
                          : "border-pa-field-border bg-pa-field"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-pa-muted-3">
                          {comment.authorLabel}
                        </span>
                        {comment.isFlagged && (
                          <Badge variant="outline" className="text-[10px] text-pa-amber border-pa-amber-tint">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            Flagged
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-pa-ink">{comment.commentText}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Comment input */}
              {(
                <div className="border-t border-pa-field-border px-4 py-3 space-y-2">
                  <Textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Leave a comment..."
                    rows={3}
                    className="resize-none rounded-pa-box border-[1.5px] border-pa-field-border bg-pa-field px-4 py-3.5 text-[15px] text-pa-ink outline-none placeholder:text-pa-muted-3 focus-visible:border-pa-green"
                    disabled={isPending}
                  />
                  <Button
                    className="h-auto w-full gap-1 rounded-[14px] bg-pa-green py-3.5 text-[15px] font-bold text-white hover:bg-pa-green/90"
                    onClick={handleSubmitComment}
                    disabled={isPending || !commentText.trim()}
                  >
                    {isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Send
                  </Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
