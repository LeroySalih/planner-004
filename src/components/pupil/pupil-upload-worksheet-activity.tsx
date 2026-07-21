"use client"

import { useCallback, useEffect, useRef, useState, useTransition, type ChangeEvent } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, RefreshCw, Upload, X } from "lucide-react"

import type { LessonActivity } from "@/types"
import { UploadWorksheetSubmissionBodySchema } from "@/types"
import type { MarkStatus } from "@/dino.config"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { getRichTextMarkup } from "@/components/lessons/activity-view/utils"
import {
  editWorksheetTextAction,
  getLatestSubmissionForActivityAction,
  resendWorksheetForMarkingAction,
} from "@/lib/server-updates"

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"]
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

interface PupilUploadWorksheetActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canUpload: boolean
  initialFileName?: string | null
  initialFileUrl?: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  scoreLabel?: string
  feedbackText?: string | null
  /** Submission endpoint — defaults to the exam (OCR) flow; mark-worksheet passes its own. */
  uploadEndpoint?: string
  /** When true, files are staged and uploaded together on an explicit Submit (no OCR text editing). */
  stagedSubmit?: boolean
}

function buildFileUrl(filePath: string): string {
  return `/api/files/${filePath.split("/").map(encodeURIComponent).join("/")}`
}

async function convertHeicIfNeeded(file: File): Promise<File> {
  const fileType = file.type.toLowerCase()
  const fileNameLower = file.name.toLowerCase()
  const isHeic =
    fileType === "image/heic" ||
    fileType === "image/heif" ||
    fileNameLower.endsWith(".heic") ||
    fileNameLower.endsWith(".heif")

  if (!isHeic) return file

  try {
    toast.info("Converting photo...")
    const heic2any = (await import("heic2any")).default
    const convertedBlob = await heic2any({
      blob: file,
      toType: "image/jpeg",
    })
    const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
      type: "image/jpeg",
    })
  } catch (error) {
    console.error("[pupil-upload-worksheet] HEIC conversion failed", error)
    throw new Error("Failed to process image. Please try a standard JPEG or PNG.")
  }
}

