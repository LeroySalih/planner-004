"use client"

import type { ChangeEvent, DragEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, GripVertical, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react"

import type { LessonActivity, LessonLearningObjective } from "@/types"
import {
  createLessonActivityAction,
  deleteActivityFileAction,
  deleteLessonActivityAction,
  getActivityFileDownloadUrlAction,
  getLessonFileDownloadUrlAction,
  listActivityFilesAction,
  listLessonFilesAction,
  listLessonLinksAction,
  reorderLessonActivitiesAction,
  updateLessonActivityAction,
  uploadActivityFileAction,
} from "@/lib/server-updates"
import {
  LessonPresentation,
  type LessonFileInfo,
  type LessonLinkInfo,
} from "@/components/units/lesson-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"

interface VoiceBody {
  audioFile: string | null
  mimeType?: string | null
  duration?: number | null
  size?: number | null
  [key: string]: unknown
}

interface ImageBody {
  imageFile: string | null
  imageUrl?: string | null
  [key: string]: unknown
}

interface ActivityFileInfo {
  name: string
  path: string
  size?: number | null
}

interface PresentationState {
  activities: LessonActivity[]
  files: LessonFileInfo[]
  links: LessonLinkInfo[]
  activityFilesMap: Record<string, LessonFileInfo[]>
  loading: boolean
}

const ACTIVITY_TYPES = [
  { value: "text", label: "Text" },
  { value: "file-download", label: "File download" },
  { value: "upload-file", label: "Upload file" },
  { value: "display-image", label: "Display image" },
  { value: "show-video", label: "Show video" },
  { value: "multiple-choice-question", label: "Multiple choice question" },
  { value: "text-question", label: "Text question" },
  { value: "voice", label: "Voice recording" },
] as const

type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number]["value"]

const NEW_ACTIVITY_ID = "__new__"

interface LessonActivitiesManagerProps {
  unitId: string
  unitTitle?: string | null
  lessonId: string
  lessonTitle: string
  lessonObjectives: LessonLearningObjective[]
  initialActivities: LessonActivity[]
  initialLessonFiles: LessonFileInfo[]
  initialLessonLinks: LessonLinkInfo[]
}

