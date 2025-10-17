"use client"

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from "react"
import type { LessonActivity } from "@/types"
import { ActivityImagePreview } from "@/components/lessons/activity-image-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  getActivityFileUrlValue,
  getActivityTextValue,
  getFeedbackBody,
  getImageBody,
  getMcqBody,
  getShortTextBody,
  getRichTextMarkup,
  getVoiceBody,
  isAbsoluteUrl,
} from "@/components/lessons/activity-view/utils"
import {
  getActivityFileDownloadUrlAction,
  readLessonSubmissionSummariesAction,
  listShortTextSubmissionsAction,
  markShortTextActivityAction,
  overrideShortTextSubmissionScoreAction,
} from "@/lib/server-updates"
import { supabaseBrowserClient } from "@/lib/supabase-browser"
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react"
import type { LessonSubmissionSummary } from "@/types"
import { addFeedbackRefreshListener, triggerFeedbackRefresh } from "@/lib/feedback-events"
import { toast } from "sonner"

export type LessonActivityViewMode = "short" | "present" | "edit"

export interface LessonActivityFile {
  name: string
  path: string
  size?: number
}

export interface LessonActivityViewBaseProps {
  activity: LessonActivity
  lessonId?: string
}

type ShortTextSubmissionRow = {
  submissionId: string
  activityId: string
  userId: string
  submittedAt: string | null
  answer: string
  aiModelScore: number | null
  teacherOverrideScore: number | null
  isCorrect: boolean
  profile: {
    userId: string
    firstName: string | null
    lastName: string | null
  } | null
}

const FEEDBACK_GROUP_DEFAULTS = {
  isEnabled: false,
  showScore: false,
  showCorrectAnswers: false,
}

export interface LessonActivityShortViewProps extends LessonActivityViewBaseProps {
  mode: "short"
  resolvedImageUrl?: string | null
  showImageBorder?: boolean
  onSummativeChange?: (nextValue: boolean) => void
  summativeUpdating?: boolean
}

export interface LessonActivityPresentViewProps extends LessonActivityViewBaseProps {
  mode: "present"
  files: LessonActivityFile[]
  onDownloadFile: (fileName: string) => void
  voicePlayback?: { url: string | null; isLoading: boolean }
  fetchActivityFileUrl?: (activityId: string, fileName: string) => Promise<string | null>
  viewerCanReveal?: boolean
}

export interface LessonActivityEditViewProps extends LessonActivityViewBaseProps {
  mode: "edit"
  resolvedImageUrl?: string | null
}

export type LessonActivityViewProps =
  | LessonActivityShortViewProps
  | LessonActivityPresentViewProps
  | LessonActivityEditViewProps

export function LessonActivityView(props: LessonActivityViewProps) {
  switch (props.mode) {
    case "short":
      return <ActivityShortView {...props} />
    case "present":
      return <ActivityPresentView {...props} />
    case "edit":
      return <ActivityEditView {...props} />
    default:
      return null
  }
}

