"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import type { ChangeEvent, DragEvent, KeyboardEvent, MouseEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { LessonActivity, LessonLearningObjective } from "@/types"
import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, ExternalLink, GripVertical, Trash2, X } from "lucide-react"
import { ActivityImagePreview } from "@/components/lessons/activity-image-preview"
import { PupilUploadActivity } from "@/components/pupil/pupil-upload-activity"
import {
  createLessonAction,
  deactivateLessonAction,
  updateLessonAction,
  listLessonFilesAction,
  uploadLessonFileAction,
  deleteLessonFileAction,
  getLessonFileDownloadUrlAction,
  listLessonLinksAction,
  createLessonLinkAction,
  deleteLessonLinkAction,
  listActivityFilesAction,
  uploadActivityFileAction,
  deleteActivityFileAction,
  getActivityFileDownloadUrlAction,
  listLessonActivitiesAction,
  createLessonActivityAction,
  updateLessonActivityAction,
  reorderLessonActivitiesAction,
  deleteLessonActivityAction,
} from "@/lib/server-updates"
import { supabaseBrowserClient } from "@/lib/supabase-browser"

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

interface LessonSidebarProps {
  unitId: string
  unitTitle: string
  lesson: LessonWithObjectives | null
  isOpen: boolean
  onClose: () => void
  onCreateOrUpdate: (lesson: LessonWithObjectives) => void
  onDeactivate: (lessonId: string) => void
  learningObjectives: LearningObjectiveWithCriteria[]
  viewMode?: "full" | "activities-only" | "resources-only"
  onActivitiesChange?: (activities: LessonActivity[]) => void
  onLessonLinksChange?: (links: LessonLinkInfo[]) => void
  onLessonFilesChange?: (files: LessonFileInfo[]) => void
}

export interface LessonFileInfo {
  name: string
  path: string
  created_at?: string
  updated_at?: string
  size?: number
}

export interface LessonLinkInfo {
  lesson_link_id: string
  lesson_id: string
  url: string
  description: string | null
}

interface LessonFileUpload {
  id: string
  name: string
  progress: number
  status: "uploading" | "success" | "error"
  error?: string | null
}

interface LessonActivitiesSidebarProps {
  unitId: string
  unitTitle: string
  lesson: LessonWithObjectives | null
  isOpen: boolean
  onClose: () => void
  learningObjectives: LearningObjectiveWithCriteria[]
  onActivitiesChange?: (lessonId: string, activities: LessonActivity[]) => void
  onLessonUpdated?: (lesson: LessonWithObjectives) => void
  onDeactivate?: (lessonId: string) => void
}

export function LessonActivitiesSidebar({
  unitId,
  unitTitle,
  lesson,
  isOpen,
  onClose,
  learningObjectives,
  onActivitiesChange,
  onLessonUpdated,
  onDeactivate,
}: LessonActivitiesSidebarProps) {
  if (!lesson) {
    return null
  }

  return (
    <LessonSidebar
      unitId={unitId}
      unitTitle={unitTitle}
      lesson={lesson}
      isOpen={isOpen}
      onClose={onClose}
      onCreateOrUpdate={(updatedLesson) => {
        onLessonUpdated?.(updatedLesson)
      }}
      onDeactivate={(lessonId) => {
        onDeactivate?.(lessonId)
      }}
      learningObjectives={learningObjectives}
      viewMode="activities-only"
      onActivitiesChange={(activities) => {
        onActivitiesChange?.(lesson.lesson_id, activities)
      }}
    />
  )
}

interface LessonResourcesSidebarProps {
  unitId: string
  unitTitle: string
  lesson: LessonWithObjectives | null
  isOpen: boolean
  onClose: () => void
  learningObjectives: LearningObjectiveWithCriteria[]
  onResourcesChange?: (
    lessonId: string,
    changes: { links?: LessonLinkInfo[]; files?: LessonFileInfo[] },
  ) => void
  onLessonUpdated?: (lesson: LessonWithObjectives) => void
  onDeactivate?: (lessonId: string) => void
}

export function LessonResourcesSidebar({
  unitId,
  unitTitle,
  lesson,
  isOpen,
  onClose,
  learningObjectives,
  onResourcesChange,
  onLessonUpdated,
  onDeactivate,
}: LessonResourcesSidebarProps) {
  if (!lesson) {
    return null
  }

  const lessonId = lesson.lesson_id

  return (
    <LessonSidebar
      unitId={unitId}
      unitTitle={unitTitle}
      lesson={lesson}
      isOpen={isOpen}
      onClose={onClose}
      onCreateOrUpdate={(updatedLesson) => {
        onLessonUpdated?.(updatedLesson)
      }}
      onDeactivate={(id) => {
        onDeactivate?.(id)
      }}
      learningObjectives={learningObjectives}
      viewMode="resources-only"
      onLessonLinksChange={(links) => {
        onResourcesChange?.(lessonId, { links })
      }}
      onLessonFilesChange={(files) => {
        onResourcesChange?.(lessonId, { files })
      }}
    />
  )
}