export function PupilUploadWorksheetActivity({
  lessonId,
  activity,
  pupilId,
  canUpload,
  initialFileName = null,
  initialFileUrl = null,
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
  scoreLabel = "In progress",
  feedbackText,
  uploadEndpoint = "/api/pupil-submission/upload-worksheet",
  stagedSubmit = false,
}: PupilUploadWorksheetActivityProps) {
  const [isPending, startTransition] = useTransition()
  const [isDragActive, setIsDragActive] = useState(false)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [lightboxName, setLightboxName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadInProgress = useRef(false)

  // Mark status — populated from latest submission column
  const [markStatus, setMarkStatus] = useState<MarkStatus | null>(null)
  const [imageUrls, setImageUrls] = useState<Array<{ url: string; name: string }>>([])
  const [draftText, setDraftText] = useState("")
  const [markError, setMarkError] = useState<string | null>(null)
  const [latestSubmissionId, setLatestSubmissionId] = useState<string | null>(null)
  const latestSubmissionIdRef = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Staged (not-yet-uploaded) files for the explicit-submit flow.
  const [stagedFiles, setStagedFiles] = useState<Array<{ file: File; url: string }>>([])

  // Fallback: show legacy single-file info if no submission yet
  const [legacyFileName, setLegacyFileName] = useState<string | null>(initialFileName)
  const [legacyFileUrl, setLegacyFileUrl] = useState<string | null>(initialFileUrl)

  const task = (activity.body_data as any)?.task ?? ""
  const hasTask = typeof task === "string" && task.trim().length > 0

  const uploadDisabled = !canUpload || isPending

  // Load the latest submission and sync local state
  const loadLatestSubmission = useCallback(async () => {
    const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
    if (!result.data) return

    const sub = result.data
    setLatestSubmissionId(sub.submission_id)
    latestSubmissionIdRef.current = sub.submission_id

    // Status and error come from the submission column, not body
    if (sub.mark_status) {
      setMarkStatus(sub.mark_status)
    }

    if (sub.mark_error) {
      setMarkError(sub.mark_error)
    }

    const parsed = UploadWorksheetSubmissionBodySchema.safeParse(sub.body)
    if (!parsed.success) return

    const body = parsed.data

    if (body.images && body.images.length > 0) {
      setImageUrls(
        body.images.map((img) => ({
          url: buildFileUrl(img.filePath),
          name: img.fileName,
        })),
      )
    } else if (body.filePath) {
      // Legacy single-file submission
      setLegacyFileUrl(buildFileUrl(body.filePath))
      setLegacyFileName(body.fileName ?? body.filePath.split("/").pop() ?? "file")
    }

    if (body.extractedText) {
      setDraftText(body.extractedText)
    }
  }, [activity.activity_id, pupilId])

  // On mount, load the latest submission
  useEffect(() => {
    void loadLatestSubmission()
  }, [loadLatestSubmission])

  // SSE subscription for live mark_status updates
  useEffect(() => {
    const source = new EventSource("/sse?topics=submissions")

    source.onmessage = (event) => {
      const envelope = JSON.parse(event.data) as {
        topic?: string
        type?: string
        payload?: unknown
      }
      if (envelope.topic !== "submissions") return
      if (envelope.type !== "submission.updated") return

      const payload = envelope.payload as {
        submissionId?: string
        activityId?: string
        markStatus?: MarkStatus
        markError?: string
      } | null

      if (!payload) return

      const matchesActivity = payload.activityId === activity.activity_id
      const matchesSubmission =
        latestSubmissionIdRef.current != null && payload.submissionId === latestSubmissionIdRef.current

      if (matchesActivity || matchesSubmission) {
        if (payload.markStatus) {
          setMarkStatus(payload.markStatus)
        }
        if (payload.markError) {
          setMarkError(payload.markError)
        }
        // Re-load for the full body (extracted text, new submission id, etc.)
        void loadLatestSubmission()
      }
    }

    return () => {
      source.close()
    }
  }, [activity.activity_id, loadLatestSubmission])

  const beginUpload = useCallback(
    (incoming: FileList | File[]) => {
      if (uploadInProgress.current) return
      uploadInProgress.current = true

      const files = Array.from(incoming ?? []).filter((file) => file.size > 0)
      if (files.length === 0) {
        uploadInProgress.current = false
        return
      }

      startTransition(async () => {
        try {
          const prepared: File[] = []

          for (const raw of files) {
            let file: File
            try {
              file = await convertHeicIfNeeded(raw)
            } catch {
              toast.error(`Failed to process ${raw.name}`, {
                description: "Please try a standard JPEG or PNG.",
              })
              continue
            }

            const lowerName = file.name.toLowerCase()
            if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
              toast.error(`Upload failed for ${file.name}`, {
                description: "Only JPEG or PNG photos are allowed.",
              })
              continue
            }

            if (file.size > MAX_FILE_SIZE_BYTES) {
              toast.error(`Upload failed for ${file.name}`, {
                description: "File exceeds 10MB limit.",
              })
              continue
            }

            prepared.push(file)
          }

          if (prepared.length === 0) {
            toast.error("No valid photos to upload")
            return
          }

          const formData = new FormData()
          formData.append("lessonId", lessonId)
          formData.append("activityId", activity.activity_id)
          formData.append("pupilId", pupilId)
          for (const f of prepared) {
            formData.append("files", f)
          }
          if (feedbackAssignmentIds.length > 0) {
            formData.append("groupAssignmentId", feedbackAssignmentIds[0])
          }

          let result: { success: boolean; error?: string; imagePaths?: string[] }
          try {
            const response = await fetch(uploadEndpoint, {
              method: "POST",
              body: formData,
            })
            result = await response.json()
          } catch (err) {
            console.error("[pupil-upload-worksheet] Network error during upload", err)
            result = { success: false, error: "Network error, please try again." }
          }

          if (!result.success) {
            toast.error("Upload failed", {
              description: result.error ?? "Please try again later.",
            })
            return
          }

          toast.success(`Uploaded ${prepared.length} photo${prepared.length > 1 ? "s" : ""}`)

          // Set optimistic thumbnails
          if (result.imagePaths && result.imagePaths.length > 0) {
            setImageUrls(
              result.imagePaths.map((p, i) => ({
                url: buildFileUrl(p),
                name: prepared[i]?.name ?? p.split("/").pop() ?? "photo",
              })),
            )
          }

          // Exam flow runs OCR first ("reading"); worksheet flow goes straight to marking.
          setMarkStatus(stagedSubmit ? "marking" : "reading")
          setDraftText("")

          // Reload to get latest submission ID for SSE matching
          await loadLatestSubmission()
        } finally {
          uploadInProgress.current = false
        }
      })
    },
    [activity.activity_id, feedbackAssignmentIds, lessonId, pupilId, loadLatestSubmission, stagedSubmit, uploadEndpoint],
  )

  const addStagedFiles = useCallback((incoming: FileList | File[]) => {
    const files = Array.from(incoming ?? []).filter((file) => file.size > 0)
    const valid: Array<{ file: File; url: string }> = []
    for (const file of files) {
      const lowerName = file.name.toLowerCase()
      const okExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext)) ||
        lowerName.endsWith(".heic") || lowerName.endsWith(".heif")
      if (!okExt) {
        toast.error(`Skipped ${file.name}`, { description: "Only JPEG or PNG photos are allowed." })
        continue
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`Skipped ${file.name}`, { description: "File exceeds 10MB limit." })
        continue
      }
      valid.push({ file, url: URL.createObjectURL(file) })
    }
    if (valid.length > 0) setStagedFiles((prev) => [...prev, ...valid])
  }, [])

  const removeStagedFile = useCallback((index: number) => {
    setStagedFiles((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const submitStagedFiles = useCallback(() => {
    if (stagedFiles.length === 0) return
    const entries = stagedFiles
    const files = entries.map((entry) => entry.file)
    // Replace the displayed photo(s) with the new batch immediately — this must
    // not depend on the AI/marking step (which runs server-side after upload).
    // Keep the preview object URLs alive (they're now shown) until the server
    // URLs arrive via beginUpload/loadLatestSubmission.
    setImageUrls(entries.map((entry) => ({ url: entry.url, name: entry.file.name })))
    setMarkStatus("marking")
    setMarkError(null)
    setStagedFiles([])
    beginUpload(files)
  }, [beginUpload, stagedFiles])

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (isPending) {
        event.target.value = ""
        return
      }
      const files = event.target.files
      if (!files || files.length === 0) {
        return
      }
      if (stagedSubmit) {
        addStagedFiles(files)
      } else {
        beginUpload(files)
      }
      event.target.value = ""
    },
    [addStagedFiles, beginUpload, isPending, stagedSubmit],
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
    if (stagedSubmit) {
      addStagedFiles(files)
    } else {
      beginUpload(files)
    }
  }, [addStagedFiles, beginUpload, canUpload, stagedSubmit, uploadDisabled])

  const handleSaveAndRemark = useCallback(async () => {
    if (!latestSubmissionId) return
    setSaving(true)
    try {
      const result = await editWorksheetTextAction({
        activityId: activity.activity_id,
        userId: pupilId,
        sourceSubmissionId: latestSubmissionId,
        text: draftText,
        groupAssignmentId: feedbackAssignmentIds[0] ?? undefined,
      })
      if (!result.success) {
        toast.error("Failed to save", { description: result.error ?? "Please try again." })
        return
      }
      toast.success("Saved — your answer is being re-marked.")
      setMarkStatus("marking")
      if (result.data) {
        setLatestSubmissionId(result.data.submission_id)
        latestSubmissionIdRef.current = result.data.submission_id
      }
    } finally {
      setSaving(false)
    }
  }, [activity.activity_id, draftText, feedbackAssignmentIds, latestSubmissionId, pupilId])

  const [isResending, setIsResending] = useState(false)
  const handleResend = useCallback(async () => {
    setIsResending(true)
    setMarkStatus("marking")
    setMarkError(null)
    try {
      const result = await resendWorksheetForMarkingAction({
        activityId: activity.activity_id,
        pupilId,
        groupAssignmentId: feedbackAssignmentIds[0],
      })
      if (!result.success) {
        toast.error("Couldn't resend for marking", { description: result.error ?? "Please try again." })
      } else {
        toast.success("Resent for marking")
      }
      await loadLatestSubmission()
    } finally {
      setIsResending(false)
    }
  }, [activity.activity_id, pupilId, feedbackAssignmentIds, loadLatestSubmission])

  const openLightbox = useCallback((url: string, name: string) => {
    setLightboxUrl(url)
    setLightboxName(name)
    setIsLightboxOpen(true)
  }, [])

  const hasImages = imageUrls.length > 0
  // While the pupil is staging a new batch, hide the previous submission's
  // images/status so the new upload clearly replaces the old one.
  const hasSubmission = markStatus !== null && !(stagedSubmit && stagedFiles.length > 0)

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
          <label className="text-sm font-medium text-pa-ink" htmlFor={`upload-worksheet-${activity.activity_id}`}>
            {stagedSubmit
              ? "Add photos of your completed worksheet, then submit"
              : "Upload a photo of your completed exam question"}
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
            <p className="text-sm font-medium text-pa-ink">Drag & drop photos here</p>
            <p className="text-xs text-pa-muted-3">or click to take/choose photos</p>
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
              Choose photos
            </Button>
            <input
              ref={fileInputRef}
              id={`upload-worksheet-${activity.activity_id}`}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
              multiple
              className="hidden"
              disabled={uploadDisabled}
              onChange={handleFileChange}
            />
          </div>
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-pa-muted-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
            </div>
          ) : null}

          {stagedSubmit && stagedFiles.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {stagedFiles.map((entry, index) => (
                  <div key={entry.url} className="relative inline-block shrink-0">
                    <div className="h-16 w-16 overflow-hidden rounded-[14px] border-[1.5px] border-pa-field-border bg-pa-field">
                      <img
                        src={entry.url}
                        alt={entry.file.name}
                        className="h-16 w-16 object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStagedFile(index)}
                      disabled={isPending}
                      className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-600 text-white shadow-md ring-2 ring-white transition hover:bg-red-700 disabled:opacity-50"
                      aria-label={`Remove ${entry.file.name}`}
                      title="Remove this photo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                onClick={submitStagedFiles}
                disabled={isPending}
                className="h-auto w-full rounded-[14px] bg-pa-green py-3.5 text-[15px] font-bold text-white hover:bg-pa-green/90"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Submitting…
                  </>
                ) : (
                  `Submit ${stagedFiles.length} photo${stagedFiles.length > 1 ? "s" : ""} for marking`
                )}
              </Button>
            </div>
          ) : null}

          <p className="text-xs text-pa-muted-3">
            Photos are stored securely so your teacher can review them later. You can re-upload at any time.
          </p>
        </div>
      ) : (
        <p className="text-xs text-pa-muted-3">
          Uploading is disabled in read-only mode. Sign in as the pupil to submit work.
        </p>
      )}

      {/* Mark status section — shown when there is a submission */}
      {hasSubmission ? (
        <div className="space-y-3">
          {/* Thumbnails */}
          {hasImages ? (
            <div className="flex flex-wrap gap-2">
              {imageUrls.map((img) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => openLightbox(img.url, img.name)}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-[14px] border-[1.5px] border-pa-field-border bg-pa-field"
                  title={img.name}
                >
                  <img src={img.url} alt={img.name} className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}

          {/* Resend the already-uploaded images to the AI marking flow. */}
          {stagedSubmit && hasImages && canUpload ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleResend}
              disabled={isResending}
              className="w-full gap-2"
            >
              {isResending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Resending…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Resend to AI for marking
                </>
              )}
            </Button>
          ) : null}

          {/* Mark status rendering */}
          {markStatus === "reading" ? (
            <div className="flex items-center gap-2 text-sm text-pa-muted-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Reading your work…</span>
            </div>
          ) : markStatus === "reading-error" || markStatus === "marking-error" ? (
            <div className="space-y-1">
              <p className="text-sm text-destructive">
                {markError ?? "Couldn't read the images. Please try re-uploading."}
              </p>
            </div>
          ) : markStatus === "waiting" || markStatus === "marking" || markStatus === "marked" ? (
            stagedSubmit ? (
              <div className="flex items-center gap-2 text-sm text-pa-muted-3">
                {markStatus === "marked" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-pa-green" />
                    <span>Marked — feedback appears when your teacher releases it.</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Marking your work…</span>
                  </>
                )}
              </div>
            ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-pa-ink">
                Extracted answer — you can correct any mistakes before re-marking
              </label>
              <textarea
                className="w-full rounded-pa-box border-[1.5px] border-pa-field-border bg-pa-field px-4 py-3.5 text-[15px] text-pa-ink outline-none placeholder:text-pa-muted-3 focus-visible:border-pa-green disabled:opacity-70"
                rows={6}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
              />
              {markStatus === "waiting" || markStatus === "marking" ? (
                <div className="flex items-center gap-2 text-xs text-pa-muted-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Marking…</span>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={handleSaveAndRemark}
                  disabled={saving || !latestSubmissionId}
                  className="h-auto w-full rounded-[14px] bg-pa-green py-3.5 text-[15px] font-bold text-white hover:bg-pa-green/90"
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save & re-mark"
                  )}
                </Button>
              )}
            </div>
            )
          ) : null}
        </div>
      ) : legacyFileName ? (
        /* Legacy single-file fallback for old submissions without mark_status */
        <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-pa-field-border bg-pa-field px-[13px] py-[11px]">
          {legacyFileUrl ? (
            <button
              type="button"
              onClick={() => openLightbox(legacyFileUrl, legacyFileName ?? "Uploaded file")}
              className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border-[1.5px] border-pa-field-border bg-white"
            >
              <img src={legacyFileUrl} alt={legacyFileName ?? "Uploaded"} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-pa-green" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-pa-ink">{legacyFileName}</p>
            <p className="text-xs text-pa-muted-3">Uploaded</p>
          </div>
        </div>
      ) : null}

      {/* Lightbox */}
      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent
          showCloseButton={false}
          className="h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] p-0 gap-0 flex flex-col sm:max-w-3xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <DialogTitle className="text-base font-medium">{lightboxName}</DialogTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setIsLightboxOpen(false)}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
          <div className="flex flex-1 min-h-0 items-center justify-center bg-muted/30 p-4">
            {lightboxUrl ? (
              <img
                src={lightboxUrl}
                alt={lightboxName ?? "Uploaded exam question"}
                className="max-h-full max-w-full object-contain rounded-lg"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