function ActivitySuccessCriteria({
  activity,
  variant = "default",
}: {
  activity: LessonActivity
  variant?: "compact" | "default"
}) {
  const items = Array.isArray(activity.success_criteria) ? activity.success_criteria : []
  if (items.length === 0) {
    return null
  }

  const wrapperClasses = variant === "compact" ? "space-y-1" : "space-y-2"
  const containerClasses = variant === "compact" ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"
  const badgeClasses =
    variant === "compact"
      ? "rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
      : "rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"

  const heading =
    variant === "compact" ? (
      <span className="sr-only">Success criteria</span>
    ) : (
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Success criteria</p>
    )

  return (
    <div className={wrapperClasses}>
      {heading}
      <div className={containerClasses}>
        {items.map((item) => {
          const identifier = typeof item?.success_criteria_id === "string" ? item.success_criteria_id : undefined
          const label =
            typeof item?.title === "string" && item.title.trim().length > 0
              ? item.title.trim()
              : "Success criterion"
          return (
            <span key={identifier ?? label} className={badgeClasses}>
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function ActivityShortView({
  activity,
  lessonId,
  resolvedImageUrl,
  showImageBorder = true,
  onSummativeChange,
  summativeUpdating = false,
}: LessonActivityShortViewProps) {
  const hasSuccessCriteria = Array.isArray(activity.success_criteria) && activity.success_criteria.length > 0
  const isSummative = activity.is_summative ?? false
  const canToggleSummative = typeof onSummativeChange === "function"
  const summativeSwitchId = `activity-summative-${activity.activity_id}`

  const summativeSection = (() => {
    if (canToggleSummative) {
      return (
        <div key="summative" className="flex items-center gap-2">
          <Switch
            id={summativeSwitchId}
            checked={isSummative}
            disabled={summativeUpdating}
            onCheckedChange={(checked) => onSummativeChange?.(checked)}
          />
          <Label htmlFor={summativeSwitchId} className="text-xs font-medium text-muted-foreground">
            Summative
          </Label>
          {summativeUpdating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      )
    }

    if (isSummative) {
      return (
        <div key="summative" className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            Summative
          </Badge>
        </div>
      )
    }

    return null
  })()

  let content: ReactNode = null

  if (activity.type === "text") {
    const text = getActivityTextValue(activity)
    const markup = getRichTextMarkup(text)
    if (markup) {
      content = (
        <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: markup }} />
      )
    }
  } else if (activity.type === "upload-file") {
    const text = getActivityTextValue(activity)
    const markup = getRichTextMarkup(text)
    if (markup) {
      content = (
        <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: markup }} />
      )
    }
  } else if (activity.type === "multiple-choice-question") {
    const mcq = getMcqBody(activity)
    const markup = getRichTextMarkup(mcq.question)
    content = markup ? (
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Multiple choice</p>
        <div
          className="prose prose-sm line-clamp-3 max-w-none text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Multiple choice question awaiting setup.</p>
    )
  } else if (activity.type === "short-text-question") {
    const shortText = getShortTextBody(activity)
    const markup = getRichTextMarkup(shortText.question)
    content = markup ? (
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Short text question</p>
        <div
          className="prose prose-sm line-clamp-3 max-w-none text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Short text question awaiting setup.</p>
    )
  } else if (activity.type === "feedback") {
    const feedback = getFeedbackBody(activity)
    const entries = Object.entries(feedback.groups)

    content =
      entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No groups configured yet.</p>
      ) : (
        <div className="space-y-2 text-sm">
          {entries.map(([groupId, settings]) => (
            <div
              key={groupId}
              className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
            >
              <span className="font-medium text-foreground">{groupId}</span>
              <span className={cn("text-xs", settings.isEnabled ? "text-emerald-600" : "text-muted-foreground")}>
                {settings.isEnabled ? `Enabled for group ${groupId}` : `Not enabled for group ${groupId}`}
              </span>
            </div>
          ))}
        </div>
      )
  } else if (activity.type === "show-video") {
    const url = getActivityFileUrlValue(activity)
    if (url) {
      content = (
        <span
          role="link"
          tabIndex={0}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (typeof window !== "undefined") {
              window.open(url, "_blank", "noopener,noreferrer")
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              event.stopPropagation()
              if (typeof window !== "undefined") {
                window.open(url, "_blank", "noopener,noreferrer")
              }
            }
          }}
          className="inline-flex cursor-pointer items-center break-all text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Watch video
        </span>
      )
    }
  } else if (activity.type === "display-image") {
    content = (
      <DisplayImageShortView
        activity={activity}
        lessonId={lessonId ?? null}
        resolvedImageUrl={resolvedImageUrl ?? null}
        showImageBorder={showImageBorder}
      />
    )
  } else if (activity.type === "voice") {
    const body = getVoiceBody(activity)
    content = body.audioFile ? (
      <p className="text-sm text-muted-foreground">Voice recording attached.</p>
    ) : (
      <p className="text-sm text-muted-foreground">No recording uploaded yet.</p>
    )
  }

  const sections: ReactNode[] = []
  if (summativeSection) {
    sections.push(summativeSection)
  }
  if (hasSuccessCriteria) {
    sections.push(<ActivitySuccessCriteria key="success-criteria" activity={activity} variant="compact" />)
  }
  if (content) {
    sections.push(<Fragment key="content">{content}</Fragment>)
  }

  if (sections.length === 0) {
    return null
  }

  if (sections.length === 1) {
    return <>{sections[0]}</>
  }

  return <div className="space-y-3">{sections}</div>
}

