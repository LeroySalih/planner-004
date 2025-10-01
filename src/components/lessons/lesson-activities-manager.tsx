"use client"

import type { DragEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, GripVertical, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react"

import type { LessonActivity } from "@/types"
import {
  createLessonActivityAction,
  deleteActivityFileAction,
  deleteLessonActivityAction,
  getActivityFileDownloadUrlAction,
  listActivityFilesAction,
  reorderLessonActivitiesAction,
  updateLessonActivityAction,
  uploadActivityFileAction,
} from "@/lib/server-updates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

interface VoiceBody {
  audioFile: string | null
  mimeType?: string | null
  duration?: number | null
  size?: number | null
  [key: string]: unknown
}

const ACTIVITY_TYPES = [
  { value: "text", label: "Text" },
  { value: "file-download", label: "File download" },
  { value: "display-image", label: "Display image" },
  { value: "show-video", label: "Show video" },
  { value: "file-upload-question", label: "File upload question" },
  { value: "multiple-choice-question", label: "Multiple choice question" },
  { value: "text-question", label: "Text question" },
  { value: "voice", label: "Voice recording" },
] as const

type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number]["value"]

interface LessonActivitiesManagerProps {
  unitId: string
  lessonId: string
  initialActivities: LessonActivity[]
}

export function LessonActivitiesManager({ unitId, lessonId, initialActivities }: LessonActivitiesManagerProps) {
  const router = useRouter()
  const [activities, setActivities] = useState<LessonActivity[]>(() => sortActivities(initialActivities))
  const [isPending, startTransition] = useTransition()

  const [newTitle, setNewTitle] = useState("")
  const [newType, setNewType] = useState<ActivityTypeValue>("text")
  const [newText, setNewText] = useState("")
  const [newVideoUrl, setNewVideoUrl] = useState("")

  const [editorActivityId, setEditorActivityId] = useState<string | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const pendingReorderRef = useRef<{ next: LessonActivity[]; previous: LessonActivity[] } | null>(null)
  const [voicePreviewState, setVoicePreviewState] = useState<
    Record<string, { url: string | null; loading: boolean }>
  >({})
  const [fileDownloadState, setFileDownloadState] = useState<Record<string, { loading: boolean }>>({})
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    setActivities(sortActivities(initialActivities))
  }, [initialActivities])

  useEffect(() => {
    if (newType === "text") {
      setNewVideoUrl("")
      return
    }
    if (newType === "show-video") {
      setNewText("")
      return
    }
    setNewText("")
    setNewVideoUrl("")
  }, [newType])

  const typeLabelMap = useMemo(() => {
    return ACTIVITY_TYPES.reduce<Record<string, string>>((acc, type) => {
      acc[type.value] = type.label
      return acc
    }, {})
  }, [])

  const resetNewForm = () => {
    setNewTitle("")
    setNewText("")
    setNewVideoUrl("")
    setNewType("text")
  }

  const handleAddActivity = () => {
    const title = newTitle.trim()
    if (!title) {
      toast.error("Activity title is required")
      return
    }

    const bodyData = buildBodyData(newType, {
      text: newText,
      videoUrl: newVideoUrl,
    })

    startTransition(async () => {
      const result = await createLessonActivityAction(unitId, lessonId, {
        title,
        type: newType,
        bodyData,
      })

      if (!result.success || !result.data) {
        toast.error("Unable to add activity", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setActivities((prev) => sortActivities([...prev, result.data!]))
      resetNewForm()
      toast.success("Activity added")
      router.refresh()
    })
  }

const handleDeleteActivity = (activityId: string) => {
  startTransition(async () => {
    const result = await deleteLessonActivityAction(unitId, lessonId, activityId)
    if (!result.success) {
      toast.error("Unable to delete activity", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setActivities((prev) => prev.filter((activity) => activity.activity_id !== activityId))
      toast.success("Activity deleted")
      router.refresh()
    })
  }

  const handleVoicePreview = async (activity: LessonActivity) => {
    const body = getVoiceBody(activity)
    if (!body.audioFile) {
      toast.error("No recording available")
      return
    }

    const activityId = activity.activity_id
    const existing = voicePreviewState[activityId]

    setVoicePreviewState((prev) => ({
      ...prev,
      [activityId]: { url: existing?.url ?? null, loading: true },
    }))

    const playUrl = async (url: string) => {
      try {
        if (voiceAudioRef.current) {
          voiceAudioRef.current.pause()
          voiceAudioRef.current.currentTime = 0
        }
      } catch (error) {
        console.warn("[activities] Failed to reset previous audio", error)
      }

      const audio = new Audio(url)
      voiceAudioRef.current = audio
      await audio.play()
    }

    try {
      if (existing?.url) {
        await playUrl(existing.url)
        setVoicePreviewState((prev) => ({
          ...prev,
          [activityId]: { url: existing.url, loading: false },
        }))
        return
      }

      const result = await getActivityFileDownloadUrlAction(lessonId, activityId, body.audioFile)
      if (!result.success || !result.url) {
        throw new Error(result.error ?? "Unable to load recording")
      }

      await playUrl(result.url)
      setVoicePreviewState((prev) => ({
        ...prev,
        [activityId]: { url: result.url, loading: false },
      }))
    } catch (error) {
      console.error("[activities] Failed to play voice recording:", error)
      setVoicePreviewState((prev) => ({
        ...prev,
        [activityId]: { url: prev[activityId]?.url ?? null, loading: false },
      }))
      toast.error("Unable to play recording", {
        description: error instanceof Error ? error.message : "Please try again later.",
      })
    }
  }

  const handleFileDownload = async (activity: LessonActivity) => {
    const activityId = activity.activity_id
    setFileDownloadState((prev) => ({ ...prev, [activityId]: { loading: true } }))

    try {
      const filesResult = await listActivityFilesAction(lessonId, activityId)
      if (filesResult.error) {
        toast.error("Unable to list files", {
          description: filesResult.error,
        })
        return
      }

      const files = filesResult.data ?? []
      if (files.length === 0) {
        toast.error("No files uploaded yet")
        return
      }

      const fileName = files[0].name
      const downloadResult = await getActivityFileDownloadUrlAction(lessonId, activityId, fileName)
      if (!downloadResult.success || !downloadResult.url) {
        toast.error("Unable to download file", {
          description: downloadResult.error ?? "Please try again later.",
        })
        return
      }

      const link = document.createElement("a")
      link.href = downloadResult.url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      link.click()
    } catch (error) {
      console.error("[activities] Failed to download activity file:", error)
      toast.error("Unable to download file", {
        description: error instanceof Error ? error.message : "Please try again later.",
      })
    } finally {
      setFileDownloadState((prev) => ({ ...prev, [activityId]: { loading: false } }))
    }
  }

  const openEditor = (activityId: string) => {
    setEditorActivityId(activityId)
    setIsEditorOpen(true)
  }

  const closeEditor = () => {
    setIsEditorOpen(false)
    setEditorActivityId(null)
  }

  const editingActivity = editorActivityId
    ? activities.find((activity) => activity.activity_id === editorActivityId) ?? null
    : null

  useEffect(() => {
    if (isEditorOpen && editorActivityId && !editingActivity) {
      closeEditor()
    }
  }, [editorActivityId, editingActivity, isEditorOpen])

  useEffect(() => {
    return () => {
      if (voiceAudioRef.current) {
        try {
          voiceAudioRef.current.pause()
        } catch (error) {
          console.warn("[activities] Failed to pause voice preview on unmount", error)
        }
      }
      voiceAudioRef.current = null
    }
  }, [])

  const handleEditorSubmit = ({
    activityId,
    title,
    type,
    bodyData,
  }: {
    activityId: string
    title: string
    type: ActivityTypeValue
    bodyData: unknown
  }) => {
    startTransition(async () => {
      const result = await updateLessonActivityAction(unitId, lessonId, activityId, {
        title,
        type,
        bodyData,
      })

      if (!result.success || !result.data) {
        toast.error("Unable to update activity", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setActivities((prev) =>
        sortActivities(prev.map((item) => (item.activity_id === activityId ? result.data! : item))),
      )
      toast.success("Activity updated")
      closeEditor()
      router.refresh()
    })
  }
  const submitReorder = useCallback(
    (nextActivities: LessonActivity[], previousActivities?: LessonActivity[]) => {
      startTransition(async () => {
        const payload = nextActivities.map((activity, index) => ({
          activityId: activity.activity_id,
          orderBy: index,
        }))

        const result = await reorderLessonActivitiesAction(unitId, lessonId, payload)
        if (!result.success) {
          if (previousActivities) {
            setActivities(previousActivities)
          }
          toast.error("Unable to reorder activities", {
            description: result.error ?? "Please try again later.",
          })
          return
        }
        router.refresh()
      })
    },
    [lessonId, router, startTransition, unitId],
  )

  const isBusy = isPending

  const handleDragStart = (activityId: string) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", activityId)
    setDraggingId(activityId)
    setDragOverId(activityId)
  }

  const handleDragOver = (targetId: string | null) => (event: DragEvent<HTMLLIElement | HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDragOverId(targetId)
  }

  const handleDragLeave = (targetId: string | null) => () => {
    setDragOverId((current) => (current === targetId ? null : current))
  }

  const END_DROP_ID = "__end__"

  const handleDrop = (targetId: string | null) => (event: DragEvent<HTMLLIElement | HTMLDivElement>) => {
    event.preventDefault()
    const draggedFromData = event.dataTransfer.getData("text/plain")
    const draggedId = draggedFromData || draggingId
    setDraggingId(null)
    setDragOverId(null)
    if (!draggedId) {
      return
    }

    const normalizedTarget = targetId === END_DROP_ID ? null : targetId

    setActivities((prev) => {
      const orderedPrev = applyOrderToActivities(prev)
      const reordered = reorderActivities(orderedPrev, draggedId, normalizedTarget)
      if (!reordered) {
        pendingReorderRef.current = null
        return prev
      }
      pendingReorderRef.current = { previous: orderedPrev, next: reordered }
      return reordered
    })
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    setDragOverId(null)
  }

  useEffect(() => {
    const pending = pendingReorderRef.current
    if (!pending) {
      return
    }

    pendingReorderRef.current = null
    submitReorder(pending.next, pending.previous)
  }, [activities, submitReorder])

  return (
    <>
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Add Activity</h3>
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="new-activity-title">Title</Label>
            <Input
              id="new-activity-title"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Warm-up discussion"
              disabled={isBusy}
            />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="new-activity-type">Type</Label>
            <Select
              value={newType}
              onValueChange={(value: ActivityTypeValue) => setNewType(value)}
              disabled={isBusy}
            >
              <SelectTrigger id="new-activity-type">
                <SelectValue placeholder="Select activity type" />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {newType === "text" ? (
          <div className="space-y-2">
            <Label htmlFor="new-activity-text">Instructions</Label>
            <Textarea
              id="new-activity-text"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              placeholder="Enter the activity instructions"
              disabled={isBusy}
              rows={4}
            />
          </div>
        ) : null}
        {newType === "show-video" ? (
          <div className="space-y-2">
            <Label htmlFor="new-activity-video-url">Video URL</Label>
            <Input
              id="new-activity-video-url"
              value={newVideoUrl}
              onChange={(event) => setNewVideoUrl(event.target.value)}
              placeholder="https://..."
              disabled={isBusy}
            />
          </div>
        ) : null}
        <Button onClick={handleAddActivity} disabled={isBusy || newTitle.trim().length === 0} className="sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> Add Activity
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Scheduled Activities</h3>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activities have been added yet.</p>
        ) : (
          <ul className="space-y-3">
            {activities.map((activity) => {
              const label = typeLabelMap[activity.type] ?? activity.type
              const isDragging = draggingId === activity.activity_id
              const isDragOver = dragOverId === activity.activity_id
              const videoUrl = activity.type === "show-video" ? extractVideoUrl(activity) : ""
              const videoThumbnail =
                activity.type === "show-video" ? getYouTubeThumbnailUrl(videoUrl) : null
              const isVoice = activity.type === "voice"
              const voiceBody = isVoice ? getVoiceBody(activity) : null
              const voiceStatus = voicePreviewState[activity.activity_id]
              const isFileDownload = activity.type === "file-download"
              const fileStatus = fileDownloadState[activity.activity_id]
              return (
                <li
                  key={activity.activity_id}
                  onDragOver={handleDragOver(activity.activity_id)}
                  onDragEnter={handleDragOver(activity.activity_id)}
                  onDragLeave={handleDragLeave(activity.activity_id)}
                  onDrop={handleDrop(activity.activity_id)}
                  className={[
                    "rounded-md border border-border bg-card p-4 transition",
                    isDragging ? "opacity-70" : "",
                    isDragOver ? "border-primary bg-primary/5" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        aria-label="Drag to reorder activity"
                        className="mt-1 cursor-grab text-muted-foreground transition hover:text-foreground"
                        draggable
                        onDragStart={handleDragStart(activity.activity_id)}
                        onDragEnd={handleDragEnd}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <div className="flex flex-1 flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-1 items-start gap-3">
                          {isVoice ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-[60px] w-[100px] shrink-0 flex-col gap-1"
                              disabled={voiceStatus?.loading || !voiceBody?.audioFile}
                              onClick={() => handleVoicePreview(activity)}
                            >
                              {voiceStatus?.loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                          <span className="text-xs">Play</span>
                        </Button>
                      ) : null}
                          {isFileDownload ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-[60px] w-[100px] shrink-0 flex-col gap-1"
                              disabled={fileStatus?.loading}
                              onClick={() => handleFileDownload(activity)}
                            >
                              {fileStatus?.loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                              <span className="text-xs">Download</span>
                            </Button>
                          ) : null}
                          {videoThumbnail ? (
                            <a
                              href={videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={videoThumbnail}
                                alt="YouTube video thumbnail"
                                className="h-auto w-[100px] rounded-md border border-border object-cover"
                                loading="lazy"
                              />
                            </a>
                          ) : null}
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{activity.title}</p>
                            <Badge variant="secondary" className="capitalize">
                              {label}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditor(activity.activity_id)}
                            disabled={isBusy}
                            aria-label="Edit activity"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteActivity(activity.activity_id)}
                            disabled={isBusy}
                            aria-label="Delete activity"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    {renderActivityPreview(activity)}
                  </div>
                </li>
              )
            })}
            {draggingId ? (
              <li
                key="activity-dropzone-end"
                onDragOver={handleDragOver(END_DROP_ID)}
                onDragEnter={handleDragOver(END_DROP_ID)}
                onDragLeave={handleDragLeave(END_DROP_ID)}
                onDrop={handleDrop(END_DROP_ID)}
                className={[
                  "h-12 rounded-md border-2 border-dashed border-border transition",
                  dragOverId === END_DROP_ID ? "border-primary bg-primary/5" : "border-transparent",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Drop here to move to the end
                </div>
              </li>
            ) : null}
          </ul>
        )}
      </section>
      </div>
      <LessonActivityEditorSheet
        activity={editingActivity}
        open={isEditorOpen}
        onClose={closeEditor}
        isPending={isPending}
        onSubmit={handleEditorSubmit}
        unitId={unitId}
        lessonId={lessonId}
      />
    </>
  )
}

function sortActivities(activities: LessonActivity[]): LessonActivity[] {
  const list = [...activities]
  return list.sort((a, b) => {
    const aOrder = typeof a.order_by === "number" ? a.order_by : Number.MAX_SAFE_INTEGER
    const bOrder = typeof b.order_by === "number" ? b.order_by : Number.MAX_SAFE_INTEGER
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }
    return a.title.localeCompare(b.title)
  })
}

function applyOrderToActivities(activities: LessonActivity[]): LessonActivity[] {
  return activities.map((activity, index) => ({ ...activity, order_by: index }))
}

function reorderActivities(
  orderedActivities: LessonActivity[],
  draggedId: string,
  targetId: string | null,
): LessonActivity[] | null {
  const currentIndex = orderedActivities.findIndex((activity) => activity.activity_id === draggedId)
  if (currentIndex === -1) {
    return null
  }

  const working = [...orderedActivities]
  const [moved] = working.splice(currentIndex, 1)

  if (targetId === null) {
    if (currentIndex === orderedActivities.length - 1) {
      return null
    }
    working.push(moved)
    return applyOrderToActivities(working)
  }

  const targetIndexInOriginal = orderedActivities.findIndex((activity) => activity.activity_id === targetId)
  if (targetIndexInOriginal === -1) {
    return null
  }

  let insertIndex = targetIndexInOriginal
  if (targetIndexInOriginal > currentIndex) {
    insertIndex = targetIndexInOriginal - 1
  }

  if (insertIndex === currentIndex) {
    return null
  }

  working.splice(insertIndex, 0, moved)
  return applyOrderToActivities(working)
}

function extractText(activity: LessonActivity): string {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return ""
  }
  const value = (activity.body_data as Record<string, unknown>).text
  return typeof value === "string" ? value : ""
}

function extractVideoUrl(activity: LessonActivity): string {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return ""
  }
  const value = (activity.body_data as Record<string, unknown>).fileUrl
  return typeof value === "string" ? value : ""
}

function buildBodyData(
  type: ActivityTypeValue,
  options: { text?: string; videoUrl?: string; fallback?: unknown },
): unknown {
  const { text = "", videoUrl = "", fallback = null } = options
  if (type === "text") {
    return { text }
  }
  if (type === "show-video") {
    return { fileUrl: videoUrl }
  }
  if (type === "voice") {
    if (fallback && typeof fallback === "object") {
      return fallback
    }
    return { audioFile: null }
  }
  return fallback ?? null
}

function renderActivityPreview(activity: LessonActivity) {
  if (activity.type === "text") {
    const text = extractText(activity)
    if (!text) return null
    return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{text}</p>
  }

  if (activity.type === "show-video") {
    const url = extractVideoUrl(activity)
    if (!url) return null
    const thumbnail = getYouTubeThumbnailUrl(url)
    if (thumbnail) {
      return null
    }
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

  return null
}

interface LessonActivityEditorSheetProps {
  activity: LessonActivity | null
  open: boolean
  onClose: () => void
  isPending: boolean
  onSubmit: (updates: { activityId: string; title: string; type: ActivityTypeValue; bodyData: unknown }) => void
  unitId: string
  lessonId: string
}

function getVoiceBody(activity: LessonActivity): VoiceBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { audioFile: null }
  }

  const body = activity.body_data as Record<string, unknown>
  const audioFile = typeof body.audioFile === "string" ? body.audioFile : null
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : null
  const duration = typeof body.duration === "number" ? body.duration : null
  const size = typeof body.size === "number" ? body.size : null

  return {
    ...body,
    audioFile,
    mimeType,
    duration,
    size,
  }
}

function LessonActivityEditorSheet({
  activity,
  open,
  onClose,
  isPending,
  onSubmit,
  unitId,
  lessonId,
}: LessonActivityEditorSheetProps) {
  const [title, setTitle] = useState("")
  const [type, setType] = useState<ActivityTypeValue>("text")
  const [text, setText] = useState("")
  const [videoUrl, setVideoUrl] = useState("")
  const [rawBody, setRawBody] = useState("")
  const [rawBodyError, setRawBodyError] = useState<string | null>(null)
  const [voiceBody, setVoiceBody] = useState<VoiceBody | null>(null)
  const [pendingRecording, setPendingRecording] = useState<{ file: File; durationMs: number | null } | null>(null)
  const [shouldDeleteExistingRecording, setShouldDeleteExistingRecording] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const originalVoiceBodyRef = useRef<VoiceBody | null>(null)
  const pendingObjectUrlRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    if (open && activity) {
      const ensuredType = ensureActivityType(activity.type)
      setTitle(activity.title)
      setType(ensuredType)
      setText(extractText(activity))
      setVideoUrl(extractVideoUrl(activity))
      setRawBody(activity.body_data ? JSON.stringify(activity.body_data, null, 2) : "")
      setRawBodyError(null)
      const voice = getVoiceBody(activity)
      setVoiceBody(voice)
      originalVoiceBodyRef.current = voice
      setShouldDeleteExistingRecording(false)
      setPendingRecording(null)
      setPlaybackUrl(null)
      setRecordingError(null)
      if (ensuredType === "voice") {
        if (voice.audioFile) {
          setIsPlaybackLoading(true)
        } else {
          setIsPlaybackLoading(false)
        }
      } else {
        setIsPlaybackLoading(false)
      }
    }

    if (!open) {
      cleanupRecordingResources()
      if (pendingObjectUrlRef.current) {
        URL.revokeObjectURL(pendingObjectUrlRef.current)
        pendingObjectUrlRef.current = null
      }
      setTitle("")
      setType("text")
      setText("")
      setVideoUrl("")
      setRawBody("")
      setRawBodyError(null)
      setVoiceBody(null)
      originalVoiceBodyRef.current = null
      setPendingRecording(null)
      setShouldDeleteExistingRecording(false)
      setPlaybackUrl(null)
      setRecordingError(null)
      setIsPlaybackLoading(false)
      setIsProcessing(false)
    }
  }, [activity, open])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose()
    }
  }

  const cleanupRecordingResources = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop()
      }
    } catch (error) {
      console.warn("[activities] Failed to stop recorder during cleanup", error)
    }
    mediaRecorderRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    chunksRef.current = []
    startTimeRef.current = null
    setIsRecording(false)
  }

  const loadPlaybackForFile = useCallback(
    async (fileName: string | null) => {
      if (!activity) {
        setPlaybackUrl(null)
        return
      }

      if (!fileName) {
        setPlaybackUrl(null)
        setIsPlaybackLoading(false)
        return
      }

      setIsPlaybackLoading(true)
      try {
        const result = await getActivityFileDownloadUrlAction(activity.lesson_id, activity.activity_id, fileName)
        if (!result.success || !result.url) {
          if (result.error) {
            toast.error("Failed to load recording", {
              description: result.error,
            })
          }
          setPlaybackUrl(null)
        } else {
          setPlaybackUrl(result.url)
        }
      } catch (error) {
        console.error("[activities] Failed to load voice recording:", error)
        toast.error("Failed to load recording", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        setPlaybackUrl(null)
      } finally {
        setIsPlaybackLoading(false)
      }
    },
    [activity],
  )

  useEffect(() => {
    setRawBodyError(null)
    if (type === "text") {
      setVideoUrl("")
      if (activity) {
        setRawBody(activity.body_data ? JSON.stringify(activity.body_data, null, 2) : "")
      }
      return
    }
    if (type === "show-video") {
      setText("")
      if (activity) {
        const nextUrl = extractVideoUrl(activity)
        setVideoUrl(nextUrl)
        setRawBody(activity.body_data ? JSON.stringify(activity.body_data, null, 2) : "")
      }
      return
    }

    if (type === "voice") {
      const body = activity ? getVoiceBody(activity) : { audioFile: null }
      setVoiceBody(body)
      originalVoiceBodyRef.current = body
      setPendingRecording(null)
      setShouldDeleteExistingRecording(false)
      setRecordingError(null)
      if (body.audioFile) {
        loadPlaybackForFile(body.audioFile)
      } else {
        setPlaybackUrl(null)
        setIsPlaybackLoading(false)
      }
      return
    }

    if (activity) {
      setRawBody(activity.body_data ? JSON.stringify(activity.body_data, null, 2) : "")
    }

    if (type !== "voice") {
      setVoiceBody(null)
      setPendingRecording(null)
      setShouldDeleteExistingRecording(false)
      setPlaybackUrl(null)
      setRecordingError(null)
      cleanupRecordingResources()
    }
  }, [type, activity, loadPlaybackForFile])

  useEffect(() => {
    if (open && type === "voice" && voiceBody?.audioFile && !pendingRecording) {
      loadPlaybackForFile(voiceBody.audioFile)
    }
  }, [loadPlaybackForFile, open, type, voiceBody?.audioFile, pendingRecording])

  useEffect(() => {
    return () => {
      cleanupRecordingResources()
      if (pendingObjectUrlRef.current) {
        URL.revokeObjectURL(pendingObjectUrlRef.current)
        pendingObjectUrlRef.current = null
      }
    }
  }, [])

  const handleStartRecording = async () => {
    if (isRecording || isPending || isProcessing) return
    setRecordingError(null)

    if (typeof window === "undefined" || typeof navigator === "undefined") {
      setRecordingError("Voice recording is not supported in this environment.")
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Voice recording is not supported in this browser.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      startTimeRef.current = Date.now()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = (event) => {
        console.error("[activities] MediaRecorder error:", event.error)
        setRecordingError(event.error?.message ?? "Recording failed")
      }

      recorder.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
          if (blob.size === 0) {
            setRecordingError("Recording was empty.")
            return
          }

          if (pendingObjectUrlRef.current) {
            URL.revokeObjectURL(pendingObjectUrlRef.current)
            pendingObjectUrlRef.current = null
          }

          const fileName = `voice-${Date.now()}.webm`
          const file = new File([blob], fileName, { type: blob.type })
          const durationMs = startTimeRef.current ? Date.now() - startTimeRef.current : null

          const objectUrl = URL.createObjectURL(file)
          pendingObjectUrlRef.current = objectUrl
          setPlaybackUrl(objectUrl)
          setIsPlaybackLoading(false)
          setPendingRecording({ file, durationMs })

          const nextVoiceBody: VoiceBody = {
            ...(voiceBody ?? { audioFile: null }),
            audioFile: file.name,
            mimeType: file.type || "audio/webm",
            duration: durationMs != null ? durationMs / 1000 : null,
            size: file.size,
          }
          setVoiceBody(nextVoiceBody)
          setShouldDeleteExistingRecording(false)
        } catch (error) {
          console.error("[activities] Failed to process recording:", error)
          setRecordingError(error instanceof Error ? error.message : "Failed to process recording.")
        } finally {
          stream.getTracks().forEach((track) => track.stop())
          mediaStreamRef.current = null
          mediaRecorderRef.current = null
          chunksRef.current = []
          startTimeRef.current = null
          setIsRecording(false)
        }
      }

      recorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error("[activities] Failed to start recording:", error)
      setRecordingError(error instanceof Error ? error.message : "Could not access microphone.")
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      mediaRecorderRef.current = null
      setIsRecording(false)
    }
  }

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
  }

  const handleDiscardRecording = () => {
    if (pendingObjectUrlRef.current) {
      URL.revokeObjectURL(pendingObjectUrlRef.current)
      pendingObjectUrlRef.current = null
    }
    setPendingRecording(null)
    setRecordingError(null)
    setShouldDeleteExistingRecording(false)
    const original = originalVoiceBodyRef.current
    setVoiceBody(original)
    if (type === "voice") {
      loadPlaybackForFile(original?.audioFile ?? null)
    } else {
      setPlaybackUrl(null)
    }
  }

  const handleRemoveExistingRecording = () => {
    if (!voiceBody?.audioFile && !pendingRecording && !(originalVoiceBodyRef.current?.audioFile)) {
      return
    }
    if (pendingObjectUrlRef.current) {
      URL.revokeObjectURL(pendingObjectUrlRef.current)
      pendingObjectUrlRef.current = null
    }
    setPendingRecording(null)
    setRecordingError(null)
    setVoiceBody((prev) => ({
      ...(prev ?? { audioFile: null }),
      audioFile: null,
      mimeType: null,
      duration: null,
      size: null,
    }))
    setShouldDeleteExistingRecording(true)
    setPlaybackUrl(null)
  }

  const prepareVoiceBody = async (): Promise<{ success: boolean; bodyData?: VoiceBody }> => {
    if (!activity) {
      return { success: false }
    }

    const originalBody = originalVoiceBodyRef.current ?? getVoiceBody(activity)
    let workingBody = voiceBody ?? originalBody
    const shouldUpload = Boolean(pendingRecording)
    const shouldDelete = shouldDeleteExistingRecording && Boolean(originalBody.audioFile) && !pendingRecording

    if (!shouldUpload && !shouldDelete) {
      return { success: true, bodyData: workingBody }
    }

    setIsProcessing(true)
    try {
      if (shouldUpload && pendingRecording) {
        const { file, durationMs } = pendingRecording
        const formData = new FormData()
        formData.append("unitId", unitId)
        formData.append("lessonId", lessonId)
        formData.append("activityId", activity.activity_id)
        formData.append("file", file, file.name)

        const uploadResult = await uploadActivityFileAction(formData)
        if (!uploadResult.success) {
          toast.error("Failed to upload recording", {
            description: uploadResult.error ?? "Please try again later.",
          })
          return { success: false }
        }

        workingBody = {
          ...workingBody,
          audioFile: file.name,
          mimeType: file.type || "audio/webm",
          duration: durationMs != null ? durationMs / 1000 : workingBody.duration ?? null,
          size: file.size,
        }

        if (originalBody.audioFile && originalBody.audioFile !== file.name) {
          const deleteResult = await deleteActivityFileAction(
            unitId,
            lessonId,
            activity.activity_id,
            originalBody.audioFile,
          )
          if (!deleteResult.success) {
            toast.error("Failed to remove previous recording", {
              description: deleteResult.error ?? "Please try again later.",
            })
            return { success: false }
          }
        }

        if (pendingObjectUrlRef.current) {
          URL.revokeObjectURL(pendingObjectUrlRef.current)
          pendingObjectUrlRef.current = null
        }
        setPendingRecording(null)
        originalVoiceBodyRef.current = workingBody
        setVoiceBody(workingBody)
      }

      if (shouldDelete && originalBody.audioFile) {
        const deleteResult = await deleteActivityFileAction(
          unitId,
          lessonId,
          activity.activity_id,
          originalBody.audioFile,
        )
        if (!deleteResult.success) {
          toast.error("Failed to delete recording", {
            description: deleteResult.error ?? "Please try again later.",
          })
          return { success: false }
        }

        workingBody = {
          ...workingBody,
          audioFile: null,
          mimeType: null,
          duration: null,
          size: null,
        }
        originalVoiceBodyRef.current = workingBody
        setVoiceBody(workingBody)
        setShouldDeleteExistingRecording(false)
        setPlaybackUrl(null)
      }

      return { success: true, bodyData: workingBody }
    } catch (error) {
      console.error("[activities] Failed to process voice changes:", error)
      toast.error("Failed to save recording", {
        description: error instanceof Error ? error.message : "Please try again later.",
      })
      return { success: false }
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSave = async () => {
    if (!activity) {
      return
    }

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error("Activity title is required")
      return
    }

    let bodyData: unknown

    if (type === "voice") {
      const result = await prepareVoiceBody()
      if (!result.success || result.bodyData === undefined) {
        return
      }
      bodyData = result.bodyData
    } else {
      let fallbackBody: unknown = activity.body_data ?? null
      if (type !== "text" && type !== "show-video") {
        const trimmed = rawBody.trim()
        if (trimmed.length === 0) {
          fallbackBody = null
        } else {
          try {
            fallbackBody = JSON.parse(trimmed)
          } catch (error) {
            console.error("[activities] Failed to parse activity body", error)
            setRawBodyError("Activity details must be valid JSON.")
            return
          }
        }
      }

      bodyData = buildBodyData(type, {
        text,
        videoUrl,
        fallback: fallbackBody,
      })
    }

    onSubmit({
      activityId: activity.activity_id,
      title: trimmedTitle,
      type,
      bodyData,
    })
  }

  const disableSave =
    isPending ||
    isProcessing ||
    isRecording ||
    !activity ||
    title.trim().length === 0 ||
    (type !== "voice" && rawBodyError !== null)

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="sm:max-w-md gap-0">
        <SheetHeader>
          <SheetTitle>Edit activity</SheetTitle>
          <SheetDescription>Update the activity details and save to keep your changes.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="activity-title">Title</Label>
            <Input
              id="activity-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Warm-up discussion"
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="activity-type">Type</Label>
            <Select
              value={type}
              onValueChange={(value: ActivityTypeValue) => setType(value)}
              disabled={isPending}
            >
              <SelectTrigger id="activity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === "text" ? (
            <div className="space-y-2">
              <Label htmlFor="activity-text">Instructions</Label>
              <Textarea
                id="activity-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Enter the activity instructions"
                rows={6}
                disabled={isPending}
              />
            </div>
          ) : null}

          {type === "show-video" ? (
            <div className="space-y-2">
              <Label htmlFor="activity-video-url">Video URL</Label>
              <Input
                id="activity-video-url"
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                placeholder="https://..."
                disabled={isPending}
              />
              {(() => {
                const previewUrl = getYouTubeThumbnailUrl(videoUrl)
                if (!previewUrl) return null
                return (
                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="YouTube video thumbnail"
                      className="h-auto w-[100px] rounded-sm object-cover"
                      loading="lazy"
                    />
                  </div>
                )
              })()}
            </div>
          ) : null}

          {type === "voice" ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <div className="space-y-2">
                <Label>Recording</Label>
                {isPlaybackLoading ? (
                  <p className="text-sm text-muted-foreground">Loading recording…</p>
                ) : playbackUrl ? (
                  <audio controls src={playbackUrl} className="w-full" />
                ) : (
                  <p className="text-sm text-muted-foreground">No recording available.</p>
                )}
                {recordingError ? <p className="text-xs text-destructive">{recordingError}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={isRecording ? "destructive" : "secondary"}
                  onClick={isRecording ? handleStopRecording : handleStartRecording}
                  disabled={isPending || isProcessing}
                >
                  {isRecording ? "Stop recording" : "Record"}
                </Button>
                {pendingRecording ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDiscardRecording}
                    disabled={isPending || isProcessing || isRecording}
                  >
                    Discard recording
                  </Button>
                ) : voiceBody?.audioFile && !shouldDeleteExistingRecording ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRemoveExistingRecording}
                    disabled={isPending || isProcessing || isRecording}
                  >
                    Remove recording
                  </Button>
                ) : null}
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {pendingRecording ? (
                  <p>New recording will replace the existing file when you save.</p>
                ) : shouldDeleteExistingRecording ? (
                  <p>Recording will be removed when you save.</p>
                ) : voiceBody?.audioFile ? (
                  <p>Current file: {voiceBody.audioFile}</p>
                ) : (
                  <p>No recording selected.</p>
                )}
                {voiceBody?.duration != null ? (
                  <p>Duration: {voiceBody.duration.toFixed(1)}s</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {type !== "text" && type !== "show-video" && type !== "voice" ? (
            <div className="space-y-2">
              <Label htmlFor="activity-json">Activity details</Label>
              <Textarea
                id="activity-json"
                value={rawBody}
                onChange={(event) => {
                  setRawBody(event.target.value)
                  setRawBodyError(null)
                }}
                placeholder="Provide JSON data for this activity type"
                rows={12}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Supply valid JSON to control the activity details. Leave blank to reset to defaults.
              </p>
              {rawBodyError ? <p className="text-xs text-destructive">{rawBodyError}</p> : null}
            </div>
          ) : null}
        </div>
        <SheetFooter className="border-t border-border bg-muted/20">
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={disableSave}>
              Save changes
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function ensureActivityType(value: string | null | undefined): ActivityTypeValue {
  const match = ACTIVITY_TYPES.find((item) => item.value === value)
  return match ? match.value : ACTIVITY_TYPES[0].value
}

function getYouTubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase()
    if (host === "youtu.be") {
      return parsed.pathname.slice(1) || null
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v")
      }
      const segments = parsed.pathname.split("/").filter(Boolean)
      if (segments[0] === "embed" || segments[0] === "v") {
        return segments[1] ?? null
      }
    }
    return null
  } catch {
    return null
  }
}

function getYouTubeThumbnailUrl(url: string | null | undefined): string | null {
  const videoId = getYouTubeVideoId(url)
  if (!videoId) {
    return null
  }
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
}