export function LessonActivitiesManager({
  unitId,
  unitTitle,
  lessonId,
  lessonTitle,
  lessonObjectives,
  initialActivities,
  initialLessonFiles,
  initialLessonLinks,
}: LessonActivitiesManagerProps) {
  const router = useRouter()
  const [activities, setActivities] = useState<LessonActivity[]>(() => sortActivities(initialActivities))
  const [isPending, startTransition] = useTransition()

  const [editorActivityId, setEditorActivityId] = useState<string | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const pendingReorderRef = useRef<{ next: LessonActivity[]; previous: LessonActivity[] } | null>(null)
  const [voicePreviewState, setVoicePreviewState] = useState<
    Record<string, { url: string | null; loading: boolean }>
  >({})
  const [fileDownloadState, setFileDownloadState] = useState<Record<string, { loading: boolean }>>({})
  const [imagePreviewState, setImagePreviewState] = useState<
    Record<string, { url: string | null; loading: boolean }>
  >({})
  const [homeworkPending, setHomeworkPending] = useState<Record<string, boolean>>({})
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const [presentationState, setPresentationState] = useState<PresentationState | null>(null)
  const [presentationIndex, setPresentationIndex] = useState(-1)
  const [isPresentationPending, startPresentationTransition] = useTransition()
  const [, startDownloadTransition] = useTransition()

  useEffect(() => {
    setActivities(sortActivities(initialActivities))
    setImagePreviewState({})
    setHomeworkPending({})
  }, [initialActivities])

  useEffect(() => {
    setPresentationState((prev) => {
      if (!prev) {
        return prev
      }
      return {
        ...prev,
        activities,
      }
    })

    setPresentationIndex((prev) => {
      if (activities.length === 0) {
        return -1
      }
      const maxIndex = activities.length - 1
      return prev > maxIndex ? maxIndex : prev
    })
  }, [activities])

  const typeLabelMap = useMemo(() => {
    return ACTIVITY_TYPES.reduce<Record<string, string>>((acc, type) => {
      acc[type.value] = type.label
      return acc
    }, {})
  }, [])

  const openEditor = (activityId: string) => {
    setEditorActivityId(activityId)
    setIsEditorOpen(true)
  }

  const closeEditor = () => {
    setIsEditorOpen(false)
    setEditorActivityId(null)
  }

  const isCreating = editorActivityId === NEW_ACTIVITY_ID

  const fetchImagePreview = useCallback(
    async (activity: LessonActivity, fileName: string) => {
      setImagePreviewState((prev) => ({
        ...prev,
        [activity.activity_id]: {
          url: prev[activity.activity_id]?.url ?? null,
          loading: true,
        },
      }))

      try {
        const result = await getActivityFileDownloadUrlAction(
          activity.lesson_id,
          activity.activity_id,
          fileName,
        )
        if (!result.success || !result.url) {
          setImagePreviewState((prev) => ({
            ...prev,
            [activity.activity_id]: {
              url: null,
              loading: false,
            },
          }))
          if (result.error) {
            console.warn("[activities] Unable to load image thumbnail:", result.error)
          }
          return
        }

        setImagePreviewState((prev) => ({
          ...prev,
          [activity.activity_id]: {
            url: result.url,
            loading: false,
          },
        }))
      } catch (error) {
        console.error("[activities] Failed to fetch image thumbnail:", error)
        setImagePreviewState((prev) => ({
          ...prev,
          [activity.activity_id]: {
            url: null,
            loading: false,
          },
        }))
      }
    },
    [],
  )

  useEffect(() => {
    const pendingFetches: { activity: LessonActivity; fileName: string }[] = []

    setImagePreviewState((prev) => {
      const next: Record<string, { url: string | null; loading: boolean }> = { ...prev }
      const isAbsolute = (value: string | null) => {
        if (!value) return false
        return /^https?:\/\//i.test(value) || value.startsWith("data:")
      }

      for (const activity of activities) {
        if (activity.type !== "display-image") {
          continue
        }

        const body = getImageBody(activity)
        const raw = (activity.body_data ?? {}) as Record<string, unknown>
        const rawFileUrl = typeof raw.fileUrl === "string" ? raw.fileUrl : null

        const directUrl = body.imageUrl && isAbsolute(body.imageUrl) ? body.imageUrl : null
        const fallbackDirect = directUrl || (rawFileUrl && isAbsolute(rawFileUrl) ? rawFileUrl : null)

        const fileNameCandidate = body.imageFile && !isAbsolute(body.imageFile) ? body.imageFile : null
        const fallbackFileName = !fileNameCandidate && rawFileUrl && !isAbsolute(rawFileUrl) ? rawFileUrl : null
        const finalFileName = fileNameCandidate ?? fallbackFileName

        if (fallbackDirect) {
          next[activity.activity_id] = { url: fallbackDirect, loading: false }
          continue
        }

        if (finalFileName) {
          const existing = prev[activity.activity_id]
          if (!existing || (!existing.url && !existing.loading)) {
            pendingFetches.push({ activity, fileName: finalFileName })
            next[activity.activity_id] = { url: existing?.url ?? null, loading: true }
          }
          continue
        }

        next[activity.activity_id] = { url: null, loading: false }
      }

      return next
    })

    pendingFetches.forEach(({ activity, fileName }) => {
      void fetchImagePreview(activity, fileName)
    })
  }, [activities, fetchImagePreview])

  const editingActivity = useMemo(() => {
    if (!editorActivityId || editorActivityId === NEW_ACTIVITY_ID) {
      return null
    }
    return activities.find((activity) => activity.activity_id === editorActivityId) ?? null
  }, [activities, editorActivityId])

  useEffect(() => {
    if (isEditorOpen && editorActivityId && !isCreating && !editingActivity) {
      closeEditor()
    }
  }, [editorActivityId, editingActivity, isCreating, isEditorOpen])

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
    mode,
    activityId,
    title,
    type,
    bodyData,
    imageSubmission,
  }: {
    mode: "create" | "edit"
    activityId?: string
    title: string
    type: ActivityTypeValue
    bodyData: unknown
    imageSubmission?: ImageSubmissionPayload
  }) => {
    startTransition(async () => {
      if (mode === "create") {
        if (type === "display-image" && imageSubmission) {
          const createBody = imageSubmission.pendingFile ? { imageFile: null, imageUrl: null, fileUrl: null } : bodyData

          const createResult = await createLessonActivityAction(unitId, lessonId, {
            title,
            type,
            bodyData: createBody,
          })

          if (!createResult.success || !createResult.data) {
            toast.error("Unable to create activity", {
              description: createResult.error ?? "Please try again later.",
            })
            return
          }

          let createdActivity = createResult.data

          if (imageSubmission.pendingFile && createdActivity) {
            const formData = new FormData()
            formData.append("unitId", unitId)
            formData.append("lessonId", lessonId)
            formData.append("activityId", createdActivity.activity_id)
            formData.append("file", imageSubmission.pendingFile)

            const uploadResult = await uploadActivityFileAction(formData)
            if (!uploadResult.success) {
              toast.error("Failed to upload image", {
                description: uploadResult.error ?? "Please try again later.",
              })
              await deleteLessonActivityAction(unitId, lessonId, createdActivity.activity_id)
              return
            }

            const finalizeResult = await updateLessonActivityAction(unitId, lessonId, createdActivity.activity_id, {
              bodyData: imageSubmission.finalBody ?? { imageFile: imageSubmission.pendingFile.name },
            })

            if (!finalizeResult.success || !finalizeResult.data) {
              toast.error("Unable to finalize image", {
                description: finalizeResult.error ?? "Please try again later.",
              })
              await deleteActivityFileAction(
                unitId,
                lessonId,
                createdActivity.activity_id,
                imageSubmission.pendingFile.name,
              )
              await deleteLessonActivityAction(unitId, lessonId, createdActivity.activity_id)
              return
            }

            createdActivity = finalizeResult.data
          }

          setActivities((prev) => sortActivities([...prev, createdActivity]))
          setImagePreviewState((prev) => ({
            ...prev,
            [createdActivity.activity_id]: { url: null, loading: false },
          }))
          toast.success("Activity created")
          closeEditor()
          router.refresh()
          return
        }

        const result = await createLessonActivityAction(unitId, lessonId, {
          title,
          type,
          bodyData,
        })

        if (!result.success || !result.data) {
          toast.error("Unable to create activity", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        setActivities((prev) => sortActivities([...prev, result.data!]))
        toast.success("Activity created")
        closeEditor()
        router.refresh()
        return
      }

      if (!activityId) {
        toast.error("Unable to update activity", {
          description: "Missing activity identifier.",
        })
        return
      }

      if (type === "display-image" && imageSubmission) {
        const pendingFile = imageSubmission.pendingFile
        const previousFileName = imageSubmission.previousFileName

        if (pendingFile) {
          const formData = new FormData()
          formData.append("unitId", unitId)
          formData.append("lessonId", lessonId)
          formData.append("activityId", activityId)
          formData.append("file", pendingFile)

          const uploadResult = await uploadActivityFileAction(formData)
          if (!uploadResult.success) {
            toast.error("Failed to upload image", {
              description: uploadResult.error ?? "Please try again later.",
            })
            return
          }
        }

        const updateResult = await updateLessonActivityAction(unitId, lessonId, activityId, {
          title,
          type,
          bodyData: imageSubmission.finalBody ?? null,
        })

        if (!updateResult.success || !updateResult.data) {
          if (pendingFile) {
            await deleteActivityFileAction(unitId, lessonId, activityId, pendingFile.name)
          }
          toast.error("Unable to update activity", {
            description: updateResult.error ?? "Please try again later.",
          })
          return
        }

        const updatedActivity = updateResult.data

        if (pendingFile && previousFileName && previousFileName !== pendingFile.name) {
          const cleanupResult = await deleteActivityFileAction(unitId, lessonId, activityId, previousFileName)
          if (!cleanupResult.success) {
            toast.error("Image updated, but the previous file could not be removed.", {
              description: cleanupResult.error ?? "Please remove it manually later.",
            })
          }
        }

        if (!pendingFile && imageSubmission.shouldDeleteExisting && previousFileName) {
          const deleteResult = await deleteActivityFileAction(unitId, lessonId, activityId, previousFileName)
          if (!deleteResult.success) {
            toast.error("Unable to remove the existing image", {
              description: deleteResult.error ?? "Please try again later.",
            })
            // Attempt to restore the previous body so the image remains referenced
            await updateLessonActivityAction(unitId, lessonId, activityId, {
              title,
              type,
              bodyData: { imageFile: previousFileName, fileUrl: previousFileName },
            })
            return
          }
        }

        setActivities((prev) =>
          sortActivities(prev.map((item) => (item.activity_id === activityId ? updatedActivity : item))),
        )
        setImagePreviewState((prev) => ({
          ...prev,
          [activityId]: { url: null, loading: false },
        }))
        toast.success("Activity updated")
        closeEditor()
        router.refresh()
        return
      }

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
  const isPresentationBusy = isPresentationPending || Boolean(presentationState?.loading)
  const resolvedUnitTitle = unitTitle ?? unitId

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

  const toggleHomework = useCallback(
    (activity: LessonActivity, nextValue: boolean) => {
      const activityId = activity.activity_id
      const previousValue = activity.is_homework ?? false

      setHomeworkPending((prev) => ({ ...prev, [activityId]: true }))
      setActivities((prev) =>
        prev.map((item) =>
          item.activity_id === activityId ? { ...item, is_homework: nextValue } : item,
        ),
      )

      startTransition(async () => {
        try {
          const result = await updateLessonActivityAction(unitId, lessonId, activityId, {
            isHomework: nextValue,
          })

          if (!result.success || !result.data) {
            setActivities((prev) =>
              prev.map((item) =>
                item.activity_id === activityId ? { ...item, is_homework: previousValue } : item,
              ),
            )
            toast.error("Unable to update homework status", {
              description: result.error ?? "Please try again later.",
            })
            return
          }

          setActivities((prev) =>
            prev.map((item) => (item.activity_id === activityId ? result.data! : item)),
          )
          router.refresh()
        } catch (error) {
          console.error("[activities] Failed to update homework flag", error)
          setActivities((prev) =>
            prev.map((item) =>
              item.activity_id === activityId ? { ...item, is_homework: previousValue } : item,
            ),
          )
          toast.error("Unable to update homework status", {
            description: error instanceof Error ? error.message : "Please try again later.",
          })
        } finally {
          setHomeworkPending((prev) => {
            const next = { ...prev }
            delete next[activityId]
            return next
          })
        }
      })
    },
    [lessonId, router, startTransition, unitId],
  )

  const handleOpenPresentation = () => {
    if (isPresentationPending || presentationState?.loading || presentationState) {
      return
    }

    if (activities.length === 0) {
      toast.info("This lesson doesn't have any activities yet.")
      return
    }

    setPresentationState({
      activities,
      files: initialLessonFiles,
      links: initialLessonLinks,
      activityFilesMap: {},
      loading: true,
    })
    setPresentationIndex(-1)

    startPresentationTransition(async () => {
      try {
        const [filesResult, linksResult] = await Promise.all([
          listLessonFilesAction(lessonId),
          listLessonLinksAction(lessonId),
        ])

        if (filesResult.error) {
          toast.error("Failed to load lesson files", {
            description: filesResult.error,
          })
        }
        if (linksResult.error) {
          toast.error("Failed to load lesson links", {
            description: linksResult.error,
          })
        }

        const files = filesResult.data ?? initialLessonFiles
        const links = linksResult.data ?? initialLessonLinks

        const activitiesRequiringFiles = activities.filter(
          (activity) =>
            activity.type === "file-download" ||
            activity.type === "upload-file" ||
            activity.type === "voice",
        )

        const activityFilesEntries = await Promise.all(
          activitiesRequiringFiles.map(async (activity) => {
            const result = await listActivityFilesAction(lessonId, activity.activity_id)
            if (result.error) {
              toast.error("Failed to load activity files", {
                description: result.error,
              })
              return [activity.activity_id, []] as const
            }
            return [activity.activity_id, result.data ?? []] as const
          }),
        )

        const activityFilesMap = Object.fromEntries(activityFilesEntries)

        setPresentationState((prev) => {
          if (!prev) {
            return prev
          }
          return {
            activities,
            files,
            links,
            activityFilesMap,
            loading: false,
          }
        })
        setPresentationIndex((prev) => {
          if (activities.length === 0) {
            return -1
          }
          if (prev > activities.length - 1) {
            return activities.length - 1
          }
          return prev
        })
      } catch (error) {
        console.error("[activities] Failed to open lesson presentation:", error)
        toast.error("Unable to load activities", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        setPresentationState(null)
        setPresentationIndex(-1)
      }
    })
  }

  const handleClosePresentation = () => {
    setPresentationState(null)
    setPresentationIndex(-1)
  }

  const handlePresentationNext = () => {
    setPresentationIndex((previous) => {
      if (!presentationState || presentationState.activities.length === 0) {
        return previous
      }
      if (previous < 0) {
        return 0
      }
      if (previous < presentationState.activities.length - 1) {
        return previous + 1
      }
      return previous
    })
  }

  const handlePresentationPrevious = () => {
    setPresentationIndex((previous) => (previous <= 0 ? -1 : previous - 1))
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">Add Activity</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={handleOpenPresentation}
                variant="outline"
                disabled={isPresentationBusy || activities.length === 0}
                className="w-full sm:w-auto"
              >
                <Play className="mr-2 h-4 w-4" /> Show Activities
              </Button>
              <Button
                onClick={() => openEditor(NEW_ACTIVITY_ID)}
                disabled={isBusy}
                className="w-full sm:w-auto"
              >
                <Plus className="mr-2 h-4 w-4" /> Add Activity
              </Button>
            </div>
          </div>
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
                const isFileResource = activity.type === "file-download" || activity.type === "upload-file"
                const fileStatus = fileDownloadState[activity.activity_id]
                const isDisplayImage = activity.type === "display-image"
                const imageBody = isDisplayImage ? getImageBody(activity) : null
                const imageState = isDisplayImage ? imagePreviewState[activity.activity_id] : null
                const imageThumbnail = isDisplayImage ? imageState?.url ?? imageBody?.imageUrl ?? null : null
                const isImageLoading = isDisplayImage ? imageState?.loading ?? false : false
                const isHomework = activity.is_homework ?? false
                const homeworkUpdating = homeworkPending[activity.activity_id] ?? false
                const switchId = `activity-homework-${activity.activity_id}`
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
                          {isFileResource ? (
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
                          {isDisplayImage ? (
                            imageThumbnail ? (
                              <a
                                href={imageThumbnail}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imageThumbnail}
                                  alt="Activity image thumbnail"
                                  className="h-auto w-[100px] rounded-md border border-border object-cover"
                                  loading="lazy"
                                />
                              </a>
                            ) : isImageLoading ? (
                              <div className="flex h-[60px] w-[100px] shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            ) : (
                              <div className="flex h-[60px] w-[100px] shrink-0 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
                                No image
                              </div>
                            )
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
                        <div className="flex items-center gap-2">
                          <Switch
                            id={switchId}
                            checked={isHomework}
                            disabled={isBusy || homeworkUpdating}
                            onCheckedChange={(checked) => toggleHomework(activity, checked)}
                          />
                          <Label
                            htmlFor={switchId}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Homework
                          </Label>
                          {homeworkUpdating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : null}
                        </div>
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
        key={editorActivityId ?? "closed"}
        mode={isCreating ? "create" : "edit"}
        activity={isCreating ? null : editingActivity}
        open={isEditorOpen}
        onClose={closeEditor}
        isPending={isPending}
        onSubmit={handleEditorSubmit}
        unitId={unitId}
        lessonId={lessonId}
      />

      {presentationState ? (
        <>
          <LessonPresentation
            activities={presentationState.activities}
            currentIndex={presentationIndex}
            unitTitle={resolvedUnitTitle}
            lessonTitle={lessonTitle}
            lessonId={lessonId}
            lessonObjectives={lessonObjectives}
            lessonLinks={presentationState.links}
            lessonFiles={presentationState.files}
            activityFilesMap={presentationState.activityFilesMap}
            onClose={handleClosePresentation}
            onNext={handlePresentationNext}
            onPrevious={handlePresentationPrevious}
            onDownloadFile={(fileName) => {
              startDownloadTransition(async () => {
                const result = await getLessonFileDownloadUrlAction(lessonId, fileName)
                if (!result.success || !result.url) {
                  toast.error("Failed to download file", {
                    description: result.error ?? "Please try again later.",
                  })
                  return
                }
                window.open(result.url, "_blank")
              })
            }}
            onDownloadActivityFile={(activityId, fileName) => {
              startDownloadTransition(async () => {
                const result = await getActivityFileDownloadUrlAction(lessonId, activityId, fileName)
                if (!result.success || !result.url) {
                  toast.error("Failed to download activity file", {
                    description: result.error ?? "Please try again later.",
                  })
                  return
                }
                window.open(result.url, "_blank")
              })
            }}
            fetchActivityFileUrl={async (activityId, fileName) => {
              const result = await getActivityFileDownloadUrlAction(lessonId, activityId, fileName)
              if (!result.success || !result.url) {
                toast.error("Failed to load file", {
                  description: result.error ?? "Please try again later.",
                })
                return null
              }
              return result.url
            }}
          />

          {presentationState.loading || isPresentationPending ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40">
              <div className="rounded-md bg-background px-4 py-2 text-sm text-foreground shadow-md">
                Loading activities…
              </div>
            </div>
          ) : null}
        </>
      ) : null}
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

function extractUploadInstructions(activity: LessonActivity): string {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return ""
  }
  const value = (activity.body_data as Record<string, unknown>).instructions
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
  if (type === "upload-file") {
    const instructions = text
    if (fallback && typeof fallback === "object" && fallback !== null) {
      return { ...fallback, instructions }
    }
    return { instructions }
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

  if (activity.type === "upload-file") {
    const instructions = extractUploadInstructions(activity)
    if (!instructions) return null
    return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{instructions}</p>
  }

  return null
}

interface ImageSubmissionPayload {
  pendingFile: File | null
  shouldDeleteExisting: boolean
  previousFileName: string | null
  finalBody: ImageBody | null
}

interface LessonActivityEditorSheetProps {
  mode: "create" | "edit"
  activity: LessonActivity | null
  open: boolean
  onClose: () => void
  isPending: boolean
  onSubmit: (updates: {
    mode: "create" | "edit"
    activityId?: string
    title: string
    type: ActivityTypeValue
    bodyData: unknown
    imageSubmission?: ImageSubmissionPayload
  }) => void
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

function getImageBody(activity: LessonActivity): ImageBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { imageFile: null, imageUrl: null }
  }

  const body = activity.body_data as Record<string, unknown>
  const rawImageFile = typeof body.imageFile === "string" ? body.imageFile : null
  const rawImageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null
  const rawFileUrl = typeof body.fileUrl === "string" ? body.fileUrl : null

  const isAbsolute = (value: string | null) => {
    if (!value) return false
    return /^https?:\/\//i.test(value) || value.startsWith("data:")
  }

  let imageFile = rawImageFile
  let imageUrl = rawImageUrl

  if (!imageFile && rawFileUrl && !isAbsolute(rawFileUrl)) {
    imageFile = rawFileUrl
  }

  if (!imageUrl && rawFileUrl && isAbsolute(rawFileUrl)) {
    imageUrl = rawFileUrl
  }

  return {
    ...body,
    imageFile,
    imageUrl: imageUrl ?? null,
  }
}

function LessonActivityEditorSheet({
  mode,
  activity,
  open,
  onClose,
  isPending,
  onSubmit,
  unitId,
  lessonId,
}: LessonActivityEditorSheetProps) {
  const isCreateMode = mode === "create"
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
  const [activityFiles, setActivityFiles] = useState<ActivityFileInfo[]>([])
  const [isFilesLoading, setIsFilesLoading] = useState(false)
  const [isUploadingFiles, setIsUploadingFiles] = useState(false)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const [imageBody, setImageBody] = useState<ImageBody | null>(null)
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null)
  const [shouldDeleteExistingImage, setShouldDeleteExistingImage] = useState(false)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [isImageDragActive, setIsImageDragActive] = useState(false)

  const originalVoiceBodyRef = useRef<VoiceBody | null>(null)
  const pendingObjectUrlRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageObjectUrlRef = useRef<string | null>(null)
  const originalImageBodyRef = useRef<ImageBody | null>(null)

  const resetImageState = useCallback(() => {
    if (pendingImageObjectUrlRef.current) {
      URL.revokeObjectURL(pendingImageObjectUrlRef.current)
      pendingImageObjectUrlRef.current = null
    }

    const defaultBody: ImageBody = { imageFile: null, imageUrl: null }
    setImageBody(defaultBody)
    originalImageBodyRef.current = defaultBody
    setPendingImageFile(null)
    setShouldDeleteExistingImage(false)
    setImagePreviewUrl(null)
    setIsImageLoading(false)
    setIsImageDragActive(false)
  }, [])

  const loadImagePreviewForFile = useCallback(
    async (fileName: string | null) => {
      if (!activity) {
        setImagePreviewUrl(null)
        setIsImageLoading(false)
        return
      }

      if (!fileName) {
        setImagePreviewUrl(null)
        setIsImageLoading(false)
        return
      }

      setIsImageLoading(true)
      try {
        const result = await getActivityFileDownloadUrlAction(
          activity.lesson_id,
          activity.activity_id,
          fileName,
        )
        if (!result.success || !result.url) {
          if (result.error) {
            toast.error("Failed to load image", {
              description: result.error,
            })
          }
          setImagePreviewUrl(null)
        } else {
          setImagePreviewUrl(result.url)
        }
      } catch (error) {
        console.error("[activities] Failed to load activity image:", error)
        toast.error("Failed to load image", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        setImagePreviewUrl(null)
      } finally {
        setIsImageLoading(false)
      }
    },
    [activity],
  )

  const applyImageFromActivity = useCallback(
    (target: LessonActivity | null) => {
      resetImageState()
      if (!target) {
        return
      }

      const nextBody = getImageBody(target)
      setImageBody(nextBody)
      originalImageBodyRef.current = nextBody
      setShouldDeleteExistingImage(false)
      setPendingImageFile(null)
      setIsImageDragActive(false)

      const rawBody = nextBody as Record<string, unknown>
      const candidateFile =
        typeof nextBody.imageFile === "string" && nextBody.imageFile.trim().length > 0
          ? nextBody.imageFile
          : typeof rawBody.fileUrl === "string" && rawBody.fileUrl.trim().length > 0
            ? (rawBody.fileUrl as string)
            : null

      const candidateExternalUrl =
        typeof nextBody.imageUrl === "string" && nextBody.imageUrl.trim().length > 0
          ? nextBody.imageUrl
          : null

      const isAbsoluteUrl = (value: string | null) => {
        if (!value) return false
        return /^https?:\/\//i.test(value) || value.startsWith("data:")
      }

      if (candidateFile && isAbsoluteUrl(candidateFile)) {
        setImagePreviewUrl(candidateFile)
        setIsImageLoading(false)
        return
      }

      if (candidateFile) {
        void loadImagePreviewForFile(candidateFile)
        return
      }

      if (candidateExternalUrl) {
        setImagePreviewUrl(candidateExternalUrl)
        setIsImageLoading(false)
        return
      }

      setImagePreviewUrl(null)
      setIsImageLoading(false)
    },
    [loadImagePreviewForFile, resetImageState],
  )

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

  const refreshActivityFiles = useCallback(
    async (targetActivityId: string) => {
      setIsFilesLoading(true)
      try {
        const result = await listActivityFilesAction(lessonId, targetActivityId)
        if (result.error) {
          toast.error("Unable to load files", {
            description: result.error,
          })
          setActivityFiles([])
        } else {
          setActivityFiles(result.data ?? [])
        }
      } catch (error) {
        console.error("[activities] Failed to load activity files:", error)
        toast.error("Unable to load files", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        setActivityFiles([])
      } finally {
        setIsFilesLoading(false)
      }
    },
    [lessonId],
  )

  const handleUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!activity) return
      const items = Array.from(files).filter((file) => file.size > 0)
      if (items.length === 0) {
        return
      }

      setIsUploadingFiles(true)
      let hadError = false

      for (const file of items) {
        const formData = new FormData()
        formData.append("unitId", unitId)
        formData.append("lessonId", lessonId)
        formData.append("activityId", activity.activity_id)
        formData.append("file", file)

        try {
          const result = await uploadActivityFileAction(formData)
          if (!result.success) {
            hadError = true
            toast.error(`Failed to upload ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
          }
        } catch (error) {
          hadError = true
          console.error("[activities] Failed to upload file:", error)
          toast.error(`Failed to upload ${file.name}`, {
            description: error instanceof Error ? error.message : "Please try again later.",
          })
        }
      }

      setIsUploadingFiles(false)
      await refreshActivityFiles(activity.activity_id)
      setIsFileDragActive(false)

      if (!hadError) {
        toast.success("Files uploaded")
      }
    },
    [activity, lessonId, refreshActivityFiles, unitId],
  )

  const handleDeleteFile = useCallback(
    async (fileName: string) => {
      if (!activity) return
      setIsUploadingFiles(true)
      try {
        const result = await deleteActivityFileAction(unitId, lessonId, activity.activity_id, fileName)
        if (!result.success) {
          toast.error("Failed to delete file", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        toast.success("File removed")
        await refreshActivityFiles(activity.activity_id)
      } catch (error) {
        console.error("[activities] Failed to delete file:", error)
        toast.error("Failed to delete file", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      } finally {
        setIsUploadingFiles(false)
      }
    },
    [activity, lessonId, refreshActivityFiles, unitId],
  )

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return
    void handleUploadFiles(event.target.files)
    event.target.value = ""
  }

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsFileDragActive(false)
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      void handleUploadFiles(files)
    }
  }

  const handleFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsFileDragActive(true)
  }

  const handleFileDragLeave = () => {
    setIsFileDragActive(false)
  }

  const formatFileSize = (size?: number | null) => {
    if (typeof size !== "number" || Number.isNaN(size) || size < 0) {
      return ""
    }
    const units = ["B", "KB", "MB", "GB"] as const
    let value = size
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }
    const display = unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)
    return `${display} ${units[unitIndex]}`
  }

  const processImageFile = (file: File | null) => {
    if (!file) return
    if (!file.type?.startsWith("image/")) {
      toast.error("Unsupported file type", {
        description: "Please choose an image file.",
      })
      return
    }
    if (file.size === 0) {
      toast.error("Image is empty", {
        description: "Please choose a valid image file.",
      })
      return
    }

    if (pendingImageObjectUrlRef.current) {
      URL.revokeObjectURL(pendingImageObjectUrlRef.current)
      pendingImageObjectUrlRef.current = null
    }

    const objectUrl = URL.createObjectURL(file)
    pendingImageObjectUrlRef.current = objectUrl
    setPendingImageFile(file)
    setImagePreviewUrl(objectUrl)
    setIsImageLoading(false)
    setShouldDeleteExistingImage(false)
    setImageBody((prev) => {
      const next: ImageBody = {
        ...(prev ?? { imageFile: null, imageUrl: null }),
        imageFile: file.name,
        imageUrl: null,
        fileUrl: file.name,
        mimeType: file.type,
        size: file.size,
      }
      return next
    })
  }

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    processImageFile(file)
    setIsImageDragActive(false)
    event.target.value = ""
  }

  const handleImageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsImageDragActive(false)
    const file = event.dataTransfer?.files?.[0] ?? null
    processImageFile(file)
  }

  const handleImageDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsImageDragActive(true)
  }

  const handleImageDragLeave = () => {
    setIsImageDragActive(false)
  }

  const handleRemoveImage = () => {
    if (pendingImageFile) {
      if (pendingImageObjectUrlRef.current) {
        URL.revokeObjectURL(pendingImageObjectUrlRef.current)
        pendingImageObjectUrlRef.current = null
      }
      setPendingImageFile(null)
      setShouldDeleteExistingImage(false)
      if (isCreateMode) {
        resetImageState()
      } else if (activity) {
        applyImageFromActivity(activity)
      } else {
        resetImageState()
      }
      return
    }

    if (pendingImageObjectUrlRef.current) {
      URL.revokeObjectURL(pendingImageObjectUrlRef.current)
      pendingImageObjectUrlRef.current = null
    }

    setImagePreviewUrl(null)
    setIsImageLoading(false)
    setImageBody((prev) => ({
      ...(prev ?? { imageFile: null, imageUrl: null }),
      imageFile: null,
      imageUrl: null,
      fileUrl: null,
    }))
    setPendingImageFile(null)
    if (!isCreateMode) {
      const original = originalImageBodyRef.current
      const hadOriginal = Boolean(
        (original?.imageFile && original.imageFile.trim().length > 0) ||
          (original?.imageUrl && original.imageUrl.trim().length > 0) ||
          (typeof (original as Record<string, unknown>)?.fileUrl === "string" &&
            ((original as Record<string, unknown>).fileUrl as string).trim().length > 0),
      )
      setShouldDeleteExistingImage(hadOriginal)
    }
  }

  useEffect(() => {
    if (open && isCreateMode) {
      setTitle("")
      setType("text")
      setText("")
      setVideoUrl("")
      setRawBody("")
      setRawBodyError(null)
      const defaultVoice: VoiceBody = { audioFile: null }
      setVoiceBody(defaultVoice)
      originalVoiceBodyRef.current = defaultVoice
      setShouldDeleteExistingRecording(false)
      setPendingRecording(null)
      setPlaybackUrl(null)
      setRecordingError(null)
      setIsPlaybackLoading(false)
      setIsProcessing(false)
      setActivityFiles([])
      setIsFilesLoading(false)
      setIsUploadingFiles(false)
      setIsFileDragActive(false)
      resetImageState()
      return
    }

    if (open && activity && mode === "edit") {
      const ensuredType = ensureActivityType(activity.type)
      setTitle(activity.title)
      setType(ensuredType)
      const initialText =
        ensuredType === "upload-file" ? extractUploadInstructions(activity) : extractText(activity)
      setText(initialText)
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
      if (ensuredType === "file-download") {
        void refreshActivityFiles(activity.activity_id)
      } else {
        setActivityFiles([])
      }
      if (ensuredType === "display-image") {
        applyImageFromActivity(activity)
      } else {
        resetImageState()
      }
    }

    if (!open) {
      cleanupRecordingResources()
      if (pendingObjectUrlRef.current) {
        URL.revokeObjectURL(pendingObjectUrlRef.current)
        pendingObjectUrlRef.current = null
      }
      resetImageState()
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
      setActivityFiles([])
      setIsFilesLoading(false)
      setIsUploadingFiles(false)
      setIsFileDragActive(false)
    }
  }, [activity, applyImageFromActivity, isCreateMode, mode, open, refreshActivityFiles, resetImageState])

  useEffect(() => {
    setRawBodyError(null)
    if (isCreateMode) {
      if (type === "text" || type === "upload-file") {
        setVideoUrl("")
        setText("")
        setRawBody("")
        if (type === "upload-file") {
          setActivityFiles([])
          setIsFilesLoading(false)
          setIsUploadingFiles(false)
          setIsFileDragActive(false)
        }
        return
      }

      if (type === "show-video") {
        setText("")
        setRawBody("")
        return
      }

      if (type === "voice") {
        const defaultVoice: VoiceBody = { audioFile: null }
        setVoiceBody(defaultVoice)
        originalVoiceBodyRef.current = defaultVoice
        setPendingRecording(null)
        setShouldDeleteExistingRecording(false)
        setRecordingError(null)
        setPlaybackUrl(null)
        setIsPlaybackLoading(false)
        return
      }

      if (type === "file-download") {
        setActivityFiles([])
        setIsFilesLoading(false)
        setIsUploadingFiles(false)
        setIsFileDragActive(false)
        return
      }

      if (type === "display-image") {
        resetImageState()
        return
      }

      setRawBody("")
      return
    }

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

    if (type === "upload-file") {
      if (activity) {
        setText(extractUploadInstructions(activity))
        void refreshActivityFiles(activity.activity_id)
      } else {
        setText("")
        setActivityFiles([])
      }
      return
    }

    if (type === "file-download") {
      if (activity) {
        void refreshActivityFiles(activity.activity_id)
      } else {
        setActivityFiles([])
      }
      return
    }

    if (type === "display-image") {
      if (activity) {
        applyImageFromActivity(activity)
      } else {
        resetImageState()
      }
      return
    }

    if (activity) {
      setRawBody(activity.body_data ? JSON.stringify(activity.body_data, null, 2) : "")
    }

    setVoiceBody(null)
    setPendingRecording(null)
    setShouldDeleteExistingRecording(false)
    setPlaybackUrl(null)
    setRecordingError(null)
    cleanupRecordingResources()
    setActivityFiles([])
    resetImageState()
  }, [activity, applyImageFromActivity, isCreateMode, loadPlaybackForFile, refreshActivityFiles, resetImageState, type])

  useEffect(() => {
    if (open && !isCreateMode && type === "voice" && voiceBody?.audioFile && !pendingRecording) {
      loadPlaybackForFile(voiceBody.audioFile)
    }
  }, [isCreateMode, loadPlaybackForFile, open, pendingRecording, type, voiceBody?.audioFile])

  useEffect(() => {
    return () => {
      cleanupRecordingResources()
      if (pendingObjectUrlRef.current) {
        URL.revokeObjectURL(pendingObjectUrlRef.current)
        pendingObjectUrlRef.current = null
      }
      if (pendingImageObjectUrlRef.current) {
        URL.revokeObjectURL(pendingImageObjectUrlRef.current)
        pendingImageObjectUrlRef.current = null
      }
    }
  }, [])

  const handleStartRecording = async () => {
    if (isCreateMode || isRecording || isPending || isProcessing) return
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
    if (!isCreateMode && !activity) {
      toast.error("Unable to update activity", {
        description: "Activity could not be found.",
      })
      return
    }

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error("Activity title is required")
      return
    }

    let bodyData: unknown
    let imageSubmission: ImageSubmissionPayload | undefined

    if (type === "voice") {
      if (isCreateMode) {
        bodyData = { audioFile: null }
      } else {
        const result = await prepareVoiceBody()
        if (!result.success || result.bodyData === undefined) {
          return
        }
        bodyData = result.bodyData
      }
    } else if (type === "display-image") {
      const previousBody = originalImageBodyRef.current ?? (activity ? getImageBody(activity) : { imageFile: null })
      const baseBody = imageBody ?? previousBody ?? { imageFile: null, imageUrl: null }
      const pendingFileRef = pendingImageFile

      const normalizedExternalUrl =
        typeof baseBody.imageUrl === "string" && baseBody.imageUrl.trim().length > 0
          ? baseBody.imageUrl.trim()
          : null

      const nextFileName = pendingFileRef
        ? pendingFileRef.name
        : typeof baseBody.imageFile === "string" && baseBody.imageFile.trim().length > 0
          ? baseBody.imageFile.trim()
          : null

      const sanitizedBody = (() => {
        if (nextFileName) {
          const next: ImageBody = {
            ...(baseBody ?? {}),
            imageFile: nextFileName,
            imageUrl: null,
            fileUrl: nextFileName,
          }
          if (pendingFileRef) {
            next.mimeType = pendingFileRef.type
            next.size = pendingFileRef.size
          }
          return next
        }

        if (normalizedExternalUrl) {
          const next: ImageBody = {
            ...(baseBody ?? {}),
            imageFile: null,
            imageUrl: normalizedExternalUrl,
            fileUrl: normalizedExternalUrl,
          }
          return next
        }

        if (
          shouldDeleteExistingImage ||
          (previousBody &&
            ((previousBody.imageFile && previousBody.imageFile.trim().length > 0) ||
              (previousBody.imageUrl && previousBody.imageUrl.trim().length > 0)))
        ) {
          return { imageFile: null, imageUrl: null, fileUrl: null }
        }

        return null
      })()

      bodyData = sanitizedBody
      imageSubmission = {
        pendingFile: pendingFileRef ?? null,
        shouldDeleteExisting: Boolean(!pendingFileRef && shouldDeleteExistingImage),
        previousFileName:
          typeof previousBody?.imageFile === "string" && previousBody.imageFile.trim().length > 0
            ? previousBody.imageFile.trim()
            : null,
        finalBody: sanitizedBody,
      }
    } else {
      let fallbackBody: unknown = !isCreateMode && activity ? activity.body_data ?? null : null
      if (!isCreateMode && type !== "text" && type !== "show-video") {
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
      mode: isCreateMode ? "create" : "edit",
      activityId: activity?.activity_id,
      title: trimmedTitle,
      type,
      bodyData,
      imageSubmission,
    })
  }

  const disableSave =
    isPending ||
    isProcessing ||
    isRecording ||
    title.trim().length === 0 ||
    (type !== "voice" && rawBodyError !== null)

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="sm:max-w-md gap-0">
        <SheetHeader>
          <SheetTitle>{isCreateMode ? "New activity" : "Edit activity"}</SheetTitle>
          <SheetDescription>
            {isCreateMode
              ? "Configure the activity details and save to add it to the lesson."
              : "Update the activity details and save to keep your changes."}
          </SheetDescription>
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

          {type === "text" || type === "upload-file" ? (
            <div className="space-y-2">
              <Label htmlFor="activity-text">
                {type === "upload-file" ? "Instructions for pupils" : "Instructions"}
              </Label>
              <Textarea
                id="activity-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={
                  type === "upload-file"
                    ? "Explain what pupils should upload"
                    : "Enter the activity instructions"
                }
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

          {type === "display-image" ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <div
                onDragOver={handleImageDragOver}
                onDragEnter={handleImageDragOver}
                onDragLeave={handleImageDragLeave}
                onDrop={handleImageDrop}
                className={[
                  "flex h-28 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/40 p-4 text-center transition",
                  isImageDragActive ? "border-primary bg-primary/5" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <p className="text-sm font-medium">Drag and drop an image here</p>
                <p className="text-xs text-muted-foreground">PNG, JPG, or GIF up to a few megabytes.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isPending}
                >
                  Browse image
                </Button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageInputChange}
                />
              </div>

              {pendingImageFile ? (
                <p className="text-xs text-muted-foreground">
                  Selected file: {pendingImageFile.name} ({formatFileSize(pendingImageFile.size)})
                </p>
              ) : null}

              {shouldDeleteExistingImage && !pendingImageFile ? (
                <p className="text-xs font-medium text-amber-600">Existing image will be removed when you save.</p>
              ) : null}

              {isImageLoading ? (
                <p className="text-sm text-muted-foreground">Loading preview…</p>
              ) : imagePreviewUrl ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Preview</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreviewUrl}
                    alt="Activity image preview"
                    className="h-auto max-h-48 w-full max-w-xs rounded-md border border-border object-contain"
                    loading="lazy"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No image selected.</p>
              )}

              <div className="space-y-1 text-xs text-muted-foreground">
                {isCreateMode
                  ? "Save the activity to upload the image."
                  : pendingImageFile
                    ? "New image will replace the current one when you save."
                    : shouldDeleteExistingImage
                      ? "Image will be removed when you save."
                      : imageBody?.imageFile
                        ? `Current file: ${imageBody.imageFile}`
                        : null}
              </div>

              {(pendingImageFile || imagePreviewUrl || shouldDeleteExistingImage) && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRemoveImage}
                    disabled={isPending}
                  >
                    {pendingImageFile ? "Discard image" : "Remove image"}
                  </Button>
                </div>
              )}
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
                  disabled={isPending || isProcessing || isCreateMode}
                >
                  {isRecording ? "Stop recording" : "Record"}
                </Button>
                {!isCreateMode ? (
                  pendingRecording ? (
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
                  ) : null
                ) : null}
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {isCreateMode ? (
                  <p>Save the activity to upload or record audio.</p>
                ) : pendingRecording ? (
                  <p>New recording will replace the existing file when you save.</p>
                ) : shouldDeleteExistingRecording ? (
                  <p>Recording will be removed when you save.</p>
                ) : voiceBody?.audioFile ? (
                  <p>Current file: {voiceBody.audioFile}</p>
                ) : (
                  <p>No recording selected.</p>
                )}
                {!isCreateMode && voiceBody?.duration != null ? (
                  <p>Duration: {voiceBody.duration.toFixed(1)}s</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {type === "file-download" || type === "upload-file" ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              {isCreateMode || !activity ? (
                <p className="text-sm text-muted-foreground">
                  Save the activity before uploading files.
                </p>
              ) : (
                <>
                  <div
                    onDragOver={handleFileDragOver}
                    onDragEnter={handleFileDragOver}
                    onDragLeave={handleFileDragLeave}
                    onDrop={handleFileDrop}
                    className={[
                      "flex h-28 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/40 p-4 text-center transition",
                      isFileDragActive ? "border-primary bg-primary/5" : "",
                      isUploadingFiles || isFilesLoading ? "opacity-60" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <p className="text-sm font-medium">Drag and drop files here</p>
                    <p className="text-xs text-muted-foreground">
                      Files will be available for pupils to download when viewing this activity.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingFiles}
                      className="mt-2"
                    >
                      Browse files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileInputChange}
                    />
                  </div>

                  {isFilesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading files…</p>
                  ) : activityFiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {activityFiles.map((file) => {
                        const sizeLabel = formatFileSize(file.size)
                        return (
                          <li
                            key={file.path}
                            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{file.name}</span>
                              {sizeLabel ? <span className="text-xs text-muted-foreground">{sizeLabel}</span> : null}
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteFile(file.name)}
                              disabled={isUploadingFiles}
                              aria-label={`Remove ${file.name}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : null}

          {type !== "text" &&
          type !== "show-video" &&
          type !== "voice" &&
          type !== "file-download" &&
          type !== "upload-file" &&
          type !== "display-image" ? (
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
              {isCreateMode ? "Create activity" : "Save changes"}
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