function DisplayImageShortView({
  activity,
  lessonId,
  resolvedImageUrl,
  showImageBorder,
}: {
  activity: LessonActivity
  lessonId: string | null
  resolvedImageUrl: string | null
  showImageBorder: boolean
}) {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>({
    url: null,
    loading: true,
  })

  const normalizedLessonId = useMemo(() => {
    const fromProp = lessonId?.trim()
    if (fromProp) return fromProp
    const fromActivity = typeof activity.lesson_id === "string" ? activity.lesson_id.trim() : ""
    return fromActivity
  }, [activity.lesson_id, lessonId])

  const derived = useMemo(() => {
    const body = getImageBody(activity)
    const record = (activity.body_data ?? {}) as Record<string, unknown>
    const rawFileUrl = typeof record.fileUrl === "string" ? record.fileUrl : null

    const directCandidate = (() => {
      const trimmed = resolvedImageUrl?.trim()
      if (trimmed) return trimmed
      if (body.imageUrl && isAbsoluteUrl(body.imageUrl)) return body.imageUrl
      if (rawFileUrl && isAbsoluteUrl(rawFileUrl)) return rawFileUrl
      return null
    })()

    const fileCandidate = (() => {
      if (body.imageFile && !isAbsoluteUrl(body.imageFile)) return body.imageFile
      if (rawFileUrl && !isAbsoluteUrl(rawFileUrl)) return rawFileUrl
      return null
    })()

    return { directCandidate, fileCandidate }
  }, [activity, resolvedImageUrl])

  useEffect(() => {
    let cancelled = false

    async function preload(url: string): Promise<boolean> {
      if (!url) return false
      return new Promise((resolve) => {
        const image = new Image()
        image.onload = () => resolve(true)
        image.onerror = () => resolve(false)
        image.src = url
      })
    }

    async function resolveUrl() {
      if (derived.directCandidate) {
        const loaded = await preload(derived.directCandidate)
        if (!cancelled && loaded) {
          setState({ url: derived.directCandidate, loading: false })
          return
        }
        if (!loaded) {
          console.log("[lesson-activities] Failed to load thumbnail image:", derived.directCandidate)
        }
      }

      if (!normalizedLessonId || !derived.fileCandidate) {
        if (!cancelled) {
          setState({ url: null, loading: false })
        }
        return
      }

      setState({ url: null, loading: true })

      try {
        const result = await getActivityFileDownloadUrlAction(
          normalizedLessonId,
          activity.activity_id,
          derived.fileCandidate,
        )
        if (cancelled) return
        const candidateUrl = result.success ? result.url ?? null : null
        if (candidateUrl) {
          const loaded = await preload(candidateUrl)
          if (cancelled) return
          if (loaded) {
            setState({ url: candidateUrl, loading: false })
            return
          }
          console.log("[lesson-activities] Failed to load thumbnail image:", candidateUrl)
        }
        setState({ url: null, loading: false })
      } catch (error) {
        if (!cancelled) {
          console.error("[lesson-activities] Unexpected error resolving thumbnail image:", error)
          setState({ url: null, loading: false })
        }
      }
    }

    setState({ url: null, loading: true })
    resolveUrl()

    return () => {
      cancelled = true
    }
  }, [activity.activity_id, derived, normalizedLessonId])

  if (state.loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-border/60 bg-muted/20 text-sm text-muted-foreground">
        Loading image…
      </div>
    )
  }

  if (state.url) {
    return (
      <div
        className={[
          "relative h-24 w-32 overflow-hidden rounded-md bg-muted/30",
          showImageBorder ? "border border-border" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={state.url}
          alt={activity.title || "Activity image"}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => {
            console.log("[lesson-activities] Failed to load thumbnail image:", state.url)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      No image selected (yet).
    </div>
  )
}

function McqPresentView({
  activity,
  fetchActivityFileUrl,
  canReveal = false,
}: {
  activity: LessonActivity
  fetchActivityFileUrl?: (activityId: string, fileName: string) => Promise<string | null>
  canReveal?: boolean
}) {
  const mcq = getMcqBody(activity)
  const [imageState, setImageState] = useState<{
    url: string | null
    loading: boolean
    error: string | null
  }>({ url: null, loading: false, error: null })
  const [isRevealed, setIsRevealed] = useState(false)

  useEffect(() => {
    setIsRevealed(false)
  }, [activity.activity_id])

  useEffect(() => {
    let cancelled = false

    const directUrl =
      mcq.imageUrl && isAbsoluteUrl(mcq.imageUrl) ? mcq.imageUrl : null

    if (directUrl) {
      setImageState({ url: directUrl, loading: false, error: null })
      return () => {
        cancelled = true
      }
    }

    const fileName =
      mcq.imageFile && !isAbsoluteUrl(mcq.imageFile) ? mcq.imageFile : null

    if (!fileName) {
      setImageState({ url: null, loading: false, error: null })
      return () => {
        cancelled = true
      }
    }

    if (!fetchActivityFileUrl) {
      setImageState({
        url: null,
        loading: false,
        error: "Upload handling is not available for this image.",
      })
      return () => {
        cancelled = true
      }
    }

    setImageState({ url: null, loading: true, error: null })
    fetchActivityFileUrl(activity.activity_id, fileName)
      .then((url) => {
        if (cancelled) return
        if (url) {
          setImageState({ url, loading: false, error: null })
        } else {
          setImageState({
            url: null,
            loading: false,
            error: "Unable to load the image for this question.",
          })
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error("[lesson-activities] Failed to load MCQ image:", error)
        setImageState({
          url: null,
          loading: false,
          error: "Unable to load the image for this question.",
        })
      })

    return () => {
      cancelled = true
    }
  }, [activity.activity_id, fetchActivityFileUrl, mcq.imageFile, mcq.imageUrl])

  const questionMarkup = getRichTextMarkup(mcq.question)
  const fallbackQuestion = (mcq.question || activity.title || "Multiple choice question").trim()
  const revealEnabled = canReveal && isRevealed

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
          {questionMarkup ? (
            <div
              className="prose prose-lg max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: questionMarkup }}
            />
          ) : (
            <h3 className="text-2xl font-semibold text-foreground">
              {fallbackQuestion || "Multiple choice question"}
            </h3>
          )}
          {canReveal ? (
            <Button
              type="button"
              size="sm"
              variant={revealEnabled ? "secondary" : "outline"}
              onClick={() => setIsRevealed((previous) => !previous)}
              aria-pressed={revealEnabled}
              className="shrink-0"
            >
              {revealEnabled ? (
                <>
                  <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
                  Hide answer
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                  Reveal answer
                </>
              )}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Pupils respond on their devices. Use reveal when you are ready to discuss the answer.
        </p>
      </div>

      {imageState.loading ? (
        <p className="text-sm text-muted-foreground">Loading question image…</p>
      ) : imageState.error ? (
        <p className="text-sm text-destructive">{imageState.error}</p>
      ) : imageState.url ? (
        <ActivityImagePreview
          imageUrl={imageState.url}
          alt={mcq.imageAlt || fallbackQuestion || "Question image"}
          objectFit="contain"
        />
      ) : null}

      <ul className="space-y-3">
        {mcq.options.map((option, index) => {
          const optionText = option.text.trim() || `Option ${index + 1}`
          const isCorrect = option.id === mcq.correctOptionId

          return (
            <li
              key={option.id}
              className={cn(
                "flex items-start justify-between rounded-lg border border-border bg-card p-3",
                revealEnabled && isCorrect && "border-primary bg-primary/5",
              )}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{optionText}</p>
                <p className="text-xs text-muted-foreground">Choice {index + 1}</p>
              </div>
              {revealEnabled && isCorrect ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Correct answer
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        When presenting, ask pupils to choose their answer on their device.
      </p>
    </div>
  )
}
function ActivityPresentView({
  activity,
  files,
  onDownloadFile,
  voicePlayback,
  fetchActivityFileUrl,
  viewerCanReveal,
  lessonId,
}: LessonActivityPresentViewProps) {
  const hasSuccessCriteria = Array.isArray(activity.success_criteria) && activity.success_criteria.length > 0

  const wrap = (node: ReactNode) => {
    if (!hasSuccessCriteria) {
      return node
    }
    return (
      <div className="space-y-4">
        <ActivitySuccessCriteria activity={activity} variant="default" />
        {node}
      </div>
    )
  }

  if (activity.type === "feedback") {
    return wrap(<FeedbackPresentView activity={activity} lessonId={lessonId} />)
  }

  if (activity.type === "text") {
    const text = getActivityTextValue(activity)
    const markup = getRichTextMarkup(text)
    if (!markup) {
      return wrap(<p className="text-muted-foreground">No text content provided for this activity.</p>)
    }
    return wrap(
      <div
        className="prose prose-lg max-w-none text-foreground"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    )
  }

  if (activity.type === "short-text-question") {
    return wrap(<ShortTextPresentView activity={activity} lessonId={lessonId} />)
  }

  if (activity.type === "display-image") {
    return wrap(
      <DisplayImagePresent
        activity={activity}
        fetchActivityFileUrl={fetchActivityFileUrl}
      />
    )
  }

  if (activity.type === "file-download") {
    if (files.length === 0) {
      return wrap(<p className="text-muted-foreground">No files added yet. Upload files to share with learners.</p>)
    }

    return wrap(
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Download the resources for this step.</p>
        <ul className="space-y-2">
          {files.map((file) => (
            <li
              key={file.path}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-medium">{file.name}</span>
                {file.size ? <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span> : null}
              </div>
              <Button size="sm" variant="secondary" onClick={() => onDownloadFile(file.name)}>
                Download
              </Button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (activity.type === "upload-file") {
    const instructions = getActivityTextValue(activity)
    const markup = getRichTextMarkup(instructions)

    return wrap(
      <div className="space-y-4">
        {markup ? (
          <div
            className="prose prose-lg max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        ) : (
          <p className="text-muted-foreground">Add instructions so pupils know what to submit.</p>
        )}

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Share any reference files pupils should download before uploading their work.
          </p>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files attached yet.</p>
          ) : (
            <ul className="space-y-2">
              {files.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{file.name}</span>
                    {file.size ? (
                      <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                    ) : null}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onDownloadFile(file.name)}>
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Pupils can upload their responses from the student lesson page. Their files are saved under each activity.
        </p>
      </div>
    )
  }

  if (activity.type === "show-video") {
    const url = getActivityFileUrlValue(activity)
    if (!url) {
      return wrap(<p className="text-muted-foreground">Add a video URL to present this activity.</p>)
    }

    const embedUrl = getVideoEmbedUrl(url)
    if (embedUrl) {
      return wrap(
        <div className="flex flex-col gap-3">
          <div className="aspect-video w-full overflow-hidden rounded-lg border">
            <iframe
              src={embedUrl}
              title={activity.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Source:{" "}
            <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
              {url}
            </a>
          </p>
        </div>
      )
    }

    return wrap(
      <div className="flex flex-col gap-3">
        <video src={url} controls className="w-full max-h-[480px] rounded-lg border" />
        <p className="text-sm text-muted-foreground">
          Having trouble playing the video? Open it in a new tab:{" "}
          <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
            {url}
          </a>
        </p>
      </div>
    )
  }

  if (activity.type === "voice") {
    const playback = voicePlayback ?? { url: null, isLoading: false }
    if (playback.isLoading) {
      return wrap(<p className="text-sm text-muted-foreground">Loading recording…</p>)
    }

    if (!playback.url) {
      return wrap(<p className="text-sm text-muted-foreground">No recording available yet.</p>)
    }

    const body = getVoiceBody(activity)

    return wrap(
      <div className="space-y-3">
        <audio controls src={playback.url} className="w-full" />
        {body.duration ? (
          <p className="text-xs text-muted-foreground">
            Duration: {body.duration.toFixed(1)} seconds
          </p>
        ) : null}
      </div>
    )
  }

  if (activity.type === "multiple-choice-question") {
    return wrap(
      <McqPresentView
        activity={activity}
        fetchActivityFileUrl={fetchActivityFileUrl}
        canReveal={viewerCanReveal}
      />
    )
  }

  return wrap(
    <div className="space-y-3">
      <p className="text-lg text-muted-foreground">
        This activity type is not yet supported in the presentation view.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Activity type: {activity.type}</li>
        <li>Update this view to add rich content for additional activity types.</li>
      </ul>
    </div>
  )
}

function ActivityEditView({ activity, resolvedImageUrl }: LessonActivityEditViewProps) {
  if (activity.type === "text") {
    const text = getActivityTextValue(activity)
    const markup = getRichTextMarkup(text)
    if (!markup) return null
    return (
      <div
        className="prose prose-sm max-w-none text-muted-foreground"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    )
  }

  if (activity.type === "upload-file") {
    const instructions = getActivityTextValue(activity)
    const markup = getRichTextMarkup(instructions)
    if (!markup) return null
    return (
      <div
        className="prose prose-sm max-w-none text-muted-foreground"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    )
  }

  if (activity.type === "show-video") {
    const url = getActivityFileUrlValue(activity)
    if (!url) return null
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center text-sm font-medium text-primary underline-offset-2 hover:underline break-all"
      >
        Watch video
      </a>
    )
  }

  if (activity.type === "multiple-choice-question") {
    const mcq = getMcqBody(activity)
    const questionMarkup = getRichTextMarkup(mcq.question)
    const fallbackQuestion = mcq.question.trim()

    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        {questionMarkup ? (
          <div
            className="prose prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: questionMarkup }}
          />
        ) : (
          <p className="font-medium text-foreground">
            {fallbackQuestion || "Multiple choice question"}
          </p>
        )}
        <ul className="space-y-1 pl-4">
          {mcq.options.map((option) => (
            <li
              key={option.id}
              className={cn(
                "list-disc",
                option.id === mcq.correctOptionId && "font-medium text-primary",
              )}
            >
              {option.text.trim() || "Untitled option"}
              {option.id === mcq.correctOptionId ? (
                <span className="ml-1 text-xs uppercase tracking-wide text-primary/80">
                  Correct
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (activity.type === "short-text-question") {
    const shortText = getShortTextBody(activity)
    const questionMarkup = getRichTextMarkup(shortText.question)
    const modelAnswer = shortText.modelAnswer?.trim()

    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Question</p>
          {questionMarkup ? (
            <div
              className="prose prose-sm max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: questionMarkup }}
            />
          ) : (
            <p className="text-foreground">Short text question</p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Model answer</p>
          <p className="mt-1 font-medium text-foreground">{modelAnswer || "Not provided"}</p>
        </div>
      </div>
    )
  }

  if (activity.type === "feedback") {
    const feedback = getFeedbackBody(activity)
    const entries = Object.entries(feedback.groups)

    if (entries.length === 0) {
      return <p className="text-sm text-muted-foreground">No groups configured yet.</p>
    }

    return (
      <div className="space-y-2 text-sm">
        {entries.map(([groupId, settings]) => (
          <div
            key={groupId}
            className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
          >
            <span className="font-medium text-foreground">{groupId}</span>
            <span className={cn("text-xs", settings.isEnabled ? "text-emerald-600" : "text-muted-foreground")}> 
              {settings.isEnabled ? `Enabled for group ${groupId}` : `Not enabled for group ${groupId}`}
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (activity.type === "display-image") {
    const body = getImageBody(activity)
    const url = resolvedImageUrl ?? body.imageUrl ?? null
    if (url) {
      return (
        <div className="mt-2 overflow-hidden rounded-md border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={activity.title || "Activity image"}
            className="h-auto w-full max-h-48 object-cover"
          />
        </div>
      )
    }
    if (body.imageFile) {
      const attemptedUrl = resolvedImageUrl ?? body.imageUrl ?? body.imageFile
      return <p className="break-all text-sm text-muted-foreground">{attemptedUrl}</p>
    }
    return <p className="text-sm text-muted-foreground">No image selected.</p>
  }

  if (activity.type === "voice") {
    const body = getVoiceBody(activity)
    if (body.audioFile) {
      return <p className="text-sm text-muted-foreground">Recording: {body.audioFile}</p>
    }
    return <p className="text-sm text-muted-foreground">No recording uploaded yet.</p>
  }

  return null
}

function FeedbackPresentView({ activity, lessonId }: { activity: LessonActivity; lessonId?: string }) {
  const feedbackBody = useMemo(() => getFeedbackBody(activity), [activity])
  const assignedEntries = useMemo(() => Object.entries(feedbackBody.groups), [feedbackBody])
  const assignedGroupIds = useMemo(
    () => assignedEntries.map(([groupId]) => groupId),
    [assignedEntries],
  )

  const [summaryState, setSummaryState] = useState<{
    summaries: LessonSubmissionSummary[]
    lessonAverage: number | null
  }>({ summaries: [], lessonAverage: null })
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [memberships, setMemberships] = useState<Array<{ groupId: string; role: string }>>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const candidateConfigs = useMemo(() => {
    const pupilGroups = memberships
      .filter((entry) => entry.role.trim().toLowerCase() === "pupil")
      .map((entry) => entry.groupId)
    const teacherGroups = memberships.map((entry) => entry.groupId)

    const baseGroupIds = pupilGroups.length > 0
      ? pupilGroups
      : teacherGroups.length > 0
        ? teacherGroups
        : assignedGroupIds

    const uniqueGroupIds = Array.from(new Set(baseGroupIds))

    if (uniqueGroupIds.length === 0) {
      return assignedEntries.map(([groupId, settings]) => ({
        groupId,
        settings,
      }))
    }

    return uniqueGroupIds.map((groupId) => ({
      groupId,
      settings: feedbackBody.groups[groupId] ?? FEEDBACK_GROUP_DEFAULTS,
    }))
  }, [assignedEntries, assignedGroupIds, feedbackBody.groups, memberships])

  const hasGroupConfiguration = candidateConfigs.length > 0
  const hasEnabledGroup = candidateConfigs.some((entry) => entry.settings.isEnabled)
  const showScores = candidateConfigs.some((entry) => entry.settings.showScore)
  const showCorrectAnswers = candidateConfigs.some((entry) => entry.settings.showCorrectAnswers)

  useEffect(() => {
    if (!lessonId) return
    return addFeedbackRefreshListener((targetLessonId) => {
      if (targetLessonId && targetLessonId !== lessonId) {
        return
      }
      setRefreshKey((previous) => previous + 1)
    })
  }, [lessonId])

  useEffect(() => {
    let cancelled = false

    supabaseBrowserClient.auth
      .getUser()
      .then(async ({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error("[feedback-present] Failed to load current user", error)
          setMemberships([])
          return
        }

        const userId = data.user?.id ?? null
        setCurrentUserId(userId)
        if (!userId) {
          setMemberships([])
          return
        }

        const { data: membershipRows, error: membershipError } = await supabaseBrowserClient
          .from("group_membership")
          .select("group_id, role")
          .eq("user_id", userId)

        if (cancelled) return

        if (membershipError) {
          console.error("[feedback-present] Failed to read memberships", membershipError)
          setMemberships([])
        } else {
          setMemberships(
            (membershipRows ?? []).map((row) => ({
              groupId: row.group_id,
              role: typeof row.role === "string" ? row.role : "",
            })),
          )
        }

      })
      .catch((error) => {
        if (!cancelled) {
          console.error("[feedback-present] Failed to resolve viewer membership", error)
          setMemberships([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!lessonId || !hasEnabledGroup) {
      setSummaryState({ summaries: [], lessonAverage: null })
      setSummaryError(lessonId ? null : "Lesson context not available.")
      setIsSummaryLoading(false)
      return
    }

    let cancelled = false
    setIsSummaryLoading(true)
    readLessonSubmissionSummariesAction(lessonId, { userId: currentUserId })
      .then((result) => {
        if (cancelled) return
        if (result.error) {
          setSummaryError(result.error)
          setSummaryState({ summaries: [], lessonAverage: null })
        } else {
          setSummaryError(null)
          setSummaryState({
            summaries: result.data ?? [],
            lessonAverage: result.lessonAverage ?? null,
          })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("[feedback-present] Failed to load submission summaries", error)
          setSummaryError("Unable to load submission summaries.")
          setSummaryState({ summaries: [], lessonAverage: null })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSummaryLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activity.activity_id, hasEnabledGroup, lessonId, currentUserId, refreshKey])

  const filteredSummaries = useMemo(() => {
    return summaryState.summaries.filter((summary) => summary.activityId !== activity.activity_id)
  }, [summaryState.summaries, activity.activity_id])

  if (!hasGroupConfiguration) {
    return <p className="text-sm text-muted-foreground">No groups configured yet.</p>
  }

  if (!hasEnabledGroup) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        {candidateConfigs.map((entry) => (
          <p key={entry.groupId}>Not enabled for group {entry.groupId}</p>
        ))}
      </div>
    )
  }

  if (!lessonId) {
    return <p className="text-sm text-muted-foreground">Lesson context not available.</p>
  }

  if (isSummaryLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading lesson results…
      </div>
    )
  }

  if (summaryError) {
    return <p className="text-sm text-destructive">{summaryError}</p>
  }

  if (!filteredSummaries || filteredSummaries.length === 0) {
    return (
      <div className="space-y-3">
        {showScores ? (
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Lesson average not available yet.
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">No submissions have been recorded yet.</p>
      </div>
    )
  }

  const lessonAverageDisplay =
    showScores && summaryState.lessonAverage !== null
      ? formatAverageScore(summaryState.lessonAverage, "lesson-average")
      : null

  return (
    <div className="space-y-4">
      {showScores ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary">
          Lesson average: {lessonAverageDisplay ?? "Not available yet"}
        </div>
      ) : null}
      {filteredSummaries.map((summary) => {
        const isMcq = summary.activityType === "multiple-choice-question"
        const numericScores = summary.scores.filter((entry) => typeof entry.score === "number") as Array<{
          userId: string
          score: number
          isCorrect?: boolean
        }>
        const correctCount = isMcq ? summary.correctCount ?? 0 : null
        const incorrectCount = isMcq && typeof correctCount === "number"
          ? summary.totalSubmissions - correctCount
          : null

        return (
          <div key={summary.activityId} className="rounded-md border border-border bg-card/60 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-medium text-foreground">{summary.activityTitle}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {formatActivityTypeLabel(summary.activityType)}
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>Total submissions: {summary.totalSubmissions}</p>
              {showScores ? (
                numericScores.length > 0 ? (
                  <div className="flex flex-wrap gap-4">
                    <span>Scores recorded: {numericScores.length}</span>
                    {isMcq && typeof correctCount === "number" ? (
                      <span>
                        Correct: {correctCount}
                        {typeof incorrectCount === "number" ? ` • Incorrect: ${incorrectCount}` : ""}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p>No numeric scores recorded yet.</p>
                )
              ) : (
                <p>Scores hidden for this group.</p>
              )}

              {showCorrectAnswers ? (
                summary.correctAnswer ? (
                  <p>
                    Correct answer: <span className="font-medium text-foreground">{summary.correctAnswer}</span>
                  </p>
                ) : (
                  <p>No correct answer available for this activity.</p>
                )
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DisplayImagePresent({
  activity,
  fetchActivityFileUrl,
}: {
  activity: LessonActivity
  fetchActivityFileUrl?: (activityId: string, fileName: string) => Promise<string | null>
}) {
  const [state, setState] = useState<{ url: string | null; loading: boolean; error: string | null }>({
    url: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    const body = getImageBody(activity)
    const record = (activity.body_data ?? {}) as Record<string, unknown>
    const rawFileUrl = typeof record.fileUrl === "string" ? record.fileUrl : null

    const directUrl =
      (body.imageUrl && isAbsoluteUrl(body.imageUrl) ? body.imageUrl : null) ||
      (rawFileUrl && isAbsoluteUrl(rawFileUrl) ? rawFileUrl : null)

    if (directUrl) {
      setState({ url: directUrl, loading: false, error: null })
      return
    }

    const candidateFile =
      body.imageFile && !isAbsoluteUrl(body.imageFile) ? body.imageFile : null
    const fallbackFile =
      !candidateFile && rawFileUrl && !isAbsoluteUrl(rawFileUrl) ? rawFileUrl : null
    const finalFileName = candidateFile ?? fallbackFile

    if (!finalFileName) {
      setState({ url: null, loading: false, error: null })
      return
    }

    if (!fetchActivityFileUrl) {
      setState({
        url: null,
        loading: false,
        error: "Unable to load image for this activity.",
      })
      return
    }

    setState({ url: null, loading: true, error: null })
    fetchActivityFileUrl(activity.activity_id, finalFileName)
      .then((url) => {
        if (cancelled) return
        if (url) {
          setState({ url, loading: false, error: null })
        } else {
          setState({ url: null, loading: false, error: "Unable to load image." })
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error("[lesson-presentation] Failed to fetch activity image:", error)
        setState({ url: null, loading: false, error: "Unable to load image." })
      })

    return () => {
      cancelled = true
    }
  }, [activity, fetchActivityFileUrl])

  const { url, loading, error } = state

  if (loading) {
    return (
      <div className="flex h-full min-h-[240px] w-full items-center justify-center text-sm text-muted-foreground">
        Loading image…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[240px] w-full items-center justify-center text-sm text-muted-foreground">
        {error}
      </div>
    )
  }

  if (!url) {
    return (
      <div className="flex h-full min-h-[240px] w-full items-center justify-center text-sm text-muted-foreground">
        No image available for this activity.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[240px] w-full items-center justify-center">
      <ActivityImagePreview
        imageUrl={url}
        alt={activity.title ? `${activity.title} image` : "Activity image"}
        objectFit="contain"
        className="flex max-h-[60vh] w-full max-w-3xl items-center justify-center bg-muted/10 p-4"
        imageClassName="max-h-[60vh]"
      />
    </div>
  )
}

function ShortTextPresentView({ activity, lessonId }: { activity: LessonActivity; lessonId?: string }) {
  const shortText = useMemo(() => getShortTextBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(shortText.question)
  const modelAnswer = shortText.modelAnswer?.trim() ?? ""

  const [submissions, setSubmissions] = useState<ShortTextSubmissionRow[]>([])
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isMarking, startMarkingTransition] = useTransition()
  const [overrideSaving, setOverrideSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    listShortTextSubmissionsAction(activity.activity_id)
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setError(result.error ?? "Unable to load submissions.")
          setSubmissions([])
          setOverrideDrafts({})
          return
        }

        setError(result.error ?? null)
        const rows = result.data ?? []
        setSubmissions(rows)
        const drafts: Record<string, string> = {}
        rows.forEach((row) => {
          drafts[row.submissionId] =
            row.teacherOverrideScore !== null && Number.isFinite(row.teacherOverrideScore)
              ? row.teacherOverrideScore.toFixed(2)
              : ""
        })
        setOverrideDrafts(drafts)
      })
      .catch((loadError) => {
        if (cancelled) return
        console.error("[short-text] Failed to load submissions in present view:", loadError)
        setError("Unable to load submissions right now.")
        setSubmissions([])
        setOverrideDrafts({})
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activity.activity_id, refreshKey])

  const totalSubmissions = submissions.length
  const markedCount = submissions.filter(
    (submission) =>
      submission.aiModelScore !== null || submission.teacherOverrideScore !== null,
  ).length
  const progressValue =
    totalSubmissions > 0 ? Math.round((markedCount / totalSubmissions) * 100) : 0

  const formatScore = (score: number | null) => {
    if (typeof score !== "number" || Number.isNaN(score)) {
      return "—"
    }
    return score.toFixed(2)
  }

  const formatSubmittedAt = (timestamp: string | null) => {
    if (!timestamp) return "Not yet submitted"
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) {
      return timestamp
    }
    return date.toLocaleString()
  }

  const resolveName = (row: ShortTextSubmissionRow) => {
    const first = row.profile?.firstName?.trim() ?? ""
    const last = row.profile?.lastName?.trim() ?? ""
    const combined = `${first} ${last}`.trim()
    return combined || row.userId
  }

  const handleMarkWork = () => {
    if (totalSubmissions === 0) {
      toast.error("There are no pupil answers to mark yet.")
      return
    }

    startMarkingTransition(() => {
      void (async () => {
        try {
          const result = await markShortTextActivityAction({
            activityId: activity.activity_id,
            lessonId,
          })

          if (!result.success) {
            toast.error("Unable to mark work", {
              description: result.error ?? "Please try again shortly.",
            })
          } else {
            const failedCount = result.failed.filter((entry) => entry.error).length
            if (failedCount > 0) {
              toast.warning("Marked with warnings", {
                description: `${result.updated} answers updated, ${failedCount} could not be processed.`,
              })
            } else {
              toast.success("All answers have been marked.")
            }
            setRefreshKey((previous) => previous + 1)
            triggerFeedbackRefresh(lessonId ?? null)
          }
        } catch (error) {
          console.error("[short-text] Failed to mark submissions:", error)
          toast.error("Unable to mark work", {
            description: error instanceof Error ? error.message : "Unexpected error occurred.",
          })
        }
      })()
    })
  }

  const handleOverrideChange = (submissionId: string, value: string) => {
    setOverrideDrafts((previous) => ({
      ...previous,
      [submissionId]: value,
    }))
  }

  const handleOverrideSave = async (submission: ShortTextSubmissionRow) => {
    const draft = (overrideDrafts[submission.submissionId] ?? "").trim()
    let overrideScore: number | null = null

    if (draft.length > 0) {
      const parsed = Number.parseFloat(draft)
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
        toast.error("Enter a score between 0 and 1.")
        return
      }
      overrideScore = Number.parseFloat(parsed.toFixed(3))
    }

    const currentOverride = submission.teacherOverrideScore
    const matchesCurrent =
      (overrideScore === null && currentOverride === null) ||
      (typeof overrideScore === "number" &&
        typeof currentOverride === "number" &&
        Math.abs(overrideScore - currentOverride) < 0.0005)

    if (matchesCurrent) {
      toast.info("Override already up to date.")
      return
    }

    setOverrideSaving(submission.submissionId)
    try {
      const result = await overrideShortTextSubmissionScoreAction({
        submissionId: submission.submissionId,
        activityId: activity.activity_id,
        lessonId,
        overrideScore,
      })

      if (!result.success) {
        toast.error("Unable to save override", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      toast.success(overrideScore === null ? "Override cleared." : "Override saved.")
      setRefreshKey((previous) => previous + 1)
      triggerFeedbackRefresh(lessonId ?? null)
    } catch (error) {
      console.error("[short-text] Failed to override score:", error)
      toast.error("Unable to save override", {
        description: error instanceof Error ? error.message : "Unexpected error occurred.",
      })
    } finally {
      setOverrideSaving(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Question</p>
        {questionMarkup ? (
          <div
            className="prose prose-lg max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: questionMarkup }}
          />
        ) : (
          <p className="text-base text-foreground">
            {shortText.question?.trim() || "Short text question"}
          </p>
        )}
        <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Model answer</p>
          <p className="text-sm font-medium text-foreground">
            {modelAnswer || "Add a model answer so the AI can mark responses accurately."}
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-border bg-muted/10 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Pupil responses</h3>
            <p className="text-xs text-muted-foreground">
              Marking runs the AI scorer across every saved answer. Overrides take priority.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleMarkWork}
              disabled={isMarking || totalSubmissions === 0}
            >
              {isMarking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Mark work
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Progress value={progressValue} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {markedCount} of {totalSubmissions} answers marked
          </p>
        </div>
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading pupil answers…
          </div>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pupils have submitted an answer yet.</p>
        ) : (
          <div className="space-y-3">
            {submissions.map((submission) => {
              const draftValue = overrideDrafts[submission.submissionId] ?? ""
              const trimmedDraft = draftValue.trim()
              const currentOverride = submission.teacherOverrideScore
              const matchesCurrent =
                (trimmedDraft.length === 0 && currentOverride === null) ||
                (trimmedDraft.length > 0 &&
                  currentOverride !== null &&
                  Math.abs(Number.parseFloat(trimmedDraft) - currentOverride) < 0.0005)
              const finalScore =
                submission.teacherOverrideScore ?? submission.aiModelScore ?? null
              const hasAiScore = submission.aiModelScore !== null
              const awaitingMark = !hasAiScore && submission.teacherOverrideScore === null

              return (
                <div
                  key={submission.submissionId}
                  className={cn(
                    "space-y-3 rounded-md border border-border bg-background p-4",
                    submission.isCorrect && "border-emerald-500/60 bg-emerald-500/5",
                  )}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {resolveName(submission)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Saved {formatSubmittedAt(submission.submittedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-muted px-2 py-1 font-medium text-foreground">
                        Final score: {formatScore(finalScore)}
                      </span>
                      {submission.teacherOverrideScore !== null ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-1 font-medium text-amber-600">
                          Teacher override
                        </span>
                      ) : null}
                      {hasAiScore ? (
                        <span className="rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
                          AI score {formatScore(submission.aiModelScore)}
                        </span>
                      ) : null}
                      {submission.isCorrect ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-600">
                          Marked correct
                        </span>
                      ) : awaitingMark ? (
                        <span className="rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground">
                          Awaiting marking
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground">
                          Needs review
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Pupil answer</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {submission.answer?.trim().length ? submission.answer.trim() : "No answer provided."}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="1"
                      step="0.05"
                      value={draftValue}
                      onChange={(event) =>
                        handleOverrideChange(submission.submissionId, event.target.value)
                      }
                      placeholder="Override score (0-1)"
                      className="sm:max-w-[160px]"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        Leave blank to clear the override. Scores are between 0 and 1.
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleOverrideSave(submission)}
                      disabled={overrideSaving === submission.submissionId || matchesCurrent}
                    >
                      {overrideSaving === submission.submissionId ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : null}
                      {trimmedDraft.length === 0 ? "Clear override" : "Apply override"}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function formatAverageScore(value: number | null, type: string): string {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  if (type === "multiple-choice-question") {
    return `${Math.round(value * 100)}%`
  }

  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

function formatActivityTypeLabel(type: string): string {
  if (!type) return "Activity"
  return type
    .split("-")
    .map((segment) => (segment ? segment[0]?.toUpperCase() + segment.slice(1) : ""))
    .join(" ")
}

function formatFileSize(size: number): string {
  if (size <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const value = size / Math.pow(1024, exponent)
  return `${value.toFixed(value < 10 && exponent > 0 ? 1 : 0)} ${units[exponent]}`
}

function getVideoEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, "")

    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = parsed.searchParams.get("v")
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`
      }
    }

    if (host === "youtu.be") {
      const videoId = parsed.pathname.slice(1)
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`
      }
    }

    if (host === "vimeo.com") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0]
      if (videoId) {
        return `https://player.vimeo.com/video/${videoId}`
      }
    }
  } catch (error) {
    console.error("[lesson-activity-view] Failed to compute embed url:", error)
  }

  return null
}