export function LessonSidebar({
  unitId,
  unitTitle,
  lesson,
  isOpen,
  onClose,
  onCreateOrUpdate,
  onDeactivate,
  learningObjectives,
  viewMode = "full",
  onActivitiesChange,
  onLessonLinksChange,
  onLessonFilesChange,
}: LessonSidebarProps) {
  const isActivitiesOnly = viewMode === "activities-only"
  const isResourcesOnly = viewMode === "resources-only"
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [isConfirmingDeactivate, setIsConfirmingDeactivate] = useState(false)
  const [selectedObjectiveIds, setSelectedObjectiveIds] = useState<string[]>([])
  const [activities, setActivities] = useState<LessonActivity[]>([])
  const [isActivitiesLoading, setIsActivitiesLoading] = useState(false)
  const [newActivityTitle, setNewActivityTitle] = useState("")
  const [newActivityType, setNewActivityType] = useState<ActivityTypeValue>(ACTIVITY_TYPES[0]?.value ?? "text")
  const [newActivityText, setNewActivityText] = useState("")
  const [newActivityFileUrl, setNewActivityFileUrl] = useState("")
  const [draggingActivityId, setDraggingActivityId] = useState<string | null>(null)
  const [isPresentationOpen, setIsPresentationOpen] = useState(false)
  const [presentationIndex, setPresentationIndex] = useState(-1)
  const [activityFilesMap, setActivityFilesMap] = useState<Record<string, LessonFileInfo[]>>({})
  const [activityFilesLoading, setActivityFilesLoading] = useState<Record<string, boolean>>({})
  const [activityUploading, setActivityUploading] = useState<Record<string, boolean>>({})
  const [activeDropTargets, setActiveDropTargets] = useState<Record<string, boolean>>({})
  const [files, setFiles] = useState<LessonFileInfo[]>([])
  const [isFilesLoading, setIsFilesLoading] = useState(false)
  const [lessonFileUploads, setLessonFileUploads] = useState<LessonFileUpload[]>([])
  const [isLessonFileDragActive, setIsLessonFileDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const lessonFileDragCounterRef = useRef(0)
  const activityFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const previousLessonIdRef = useRef<string | null>(null)
  const [links, setLinks] = useState<LessonLinkInfo[]>([])
  const [isLinksLoading, setIsLinksLoading] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkDescription, setLinkDescription] = useState("")

  const sortedObjectives = [...learningObjectives].sort((a, b) => {
    const aOrder = a.order_index ?? Number.MAX_SAFE_INTEGER
    const bOrder = b.order_index ?? Number.MAX_SAFE_INTEGER
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }
    return a.title.localeCompare(b.title)
  })

  useEffect(() => {
    if (!isOpen) return

    setTitle(lesson?.title ?? "")
    setIsConfirmingDeactivate(false)
    const availableIds = new Set(
      learningObjectives.map((objective) => objective.learning_objective_id),
    )
    setSelectedObjectiveIds(
      lesson?.lesson_objectives
        ?.map((entry) => entry.learning_objective_id)
        .filter((id) => availableIds.has(id)) ?? [],
    )
    setNewActivityTitle("")
    setNewActivityType(ACTIVITY_TYPES[0]?.value ?? "text")
    setNewActivityText("")
    setNewActivityFileUrl("")
    setDraggingActivityId(null)
    setIsPresentationOpen(false)
    setPresentationIndex(-1)
    setLessonFileUploads([])
    setIsLessonFileDragActive(false)
    lessonFileDragCounterRef.current = 0

    if (lesson) {
      if (previousLessonIdRef.current !== lesson.lesson_id) {
        previousLessonIdRef.current = lesson.lesson_id
        setActivityFilesMap({})
        setActivityFilesLoading({})
        setActivityUploading({})
        setActiveDropTargets({})
      }
      setIsActivitiesLoading(true)
      listLessonActivitiesAction(lesson.lesson_id)
        .then((result) => {
          if (result.error) {
            toast.error("Failed to load lesson activities", {
              description: result.error,
            })
            return
          }
          setActivities((result.data ?? []).slice().sort(sortActivities))
        })
        .finally(() => setIsActivitiesLoading(false))

      setIsFilesLoading(true)
      listLessonFilesAction(lesson.lesson_id)
        .then((result) => {
          if (result.error) {
            toast.error("Failed to load lesson files", {
              description: result.error,
            })
            return
          }
          const values = result.data ?? []
          setFiles(values)
          onLessonFilesChange?.(values)
        })
        .finally(() => setIsFilesLoading(false))

      setIsLinksLoading(true)
      listLessonLinksAction(lesson.lesson_id)
        .then((result) => {
          if (result.error) {
            toast.error("Failed to load lesson links", {
              description: result.error,
            })
            return
          }
          const values = result.data ?? []
          setLinks(values)
          onLessonLinksChange?.(values)
        })
        .finally(() => setIsLinksLoading(false))
    } else {
      setActivities([])
      setActivityFilesMap({})
      setActivityFilesLoading({})
      setActivityUploading({})
      setActiveDropTargets({})
      setFiles([])
      setLinks([])
      previousLessonIdRef.current = null
    }
  }, [isOpen, lesson, learningObjectives, onLessonFilesChange, onLessonLinksChange])

  const refreshActivities = useCallback(async () => {
    if (!lesson) return
    setIsActivitiesLoading(true)
    const result = await listLessonActivitiesAction(lesson.lesson_id)
    if (result.error) {
      toast.error("Failed to refresh lesson activities", {
        description: result.error,
      })
    } else {
      setActivities((result.data ?? []).slice().sort(sortActivities))
    }
    setIsActivitiesLoading(false)
  }, [lesson])

  const refreshActivityFiles = useCallback(
    async (activityId: string, { showLoading = true }: { showLoading?: boolean } = {}) => {
      if (!lesson) return

      if (showLoading) {
        setActivityFilesLoading((prev) => ({ ...prev, [activityId]: true }))
      }

      const result = await listActivityFilesAction(lesson.lesson_id, activityId)

      if (result.error) {
        toast.error("Failed to load activity files", {
          description: result.error,
        })
      } else {
        setActivityFilesMap((prev) => ({ ...prev, [activityId]: result.data ?? [] }))
      }

      if (showLoading) {
        setActivityFilesLoading((prev) => ({ ...prev, [activityId]: false }))
      }
    },
    [lesson],
  )

  useEffect(() => {
    if (newActivityType === "text" || newActivityType === "upload-file") {
      setNewActivityFileUrl("")
    } else if (newActivityType === "show-video") {
      setNewActivityText("")
    }
  }, [newActivityType])

  useEffect(() => {
    if (!lesson) return
    const fileDownloadActivities = activities.filter(
      (activity) =>
        activity.type === "file-download" ||
        activity.type === "upload-file" ||
        activity.type === "voice",
    )
    if (fileDownloadActivities.length === 0) return

    fileDownloadActivities.forEach((activity) => {
      if (!activityFilesMap[activity.activity_id]) {
        refreshActivityFiles(activity.activity_id, { showLoading: false })
      }
    })
  }, [activities, activityFilesMap, lesson, refreshActivityFiles])

  useEffect(() => {
    if (!lesson) return
    onActivitiesChange?.(activities)
    // We intentionally leave onActivitiesChange out of the dependency list to
    // avoid looping when the parent recreates the callback during state
    // updates triggered by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, lesson])

  const refreshFiles = useCallback(async () => {
    if (!lesson) return
    setIsFilesLoading(true)
    const result = await listLessonFilesAction(lesson.lesson_id)
    if (result.error) {
      toast.error("Failed to refresh files", {
        description: result.error,
      })
    } else {
      const values = result.data ?? []
      setFiles(values)
      onLessonFilesChange?.(values)
    }
    setIsFilesLoading(false)
  }, [lesson, onLessonFilesChange])

  const refreshLinks = useCallback(async () => {
    if (!lesson) return
    setIsLinksLoading(true)
    const result = await listLessonLinksAction(lesson.lesson_id)
    if (result.error) {
      toast.error("Failed to refresh lesson links", {
        description: result.error,
      })
    } else {
      const values = result.data ?? []
      setLinks(values)
      onLessonLinksChange?.(values)
    }
    setIsLinksLoading(false)
  }, [lesson, onLessonLinksChange])

  const handleAddActivity = () => {
    if (!lesson) return
    const titleValue = newActivityTitle.trim()
    if (!titleValue) {
      toast.error("Activity title is required")
      return
    }

    const bodyData = (() => {
      if (newActivityType === "text") {
        return { text: newActivityText }
      }
      if (newActivityType === "upload-file") {
        return { instructions: newActivityText }
      }
      if (newActivityType === "show-video") {
        return { fileUrl: newActivityFileUrl }
      }
      return null
    })()

    startTransition(async () => {
      const result = await createLessonActivityAction(unitId, lesson.lesson_id, {
        title: titleValue,
        type: newActivityType,
        bodyData,
      })

      if (!result.success || !result.data) {
        toast.error("Failed to add activity", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setActivities((prev) => [...prev, result.data].sort(sortActivities))
      if (result.data.type === "file-download" || result.data.type === "upload-file") {
        setActivityFilesMap((prev) => ({ ...prev, [result.data.activity_id]: [] }))
      }
      setNewActivityTitle("")
      setNewActivityText("")
      setNewActivityFileUrl("")
      toast.success("Activity added")
    })
  }

  const handleActivityTypeChange = (activityId: string, nextType: ActivityTypeValue) => {
    if (!lesson) return
    const previousActivities = activities
    const defaultBody = getDefaultBodyDataForType(nextType)

    setActivities((prev) =>
      prev.map((activity) =>
        activity.activity_id === activityId
          ? { ...activity, type: nextType, body_data: defaultBody }
          : activity,
      ),
    )

    startTransition(async () => {
      const result = await updateLessonActivityAction(unitId, lesson.lesson_id, activityId, {
        type: nextType,
        bodyData: defaultBody,
      })

      if (!result.success || !result.data) {
        toast.error("Failed to update activity", {
          description: result.error ?? "Please try again later.",
        })
        setActivities(previousActivities)
        await refreshActivities()
        return
      }

      setActivities((prev) =>
        prev.map((activity) => (activity.activity_id === activityId ? result.data! : activity)),
      )
      if (result.data.type === "file-download" || result.data.type === "upload-file") {
        await refreshActivityFiles(activityId)
      }
    })
  }

  const handleDeleteActivity = (activityId: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await deleteLessonActivityAction(unitId, lesson.lesson_id, activityId)

      if (!result.success) {
        toast.error("Failed to delete activity", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      setActivities((prev) => prev.filter((activity) => activity.activity_id !== activityId))
      toast.success("Activity deleted")
    })
  }

  const updateActivityBodyLocally = useCallback((activityId: string, bodyData: LessonActivity["body_data"]) => {
    setActivities((prev) =>
      prev.map((activity) =>
        activity.activity_id === activityId ? { ...activity, body_data: bodyData } : activity,
      ),
    )
  }, [])

  const handleActivityBodySubmit = (activityId: string) => {
    if (!lesson) return
    const activity = activities.find((entry) => entry.activity_id === activityId)
    if (!activity) return

    const pendingBody = activity.body_data ?? null

    startTransition(async () => {
      const result = await updateLessonActivityAction(unitId, lesson.lesson_id, activityId, {
        bodyData: pendingBody,
        type: activity.type,
      })

      if (!result.success || !result.data) {
        toast.error("Failed to update activity", {
          description: result.error ?? "Please try again later.",
        })
        await refreshActivities()
        return
      }

      setActivities((prev) =>
        prev.map((entry) => (entry.activity_id === activityId ? result.data! : entry)),
      )
    })
  }

  const fetchActivityFileUrl = useCallback(
    async (activityId: string, fileName: string) => {
      if (!lesson) return null
      const result = await getActivityFileDownloadUrlAction(lesson.lesson_id, activityId, fileName)
      if (!result.success || !result.url) {
        toast.error("Failed to load file", {
          description: result.error ?? "Please try again later.",
        })
        return null
      }
      return result.url
    },
    [lesson],
  )

  const uploadVoiceRecording = useCallback(
    async (activityId: string, file: File, durationMs: number | null) => {
      if (!lesson) {
        toast.error("Lesson must be selected before saving a recording")
        return { success: false }
      }

      const activity = activities.find((entry) => entry.activity_id === activityId)
      if (!activity) {
        toast.error("Activity not found")
        return { success: false }
      }

      const currentBody = getVoiceBody(activity)

      setActivityUploading((prev) => ({ ...prev, [activityId]: true }))

      try {
        const formData = new FormData()
        formData.append("unitId", unitId)
        formData.append("lessonId", lesson.lesson_id)
        formData.append("activityId", activityId)
        formData.append("file", file)

        const uploadResult = await uploadActivityFileAction(formData)
        if (!uploadResult.success) {
          toast.error("Failed to upload recording", {
            description: uploadResult.error ?? "Please try again later.",
          })
          return { success: false }
        }

        const updatedBody = {
          ...currentBody,
          audioFile: file.name,
          mimeType: file.type || "audio/webm",
          duration: durationMs != null ? durationMs / 1000 : currentBody.duration ?? null,
          size: file.size,
        }

        updateActivityBodyLocally(activityId, updatedBody)

        const updateResult = await updateLessonActivityAction(unitId, lesson.lesson_id, activityId, {
          bodyData: updatedBody,
          type: "voice",
        })

        if (!updateResult.success || !updateResult.data) {
          toast.error("Failed to save recording", {
            description: updateResult.error ?? "Please try again later.",
          })
          await refreshActivities()
          return { success: false }
        }

        setActivities((prev) =>
          prev.map((entry) => (entry.activity_id === activityId ? updateResult.data! : entry)),
        )

        await refreshActivityFiles(activityId)

        if (currentBody.audioFile && currentBody.audioFile !== file.name) {
          const deleteResult = await deleteActivityFileAction(
            unitId,
            lesson.lesson_id,
            activityId,
            currentBody.audioFile,
          )
          if (!deleteResult.success) {
            console.warn("[v0] Failed to delete previous voice recording:", deleteResult.error)
          }
        }

        toast.success("Voice recording saved")
        return { success: true }
      } catch (error) {
        console.error("[v0] Failed to upload voice recording:", error)
        toast.error("Failed to upload recording", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        return { success: false }
      } finally {
        setActivityUploading((prev) => ({ ...prev, [activityId]: false }))
      }
    },
    [activities, lesson, refreshActivityFiles, unitId, refreshActivities, updateActivityBodyLocally],
  )

  const deleteVoiceRecording = useCallback(
    async (activityId: string) => {
      if (!lesson) return
      const activity = activities.find((entry) => entry.activity_id === activityId)
      if (!activity) return
      const currentBody = getVoiceBody(activity)
      const fileName = currentBody.audioFile

      setActivityUploading((prev) => ({ ...prev, [activityId]: true }))

      try {
        if (fileName) {
          const result = await deleteActivityFileAction(unitId, lesson.lesson_id, activityId, fileName)
          if (!result.success) {
            toast.error("Failed to delete recording", {
              description: result.error ?? "Please try again later.",
            })
            return
          }
        }

        const updatedBody = {
          ...currentBody,
          audioFile: null,
          mimeType: null,
          duration: null,
          size: null,
        }
        updateActivityBodyLocally(activityId, updatedBody)

        const updateResult = await updateLessonActivityAction(unitId, lesson.lesson_id, activityId, {
          bodyData: updatedBody,
          type: "voice",
        })

        if (!updateResult.success || !updateResult.data) {
          toast.error("Failed to update activity", {
            description: updateResult.error ?? "Please try again later.",
          })
          await refreshActivities()
          return
        }

        setActivities((prev) =>
          prev.map((entry) => (entry.activity_id === activityId ? updateResult.data! : entry)),
        )

        await refreshActivityFiles(activityId)
        toast.success("Recording removed")
      } catch (error) {
        console.error("[v0] Failed to delete voice recording:", error)
        toast.error("Failed to delete recording", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      } finally {
        setActivityUploading((prev) => ({ ...prev, [activityId]: false }))
      }
    },
    [activities, lesson, refreshActivityFiles, unitId, refreshActivities, updateActivityBodyLocally],
  )

  const handleActivityFileUpload = (activityId: string, fileList: FileList | File[]) => {
    if (!lesson) return
    const filesArray = Array.from(fileList).filter((file) => file.size > 0)
    if (filesArray.length === 0) {
      return
    }

    setActivityUploading((prev) => ({ ...prev, [activityId]: true }))

    startTransition(async () => {
      for (const file of filesArray) {
        const formData = new FormData()
        formData.append("unitId", unitId)
        formData.append("lessonId", lesson.lesson_id)
        formData.append("activityId", activityId)
        formData.append("file", file)

        const result = await uploadActivityFileAction(formData)
        if (!result.success) {
          toast.error("Failed to upload file", {
            description: result.error ?? "Please try again later.",
          })
          break
        }
      }

      await refreshActivityFiles(activityId)
      setActivityUploading((prev) => ({ ...prev, [activityId]: false }))
    })
  }

  const handleActivityFileDelete = (activityId: string, fileName: string) => {
    if (!lesson) return
    setActivityUploading((prev) => ({ ...prev, [activityId]: true }))

    startTransition(async () => {
      const result = await deleteActivityFileAction(unitId, lesson.lesson_id, activityId, fileName)
      if (!result.success) {
        toast.error("Failed to delete file", {
          description: result.error ?? "Please try again later.",
        })
        setActivityUploading((prev) => ({ ...prev, [activityId]: false }))
        return
      }

      toast.success("File deleted")
      await refreshActivityFiles(activityId)
      setActivityUploading((prev) => ({ ...prev, [activityId]: false }))
    })
  }

  const handleActivityFileDownload = (activityId: string, fileName: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await getActivityFileDownloadUrlAction(lesson.lesson_id, activityId, fileName)
      if (!result.success || !result.url) {
        toast.error("Failed to download file", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      window.open(result.url, "_blank")
    })
  }

  const handleActivityFileDragEnter = (activityId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setActiveDropTargets((prev) => ({ ...prev, [activityId]: true }))
  }

  const handleActivityFileDragOver = (activityId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!activeDropTargets[activityId]) {
      setActiveDropTargets((prev) => ({ ...prev, [activityId]: true }))
    }
  }

  const handleActivityFileDragLeave = (activityId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return
    }
    setActiveDropTargets((prev) => ({ ...prev, [activityId]: false }))
  }

  const handleActivityFileDrop = (activityId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setActiveDropTargets((prev) => ({ ...prev, [activityId]: false }))
    const files = event.dataTransfer.files
    if (!files || files.length === 0) return
    handleActivityFileUpload(activityId, files)
  }

  const handleActivityBrowseClick = (activityId: string) => () => {
    const input = activityFileInputRefs.current[activityId]
    input?.click()
  }

  const handleActivityFileInputChange = (activityId: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return
    handleActivityFileUpload(activityId, fileList)
    // reset input to allow same file selection again
    event.target.value = ""
  }

  const openPresentation = (event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!lesson) return
    if (activities.length === 0) {
      toast.info("Add at least one activity to present this lesson.")
      return
    }
    const target = `/lessons/${encodeURIComponent(lesson.lesson_id)}/activities`
    router.push(target)
  }

  const closePresentation = () => {
    setIsPresentationOpen(false)
    setPresentationIndex(-1)
  }

  const goToPreviousActivity = () => {
    setPresentationIndex((index) => Math.max(-1, index - 1))
  }

  const goToNextActivity = () => {
    setPresentationIndex((index) => {
      if (activities.length === 0) {
        return index
      }
      const next = index + 1
      if (next >= activities.length) {
        return activities.length - 1
      }
      return next
    })
  }

  useEffect(() => {
    if (activities.length === 0 && isPresentationOpen) {
      setIsPresentationOpen(false)
      setPresentationIndex(-1)
      return
    }

    if (!isPresentationOpen) {
      return
    }

    if (presentationIndex > activities.length - 1) {
      setPresentationIndex(activities.length - 1)
    }

    if (presentationIndex < -1) {
      setPresentationIndex(-1)
    }
  }, [activities, isPresentationOpen, presentationIndex])

  const handleActivityDragStart = (
    activityId: string,
    event: DragEvent<HTMLDivElement>,
  ) => {
    setDraggingActivityId(activityId)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", activityId)
  }

  const handleActivityDragEnd = () => {
    setDraggingActivityId(null)
  }

  const handleActivityDrop = (targetActivityId: string | null) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (!lesson || !draggingActivityId || draggingActivityId === targetActivityId) {
      handleActivityDragEnd()
      return
    }

    const result = reorderActivityList(activities, draggingActivityId, targetActivityId)

    if (!result) {
      handleActivityDragEnd()
      return
    }

    const { updatedActivities, payload } = result
    const previousActivities = activities

    setActivities(updatedActivities)
    handleActivityDragEnd()

    startTransition(async () => {
      const response = await reorderLessonActivitiesAction(unitId, lesson.lesson_id, payload)
      if (!response.success) {
        toast.error("Failed to update activity order", {
          description: response.error ?? "Please try again shortly.",
        })
        setActivities(previousActivities)
        await refreshActivities()
      }
    })
  }

  const isEditing = Boolean(lesson)

  const uploadLessonFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (!lesson) {
        toast.error("Lesson must be created before uploading files")
        return
      }

      const filesToUpload = Array.from(fileList).filter((file) => file.size > 0)
      if (filesToUpload.length === 0) return

      let hasSuccessfulUpload = false

      for (const file of filesToUpload) {
        const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

        setLessonFileUploads((prev) => [
          ...prev,
          {
            id: uploadId,
            name: file.name,
            progress: 5,
            status: "uploading",
          },
        ])

        let intervalId: number | undefined

        if (typeof window !== "undefined") {
          intervalId = window.setInterval(() => {
            setLessonFileUploads((prev) =>
              prev.map((entry) =>
                entry.id === uploadId
                  ? {
                      ...entry,
                      progress: entry.progress >= 90 ? 90 : entry.progress + 5,
                    }
                  : entry,
              ),
            )
          }, 200)
        }

        const formData = new FormData()
        formData.append("unitId", unitId)
        formData.append("lessonId", lesson.lesson_id)
        formData.append("file", file)

        try {
          const result = await uploadLessonFileAction(formData)

          if (intervalId !== undefined) {
            window.clearInterval(intervalId)
          }

          if (!result.success) {
            setLessonFileUploads((prev) =>
              prev.map((entry) =>
                entry.id === uploadId
                  ? {
                      ...entry,
                      status: "error",
                      progress: 100,
                      error: result.error ?? "Failed to upload file",
                    }
                  : entry,
              ),
            )

            toast.error(`Failed to upload ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
          } else {
            hasSuccessfulUpload = true
            setLessonFileUploads((prev) =>
              prev.map((entry) =>
                entry.id === uploadId
                  ? {
                      ...entry,
                      status: "success",
                      progress: 100,
                    }
                  : entry,
              ),
            )

            toast.success(`Uploaded ${file.name}`)

            setTimeout(() => {
              setLessonFileUploads((prev) => prev.filter((entry) => entry.id !== uploadId || entry.status === "error"))
            }, 1500)
          }
        } catch (error) {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId)
          }

          console.error("[lessons] Failed to upload file", error)

          setLessonFileUploads((prev) =>
            prev.map((entry) =>
              entry.id === uploadId
                ? {
                    ...entry,
                    status: "error",
                    progress: 100,
                    error: error instanceof Error ? error.message : "Failed to upload file",
                  }
                : entry,
            ),
          )

          toast.error(`Failed to upload ${file.name}`, {
            description: error instanceof Error ? error.message : "Please try again later.",
          })
        }
      }

      if (hasSuccessfulUpload) {
        await refreshFiles()
      }
    },
    [lesson, refreshFiles, unitId],
  )

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return

    void uploadLessonFiles(fileList)

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleLessonFileAreaClick = () => {
    if (!lesson || isPending) return
    fileInputRef.current?.click()
  }

  const handleLessonFileAreaKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      handleLessonFileAreaClick()
    }
  }

  const handleLessonFileDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!lesson) return
      if (!event.dataTransfer) return
      const hasFile = Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file")
      if (!hasFile) return
      event.preventDefault()
      event.stopPropagation()
      lessonFileDragCounterRef.current += 1
      setIsLessonFileDragActive(true)
    },
    [lesson],
  )

  const handleLessonFileDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!lesson) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy"
      }
    },
    [lesson],
  )

  const handleLessonFileDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!lesson) return
      event.preventDefault()
      event.stopPropagation()
      lessonFileDragCounterRef.current = Math.max(lessonFileDragCounterRef.current - 1, 0)
      if (lessonFileDragCounterRef.current === 0) {
        setIsLessonFileDragActive(false)
      }
    },
    [lesson],
  )

  const handleLessonFileDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!lesson) return
      event.preventDefault()
      event.stopPropagation()
      setIsLessonFileDragActive(false)
      lessonFileDragCounterRef.current = 0
      const files = event.dataTransfer?.files
      if (files && files.length > 0) {
        void uploadLessonFiles(files)
      }
    },
    [lesson, uploadLessonFiles],
  )

  const handleFileDelete = (fileName: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await deleteLessonFileAction(unitId, lesson.lesson_id, fileName)
      if (!result.success) {
        toast.error("Failed to delete file", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      toast.success("File deleted")
      await refreshFiles()
    })
  }

  const handleFileDownload = (fileName: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await getLessonFileDownloadUrlAction(lesson.lesson_id, fileName)
      if (!result.success || !result.url) {
        toast.error("Failed to download file", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      window.open(result.url, "_blank")
    })
  }

  const handleAddLink = () => {
    if (!lesson) return
    const url = linkUrl.trim()
    if (!url) {
      toast.error("Link URL is required")
      return
    }

    startTransition(async () => {
      const result = await createLessonLinkAction(unitId, lesson.lesson_id, url, linkDescription.trim() || null)
      if (!result.success) {
        toast.error("Failed to add link", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      toast.success("Link added")
      setLinkUrl("")
      setLinkDescription("")
      await refreshLinks()
    })
  }

  const handleDeleteLink = (lessonLinkId: string) => {
    if (!lesson) return
    startTransition(async () => {
      const result = await deleteLessonLinkAction(unitId, lesson.lesson_id, lessonLinkId)
      if (!result.success) {
        toast.error("Failed to delete link", {
          description: result.error ?? "Please try again later.",
        })
        return
      }
      toast.success("Link deleted")
      await refreshLinks()
    })
  }

  const handleSave = () => {
    if (title.trim().length === 0) {
      toast.error("Lesson title is required")
      return
    }

    startTransition(async () => {
      try {
        if (lesson) {
          const result = await updateLessonAction(
            lesson.lesson_id,
            unitId,
            title.trim(),
            selectedObjectiveIds,
          )

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Lesson updated")
        } else {
          const result = await createLessonAction(unitId, title.trim(), selectedObjectiveIds)

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Lesson created")
        }

        onClose()
      } catch (error) {
        console.error("[v0] Failed to save lesson:", error)
        toast.error("Failed to save lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  const handleDeactivate = () => {
    if (!lesson) return

    startTransition(async () => {
      try {
        const result = await deactivateLessonAction(lesson.lesson_id, unitId)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        onDeactivate(lesson.lesson_id)
        toast.success("Lesson deactivated")
        onClose()
      } catch (error) {
        console.error("[v0] Failed to deactivate lesson:", error)
        toast.error("Failed to deactivate lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  if (!isOpen) {
    return null
  }

  const activitiesCount = activities.length
  const showActivitiesDisabled = isPending || activitiesCount === 0

  return (
    <>
      <div className="fixed inset-0 z-50 flex">
        <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
        <div className="relative ml-auto w-full max-w-md border-l bg-background shadow-xl">
          <Card className="flex h-full flex-col rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">
              {isActivitiesOnly
                ? "Edit Activities"
                : isResourcesOnly
                  ? "Lesson resources"
                  : isEditing
                    ? "Edit Lesson"
                    : "Add Lesson"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
            {isActivitiesOnly ? (
              <div className="border-b bg-background px-6 py-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Lesson</p>
                  <p className="text-base font-medium text-foreground">{lesson?.title ?? "Untitled lesson"}</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Manage the activities learners will work through for this lesson.
                </p>
              </div>
            ) : isResourcesOnly ? (
              <div className="border-b bg-background px-6 py-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Lesson</p>
                  <p className="text-base font-medium text-foreground">{lesson?.title ?? "Untitled lesson"}</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add lesson links and upload supporting files learners will need.
                </p>
              </div>
            ) : (
              <div className="space-y-6 border-b bg-background px-6 py-4">
                <div className="space-y-2">
                  <Label htmlFor="lesson-title">Title</Label>
                  <Input
                    id="lesson-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Lesson title"
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Learning Objectives</Label>
                  <div className="space-y-2">
                    {sortedObjectives.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No learning objectives available for this unit yet.
                      </p>
                    )}
                    {sortedObjectives.map((objective) => {
                      const isChecked = selectedObjectiveIds.includes(objective.learning_objective_id)
                      return (
                        <label
                          key={objective.learning_objective_id}
                          className="flex items-start gap-2 text-sm"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              setSelectedObjectiveIds((prev) => {
                                if (checked === true) {
                                  if (prev.includes(objective.learning_objective_id)) return prev
                                  return [...prev, objective.learning_objective_id]
                                }
                                return prev.filter((id) => id !== objective.learning_objective_id)
                              })
                            }}
                            disabled={isPending}
                          />
                          <span>{objective.title}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-6">
                {isActivitiesOnly && lesson && (
                  <div className="space-y-3">
                    <Label>Lesson Activities</Label>
                    <div className="space-y-2 rounded-md border border-border p-3">
                      <Input
                        value={newActivityTitle}
                        onChange={(event) => setNewActivityTitle(event.target.value)}
                        placeholder="Activity title"
                        disabled={isPending}
                      />
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <Select
                      value={newActivityType}
                      onValueChange={(value) => setNewActivityType(value as ActivityTypeValue)}
                      disabled={isPending}
                    >
                      <SelectTrigger className="w-full sm:w-[220px]" size="sm">
                        <SelectValue placeholder="Select activity type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddActivity}
                      disabled={isPending || newActivityTitle.trim().length === 0}
                    >
                      Add Activity
                    </Button>
                  </div>
                  {newActivityType === "text" || newActivityType === "upload-file" ? (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="new-activity-text"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {newActivityType === "upload-file" ? "Instructions for pupils" : "Text content"}
                      </Label>
                      <Textarea
                        id="new-activity-text"
                        value={newActivityText}
                        onChange={(event) => setNewActivityText(event.target.value)}
                        placeholder={
                          newActivityType === "upload-file"
                            ? "Explain what pupils should upload"
                            : "Add the instructions or text for this activity"
                        }
                        disabled={isPending}
                      />
                    </div>
                  ) : null}
                  {newActivityType === "show-video" ? (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="new-activity-video-url"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Video URL
                      </Label>
                      <Input
                        id="new-activity-video-url"
                        type="url"
                        value={newActivityFileUrl}
                        onChange={(event) => setNewActivityFileUrl(event.target.value)}
                        placeholder="https://example.com/video"
                        disabled={isPending}
                      />
                    </div>
                  ) : null}
                  {newActivityType === "file-download" ? (
                    <p className="text-sm text-muted-foreground">
                      Save the activity first, then upload files to it.
                    </p>
                  ) : null}
                  {newActivityType === "upload-file" ? (
                    <p className="text-sm text-muted-foreground">
                      After saving, attach any reference files pupils should use before uploading their own work.
                    </p>
                  ) : null}
                </div>
                    {isActivitiesLoading ? (
                      <p className="text-sm text-muted-foreground">Loading activities...</p>
                    ) : activities.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No activities added yet. Create the first step above.
                      </p>
                    ) : (
                      <div
                        className="space-y-2"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handleActivityDrop(null)}
                      >
                        {activities.map((activity, index) => {
                          const activityType =
                            ACTIVITY_TYPES.find((option) => option.value === activity.type)?.value ?? ACTIVITY_TYPES[0].value

                          return (
                            <div
                              key={activity.activity_id}
                              draggable
                              onDragStart={(event) => handleActivityDragStart(activity.activity_id, event)}
                              onDragEnd={handleActivityDragEnd}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={handleActivityDrop(activity.activity_id)}
                              className={cn(
                                "rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary cursor-grab active:cursor-grabbing",
                                draggingActivityId === activity.activity_id && "opacity-60",
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2">
                                  <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                  <div>
                                    <p className="font-medium leading-tight">{activity.title}</p>
                                    <p className="text-xs text-muted-foreground">Step {index + 1}</p>
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleDeleteActivity(activity.activity_id)}
                                  aria-label={`Delete activity ${activity.title}`}
                                  disabled={isPending}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                          <div className="mt-3 flex items-center gap-2">
                            <Label className="text-xs font-medium text-muted-foreground">Type</Label>
                            <Select
                              value={activityType}
                              onValueChange={(value) =>
                                handleActivityTypeChange(activity.activity_id, value as ActivityTypeValue)
                              }
                              disabled={isPending}
                            >
                              <SelectTrigger size="sm" className="w-[220px]">
                                <SelectValue />
                              </SelectTrigger>
                          <SelectContent>
                            {ACTIVITY_TYPES.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                          </Select>
                        </div>
                          {activity.type === "text" ? (
                            <div className="mt-3 space-y-1.5">
                              <Label
                                htmlFor={`activity-${activity.activity_id}-text`}
                                className="text-xs font-medium text-muted-foreground"
                              >
                                Text content
                              </Label>
                              <Textarea
                                id={`activity-${activity.activity_id}-text`}
                                value={getActivityTextValue(activity)}
                                onChange={(event) =>
                                  updateActivityBodyLocally(activity.activity_id, {
                                    ...(typeof activity.body_data === "object" && activity.body_data !== null
                                      ? (activity.body_data as Record<string, unknown>)
                                      : {}),
                                    text: event.target.value,
                                  })
                                }
                                onBlur={() => handleActivityBodySubmit(activity.activity_id)}
                                disabled={isPending}
                              />
                            </div>
                          ) : null}
                          {activity.type === "upload-file" ? (
                            <div className="mt-3 space-y-1.5">
                              <Label
                                htmlFor={`activity-${activity.activity_id}-instructions`}
                                className="text-xs font-medium text-muted-foreground"
                              >
                                Instructions for pupils
                              </Label>
                              <Textarea
                                id={`activity-${activity.activity_id}-instructions`}
                                value={getActivityTextValue(activity)}
                                onChange={(event) =>
                                  updateActivityBodyLocally(activity.activity_id, {
                                    ...(typeof activity.body_data === "object" && activity.body_data !== null
                                      ? (activity.body_data as Record<string, unknown>)
                                      : {}),
                                    instructions: event.target.value,
                                  })
                                }
                                onBlur={() => handleActivityBodySubmit(activity.activity_id)}
                                disabled={isPending}
                              />
                            </div>
                          ) : null}
                          {activity.type === "show-video" ? (
                            <div className="mt-3 space-y-1.5">
                              <Label
                                htmlFor={`activity-${activity.activity_id}-video-url`}
                                className="text-xs font-medium text-muted-foreground"
                              >
                                Video URL
                              </Label>
                              <Input
                                id={`activity-${activity.activity_id}-video-url`}
                                type="url"
                                value={getActivityFileUrlValue(activity)}
                                onChange={(event) =>
                                  updateActivityBodyLocally(activity.activity_id, {
                                    fileUrl: event.target.value,
                                  })
                                }
                                onBlur={() => handleActivityBodySubmit(activity.activity_id)}
                                placeholder="https://example.com/video"
                                disabled={isPending}
                              />
                            </div>
                          ) : null}
                          {activity.type === "file-download" || activity.type === "upload-file" ? (
                            <div className="mt-3 space-y-3">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={handleActivityBrowseClick(activity.activity_id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault()
                                    handleActivityBrowseClick(activity.activity_id)()
                                  }
                                }}
                                onDragEnter={handleActivityFileDragEnter(activity.activity_id)}
                                onDragOver={handleActivityFileDragOver(activity.activity_id)}
                                onDragLeave={handleActivityFileDragLeave(activity.activity_id)}
                                onDrop={handleActivityFileDrop(activity.activity_id)}
                                className={cn(
                                  "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/40 p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  activeDropTargets[activity.activity_id] && "border-primary bg-primary/10",
                                  activityUploading[activity.activity_id] && "opacity-60",
                                )}
                              >
                                <p className="text-sm font-medium">
                                  Drag and drop files here or click to browse
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Uploads are available to download during the lesson presentation.
                                </p>
                                <input
                                  type="file"
                                  multiple
                                  ref={(element) => {
                                    activityFileInputRefs.current[activity.activity_id] = element
                                  }}
                                  className="hidden"
                                  onChange={handleActivityFileInputChange(activity.activity_id)}
                                />
                              </div>
                              {activityUploading[activity.activity_id] ? (
                                <p className="text-xs text-muted-foreground">Uploading files…</p>
                              ) : null}
                              {activityFilesLoading[activity.activity_id] ? (
                                <p className="text-sm text-muted-foreground">Loading files...</p>
                              ) : (activityFilesMap[activity.activity_id] ?? []).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
                              ) : (
                                <ul className="space-y-2">
                                  {(activityFilesMap[activity.activity_id] ?? []).map((file) => (
                                    <li
                                      key={file.path}
                                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                                    >
                                      <div className="flex flex-col">
                                        <span className="font-medium">{file.name}</span>
                                        {file.size ? (
                                          <span className="text-xs text-muted-foreground">
                                            {formatFileSize(file.size)}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="secondary"
                                          onClick={() => handleActivityFileDownload(activity.activity_id, file.name)}
                                          disabled={activityUploading[activity.activity_id]}
                                        >
                                          <Download className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="destructive"
                                          onClick={() => handleActivityFileDelete(activity.activity_id, file.name)}
                                          disabled={activityUploading[activity.activity_id]}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                          {activity.type === "voice" ? (
                            <VoiceActivityEditor
                              activity={activity}
                              isDisabled={isPending}
                              isUploading={activityUploading[activity.activity_id] ?? false}
                              isLoading={activityFilesLoading[activity.activity_id] ?? false}
                              onUploadRecording={(file, durationMs) =>
                                uploadVoiceRecording(activity.activity_id, file, durationMs)
                              }
                              onDeleteRecording={() => deleteVoiceRecording(activity.activity_id)}
                              fetchRecordingUrl={(fileName) =>
                                fetchActivityFileUrl(activity.activity_id, fileName)
                              }
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
                  </div>
                )}

                {!isActivitiesOnly && lesson && (
                  <div className="space-y-3">
                    <Label>Lesson Links</Label>
                    <div className="space-y-2">
                      <Input
                        value={linkUrl}
                        onChange={(event) => setLinkUrl(event.target.value)}
                        placeholder="https://example.com"
                        disabled={isPending}
                      />
                      <Input
                        value={linkDescription}
                        onChange={(event) => setLinkDescription(event.target.value)}
                        placeholder="Description (optional)"
                        disabled={isPending}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleAddLink}
                          disabled={isPending || !linkUrl.trim()}
                        >
                          Add Link
                        </Button>
                      </div>
                    </div>
                    {isLinksLoading ? (
                      <p className="text-sm text-muted-foreground">Loading links...</p>
                    ) : links.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No links added yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {links.map((link) => (
                          <li
                            key={link.lesson_link_id}
                            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium break-all">{link.url}</span>
                              {link.description && (
                                <span className="text-xs text-muted-foreground">{link.description}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                onClick={() => window.open(link.url, "_blank")}
                                aria-label={`Open ${link.url}`}
                                disabled={isPending}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                onClick={() => handleDeleteLink(link.lesson_link_id)}
                                aria-label={`Delete link ${link.url}`}
                                disabled={isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {!isActivitiesOnly && lesson && (
                  <div className="space-y-3">
                    <Label className="flex items-center justify-between">
                      <span>Lesson Files</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Upload
                      </Button>
                    </Label>
                    <input
                      ref={fileInputRef}
                      id="lesson-file-upload"
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={isPending}
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={handleLessonFileAreaClick}
                      onKeyDown={handleLessonFileAreaKeyDown}
                      onDragEnter={handleLessonFileDragEnter}
                      onDragOver={handleLessonFileDragOver}
                      onDragLeave={handleLessonFileDragLeave}
                      onDrop={handleLessonFileDrop}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/40 p-6 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isLessonFileDragActive && "border-primary bg-primary/10",
                        (!lesson || isPending) && "cursor-not-allowed opacity-70",
                      )}
                    >
                      <p className="font-medium">Drag and drop files here or click to browse</p>
                      <p className="text-xs text-muted-foreground">
                        You can upload multiple files at once. Learners will be able to download them from the lesson.
                      </p>
                    </div>
                    {lessonFileUploads.length > 0 ? (
                      <div className="space-y-2">
                        {lessonFileUploads.map((upload) => (
                          <div
                            key={upload.id}
                            className={cn(
                              "rounded-md border px-3 py-3 text-sm shadow-sm",
                              upload.status === "error" ? "border-destructive/60 bg-destructive/10" : "border-border bg-muted/40",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate" title={upload.name}>
                                {upload.name}
                              </span>
                              <span className="text-xs text-muted-foreground">{upload.progress}%</span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full bg-primary transition-all duration-200",
                                  upload.status === "error" && "bg-destructive",
                                )}
                                style={{ width: `${upload.progress}%` }}
                              />
                            </div>
                            {upload.status === "error" && upload.error ? (
                              <p className="mt-2 text-xs text-destructive">{upload.error}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {isFilesLoading ? (
                      <p className="text-sm text-muted-foreground">Loading files...</p>
                    ) : files.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
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
                                <span className="text-xs text-muted-foreground">
                                  {formatFileSize(file.size)}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                onClick={() => handleFileDownload(file.name)}
                                disabled={isPending}
                                aria-label={`Download ${file.name}`}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                onClick={() => handleFileDelete(file.name)}
                                disabled={isPending}
                                aria-label={`Delete ${file.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t bg-background px-6 py-4">
              <div className="flex flex-col gap-3">
                {viewMode === "full" ? (
                  <Button onClick={handleSave} disabled={isPending || title.trim().length === 0}>
                    {isEditing ? "Save Changes" : "Create Lesson"}
                  </Button>
                ) : null}

                {viewMode === "full" && isEditing && lesson?.active !== false && (
                  <div className="space-y-3">
                    {!isConfirmingDeactivate ? (
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={(event) => openPresentation(event)}
                          disabled={showActivitiesDisabled}
                        >
                          {isActivitiesLoading
                            ? "Show Activities (\u2026)"
                            : `Show Activities (${activitiesCount})`}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => setIsConfirmingDeactivate(true)}
                          disabled={isPending}
                        >
                          Deactivate Lesson
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                        <p className="text-destructive">
                          Are you sure? Learners will no longer see this lesson.
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDeactivate}
                            disabled={isPending}
                          >
                            Yes, deactivate
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsConfirmingDeactivate(false)}
                            disabled={isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <Button variant="outline" className="bg-transparent" onClick={onClose} disabled={isPending}>
                  {viewMode === "full" ? "Cancel" : "Close"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
      {isPresentationOpen ? (
        <LessonPresentation
          activities={activities}
          currentIndex={presentationIndex}
          unitTitle={unitTitle}
          lessonTitle={lesson?.title ?? title}
          lessonId={lesson?.lesson_id ?? ""}
          lessonObjectives={lesson?.lesson_objectives ?? []}
          lessonLinks={links}
          lessonFiles={files}
          activityFilesMap={activityFilesMap}
          onClose={closePresentation}
          onNext={goToNextActivity}
          onPrevious={goToPreviousActivity}
          onDownloadFile={handleFileDownload}
          onDownloadActivityFile={handleActivityFileDownload}
          fetchActivityFileUrl={fetchActivityFileUrl}
        />
      ) : null}
    </>
  )
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function sortActivities(a: LessonActivity, b: LessonActivity) {
  const aOrder = typeof a.order_by === "number" ? a.order_by : Number.MAX_SAFE_INTEGER
  const bOrder = typeof b.order_by === "number" ? b.order_by : Number.MAX_SAFE_INTEGER
  if (aOrder !== bOrder) {
    return aOrder - bOrder
  }
  return a.title.localeCompare(b.title)
}

function reorderActivityList(
  activities: LessonActivity[],
  draggedActivityId: string,
  targetActivityId: string | null,
):
  | {
      updatedActivities: LessonActivity[]
      payload: { activityId: string; orderBy: number }[]
    }
  | null {
  const ordered = [...activities].sort(sortActivities)
  const fromIndex = ordered.findIndex((activity) => activity.activity_id === draggedActivityId)
  if (fromIndex === -1) {
    return null
  }

  let toIndex = targetActivityId
    ? ordered.findIndex((activity) => activity.activity_id === targetActivityId)
    : ordered.length - 1

  if (toIndex === -1) {
    toIndex = ordered.length - 1
  }

  if (fromIndex === toIndex) {
    return null
  }

  const reordered = arrayMove(ordered, fromIndex, toIndex).map((activity, index) => ({
    ...activity,
    order_by: index,
  }))

  const reorderedMap = new Map(reordered.map((activity) => [activity.activity_id, activity]))

  const updatedActivities = activities
    .map((activity) => reorderedMap.get(activity.activity_id) ?? activity)
    .sort(sortActivities)

  const payload = reordered.map((activity) => ({
    activityId: activity.activity_id,
    orderBy: activity.order_by ?? 0,
  }))

  return { updatedActivities, payload }
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = [...array]
  if (from < 0 || from >= result.length) return result
  const [item] = result.splice(from, 1)
  let target = to
  if (target < 0) target = 0
  if (target > result.length) target = result.length
  result.splice(target, 0, item)
  return result
}

function getActivityTextValue(activity: LessonActivity): string {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return ""
  }
  const record = activity.body_data as Record<string, unknown>
  const text = typeof record.text === "string" ? record.text : null
  if (text != null) {
    return text
  }
  const instructions = record.instructions
  return typeof instructions === "string" ? instructions : ""
}

function getActivityFileUrlValue(activity: LessonActivity): string {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return ""
  }
  const fileUrl = (activity.body_data as Record<string, unknown>).fileUrl
  return typeof fileUrl === "string" ? fileUrl : ""
}

interface ImageBody {
  imageFile: string | null
  imageUrl?: string | null
  [key: string]: unknown
}

function isAbsoluteUrl(value: string | null): boolean {
  if (!value) return false
  return /^https?:\/\//i.test(value) || value.startsWith("data:")
}

function getImageBody(activity: LessonActivity): ImageBody {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return { imageFile: null, imageUrl: null }
  }

  const body = activity.body_data as Record<string, unknown>
  const rawImageFile = typeof body.imageFile === "string" ? body.imageFile : null
  const rawImageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null
  const rawFileUrl = typeof body.fileUrl === "string" ? body.fileUrl : null

  let imageFile = rawImageFile
  let imageUrl = rawImageUrl

  if (!imageFile && rawFileUrl && !isAbsoluteUrl(rawFileUrl)) {
    imageFile = rawFileUrl
  }

  if (!imageUrl && rawFileUrl && isAbsoluteUrl(rawFileUrl)) {
    imageUrl = rawFileUrl
  }

  const next: ImageBody = {
    ...(body as ImageBody),
    imageFile,
    imageUrl: imageUrl ?? null,
  }

  return next
}

interface VoiceBody {
  audioFile: string | null
  mimeType?: string | null
  duration?: number | null
  size?: number | null
  [key: string]: unknown
}

function getVoiceBody(activity: LessonActivity): VoiceBody {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
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

function getDefaultBodyDataForType(type: ActivityTypeValue): LessonActivity["body_data"] {
  if (type === "text") {
    return { text: "" }
  }
  if (type === "upload-file") {
    return { instructions: "" }
  }
  if (type === "show-video") {
    return { fileUrl: "" }
  }
  if (type === "voice") {
    return { audioFile: null }
  }
  return null
}

export interface LessonPresentationProps {
  activities: LessonActivity[]
  currentIndex: number
  unitTitle: string
  lessonTitle: string
  lessonId: string
  lessonObjectives: LessonLearningObjective[]
  lessonLinks: LessonLinkInfo[]
  lessonFiles: LessonFileInfo[]
  activityFilesMap: Record<string, LessonFileInfo[]>
  onClose: () => void
  onNext: () => void
  onPrevious: () => void
  onDownloadFile: (fileName: string) => void
  onDownloadActivityFile: (activityId: string, fileName: string) => void
  fetchActivityFileUrl: (activityId: string, fileName: string) => Promise<string | null>
}

export function LessonPresentation({
  activities,
  currentIndex,
  unitTitle,
  lessonTitle,
  lessonId,
  lessonObjectives,
  lessonLinks,
  lessonFiles,
  activityFilesMap,
  onClose,
  onNext,
  onPrevious,
  onDownloadFile,
  onDownloadActivityFile,
  fetchActivityFileUrl,
}: LessonPresentationProps) {
  const isOverview = currentIndex < 0
  const activity = !isOverview && currentIndex >= 0 ? activities[currentIndex] : null
  const activityFiles = activity ? activityFilesMap[activity.activity_id] ?? [] : []
  const [voicePlayback, setVoicePlayback] = useState<{ url: string | null; loading: boolean }>(
    { url: null, loading: false },
  )
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isUserLoaded, setIsUserLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    supabaseBrowserClient.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) {
          setCurrentUserId(data.user?.id ?? null)
          setIsUserLoaded(true)
        }
      })
      .catch((error) => {
        console.error("[lesson-presentation] Failed to fetch current user", error)
        if (!cancelled) {
          setCurrentUserId(null)
          setIsUserLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setVoicePlayback({ url: null, loading: false })

    if (!activity || activity.type !== "voice") {
      return () => {
        cancelled = true
      }
    }

    const voiceBody = getVoiceBody(activity)
    if (!voiceBody.audioFile) {
      return () => {
        cancelled = true
      }
    }

    setVoicePlayback({ url: null, loading: true })
    fetchActivityFileUrl(activity.activity_id, voiceBody.audioFile)
      .then((url) => {
        if (!cancelled) {
          setVoicePlayback({ url, loading: false })
        }
      })
      .catch((error) => {
        console.error("[v0] Failed to load voice recording:", error)
        if (!cancelled) {
          setVoicePlayback({ url: null, loading: false })
        }
      })

    return () => {
      cancelled = true
    }
  }, [activity, fetchActivityFileUrl])

  const canGoPrevious = currentIndex >= 0
  const canGoNext = activities.length > 0 && (isOverview || currentIndex < activities.length - 1)
  const nextButtonLabel = isOverview ? "Start Lesson" : "Next"

  const objectivesWithCriteria = lessonObjectives.map((objective) => {
    const title = objective.learning_objective?.title ?? objective.title
    const criteria = (objective.learning_objective?.success_criteria ?? []).map((criterion) => ({
      id: criterion.success_criteria_id,
      level: criterion.level,
      description: criterion.description,
    }))
    return { id: objective.learning_objective_id, title, criteria }
  })

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {isOverview ? unitTitle : `Step ${currentIndex + 1} of ${activities.length}`}
          </p>
          <h2 className="text-xl font-semibold">
            {isOverview ? lessonTitle : activity?.title ?? "No activities"}
          </h2>
        </div>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
        <div className="flex w-full max-w-5xl flex-col gap-6">
          {isOverview ? (
            <div className="space-y-6">
              <section className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Unit</p>
                  <h3 className="text-3xl font-bold leading-tight">{unitTitle}</h3>
                </div>
                <div className="mt-4 space-y-1">
                  <p className="text-sm text-muted-foreground">Lesson</p>
                  <h4 className="text-2xl font-semibold leading-tight">{lessonTitle}</h4>
                </div>
              </section>

              <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
                <div>
                  <h4 className="text-lg font-semibold">Learning Objectives</h4>
                  {objectivesWithCriteria.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      No learning objectives linked to this lesson yet.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {objectivesWithCriteria.map((objective) => (
                        <li key={objective.id} className="space-y-2">
                          <p className="text-base font-medium">{objective.title}</p>
                          {objective.criteria.length > 0 ? (
                            <ul className="space-y-1 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                              {objective.criteria.map((criterion) => (
                                <li key={criterion.id}>
                                  <span className="font-medium">Level {criterion.level}:</span> {criterion.description}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">No success criteria recorded yet.</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
                <h4 className="text-lg font-semibold">Resources</h4>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-muted-foreground">Lesson Links</p>
                    {lessonLinks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No links added yet.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {lessonLinks.map((link) => (
                          <li key={link.lesson_link_id} className="space-y-1">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline"
                            >
                              {link.description || link.url}
                            </a>
                            {link.description ? (
                              <p className="text-xs text-muted-foreground">{link.url}</p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-muted-foreground">Lesson Files</p>
                    {lessonFiles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {lessonFiles.map((file) => (
                          <li key={file.path} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                            <div className="space-y-1">
                              <p className="font-medium">{file.name}</p>
                              {typeof file.size === "number" ? (
                                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
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
                </div>
              </section>
            </div>
          ) : activity ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Step {currentIndex + 1} of {activities.length}
                </span>
                <h3 className="text-3xl font-bold leading-tight">{activity.title}</h3>
              </div>
              <div className="min-h-[320px] rounded-xl border bg-card p-6 shadow-sm">
                {activity.type === "upload-file" ? (
                  isUserLoaded ? (
                    <PupilUploadActivity
                      key={`${activity.activity_id}-${currentUserId ?? "guest"}`}
                      lessonId={lessonId}
                      activity={activity}
                      pupilId={currentUserId ?? ""}
                      instructions={getActivityTextValue(activity)}
                      resourceFiles={activityFiles}
                      initialSubmissions={[]}
                      canUpload={Boolean(currentUserId)}
                      stepNumber={currentIndex + 1}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Loading upload tools…
                    </div>
                  )
                ) : (
                  renderActivityPresentationContent(
                    activity,
                    activityFiles,
                    (fileName) => onDownloadActivityFile(activity.activity_id, fileName),
                    { url: voicePlayback.url, isLoading: voicePlayback.loading },
                    fetchActivityFileUrl,
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-xl border bg-card p-6 text-center text-lg text-muted-foreground shadow-sm">
              No activities available.
            </div>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-between border-t px-6 py-4">
        <Button variant="secondary" onClick={onPrevious} disabled={!canGoPrevious}>
          Previous
        </Button>
        <div className="text-sm text-muted-foreground">
          {activities.length > 0
            ? isOverview
              ? `0 / ${activities.length}`
              : `${currentIndex + 1} / ${activities.length}`
            : "0 / 0"}
        </div>
        <Button variant="secondary" onClick={onNext} disabled={!canGoNext}>
          {nextButtonLabel}
        </Button>
      </footer>
    </div>
  )
}

function DisplayImagePresentation({
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
    console.error("[v0] Failed to compute embed url:", error)
  }

  return null
}

function renderActivityPresentationContent(
  activity: LessonActivity,
  files: LessonFileInfo[],
  onDownload: (fileName: string) => void,
  voicePlayback?: { url: string | null; isLoading: boolean },
  fetchActivityFileUrl?: LessonPresentationProps["fetchActivityFileUrl"],
) {
  if (activity.type === "text") {
    const text = getActivityTextValue(activity)
    if (text.trim().length === 0) {
      return <p className="text-muted-foreground">No text content provided for this activity.</p>
    }

    return <p className="whitespace-pre-wrap text-lg leading-relaxed">{text}</p>
  }

  if (activity.type === "display-image") {
    return <DisplayImagePresentation activity={activity} fetchActivityFileUrl={fetchActivityFileUrl} />
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
              <Button size="sm" variant="secondary" onClick={() => onDownload(file.name)}>
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
                  <Button size="sm" variant="secondary" onClick={() => onDownload(file.name)}>
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Pupils can upload their responses from the student lesson page. Their files are saved under each
          activity.
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

interface VoiceActivityEditorProps {
  activity: LessonActivity
  isDisabled: boolean
  isUploading: boolean
  isLoading: boolean
  onUploadRecording: (file: File, durationMs: number | null) => Promise<{ success: boolean }>
  onDeleteRecording: () => Promise<void>
  fetchRecordingUrl: (fileName: string) => Promise<string | null>
}

function VoiceActivityEditor({
  activity,
  isDisabled,
  isUploading,
  isLoading,
  onUploadRecording,
  onDeleteRecording,
  fetchRecordingUrl,
}: VoiceActivityEditorProps) {
  const voiceBody = getVoiceBody(activity)
  const audioFileName = voiceBody.audioFile
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPlayback() {
      if (!audioFileName) {
        setPlaybackUrl(null)
        setIsPlaybackLoading(false)
        return
      }
      setIsPlaybackLoading(true)
      const url = await fetchRecordingUrl(audioFileName)
      if (!cancelled) {
        setPlaybackUrl(url)
        setIsPlaybackLoading(false)
      }
    }

    loadPlayback().catch((error) => {
      console.error("[v0] Failed to load voice playback:", error)
      if (!cancelled) {
        setIsPlaybackLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [audioFileName, fetchRecordingUrl])

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop()
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  const handleStartRecording = async () => {
    if (isDisabled || isUploading || isRecording) return
    setRecordingError(null)

    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setRecordingError("Voice recording is not supported in this browser.")
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
        console.error("[v0] MediaRecorder error:", event.error)
        setRecordingError(event.error?.message ?? "Recording failed")
      }

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
          if (blob.size === 0) {
            setRecordingError("Recording was empty.")
            return
          }

          const fileName = `voice-${Date.now()}.webm`
          const file = new File([blob], fileName, { type: blob.type })
          const durationMs = startTimeRef.current ? Date.now() - startTimeRef.current : null
          const result = await onUploadRecording(file, durationMs)
          if (!result.success) {
            setRecordingError("Failed to save recording.")
          } else {
            setRecordingError(null)
          }
        } catch (error) {
          console.error("[v0] Failed to process recording:", error)
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
      console.error("[v0] Failed to start recording:", error)
      setRecordingError(error instanceof Error ? error.message : "Could not access microphone.")
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      mediaRecorderRef.current = null
      setIsRecording(false)
    }
  }

  const handleStopRecording = () => {
    if (!mediaRecorderRef.current) return
    if (mediaRecorderRef.current.state === "inactive") return
    mediaRecorderRef.current.stop()
  }

  const handleDeleteRecording = async () => {
    if (isDisabled || isUploading) return
    await onDeleteRecording()
    setPlaybackUrl(null)
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleStartRecording}
          disabled={isDisabled || isUploading || isRecording}
        >
          {isRecording ? "Recording…" : audioFileName ? "Re-record" : "Start recording"}
        </Button>
        {isRecording ? (
          <Button type="button" size="sm" variant="destructive" onClick={handleStopRecording}>
            Stop
          </Button>
        ) : null}
        {audioFileName ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleDeleteRecording}
            disabled={isDisabled || isUploading || isRecording}
          >
            Delete recording
          </Button>
        ) : null}
      </div>
      {recordingError ? (
        <p className="text-sm text-destructive">{recordingError}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Allow microphone access to capture a short message your learners can listen to.
        </p>
      )}
      {isUploading ? <p className="text-sm text-muted-foreground">Saving recording…</p> : null}
      {isLoading || isPlaybackLoading ? (
        <p className="text-sm text-muted-foreground">Loading recording…</p>
      ) : playbackUrl ? (
        <audio controls src={playbackUrl} className="w-full" />
      ) : (
        <p className="text-sm text-muted-foreground">No recording captured yet.</p>
      )}
    </div>
  )
}
