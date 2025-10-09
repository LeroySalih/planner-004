"use client"

import { useEffect, useMemo, useState } from "react"
import type { LessonActivity } from "@/types"
import { ActivityImagePreview } from "@/components/lessons/activity-image-preview"
import { Button } from "@/components/ui/button"
import {
  getActivityFileUrlValue,
  getActivityTextValue,
  getImageBody,
  getVoiceBody,
  isAbsoluteUrl,
} from "@/components/lessons/activity-view/utils"
import { getActivityFileDownloadUrlAction } from "@/lib/server-updates"

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

export interface LessonActivityShortViewProps extends LessonActivityViewBaseProps {
  mode: "short"
  resolvedImageUrl?: string | null
  showImageBorder?: boolean
}

export interface LessonActivityPresentViewProps extends LessonActivityViewBaseProps {
  mode: "present"
  files: LessonActivityFile[]
  onDownloadFile: (fileName: string) => void
  voicePlayback?: { url: string | null; isLoading: boolean }
  fetchActivityFileUrl?: (activityId: string, fileName: string) => Promise<string | null>
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

function ActivityShortView({
  activity,
  lessonId,
  resolvedImageUrl,
  showImageBorder = true,
}: LessonActivityShortViewProps) {


  if (activity.type === "text") {
    const text = getActivityTextValue(activity)
    if (!text.trim()) return null
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{text}</p>
  }

  if (activity.type === "upload-file") {
    const text = getActivityTextValue(activity)
    if (!text.trim()) return null
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{text}</p>
  }

  if (activity.type === "show-video") {
    const url = getActivityFileUrlValue(activity)
    if (!url) return null
    return (
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
        className="inline-flex cursor-pointer items-center text-sm font-medium text-primary underline-offset-2 hover:underline break-all"
      >
        Watch video
      </span>
    )
  }

  if (activity.type === "display-image") {
    return (
      <DisplayImageShortView
        activity={activity}
        lessonId={lessonId ?? null}
        resolvedImageUrl={resolvedImageUrl ?? null}
        showImageBorder={showImageBorder}
      />
    )
  }

  if (activity.type === "voice") {
    const body = getVoiceBody(activity)
    if (body.audioFile) {
      return <p className="text-sm text-muted-foreground">Voice recording attached.</p>
    }
    return <p className="text-sm text-muted-foreground">No recording uploaded yet.</p>
  }

  return null
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

function ActivityPresentView({
  activity,
  files,
  onDownloadFile,
  voicePlayback,
  fetchActivityFileUrl,
}: LessonActivityPresentViewProps) {
  if (activity.type === "text") {
    const text = getActivityTextValue(activity)
    if (text.trim().length === 0) {
      return <p className="text-muted-foreground">No text content provided for this activity.</p>
    }
    return <p className="whitespace-pre-wrap text-lg leading-relaxed">{text}</p>
  }

  if (activity.type === "display-image") {
    return (
      <DisplayImagePresent
        activity={activity}
        fetchActivityFileUrl={fetchActivityFileUrl}
      />
    )
  }

  if (activity.type === "file-download") {
    if (files.length === 0) {
      return <p className="text-muted-foreground">No files added yet. Upload files to share with learners.</p>
    }

    return (
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

    return (
      <div className="space-y-4">
        {instructions.trim().length > 0 ? (
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-foreground">{instructions}</p>
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
      return <p className="text-muted-foreground">Add a video URL to present this activity.</p>
    }

    const embedUrl = getVideoEmbedUrl(url)
    if (embedUrl) {
      return (
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

    return (
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
      return <p className="text-sm text-muted-foreground">Loading recording…</p>
    }

    if (!playback.url) {
      return <p className="text-sm text-muted-foreground">No recording available yet.</p>
    }

    const body = getVoiceBody(activity)

    return (
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

  return (
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
    if (!text.trim()) return null
    return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{text}</p>
  }

  if (activity.type === "upload-file") {
    const instructions = getActivityTextValue(activity)
    if (!instructions.trim()) return null
    return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{instructions}</p>
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
      return <p className="text-sm text-muted-foreground">Image file: {body.imageFile}</p>
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
