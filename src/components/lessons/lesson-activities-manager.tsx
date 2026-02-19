"use client"

import type { ChangeEvent, DragEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, GripVertical, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react"

import type { FeedbackActivityBody, FeedbackActivityGroupSettings, LessonActivity } from "@/types"
import {
  createLessonActivityAction,
  deleteActivityFileAction,
  deleteLessonActivityAction,
  getActivityFileDownloadUrlAction,
  listActivityFilesAction,
  readLessonAssignmentsAction,
  readGroupsAction,
  reorderLessonActivitiesAction,
  updateLessonActivityAction,
  uploadActivitiesFromMarkdownAction,
  uploadActivityFileAction,
} from "@/lib/server-updates"
import { parseActivitiesMarkdown } from "@/lib/parse-activities-markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import {
  getImageBody,
  getFeedbackBody,
  getMcqBody,
  getShortTextBody,
  getVoiceBody,
  getYouTubeThumbnailUrl,
  isAbsoluteUrl,
  type ImageBody,
  type McqBody,
  type ShortTextBody,
  type VoiceBody,
} from "@/components/lessons/activity-view/utils"
import { LessonActivityView } from "@/components/lessons/activity-view"
import { MediaImage } from "@/components/ui/media-image"
import { isScorableActivityType, SCORABLE_ACTIVITY_TYPES } from "@/dino.config"

interface ActivityFileInfo {
  name: string
  path: string
  size?: number | null
}

interface AssignedGroupInfo {
  groupId: string
  label: string
  subject: string | null
  startDate: string | null
}

interface LessonActivitySuccessCriterionOption {
  successCriteriaId: string
  title: string
  learningObjectiveId: string | null
  learningObjectiveTitle: string | null
}

const ACTIVITY_TYPES = [
  { value: "text", label: "Text" },
  { value: "long-text-question", label: "Long text question" },
  { value: "file-download", label: "File download" },
  { value: "upload-file", label: "Upload file" },
  { value: "upload-url", label: "Upload URL" },
  { value: "display-image", label: "Display image" },
  { value: "display-key-terms", label: "Display key terms" },
  { value: "show-video", label: "Show video" },
  { value: "multiple-choice-question", label: "Multiple choice question" },
  { value: "short-text-question", label: "Short text question" },
  { value: "feedback", label: "Feedback" },
  { value: "text-question", label: "Text question" },
  { value: "voice", label: "Voice recording" },
  { value: "sketch-render", label: "Render Sketch" },
  { value: "share-my-work", label: "Share my work" },
  { value: "review-others-work", label: "Review others' work" },
] as const

type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number]["value"]

const SUMMATIVE_ELIGIBLE_ACTIVITY_LABELS = ACTIVITY_TYPES.filter((entry) =>
  SCORABLE_ACTIVITY_TYPES.includes(entry.value),
).map((entry) => entry.label)

const NEW_ACTIVITY_ID = "__new__"

const FEEDBACK_GROUP_DEFAULTS: FeedbackActivityGroupSettings = {
  isEnabled: false,
  showScore: false,
  showCorrectAnswers: false,
}

interface LessonActivitiesManagerProps {
  unitId: string
  lessonId: string
  initialActivities: LessonActivity[]
  availableSuccessCriteria: LessonActivitySuccessCriterionOption[]
}

