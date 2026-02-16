"use client"

import { useState } from "react"
import type { JSX } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, Music2, PlaySquare, TestTube, Download } from "lucide-react"

import type { LessonActivity } from "@/types"
import { cn } from "@/lib/utils"

type LessonPanelProps = {
  lesson: {
    lesson_id: string
    title: string
    unit_id: string
    order_by: number | null
    active: boolean | null
  }
  activities: LessonActivity[]
  activitiesError?: string | null
}

type ParsedActivity = {
  id: string
  title: string
  typeLabel: string
  type: string | null | undefined
  linkUrl: string | null
  audioUrl: string | null
  icon: JSX.Element | null
}

export function LessonDetailsPanel({ lesson, activities, activitiesError }: LessonPanelProps) {
  const [open, setOpen] = useState(true)
  const panelId = `lesson-details-${lesson.lesson_id}`

  const parsedActivities: ParsedActivity[] = activities.map((activity) => {
    const linkInfo = extractLink(activity)
    const audioUrl = extractAudioUrl(activity)
    const icon = selectIcon(activity.type, audioUrl, linkInfo?.url ?? null)

    return {
      id: activity.activity_id,
      title: activity.title || formatActivityType(activity.type),
      type: activity.type,
      typeLabel: activity.title ? formatActivityType(activity.type) : "",
      linkUrl: linkInfo?.url ?? null,
      audioUrl,
      icon,
    }
  })

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium text-foreground transition hover:bg-muted/60"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Link href={`/lessons/${encodeURIComponent(lesson.lesson_id)}`} className="hover:underline">
            {lesson.title}
          </Link>
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
            lesson.active ?? true
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {(lesson.active ?? true) ? "Active" : "Inactive"}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="border-t border-border px-5 py-4 text-sm">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lesson Activities</h3>
            {activitiesError ? (
              <p className="mt-3 text-sm text-destructive">
                Unable to load activities: {activitiesError}
              </p>
            ) : parsedActivities.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No activities linked to this lesson.</p>
            ) : (
              <ol className="mt-3 space-y-3 text-sm">
                {parsedActivities.map((activity, index) => (
                  <li
                    key={activity.id}
                    className="rounded-md border border-border/60 bg-muted/40 px-3 py-3"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">{index + 1}.</span>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {activity.icon}
                          {activity.linkUrl ? (
                            <Link
                              href={activity.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {activity.title}
                            </Link>
                          ) : (
                            <span className="font-medium text-foreground">{activity.title}</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{activity.typeLabel}</span>
                        {activity.linkUrl ? (
                          <span className="break-all text-xs text-muted-foreground">{activity.linkUrl}</span>
                        ) : null}
                      </div>
                    </div>

                    {activity.audioUrl && activity.type !== "show-video" ? (
                      <audio
                        className="mt-3 w-full"
                        controls
                        preload="none"
                        src={activity.audioUrl}
                      >
                        Your browser does not support the audio element.
                      </audio>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatActivityType(type: string | null | undefined): string {
  if (!type) return ""
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function selectIcon(type: string | null | undefined, audioUrl: string | null, linkUrl: string | null): JSX.Element | null {
  if (!type) {
    if (audioUrl) return <Music2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    return null
  }

  const normalized = type.toLowerCase()

  if (normalized.includes("test")) {
    return <TestTube className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("download") || normalized.includes("file")) {
    return <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("audio") || normalized.includes("voice") || audioUrl) {
    return <Music2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("video") || (linkUrl && isYouTubeUrl(linkUrl))) {
    return <PlaySquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }

  return null
}

function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be")
  } catch {
    return false
  }
}

function extractLink(activity: LessonActivity): { url: string; label: string } | null {
  const { body_data: bodyData } = activity
  if (typeof bodyData !== "object" || bodyData === null) {
    return null
  }
  const record = bodyData as Record<string, unknown>
  const directUrlKeys = ["url", "fileUrl", "href", "link", "videoUrl"]

  for (const key of directUrlKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return { url: value.trim(), label: activity.title }
    }
  }

  const nestedLink = record.link
  if (typeof nestedLink === "object" && nestedLink !== null) {
    const nestedUrl = (nestedLink as Record<string, unknown>).url
    if (typeof nestedUrl === "string" && nestedUrl.trim().length > 0) {
      return { url: nestedUrl.trim(), label: activity.title }
    }
  }

  return null
}

function extractAudioUrl(activity: LessonActivity): string | null {
  const { body_data: bodyData } = activity
  if (typeof bodyData !== "object" || bodyData === null) {
    return null
  }

  const record = bodyData as Record<string, unknown>

  const audioKeys = ["audioFile", "audioUrl", "voice", "fileUrl"]
  for (const key of audioKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  const nestedVoice = record.voice
  if (typeof nestedVoice === "object" && nestedVoice !== null) {
    const nestedUrl = (nestedVoice as Record<string, unknown>).audioFile ?? (nestedVoice as Record<string, unknown>).url
    if (typeof nestedUrl === "string" && nestedUrl.trim().length > 0) {
      return nestedUrl.trim()
    }
  }

  return null
}