export function LessonActivitiesManager({
  unitId,
  lessonId,
  initialActivities,
  availableSuccessCriteria,
}: LessonActivitiesManagerProps) {
  const router = useRouter()
  const [activities, setActivities] = useState<LessonActivity[]>(() => sortActivities(initialActivities))
  const [isPending, startTransition] = useTransition()

  const [editorActivityId, setEditorActivityId] = useState<string | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const pendingReorderRef = useRef<{ next: LessonActivity[]; previous: LessonActivity[] } | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [mdPasteDialogOpen, setMdPasteDialogOpen] = useState(false)
  const [mdPasteContent, setMdPasteContent] = useState("")
  const [voicePreviewState, setVoicePreviewState] = useState<
    Record<string, { url: string | null; loading: boolean }>
  >({})
  const [fileDownloadState, setFileDownloadState] = useState<
    Record<string, { loading: boolean; hasFiles?: boolean }>
  >({})
  const [imagePreviewState, setImagePreviewState] = useState<
    Record<string, { url: string | null; loading: boolean; error: boolean }>
  >({})
  const [summativePending, setSummativePending] = useState<Record<string, boolean>>({})
  const [imageModal, setImageModal] = useState<{ open: boolean; url: string | null; title: string }>({
    open: false,
    url: null,
    title: "",
  })
  const [assignedGroups, setAssignedGroups] = useState<AssignedGroupInfo[]>([])
  const [assignedGroupsLoading, setAssignedGroupsLoading] = useState(false)
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const handleFilePresenceChange = useCallback((activityId: string, hasFiles: boolean) => {
    setFileDownloadState((previous) => ({
      ...previous,
      [activityId]: { loading: false, hasFiles },
    }))
  }, [])

  useEffect(() => {
    setActivities(sortActivities(initialActivities))
    setImagePreviewState({})
    setSummativePending({})
  }, [initialActivities])

  useEffect(() => {
    let cancelled = false
    setAssignedGroupsLoading(true)

    const loadAssignedGroups = async () => {
      try {
        const [assignmentsResult, groupsResult] = await Promise.all([
          readLessonAssignmentsAction(),
          readGroupsAction(),
        ])

        if (cancelled) {
          return
        }

        if (assignmentsResult.error) {
          toast.error("Failed to load lesson group assignments", {
            description: assignmentsResult.error,
          })
          setAssignedGroups([])
          return
        }

        if (groupsResult.error) {
          toast.error("Failed to load groups", {
            description: groupsResult.error,
          })
        }

        const assignments = (assignmentsResult.data ?? []).filter(
          (assignment) => assignment.lesson_id === lessonId,
        )
        const groups = groupsResult.data ?? []
        const groupMap = new Map(groups.map((group) => [group.group_id, group]))

        const unique = new Map<string, AssignedGroupInfo>()
        assignments.forEach((assignment) => {
          const group = groupMap.get(assignment.group_id)
          const subject = group?.subject ?? null
          const label =
            (subject && subject.trim().length > 0 ? subject.trim() : null) ?? assignment.group_id

          unique.set(assignment.group_id, {
            groupId: assignment.group_id,
            label,
            subject,
            startDate: assignment.start_date ?? null,
          })
        })

        const ordered = Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label))
        setAssignedGroups(ordered)
      } catch (error) {
        if (!cancelled) {
          console.error("[activities] Failed to load assigned groups", error)
          toast.error("Failed to load lesson group assignments")
          setAssignedGroups([])
        }
      } finally {
        if (!cancelled) {
          setAssignedGroupsLoading(false)
        }
      }
    }

    void loadAssignedGroups()

    return () => {
      cancelled = true
    }
  }, [lessonId])

  const typeLabelMap = useMemo(() => {
    return ACTIVITY_TYPES.reduce<Record<string, string>>((acc, type) => {
      acc[type.value] = type.label
      return acc
    }, {})
  }, [])

  useEffect(() => {
    const targets = activities
      .filter((activity) => activity.type === "upload-file" || activity.type === "file-download")
      .map((activity) => activity.activity_id)
      .filter((activityId) => {
        const status = fileDownloadState[activityId]
        return !status || (!status.loading && status.hasFiles === undefined)
      })

    if (targets.length === 0) return

    setFileDownloadState((previous) => {
      const next = { ...previous }
      targets.forEach((activityId) => {
        const current = next[activityId] ?? { loading: false }
        if (!current.loading && current.hasFiles === undefined) {
          next[activityId] = { ...current, loading: true }
        }
      })
      return next
    })

    let cancelled = false

    const fetchFilePresence = async () => {
      for (const activityId of targets) {
        try {
          const result = await listActivityFilesAction(lessonId, activityId)
          if (cancelled) return
          const hasFiles = Boolean(result.data?.length)
          setFileDownloadState((previous) => ({
            ...previous,
            [activityId]: { loading: false, hasFiles },
          }))
        } catch (error) {
          if (cancelled) return
          console.error(`[activities] Failed to check files for activity ${activityId}:`, error)
          setFileDownloadState((previous) => ({
            ...previous,
            [activityId]: { loading: false, hasFiles: false },
          }))
        }
      }
    }

    void fetchFilePresence()

    return () => {
      cancelled = true
    }
  }, [activities, lessonId]) // exclude fileDownloadState to avoid cancelling in-flight checks

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
          error: false,
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
              error: true,
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
            error: false,
          },
        }))
      } catch (error) {
        console.error("[activities] Failed to fetch image thumbnail:", error)
        setImagePreviewState((prev) => ({
          ...prev,
          [activity.activity_id]: {
            url: null,
            loading: false,
            error: true,
          },
        }))
      }
    },
    [],
  )

  useEffect(() => {
    const pendingFetches: { activity: LessonActivity; fileName: string }[] = []

    setImagePreviewState((prev) => {
      const next: Record<string, { url: string | null; loading: boolean; error: boolean }> = { ...prev }
      for (const activity of activities) {
        if (activity.type !== "display-image") {
          continue
        }

        const existing = prev[activity.activity_id]
        const body = getImageBody(activity)
        const raw = (activity.body_data ?? {}) as Record<string, unknown>
        const rawFileUrl =
          typeof raw.fileUrl === "string"
            ? raw.fileUrl
            : typeof raw.file_url === "string"
              ? raw.file_url
              : null

        const directUrl = body.imageUrl && isAbsoluteUrl(body.imageUrl) ? body.imageUrl : null
        const fallbackDirect =
          directUrl || (rawFileUrl && isAbsoluteUrl(rawFileUrl) ? rawFileUrl : null)

        const fileNameCandidate = body.imageFile && !isAbsoluteUrl(body.imageFile) ? body.imageFile : null
        const fallbackFileName =
          !fileNameCandidate && rawFileUrl && !isAbsoluteUrl(rawFileUrl) ? rawFileUrl : null
        const finalFileName = fileNameCandidate ?? fallbackFileName

        if (fallbackDirect) {
          next[activity.activity_id] = { url: fallbackDirect, loading: false, error: false }
          continue
        }

        if (finalFileName) {
          if (!existing || (!existing.url && !existing.loading && !existing.error)) {
            pendingFetches.push({ activity, fileName: finalFileName })
            next[activity.activity_id] = {
              url: existing?.url ?? null,
              loading: true,
              error: false,
            }
          }
          continue
        }

        if (!existing || (!existing.url && !existing.loading && !existing.error)) {
          console.error("[activities] Missing image reference for display-image activity", {
            activityId: activity.activity_id,
            lessonId: activity.lesson_id,
          })
        }

        next[activity.activity_id] = { url: null, loading: false, error: false }
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

  const uploadPendingFilesForNewActivity = useCallback(
    async (activityId: string, files: File[]) => {
      const items = files.filter((file) => file.size > 0)
      if (items.length === 0) return { success: true, uploadedNames: [] as string[] }

      let hadError = false
      const uploadedNames: string[] = []
      for (const file of items) {
        const formData = new FormData()
        formData.append("unitId", unitId)
        formData.append("lessonId", lessonId)
        formData.append("activityId", activityId)
        formData.append("file", file)

        const result = await uploadActivityFileAction(formData)
        if (!result.success) {
          hadError = true
          toast.error(`Failed to upload ${file.name}`, {
            description: result.error ?? "Please try again later.",
          })
          break
        }
        uploadedNames.push(file.name)
      }

      if (!hadError) {
        toast.success("Files uploaded")
      }

      return { success: !hadError, uploadedNames }
    },
    [lessonId, unitId],
  )

  const handleEditorSubmit = ({
    mode,
    activityId,
    title,
    type,
    bodyData,
    imageSubmission,
    successCriteriaIds,
    pendingUploadFiles = [],
  }: {
    mode: "create" | "edit"
    activityId?: string
    title: string
    type: ActivityTypeValue
    bodyData: unknown
    imageSubmission?: ImageSubmissionPayload
    successCriteriaIds: string[]
    pendingUploadFiles?: File[]
  }) => {
    startTransition(async () => {
      if (mode === "create") {
        if (type === "display-image" && imageSubmission) {
          const createBody = imageSubmission.pendingFile ? { imageFile: null, imageUrl: null, fileUrl: null } : bodyData

        const createResult = await createLessonActivityAction(unitId, lessonId, {
          title,
          type,
          bodyData: createBody,
          successCriteriaIds,
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
            [createdActivity.activity_id]: { url: null, loading: false, error: false },
          }))
          if (pendingUploadFiles.length > 0) {
            const uploadResult = await uploadPendingFilesForNewActivity(
              createdActivity.activity_id,
              pendingUploadFiles,
            )
            if (!uploadResult.success) {
              for (const name of uploadResult.uploadedNames) {
                await deleteActivityFileAction(unitId, lessonId, createdActivity.activity_id, name)
              }
              await deleteLessonActivityAction(unitId, lessonId, createdActivity.activity_id)
              toast.error("Files failed to upload", {
                description: "Activity was removed because the files could not be uploaded. Please try again.",
              })
              return
            }
          }
          toast.success("Activity created")
          closeEditor()
          router.refresh()
          return
        }

        const result = await createLessonActivityAction(unitId, lessonId, {
          title,
          type,
          bodyData,
          successCriteriaIds,
        })

        if (!result.success || !result.data) {
          toast.error("Unable to create activity", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        setActivities((prev) => sortActivities([...prev, result.data!]))
        if (pendingUploadFiles.length > 0 && result.data?.activity_id) {
          const uploadResult = await uploadPendingFilesForNewActivity(result.data.activity_id, pendingUploadFiles)
          if (!uploadResult.success) {
            for (const name of uploadResult.uploadedNames) {
              await deleteActivityFileAction(unitId, lessonId, result.data.activity_id, name)
            }
            await deleteLessonActivityAction(unitId, lessonId, result.data.activity_id)
            toast.error("Files failed to upload", {
              description: "Activity was removed because the files could not be uploaded. Please try again.",
            })
            return
          }
        }
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
          successCriteriaIds,
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
          [activityId]: { url: null, loading: false, error: false },
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
        successCriteriaIds,
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
    setFileDownloadState((prev) => ({
      ...prev,
      [activityId]: { ...prev[activityId], loading: true },
    }))

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
        setFileDownloadState((prev) => ({
          ...prev,
          [activityId]: { loading: false, hasFiles: false },
        }))
        toast.error("No files uploaded yet")
        return
      }

      const hasMultiple = files.length > 1
      setFileDownloadState((prev) => ({
        ...prev,
        [activityId]: { loading: false, hasFiles: true },
      }))

      if (hasMultiple) {
        const url = `/api/activity-files/archive?lessonId=${encodeURIComponent(lessonId)}&activityId=${encodeURIComponent(activityId)}`
        const link = document.createElement("a")
        link.href = url
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        link.click()
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
      setFileDownloadState((prev) => ({
        ...prev,
        [activityId]: { ...prev[activityId], loading: false },
      }))
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
        if (result.status === "error") {
          if (previousActivities) {
            setActivities(previousActivities)
          }
          toast.error("Unable to reorder activities", {
            description: result.message ?? "Please try again later.",
          })
          return
        }
        toast.success("Activity order update queued")
      })
    },
    [lessonId, router, startTransition, unitId],
  )

  const handleDownloadTemplate = useCallback(() => {
    // Build unique LOs and SCs from availableSuccessCriteria
    const loMap = new Map<string, string>()
    for (const sc of availableSuccessCriteria) {
      if (sc.learningObjectiveId && sc.learningObjectiveTitle) {
        loMap.set(sc.learningObjectiveId, sc.learningObjectiveTitle)
      }
    }
    const los = [...loMap.values()]
    const scs = availableSuccessCriteria.map((sc) => ({
      title: sc.title,
      loTitle: sc.learningObjectiveTitle,
    }))

    let template = `# Activities Template
#
# FORMAT RULES:
# - Each activity starts with a level-2 heading: ## MCQ: Title  or  ## SHORT: Title
# - MCQ (Multiple Choice Question):
#     Question text on plain lines after the heading.
#     Options as a checklist: - [x] Correct answer  and  - [ ] Wrong answer
#     Exactly 1 correct answer marked with [x]. 2–4 options total.
# - SHORT (Short Text Question):
#     Question text on plain lines after the heading.
#     Model answer on a line starting with: ANSWER: your answer here
# - Optionally link to a Learning Objective:  LO: Objective Title
# - Optionally link to Success Criteria:     SC: Criterion Description
#   (SC must belong to the specified LO if both are provided)
#
`

    if (los.length > 0) {
      template += `\n# AVAILABLE LEARNING OBJECTIVES FOR THIS LESSON:\n`
      for (const lo of los) {
        template += `#   - ${lo}\n`
      }
    }

    if (scs.length > 0) {
      template += `#\n# AVAILABLE SUCCESS CRITERIA FOR THIS LESSON:\n`
      for (const sc of scs) {
        template += `#   - ${sc.title}${sc.loTitle ? ` (LO: ${sc.loTitle})` : ""}\n`
      }
    }

    template += `\n## MCQ: Example Multiple Choice Question

What is 2 + 2?

- [ ] 3
- [x] 4
- [ ] 5
${los[0] ? `\nLO: ${los[0]}` : ""}
${scs[0] ? `SC: ${scs[0].title}` : ""}

## SHORT: Example Short Answer Question

Explain why the sky is blue.

ANSWER: The sky appears blue because of Rayleigh scattering of sunlight by the atmosphere.
${los[0] ? `\nLO: ${los[0]}` : ""}
${scs[0] ? `SC: ${scs[0].title}` : ""}
`

    const blob = new Blob([template], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "activities-template.md"
    a.click()
    URL.revokeObjectURL(url)
  }, [availableSuccessCriteria])

  const handleMarkdownSubmit = useCallback(
    (content: string) => {
      if (!content.trim()) {
        toast.error("No content", { description: "Please paste some markdown content first." })
        return
      }

      const parseResult = parseActivitiesMarkdown(content)

      if (!parseResult.success) {
        toast.error("Failed to parse markdown", { description: parseResult.error })
        return
      }

      const resolvedActivities: Array<{
        title: string
        type: "multiple-choice-question" | "short-text-question"
        bodyData: unknown
        successCriteriaIds: string[]
      }> = []

      for (const parsed of parseResult.activities) {
        const successCriteriaIds: string[] = []

        // Resolve LO reference
        let loId: string | null = null
        if (parsed.loReference) {
          const matchedLo = availableSuccessCriteria.find(
            (sc) =>
              sc.learningObjectiveTitle !== null &&
              sc.learningObjectiveTitle.trim().toLowerCase() === parsed.loReference!.trim().toLowerCase(),
          )
          if (!matchedLo) {
            toast.error("Upload failed", {
              description: `Activity "${parsed.title}" references Learning Objective "${parsed.loReference}" which is not attached to this lesson.`,
            })
            return
          }
          loId = matchedLo.learningObjectiveId
        }

        // Resolve SC references
        for (const scRef of parsed.scReferences) {
          const matchedSc = availableSuccessCriteria.find(
            (sc) => sc.title.trim().toLowerCase() === scRef.trim().toLowerCase(),
          )
          if (!matchedSc) {
            toast.error("Upload failed", {
              description: `Activity "${parsed.title}" references Success Criterion "${scRef}" which is not attached to this lesson.`,
            })
            return
          }
          // If LO specified, verify SC belongs to that LO
          if (loId !== null && matchedSc.learningObjectiveId !== loId) {
            toast.error("Upload failed", {
              description: `Activity "${parsed.title}" references Success Criterion "${scRef}" which does not belong to Learning Objective "${parsed.loReference}".`,
            })
            return
          }
          successCriteriaIds.push(matchedSc.successCriteriaId)
        }

        resolvedActivities.push({
          title: parsed.title,
          type: parsed.type,
          bodyData: parsed.bodyData,
          successCriteriaIds,
        })
      }

      setIsUploading(true)
      setMdPasteDialogOpen(false)
      startTransition(async () => {
        try {
          const result = await uploadActivitiesFromMarkdownAction(unitId, lessonId, resolvedActivities)
          if (result.success && result.data) {
            toast.success(`${result.data.count} activities added successfully`)
            setMdPasteContent("")
            router.refresh()
          } else {
            toast.error("Upload failed", { description: result.error ?? "An unknown error occurred." })
          }
        } catch (error) {
          console.error("[activities] Failed to upload from markdown", error)
          toast.error("Upload failed", {
            description: error instanceof Error ? error.message : "An unknown error occurred.",
          })
        } finally {
          setIsUploading(false)
        }
      })
    },
    [availableSuccessCriteria, lessonId, router, startTransition, unitId],
  )

  const openImageModal = useCallback((url: string | null, title: string) => {
    if (!url) return
    setImageModal({ open: true, url, title })
  }, [])

  const isBusy = isPending || isUploading

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

  const toggleSummative = useCallback(
    (activity: LessonActivity, nextValue: boolean) => {
      const activityType = activity.type ?? ""
      if (nextValue && !isScorableActivityType(activityType)) {
        const allowedList =
          SUMMATIVE_ELIGIBLE_ACTIVITY_LABELS.length > 0
            ? SUMMATIVE_ELIGIBLE_ACTIVITY_LABELS.join(", ")
            : SCORABLE_ACTIVITY_TYPES.join(", ")
        toast.error("Only scorable activity types can be marked as assessments.", {
          description: `Allowed types: ${allowedList || "none configured"}.`,
        })
        return
      }

      const activityId = activity.activity_id
      const previousValue = activity.is_summative ?? false

      setSummativePending((prev) => ({ ...prev, [activityId]: true }))
      setActivities((prev) =>
        prev.map((item) =>
          item.activity_id === activityId ? { ...item, is_summative: nextValue } : item,
        ),
      )

      startTransition(async () => {
        try {
          const result = await updateLessonActivityAction(unitId, lessonId, activityId, {
            isSummative: nextValue,
          })

          if (!result.success || !result.data) {
            setActivities((prev) =>
              prev.map((item) =>
                item.activity_id === activityId ? { ...item, is_summative: previousValue } : item,
              ),
            )
            toast.error("Unable to update summative status", {
              description: result.error ?? "Please try again later.",
            })
            return
          }

          setActivities((prev) =>
            prev.map((item) => (item.activity_id === activityId ? result.data! : item)),
          )
          router.refresh()
        } catch (error) {
          console.error("[activities] Failed to update summative flag", error)
          setActivities((prev) =>
            prev.map((item) =>
              item.activity_id === activityId ? { ...item, is_summative: previousValue } : item,
            ),
          )
          toast.error("Unable to update summative status", {
            description: error instanceof Error ? error.message : "Please try again later.",
          })
        } finally {
          setSummativePending((prev) => {
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
    if (activities.length === 0) {
      toast.info("This lesson doesn't have any activities yet.")
      return
    }

    router.push(`/lessons/${encodeURIComponent(lessonId)}/activities`)
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
                disabled={activities.length === 0}
                className="w-full sm:w-auto"
              >
                <Play className="mr-2 h-4 w-4" /> Show Activities
              </Button>
              <Button
                onClick={handleDownloadTemplate}
                variant="outline"
                className="w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" /> Download Template
              </Button>
              <Button
                onClick={() => setMdPasteDialogOpen(true)}
                variant="outline"
                disabled={isBusy}
                className="w-full sm:w-auto"
              >
                {isUploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Paste Activities
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
                const isUploadFile = activity.type === "upload-file"
                const fileStatus = isFileResource ? fileDownloadState[activity.activity_id] : null
                const fileHasFiles = fileStatus?.hasFiles ?? false
                const shouldShowDownloadButton = Boolean(isUploadFile && fileHasFiles)
                const isDisplayImage = activity.type === "display-image"
                const isShowVideo = activity.type === "show-video"
                const imageBody = isDisplayImage ? getImageBody(activity) : null
                const imageThumbnail = isDisplayImage
                  ? imagePreviewState[activity.activity_id]?.url ?? imageBody?.imageUrl ?? null
                  : null
                const summativeUpdating = summativePending[activity.activity_id] ?? false
                const summativeDisabled = !isScorableActivityType(activity.type)
                const canDownloadFiles = !isFileResource || fileHasFiles
                const preview = renderActivityPreview(activity, imageThumbnail, {
                  onSummativeChange: (checked) => toggleSummative(activity, checked),
                  summativeUpdating,
                  summativeDisabled,
                  onImageClick: (url, title) => openImageModal(url, title ?? activity.title ?? "Activity image"),
                  onDownloadFile: canDownloadFiles ? () => handleFileDownload(activity) : undefined,
                })
                const inlinePreview = (() => {
                  if (isDisplayImage) return preview
                  if (isShowVideo && videoThumbnail) {
                    return (
                      <a
                        href={videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0"
                      >
                        <div className="relative h-[60px] w-[100px] overflow-hidden rounded-md border border-border">
                          <MediaImage
                            src={videoThumbnail}
                            alt="YouTube video thumbnail"
                            fill
                            sizes="120px"
                            className="object-cover"
                            loading="lazy"
                          />
                        </div>
                      </a>
                    )
                  }
                  if (isVoice) {
                    return (
                      <div className="flex items-center">
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
                      </div>
                    )
                  }
                  return preview
                })()
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
                          <div className="flex flex-1 flex-col gap-2">
                            <div className="flex w-full flex-wrap items-start gap-3">
                              <div className="flex min-w-[200px] flex-1 flex-col gap-2 md:max-w-[33%] md:basis-1/3 md:flex-none">
                                <p className="font-medium text-foreground">{activity.title}</p>
                                <Badge variant="secondary" className="w-fit capitalize text-[10px] leading-3 px-1.5 py-0.5">
                                  {label}
                                </Badge>
                              </div>
                              <div className="flex min-w-[200px] flex-1 md:max-w-[33%] md:basis-1/3">
                                <div className="w-full text-sm text-muted-foreground [&>*]:w-full [&_.prose]:max-w-none [&_p]:m-0">
                                  {isVoice ? (
                                    <div className="flex items-center">
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
                                    </div>
                                  ) : isUploadFile ? (
                                    <div className="space-y-2">
                                      {inlinePreview}
                                      {shouldShowDownloadButton ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          className="inline-flex items-center gap-2"
                                          disabled={fileStatus?.loading}
                                          onClick={(event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            handleFileDownload(activity)
                                          }}
                                        >
                                          {fileStatus?.loading ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Download className="h-4 w-4" />
                                          )}
                                          Download files
                                        </Button>
                                      ) : null}
                                    </div>
                                  ) : (
                                    inlinePreview
                                  )}
                                </div>
                              </div>
                              <div className="ml-auto flex items-center gap-2">
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
                        </div>
                      </div>
                    </div>
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
        assignedGroups={assignedGroups}
        assignedGroupsLoading={assignedGroupsLoading}
        availableSuccessCriteria={availableSuccessCriteria}
        onFilePresenceChange={handleFilePresenceChange}
        allActivities={activities}
      />

      <Dialog
        open={imageModal.open}
        onOpenChange={(open) =>
          setImageModal((prev) => ({
            ...prev,
            open,
            ...(open ? {} : { url: null, title: "" }),
          }))
        }
      >
        <DialogContent className="w-[90vw] max-w-[75vw]">
          <DialogTitle>{imageModal.title || "Activity image"}</DialogTitle>
          {imageModal.url ? (
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
              <MediaImage
                src={imageModal.url}
                alt={imageModal.title || "Activity image"}
                fill
                sizes="100vw"
                className="object-contain"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Image not available.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={mdPasteDialogOpen} onOpenChange={setMdPasteDialogOpen}>
        <DialogContent className="flex w-[90vw] max-w-2xl max-h-[85vh] flex-col">
          <DialogTitle>Paste Activities</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Paste your activities markdown below. Use the Download Template button for the expected format.
          </p>
          <Textarea
            value={mdPasteContent}
            onChange={(e) => setMdPasteContent(e.target.value)}
            placeholder="Paste your markdown here..."
            className="min-h-0 flex-1 resize-none font-mono text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMdPasteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleMarkdownSubmit(mdPasteContent)}
              disabled={!mdPasteContent.trim() || isUploading}
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Add Activities
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
  const record = activity.body_data as Record<string, unknown>
  const direct = record.text
  if (typeof direct === "string") return direct
  const question = record.question
  if (typeof question === "string") return question
  return ""
}

function extractUploadInstructions(activity: LessonActivity): string {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return ""
  }
  const value = (activity.body_data as Record<string, unknown>).instructions
  return typeof value === "string" ? value : ""
}

function extractKeyTermsMarkdown(activity: LessonActivity): string {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return ""
  }
  const value = (activity.body_data as Record<string, unknown>).markdown
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
  if (type === "text-question") {
    return { question: text, text }
  }
  if (type === "long-text-question") {
    return { question: text }
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
  if (type === "sketch-render") {
    return { instructions: text }
  }
  if (type === "display-key-terms") {
    return { markdown: text }
  }
  return fallback ?? null
}

function renderActivityPreview(
  activity: LessonActivity,
  resolvedImageUrl: string | null,
  options?: {
    onSummativeChange?: (nextValue: boolean) => void
    summativeUpdating?: boolean
    summativeDisabled?: boolean
    onImageClick?: (url: string, title: string | null) => void
    onDownloadFile?: () => void
  },
) {
  return (
    <LessonActivityView
      mode="short"
      activity={activity}
      lessonId={activity.lesson_id ?? ""}
      resolvedImageUrl={resolvedImageUrl ?? null}
      onSummativeChange={options?.onSummativeChange}
      summativeUpdating={options?.summativeUpdating}
      summativeDisabled={options?.summativeDisabled}
      onImageClick={options?.onImageClick}
      onDownloadFile={options?.onDownloadFile}
    />
  )
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
    successCriteriaIds: string[]
  }) => void
  unitId: string
  lessonId: string
  assignedGroups: AssignedGroupInfo[]
  assignedGroupsLoading: boolean
  availableSuccessCriteria: LessonActivitySuccessCriterionOption[]
  onFilePresenceChange?: (activityId: string, hasFiles: boolean) => void
  allActivities: LessonActivity[]
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
  assignedGroups,
  assignedGroupsLoading,
  availableSuccessCriteria,
  onFilePresenceChange,
  allActivities,
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
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([])
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
  const [mcqBody, setMcqBody] = useState<McqBody>(() => createDefaultMcqBody())
  const [feedbackBody, setFeedbackBody] = useState<FeedbackActivityBody>(() => createDefaultFeedbackBody())
  const [shortTextBody, setShortTextBody] = useState<ShortTextBody>(() => createDefaultShortTextBody())
  const [selectedSuccessCriteriaIds, setSelectedSuccessCriteriaIds] = useState<string[]>([])
  const [shareMyWorkName, setShareMyWorkName] = useState("")
  const [reviewShareActivityId, setReviewShareActivityId] = useState("")

  const normalizedShortTextBody = useMemo(() => normalizeShortTextBody(shortTextBody), [shortTextBody])
  const shortTextValidationMessage = useMemo(
    () => validateShortTextBody(normalizedShortTextBody),
    [normalizedShortTextBody],
  )

  useEffect(() => {
    if (!open) {
      setPendingUploadFiles([])
    }
  }, [open])

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
          onFilePresenceChange?.(targetActivityId, false)
          return []
        }

        const files = result.data ?? []
        setActivityFiles(files)
        onFilePresenceChange?.(targetActivityId, files.length > 0)
        return files
      } catch (error) {
        console.error("[activities] Failed to load activity files:", error)
        toast.error("Unable to load files", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        setActivityFiles([])
        onFilePresenceChange?.(targetActivityId, false)
        return []
      } finally {
        setIsFilesLoading(false)
      }
    },
    [lessonId, onFilePresenceChange],
  )

  async function uploadFilesForActivity(targetActivityId: string, files: File[]) {
    const items = files.filter((file) => file.size > 0)
    if (items.length === 0) return { success: true }

    setIsUploadingFiles(true)
    let hadError = false

    for (const file of items) {
      const formData = new FormData()
      formData.append("unitId", unitId)
      formData.append("lessonId", lessonId)
      formData.append("activityId", targetActivityId)
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
    await refreshActivityFiles(targetActivityId)
    setIsFileDragActive(false)

    if (!hadError) {
      toast.success("Files uploaded")
    }

    return { success: !hadError }
  }

  const mcqOptionSlots = useMemo(() => ensureOptionSlots(mcqBody.options), [mcqBody.options])
  const mcqValidationMessage = useMemo(() => validateMcqBody(mcqBody), [mcqBody])

  const successCriteriaOptions = useMemo(() => {
    return availableSuccessCriteria
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [availableSuccessCriteria])

  const updateMcqBody = useCallback((updater: (current: McqBody) => McqBody) => {
    setMcqBody((previous) => normalizeMcqBody(updater(normalizeMcqBody(previous))))
  }, [])

  const handleMcqQuestionChange = useCallback(
    (value: string) => {
      updateMcqBody((current) => ({ ...current, question: value }))
    },
    [updateMcqBody],
  )

  const handleMcqCommit = useCallback(() => {
    setMcqBody((prev) => normalizeMcqBody(prev))
  }, [])

  const handleMcqOptionTextChange = useCallback(
    (optionId: string, value: string) => {
      updateMcqBody((current) => ({
        ...current,
        options: current.options.map((option) =>
          option.id === optionId ? { ...option, text: value } : option,
        ),
      }))
    },
    [updateMcqBody],
  )

  const handleMcqCorrectOptionChange = useCallback(
    (optionId: string) => {
      const target = mcqOptionSlots.find((option) => option.id === optionId)
      if (!target || target.text.trim().length === 0) {
        toast.error("Add text to this answer before marking it correct.")
        return
      }

      updateMcqBody((current) => ({
        ...current,
        correctOptionId: optionId,
      }))
    },
    [mcqOptionSlots, updateMcqBody],
  )

  const handleShortTextQuestionChange = useCallback((value: string) => {
    setShortTextBody((current) => ({ ...current, question: value }))
  }, [])

  const handleShortTextModelAnswerChange = useCallback((value: string) => {
    setShortTextBody((current) => ({ ...current, modelAnswer: value }))
  }, [])

  const handleShortTextCommit = useCallback(() => {
    setShortTextBody((current) => normalizeShortTextBody(current))
  }, [])

  const handleSuccessCriteriaToggle = useCallback(
    (successCriteriaId: string, value: boolean | "indeterminate") => {
      const shouldSelect = value === true
      setSelectedSuccessCriteriaIds((previous) => {
        if (shouldSelect) {
          if (previous.includes(successCriteriaId)) {
            return previous
          }
          return [...previous, successCriteriaId]
        }
        return previous.filter((id) => id !== successCriteriaId)
      })
    },
    [],
  )

  const updateFeedbackSettings = useCallback(
    (groupId: string, changes: Partial<FeedbackActivityGroupSettings>) => {
      setFeedbackBody((previous) => {
        const normalized = normalizeFeedbackBody(previous)
        const nextGroups = { ...normalized.groups }
        const existing = nextGroups[groupId] ?? FEEDBACK_GROUP_DEFAULTS
        const next: FeedbackActivityGroupSettings = {
          ...FEEDBACK_GROUP_DEFAULTS,
          ...existing,
          ...changes,
        }

        if (changes.isEnabled === false) {
          next.showScore = false
          next.showCorrectAnswers = false
        }

        if (changes.showScore === true || changes.showCorrectAnswers === true) {
          next.isEnabled = true
        }

        nextGroups[groupId] = next
        return { ...normalized, groups: nextGroups }
      })
    },
    [setFeedbackBody],
  )

  const feedbackRows = useMemo(() => {
    return assignedGroups.map((group) => ({
      group,
      settings: feedbackBody.groups[group.groupId] ?? FEEDBACK_GROUP_DEFAULTS,
    }))
  }, [assignedGroups, feedbackBody])

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
            : typeof rawBody.file_url === "string" && rawBody.file_url.trim().length > 0
              ? (rawBody.file_url as string)
              : null

      const candidateExternalUrl =
        typeof nextBody.imageUrl === "string" && nextBody.imageUrl.trim().length > 0
          ? nextBody.imageUrl
          : null

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

  const handleUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const items = Array.from(files).filter((file) => file.size > 0)
      if (items.length === 0) {
        return
      }

      if (!activity) {
        setPendingUploadFiles((prev) => [...prev, ...items])
        setIsFileDragActive(false)
        toast.success("Files queued for upload. They will upload after you create the activity.")
        return
      }

      await uploadFilesForActivity(activity.activity_id, items)
    },
    [activity],
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

    setPendingImageFile(file)
    setShouldDeleteExistingImage(false)
    setIsImageLoading(true)

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null
      if (result) {
        setImagePreviewUrl(result)
      } else {
        toast.error("Could not preview image", {
          description: "Please try another image file.",
        })
        setImagePreviewUrl(null)
      }
      setIsImageLoading(false)
    }
    reader.onerror = () => {
      toast.error("Could not read image", {
        description: "Please try another image file.",
      })
      setIsImageLoading(false)
      setImagePreviewUrl(null)
    }
    reader.readAsDataURL(file)

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
            ((original as Record<string, unknown>).fileUrl as string).trim().length > 0) ||
          (typeof (original as Record<string, unknown>)?.file_url === "string" &&
            ((original as Record<string, unknown>).file_url as string).trim().length > 0),
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
      setMcqBody(createDefaultMcqBody())
      setShortTextBody(createDefaultShortTextBody())
      setFeedbackBody(createDefaultFeedbackBody())
      setSelectedSuccessCriteriaIds([])
      return
    }

    if (open && activity && mode === "edit") {
      const ensuredType = ensureActivityType(activity.type)
      setTitle(activity.title)
      setType(ensuredType)
      const initialText =
        ensuredType === "upload-file" ? extractUploadInstructions(activity)
        : ensuredType === "display-key-terms" ? extractKeyTermsMarkdown(activity)
        : extractText(activity)
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
        setIsPlaybackLoading(Boolean(voice.audioFile))
      } else {
        setIsPlaybackLoading(false)
      }
      if (ensuredType === "file-download" || ensuredType === "upload-file") {
        void refreshActivityFiles(activity.activity_id)
      } else {
        setActivityFiles([])
      }
      if (ensuredType === "display-image") {
        applyImageFromActivity(activity)
      } else {
        resetImageState()
      }
      if (ensuredType === "multiple-choice-question") {
        setMcqBody(normalizeMcqBody(getMcqBody(activity)))
      } else {
        setMcqBody(createDefaultMcqBody())
      }
      if (ensuredType === "short-text-question") {
        setShortTextBody(normalizeShortTextBody(getShortTextBody(activity)))
      } else {
        setShortTextBody(createDefaultShortTextBody())
      }
      if (ensuredType === "feedback") {
        setFeedbackBody(
          syncFeedbackBodyWithGroups(
            normalizeFeedbackBody(getFeedbackBody(activity)),
            assignedGroups,
          ),
        )
      } else {
        setFeedbackBody(createDefaultFeedbackBody())
      }

      const activitySuccessCriteriaIds = Array.isArray(activity.success_criteria_ids)
        ? activity.success_criteria_ids.filter((id): id is string => typeof id === "string")
        : []

      const orderedSelection = successCriteriaOptions
        .map((option) => option.successCriteriaId)
        .filter((id) => activitySuccessCriteriaIds.includes(id))

      setSelectedSuccessCriteriaIds(orderedSelection)
      return
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
      setMcqBody(createDefaultMcqBody())
      setShortTextBody(createDefaultShortTextBody())
      setFeedbackBody(createDefaultFeedbackBody())
      setSelectedSuccessCriteriaIds([])
    }
  }, [
    activity,
    applyImageFromActivity,
    assignedGroups,
    isCreateMode,
    mode,
    open,
    refreshActivityFiles,
    resetImageState,
    successCriteriaOptions,
  ])

  useEffect(() => {
    if (!open) {
      return
    }
    setSelectedSuccessCriteriaIds((previous) =>
      successCriteriaOptions
        .map((option) => option.successCriteriaId)
        .filter((id) => previous.includes(id)),
    )
  }, [open, successCriteriaOptions])

  useEffect(() => {
    if (!open || type !== "feedback") {
      return
    }
    setFeedbackBody((prev) => syncFeedbackBodyWithGroups(normalizeFeedbackBody(prev), assignedGroups))
  }, [assignedGroups, open, type])

  useEffect(() => {
    setRawBodyError(null)
    if (isCreateMode) {
      if (type === "text" || type === "text-question" || type === "long-text-question" || type === "upload-file" || type === "sketch-render" || type === "display-key-terms") {
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

      if (type === "multiple-choice-question") {
        setText("")
        setVideoUrl("")
        setRawBody("")
        setMcqBody(createDefaultMcqBody())
        return
      }

      if (type === "short-text-question") {
        setText("")
        setVideoUrl("")
        setRawBody("")
        setShortTextBody(createDefaultShortTextBody())
        return
      }

      if (type === "feedback") {
        setText("")
        setVideoUrl("")
        setRawBody("")
        setFeedbackBody(createDefaultFeedbackBody())
        return
      }

      if (type === "share-my-work") {
        setText("")
        setRawBody("")
        setShareMyWorkName("")
        return
      }

      if (type === "review-others-work") {
        setText("")
        setRawBody("")
        setReviewShareActivityId("")
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

    if (type === "text" || type === "text-question" || type === "long-text-question") {
      setVideoUrl("")
      setText(activity ? extractText(activity) : "")
      setRawBody("")
      return
    }

    if (type === "sketch-render") {
      setVideoUrl("")
      setText(activity ? extractUploadInstructions(activity) : "")
      setRawBody("")
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

    if (type === "display-key-terms") {
      if (activity) {
        const record = (activity.body_data ?? {}) as Record<string, unknown>
        setText(typeof record.markdown === "string" ? record.markdown : "")
      } else {
        setText("")
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

    if (type === "multiple-choice-question") {
      if (activity) {
        setMcqBody(normalizeMcqBody(getMcqBody(activity)))
      } else {
        setMcqBody(createDefaultMcqBody())
      }
      return
    }

    if (type === "short-text-question") {
      if (activity) {
        setShortTextBody(normalizeShortTextBody(getShortTextBody(activity)))
      } else {
        setShortTextBody(createDefaultShortTextBody())
      }
      return
    }

    if (type === "share-my-work") {
      if (activity) {
        const body = (activity.body_data ?? {}) as Record<string, unknown>
        setShareMyWorkName(typeof body.name === "string" ? body.name : "")
      } else {
        setShareMyWorkName("")
      }
      return
    }

    if (type === "review-others-work") {
      if (activity) {
        const body = (activity.body_data ?? {}) as Record<string, unknown>
        setReviewShareActivityId(typeof body.shareActivityId === "string" ? body.shareActivityId : "")
      } else {
        setReviewShareActivityId("")
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
    } else if (type === "multiple-choice-question") {
      const { bodyData: preparedMcqBody, error } = prepareMcqBodyForSave(mcqBody)
      if (error) {
        toast.error(error)
        return
      }
      bodyData = preparedMcqBody
    } else if (type === "short-text-question") {
      if (shortTextValidationMessage) {
        toast.error(shortTextValidationMessage)
        return
      }
      bodyData = normalizedShortTextBody
    } else if (type === "feedback") {
      bodyData = syncFeedbackBodyWithGroups(normalizeFeedbackBody(feedbackBody), assignedGroups)
    } else if (type === "share-my-work") {
      if (!shareMyWorkName.trim()) {
        toast.error("Please provide a name for this shared work collection")
        return
      }
      // Check uniqueness among other share-my-work activities in this lesson
      const duplicate = allActivities.find(
        (a) =>
          a.type === "share-my-work" &&
          a.activity_id !== activity?.activity_id &&
          (a.body_data as { name?: string } | null)?.name === shareMyWorkName.trim(),
      )
      if (duplicate) {
        toast.error("Another share-my-work activity already uses this name")
        return
      }
      bodyData = { name: shareMyWorkName.trim() }
    } else if (type === "review-others-work") {
      if (!reviewShareActivityId) {
        toast.error("Please select a share-my-work activity to review")
        return
      }
      bodyData = { shareActivityId: reviewShareActivityId }
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

    const sanitizedSuccessCriteriaIds = successCriteriaOptions
      .map((option) => option.successCriteriaId)
      .filter((id) => selectedSuccessCriteriaIds.includes(id))

    const submissionPayload: { pendingUploadFiles?: File[] } = {}
    if ((type === "upload-file" || type === "file-download") && pendingUploadFiles.length > 0) {
      submissionPayload.pendingUploadFiles = [...pendingUploadFiles]
    }

    onSubmit({
      mode: isCreateMode ? "create" : "edit",
      activityId: activity?.activity_id,
      title: trimmedTitle,
      type,
      bodyData,
      imageSubmission,
      successCriteriaIds: sanitizedSuccessCriteriaIds,
      ...submissionPayload,
    })
  }

  const disableSave =
    isPending ||
    isProcessing ||
    isRecording ||
    (type !== "voice" && rawBodyError !== null) ||
    (type === "multiple-choice-question" && mcqValidationMessage !== null) ||
    (type === "short-text-question" && shortTextValidationMessage !== null)

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
            <Label>Success criteria</Label>
            {successCriteriaOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Link success criteria to this lesson to associate them with this activity.
              </p>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                {successCriteriaOptions.map((criterion) => {
                  const checked = selectedSuccessCriteriaIds.includes(criterion.successCriteriaId)
                  return (
                    <label
                      key={criterion.successCriteriaId}
                      className="flex items-start gap-3 rounded-md border border-transparent px-2 py-2 text-sm transition hover:border-primary/40"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => handleSuccessCriteriaToggle(criterion.successCriteriaId, value)}
                        disabled={isPending}
                        className="mt-0.5"
                      />
                      <div className="space-y-1">
                        <span className="font-medium text-foreground">{criterion.title}</span>
                        {criterion.learningObjectiveTitle ? (
                          <p className="text-xs text-muted-foreground">{criterion.learningObjectiveTitle}</p>
                        ) : null}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {type === "text" || type === "text-question" || type === "long-text-question" || type === "upload-file" || type === "sketch-render" ? (
            <div className="space-y-2">
              <Label>
                {type === "upload-file" ? "Instructions for pupils" : "Instructions"}
              </Label>
              <RichTextEditor
                id="activity-text"
                value={text}
                onChange={setText}
                placeholder={
                  type === "upload-file"
                    ? "Explain what pupils should upload"
                    : "Enter the activity instructions"
                }
                disabled={isPending}
              />
            </div>
          ) : null}

          {type === "display-key-terms" ? (
            <div className="space-y-2">
              <Label htmlFor="activity-key-terms">Key terms (markdown table)</Label>
              <Textarea
                id="activity-key-terms"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={"| Term | Definition |\n|---|---|\n| Algorithm | A step-by-step set of instructions |"}
                rows={10}
                disabled={isPending}
                className="font-mono text-sm"
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
                    <div className="relative h-[60px] w-[100px] overflow-hidden rounded-sm">
                      <MediaImage
                        src={previewUrl}
                        alt="YouTube video thumbnail"
                        fill
                        sizes="120px"
                        className="object-cover"
                        loading="lazy"
                      />
                    </div>
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
                  <div className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-md border border-border">
                    <MediaImage
                      src={imagePreviewUrl}
                      alt="Activity image preview"
                      fill
                      sizes="(max-width: 640px) 80vw, 320px"
                      className="object-contain"
                      loading="lazy"
                    />
                  </div>
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

          {type === "multiple-choice-question" ? (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Question</Label>
                <RichTextEditor
                  id="mcq-question"
                  value={mcqBody.question}
                  onChange={handleMcqQuestionChange}
                  onBlur={handleMcqCommit}
                  placeholder="Ask your question here"
                  disabled={isPending}
                />
              </div>

              <div className="mt-4 space-y-3">
                <Label className="text-xs font-medium text-muted-foreground">Answers</Label>
                <div className="space-y-2 rounded-md border border-border bg-background p-3">
                  <RadioGroup
                    value={mcqBody.correctOptionId}
                    onValueChange={handleMcqCorrectOptionChange}
                    className="space-y-2"
                  >
                    {mcqOptionSlots.map((option, index) => (
                      <label
                        key={option.id}
                        htmlFor={`mcq-option-${option.id}`}
                        className="flex items-center gap-3"
                      >
                        <RadioGroupItem
                          value={option.id}
                          id={`mcq-option-${option.id}`}
                          disabled={isPending}
                          className="mt-0.5"
                        />
                        <Input
                          value={option.text}
                          onChange={(event) => handleMcqOptionTextChange(option.id, event.target.value)}
                          onBlur={handleMcqCommit}
                          placeholder={`Answer ${index + 1}`}
                          disabled={isPending}
                        />
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              </div>

              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>Provide up to four answers; at least two must contain text before saving.</p>
                {mcqValidationMessage ? (
                  <p className="text-destructive">{mcqValidationMessage}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {type === "short-text-question" ? (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground" htmlFor="short-text-question">
                  Question
                </Label>
                <RichTextEditor
                  id="short-text-question"
                  value={shortTextBody.question}
                  onChange={handleShortTextQuestionChange}
                  onBlur={handleShortTextCommit}
                  placeholder="Ask your short answer question"
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground" htmlFor="short-text-model-answer">
                  Model answer (required)
                </Label>
                <Input
                  id="short-text-model-answer"
                  value={shortTextBody.modelAnswer}
                  onChange={(event) => handleShortTextModelAnswerChange(event.target.value)}
                  onBlur={handleShortTextCommit}
                  placeholder="Enter the exemplar response"
                  disabled={isPending}
                />
              </div>
              {shortTextValidationMessage ? (
                <p className="mt-2 text-xs text-destructive">{shortTextValidationMessage}</p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  The AI uses the model answer to evaluate pupil responses when you mark work.
                </p>
              )}
            </div>
          ) : null}

          {type === "feedback" ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Group configuration</Label>
                {assignedGroupsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading group assignments…</p>
                ) : feedbackRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This lesson is not assigned to any groups yet. Assign the lesson to a class to enable feedback.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border bg-background">
                    <table className="min-w-full divide-y divide-border text-left text-sm">
                      <thead className="bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Group</th>
                          <th className="px-3 py-2 text-center">Enabled</th>
                          <th className="px-3 py-2 text-center">Show score</th>
                          <th className="px-3 py-2 text-center">Show correct answers</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {feedbackRows.map(({ group, settings }) => (
                          <tr key={group.groupId}>
                            <td className="px-3 py-2 align-middle">
                              <div className="font-medium text-foreground">{group.label}</div>
                              <div className="text-xs text-muted-foreground">{group.groupId}</div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Switch
                                checked={settings.isEnabled}
                                onCheckedChange={(checked) =>
                                  updateFeedbackSettings(group.groupId, { isEnabled: checked })
                                }
                                disabled={isPending}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Switch
                                checked={settings.showScore}
                                onCheckedChange={(checked) =>
                                  updateFeedbackSettings(group.groupId, { showScore: checked })
                                }
                                disabled={isPending || !settings.isEnabled}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Switch
                                checked={settings.showCorrectAnswers}
                                onCheckedChange={(checked) =>
                                  updateFeedbackSettings(group.groupId, { showCorrectAnswers: checked })
                                }
                                disabled={isPending || !settings.isEnabled}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Pupils see “Not enabled for group &lt;group_id&gt;” when the activity is disabled for their class.
                </p>
              </div>
            </div>
          ) : null}

          {type === "share-my-work" ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label htmlFor="share-my-work-name" className="text-xs font-medium text-muted-foreground">
                  Collection name
                </Label>
                <Input
                  id="share-my-work-name"
                  value={shareMyWorkName}
                  onChange={(e) => setShareMyWorkName(e.target.value)}
                  placeholder="e.g. poster-draft"
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">
                  A unique name for this shared work collection within the lesson.
                </p>
              </div>
            </div>
          ) : null}

          {type === "review-others-work" ? (() => {
            const shareActivities = allActivities.filter((a) => a.type === "share-my-work")
            return (
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Linked share activity
                  </Label>
                  {shareActivities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No &quot;Share my work&quot; activities found in this lesson. Add one first.
                    </p>
                  ) : (
                    <Select
                      value={reviewShareActivityId}
                      onValueChange={setReviewShareActivityId}
                      disabled={isPending}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a share activity" />
                      </SelectTrigger>
                      <SelectContent>
                        {shareActivities.map((sa) => {
                          const body = (sa.body_data ?? {}) as Record<string, unknown>
                          const name = typeof body.name === "string" ? body.name : sa.title
                          return (
                            <SelectItem key={sa.activity_id} value={sa.activity_id}>
                              {sa.title || name || "Untitled"}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Select which &quot;Share my work&quot; activity pupils will review.
                  </p>
                </div>
              </div>
            )
          })() : null}

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

              {pendingUploadFiles.length > 0 ? (
                <div className="space-y-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Queued files (will upload when saved)</p>
                  <ul className="list-disc pl-4">
                    {pendingUploadFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`}>
                        {file.name} {typeof file.size === "number" ? `(${formatFileSize(file.size)})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

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
            </div>
          ) : null}

          {type !== "text" &&
          type !== "text-question" &&
          type !== "long-text-question" &&
          type !== "show-video" &&
          type !== "voice" &&
          type !== "file-download" &&
          type !== "upload-file" &&
          type !== "display-image" &&
          type !== "multiple-choice-question" &&
          type !== "short-text-question" &&
          type !== "feedback" &&
          type !== "sketch-render" ? (
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

function createMcqOptionId(existingIds: Set<string>): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    let candidate = crypto.randomUUID()
    while (existingIds.has(candidate)) {
      candidate = crypto.randomUUID()
    }
    return candidate
  }

  let candidate = ""
  do {
    candidate = `option-${Math.random().toString(36).slice(2, 10)}`
  } while (existingIds.has(candidate))
  return candidate
}

function createDefaultShortTextBody(): ShortTextBody {
  return {
    question: "",
    modelAnswer: "",
  }
}

function normalizeShortTextBody(body: ShortTextBody | null | undefined): ShortTextBody {
  if (!body || typeof body !== "object") {
    return createDefaultShortTextBody()
  }

  const question =
    typeof body.question === "string" ? body.question.trim() : ""
  const modelAnswer =
    typeof body.modelAnswer === "string" ? body.modelAnswer.trim() : ""

  return {
    ...(body as Record<string, unknown>),
    question,
    modelAnswer,
  } as ShortTextBody
}

function validateShortTextBody(body: ShortTextBody): string | null {
  const question = typeof body.question === "string" ? body.question.trim() : ""
  if (!question) {
    return "Add the question text before saving."
  }

  const modelAnswer =
    typeof body.modelAnswer === "string" ? body.modelAnswer.trim() : ""
  if (!modelAnswer) {
    return "Model answer is required."
  }

  return null
}

function ensureOptionSlots(options: McqBody["options"]): McqBody["options"] {
  const maxOptions = 4
  const defaults = ["option-a", "option-b", "option-c", "option-d"]
  const normalized = (options ?? []).slice(0, maxOptions)

  const result = normalized.map((option, index) => {
    const rawId = typeof option.id === "string" && option.id.trim().length > 0 ? option.id.trim() : `option-${index + 1}`
    return {
      id: rawId,
      text: typeof option.text === "string" ? option.text : "",
      imageUrl: typeof option.imageUrl === "string" ? option.imageUrl : null,
    }
  })

  const used = new Set(result.map((option) => option.id))

  for (const fallbackId of defaults) {
    if (result.length >= maxOptions) break
    if (!used.has(fallbackId)) {
      used.add(fallbackId)
      result.push({ id: fallbackId, text: "", imageUrl: null })
    }
  }

  while (result.length < maxOptions) {
    const generated = createMcqOptionId(used)
    used.add(generated)
    result.push({ id: generated, text: "", imageUrl: null })
  }

  return result
}

function createDefaultMcqBody(): McqBody {
  const options = ensureOptionSlots([])
  return {
    question: "",
    imageFile: null,
    imageUrl: null,
    imageAlt: null,
    options,
    correctOptionId: options[0]?.id ?? "option-a",
  }
}

function createDefaultFeedbackBody(): FeedbackActivityBody {
  return { groups: {} }
}

function normalizeFeedbackBody(body: FeedbackActivityBody | null | undefined): FeedbackActivityBody {
  if (!body || typeof body !== "object") {
    return createDefaultFeedbackBody()
  }

  const rawGroups = body.groups ?? {}
  const normalizedGroups: Record<string, FeedbackActivityGroupSettings> = {}

  Object.entries(rawGroups).forEach(([groupId, settings]) => {
    const trimmedId = groupId.trim()
    if (!trimmedId) {
      return
    }
    normalizedGroups[trimmedId] = {
      ...FEEDBACK_GROUP_DEFAULTS,
      ...(settings ?? {}),
      isEnabled: settings?.isEnabled === true,
      showScore: settings?.showScore === true,
      showCorrectAnswers: settings?.showCorrectAnswers === true,
    }
  })

  return { ...body, groups: normalizedGroups }
}

function syncFeedbackBodyWithGroups(
  body: FeedbackActivityBody,
  groups: AssignedGroupInfo[],
): FeedbackActivityBody {
  const normalized = normalizeFeedbackBody(body)
  if (groups.length === 0) {
    return { ...normalized, groups: {} }
  }

  const syncedGroups: Record<string, FeedbackActivityGroupSettings> = {}

  groups.forEach(({ groupId }) => {
    const existing = normalized.groups[groupId]
    syncedGroups[groupId] = {
      ...FEEDBACK_GROUP_DEFAULTS,
      ...existing,
      isEnabled: existing?.isEnabled === true,
      showScore: existing?.showScore === true,
      showCorrectAnswers: existing?.showCorrectAnswers === true,
    }
  })

  return { ...normalized, groups: syncedGroups }
}

function normalizeMcqBody(body: McqBody): McqBody {
  const question = typeof body.question === "string" ? body.question : ""
  const normalizedOptions = ensureOptionSlots(body.options).map((option, index) => {
    const id = option.id && option.id.trim().length > 0 ? option.id.trim() : `option-${index + 1}`
    const text = typeof option.text === "string" ? option.text.trim() : ""
    const imageUrl = typeof option.imageUrl === "string" && option.imageUrl.trim().length > 0 ? option.imageUrl.trim() : null
    return { id, text, imageUrl }
  })

  const correctExists = normalizedOptions.some((option) => option.id === body.correctOptionId)
  const correctOptionId = correctExists ? body.correctOptionId : normalizedOptions[0]?.id ?? "option-a"

  const imageFile = typeof body.imageFile === "string" && body.imageFile.trim().length > 0 ? body.imageFile.trim() : null
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim().length > 0 ? body.imageUrl.trim() : null
  const imageAlt = typeof body.imageAlt === "string" && body.imageAlt.trim().length > 0 ? body.imageAlt.trim() : null

  return {
    question,
    options: normalizedOptions,
    correctOptionId,
    imageFile,
    imageUrl,
    imageAlt,
  }
}

function validateNormalizedMcqBody(body: McqBody): string | null {
  const trimmedQuestion = body.question.trim()
  if (!trimmedQuestion) {
    return "Add the question text."
  }

  const filledOptions = body.options.filter((option) => option.text.trim().length > 0)
  if (filledOptions.length < 2) {
    return "Add at least two answers."
  }

  if (!filledOptions.some((option) => option.id === body.correctOptionId)) {
    return "Select which answer is correct."
  }

  return null
}

function validateMcqBody(body: McqBody): string | null {
  const normalized = normalizeMcqBody(body)
  return validateNormalizedMcqBody(normalized)
}

function prepareMcqBodyForSave(body: McqBody): { bodyData: McqBody; error: string | null } {
  const normalized = normalizeMcqBody(body)
  const validation = validateNormalizedMcqBody(normalized)
  if (validation) {
    return { bodyData: normalized, error: validation }
  }

  const filledOptions = normalized.options.filter((option) => option.text.trim().length > 0)
  const correctOptionId = filledOptions.some((option) => option.id === normalized.correctOptionId)
    ? normalized.correctOptionId
    : filledOptions[0].id

  return {
    bodyData: {
      question: normalized.question,
      options: filledOptions.map((option) => ({
        id: option.id,
        text: option.text.trim(),
        imageUrl: option.imageUrl ?? null,
      })),
      correctOptionId,
      imageFile: normalized.imageFile ?? null,
      imageUrl: normalized.imageUrl ?? null,
      imageAlt: normalized.imageAlt ?? null,
    },
    error: null,
  }
}

