"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type JSX } from "react"
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react"
import Link from "next/link"
import { Check, ClipboardPaste, Copy, Download, Link2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { CurriculumDetail, LessonWithObjectives, Units } from "@/types"
import {
  batchCreateLosAndScsAction,
  checkSuccessCriteriaUsageAction,
  createCurriculumAssessmentObjectiveAction,
  createCurriculumLearningObjectiveAction,
  createCurriculumSuccessCriterionAction,
  deleteCurriculumSuccessCriterionAction,
  linkLessonSuccessCriterionAction,
  readCurriculumDetailAction,
  unassignSuccessCriteriaFromActivitiesAction,
  unlinkLessonSuccessCriterionAction,
  moveLearningObjectiveAction,
  readCurriculaWithAOsAction,
  updateCurriculumAssessmentObjectiveAction,
  updateCurriculumLearningObjectiveAction,
  updateCurriculumSuccessCriterionAction,
} from "@/lib/server-updates"
import { parseLoScMarkdown, type ParseLoScResult } from "@/lib/parse-lo-sc-markdown"
import { useToast } from "@/components/ui/use-toast"
import { createExportBasename } from "@/lib/export-utils"
import { stripLearningObjectiveFromDescription } from "@/lib/curriculum-formatting"

interface CurriculumPrototypeClientProps {
  curriculum: CurriculumDetail
  units: Units
  lessons: LessonWithObjectives[]
  unitsError?: string | null
  lessonsError?: string | null
  initialScUsageMap?: Record<string, boolean>
}

type SuccessCriterion = {
  id: string
  level: number
  description: string
  units: string[]
  active: boolean
  orderIndex: number
}

type LessonObjective = {
  id: string
  title: string
  orderIndex: number
  specRef: string | null
  successCriteria: SuccessCriterion[]
}

type AssessmentObjective = {
  id: string
  code: string
  title: string
  orderIndex: number
  unitId: string | null
  lessonObjectives: LessonObjective[]
}

const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

const levelStyleMap: Record<number, { badge: string; text: string }> = {
  0: { badge: "bg-gray-100 text-gray-600", text: "text-gray-600" },
  1: { badge: "bg-emerald-100 text-emerald-900", text: "text-emerald-900" },
  2: { badge: "bg-emerald-200 text-emerald-900", text: "text-emerald-900" },
  3: { badge: "bg-emerald-300 text-emerald-900", text: "text-emerald-900" },
  4: { badge: "bg-emerald-400 text-emerald-900", text: "text-emerald-900" },
  5: { badge: "bg-emerald-500 text-emerald-50", text: "text-emerald-50" },
  6: { badge: "bg-emerald-600 text-emerald-50", text: "text-emerald-50" },
  7: { badge: "bg-emerald-700 text-emerald-50", text: "text-emerald-50" },
  8: { badge: "bg-emerald-800 text-emerald-50", text: "text-emerald-50" },
  9: { badge: "bg-emerald-900 text-emerald-50", text: "text-emerald-50" },
}

const yearBadgeMap: Record<number, string> = {
  7: "bg-blue-100 text-blue-900",
  8: "bg-sky-200 text-sky-900",
  9: "bg-purple-200 text-purple-900",
  10: "bg-amber-200 text-amber-900",
  11: "bg-rose-200 text-rose-900",
  12: "bg-indigo-300 text-indigo-900",
  13: "bg-teal-300 text-teal-900",
}

function mapCurriculumToAssessmentObjectives(curriculum: CurriculumDetail): AssessmentObjective[] {
  const assessmentObjectives = curriculum.assessment_objectives ?? []

  return assessmentObjectives
    .slice()
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .map((ao, aoIndex) => {
      const learningObjectives = ao.learning_objectives ?? []

      const activeLearningObjectives = learningObjectives
        .filter((lo) => lo.active !== false)
        .slice()
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

      return {
        id: ao.assessment_objective_id,
        code: ao.code,
        title: ao.title,
        orderIndex: ao.order_index ?? aoIndex,
        unitId: ao.unit_id ?? null,
        lessonObjectives: activeLearningObjectives.map((lo, loIndex) => ({
            id: lo.learning_objective_id,
            title: lo.title,
            orderIndex: lo.order_index ?? loIndex,
            specRef: lo.spec_ref ?? null,
            successCriteria: (lo.success_criteria ?? [])
              .slice()
              .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
              .map((criterion, criterionIndex) => ({
                id: criterion.success_criteria_id,
                level: criterion.level ?? 0,
                description: criterion.description ?? "",
                units: criterion.units ?? [],
                active: criterion.active ?? true,
                orderIndex: criterion.order_index ?? criterionIndex,
              })),
          })),
      }
    })
}

function deriveUnitYear(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const match = text.match(/(?:year|yr)\s*(\d{1,2})/i)
  if (!match) return undefined
  const parsed = Number.parseInt(match[1] ?? "", 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

export default function CurriculumPrototypeClient({
  curriculum,
  units,
  lessons,
  unitsError,
  lessonsError,
  initialScUsageMap = {},
}: CurriculumPrototypeClientProps) {
  const curriculumId = curriculum.curriculum_id
  const curriculumName = curriculum.title

  const [assessmentObjectives, setAssessmentObjectives] = useState<AssessmentObjective[]>(() =>
    mapCurriculumToAssessmentObjectives(curriculum),
  )
  const [visualFilter, setVisualFilter] = useState("")
  const [isPending, startTransition] = useTransition()
  const [unitFilter, setUnitFilter] = useState("")
  const [lessonState, setLessonState] = useState<LessonWithObjectives[]>(() =>
    lessons.map((lesson) => ({
      ...lesson,
      lesson_success_criteria: lesson.lesson_success_criteria ?? [],
    })),
  )
  const [pendingLessonSuccessCriteria, setPendingLessonSuccessCriteria] = useState<Set<string>>(new Set())
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<Set<string>>(() => new Set<string>())
  const [isExportingLevels, setIsExportingLevels] = useState(false)
  const [isExportingUnits, setIsExportingUnits] = useState(false)

  const [editingContext, setEditingContext] = useState<
    { aoIndex: number; loIndex: number; criterionId: string } | null
  >(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [editingAssessmentObjective, setEditingAssessmentObjective] = useState<{ aoIndex: number } | null>(null)
  const [editingAssessmentObjectiveTitle, setEditingAssessmentObjectiveTitle] = useState("")
  const [editingLessonObjective, setEditingLessonObjective] = useState<
    { aoIndex: number; loIndex: number } | null
  >(null)
  const [editingLessonObjectiveTitle, setEditingLessonObjectiveTitle] = useState("")
  const [editingLessonObjectiveSpecRef, setEditingLessonObjectiveSpecRef] = useState("")
  const [editingLessonObjectiveAoId, setEditingLessonObjectiveAoId] = useState("")
  const [editingLessonObjectiveCurriculumId, setEditingLessonObjectiveCurriculumId] = useState("")
  const [allCurriculaWithAOs, setAllCurriculaWithAOs] = useState<
    { curriculum_id: string; title: string | null; assessment_objectives: { assessment_objective_id: string; code: string | null; title: string | null }[] }[] | null
  >(null)
  const [unitPickerContext, setUnitPickerContext] = useState<
    | {
        aoIndex: number
        loIndex: number
        criterionId: string
      }
    | null
  >(null)
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mapperUnitId, setMapperUnitId] = useState("")

  // Track which SCs are assigned to activities
  // Initialize with server-provided data to avoid loading delay
  const [scUsageMap, setScUsageMap] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>()
    Object.entries(initialScUsageMap).forEach(([scId, isAssigned]) => {
      map.set(scId, isAssigned)
    })
    return map
  })

  // Unassign dialog state
  const [unassignDialog, setUnassignDialog] = useState<{
    open: boolean
    successCriteriaId: string | null
    affectedLessons: Array<{ lesson_id: string; lesson_title: string; unit_title: string | null }>
  }>({
    open: false,
    successCriteriaId: null,
    affectedLessons: [],
  })

  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [pasteDialog, setPasteDialog] = useState<{ open: boolean; aoIndex: number | null }>({ open: false, aoIndex: null })
  const [pasteContent, setPasteContent] = useState("")
  const [pastePreview, setPastePreview] = useState<ParseLoScResult | null>(null)
  const [isPasting, setIsPasting] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)

  const mapperStickyWidth = "clamp(14rem, 33.3333%, 22rem)"
  const { toast } = useToast()

  const showToast = useCallback(
    (type: "success" | "error", message: string) => {
      toast({
        title: type === "error" ? "Error" : "Success",
        description: message,
        variant: type === "error" ? "destructive" : "default",
      })
    },
    [toast],
  )

  const handleLevelsExport = useCallback(async () => {
    try {
      setIsExportingLevels(true)

      const response = await fetch(`/api/curriculum/${curriculumId}/export/levels`, {
        method: "GET",
        cache: "no-store",
      })

      if (!response.ok) {
        let errorMessage = "Failed to export levels."
        try {
          const payload = await response.json()
          if (typeof payload?.error === "string") {
            errorMessage = payload.error
          }
        } catch {
          // Non-JSON error payloads are ignored, fallback message used.
        }
        throw new Error(errorMessage)
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const contentDisposition = response.headers.get("content-disposition") ?? ""
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i)
      const fallbackFilename = `${createExportBasename(curriculumName, curriculumId, { suffix: "levels" })}.docx`
      const filename = filenameMatch?.[1] ?? fallbackFilename

      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)

      showToast("success", "Levels export is ready.")
    } catch (error) {
      console.error("[curricula] Failed to export levels", error)
      const message = error instanceof Error ? error.message : "Failed to export levels."
      showToast("error", message)
    } finally {
      setIsExportingLevels(false)
    }
  }, [curriculumId, curriculumName, showToast])

  const handleUnitsExport = useCallback(async () => {
    try {
      setIsExportingUnits(true)

      const response = await fetch(`/api/curriculum/${curriculumId}/export/units`, {
        method: "GET",
        cache: "no-store",
      })

      if (!response.ok) {
        let errorMessage = "Failed to export units."
        try {
          const payload = await response.json()
          if (typeof payload?.error === "string") {
            errorMessage = payload.error
          }
        } catch {
          // Non-JSON error payloads are ignored, fallback message used.
        }
        throw new Error(errorMessage)
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const contentDisposition = response.headers.get("content-disposition") ?? ""
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i)
      const fallbackFilename = `${createExportBasename(curriculumName, curriculumId, { suffix: "units" })}.docx`
      const filename = filenameMatch?.[1] ?? fallbackFilename

      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)

      showToast("success", "Units export is ready.")
    } catch (error) {
      console.error("[curricula] Failed to export units", error)
      const message = error instanceof Error ? error.message : "Failed to export units."
      showToast("error", message)
    } finally {
      setIsExportingUnits(false)
    }
  }, [curriculumId, curriculumName, showToast])

  useEffect(() => {
    setAssessmentObjectives(mapCurriculumToAssessmentObjectives(curriculum))
    setSelectedCriteriaIds(new Set<string>())
  }, [curriculum])

  useEffect(() => {
    setLessonState(
      lessons.map((lesson) => ({
        ...lesson,
        lesson_success_criteria: lesson.lesson_success_criteria ?? [],
      })),
    )
  }, [lessons])

  useEffect(() => {
    if (!unitPickerContext) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUnitPickerContext(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [unitPickerContext])

  useEffect(() => {
    if (!editingContext) return
    const animationFrame = requestAnimationFrame(() => {
      editingTextareaRef.current?.focus()
      editingTextareaRef.current?.select()
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [editingContext])

  const unitMetadata = useMemo(
    () =>
      units.map((unit) => ({
        ...unit,
        year: unit.year ?? deriveUnitYear(unit.title) ?? deriveUnitYear(unit.description ?? undefined),
      })),
    [units],
  )

  const unitLookup = useMemo(() => new Map(unitMetadata.map((unit) => [unit.unit_id, unit])), [unitMetadata])

  const subjectUnitOptions = useMemo(() => {
    if (!curriculum.subject) {
      return unitMetadata.slice().sort((a, b) => a.title.localeCompare(b.title))
    }
    return unitMetadata
      .filter((unit) => unit.subject === curriculum.subject)
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [curriculum.subject, unitMetadata])

  useEffect(() => {
    if (subjectUnitOptions.length === 0) {
      setMapperUnitId("")
      return
    }

    setMapperUnitId((prev) => {
      if (prev && subjectUnitOptions.some((unit) => unit.unit_id === prev)) {
        return prev
      }
      return subjectUnitOptions[0]?.unit_id ?? ""
    })
  }, [subjectUnitOptions])

  const lessonsByUnit = useMemo(() => {
    const map = new Map<string, LessonWithObjectives[]>()
    if (!lessonState || lessonState.length === 0) {
      return map
    }

    const relevantUnitIds = new Set(subjectUnitOptions.map((unit) => unit.unit_id))

    lessonState.forEach((lesson) => {
      if (!lesson.unit_id || lesson.active === false) {
        return
      }
      if (relevantUnitIds.size > 0 && !relevantUnitIds.has(lesson.unit_id)) {
        return
      }
      const existing = map.get(lesson.unit_id)
      if (existing) {
        existing.push(lesson)
      } else {
        map.set(lesson.unit_id, [lesson])
      }
    })

    map.forEach((entries, unitId) => {
      entries.sort((a, b) => {
        const orderDiff = (a.order_by ?? 0) - (b.order_by ?? 0)
        if (orderDiff !== 0) return orderDiff
        return a.title.localeCompare(b.title)
      })
      map.set(unitId, entries)
    })

    return map
  }, [lessonState, subjectUnitOptions])

  const selectedMapperUnit = useMemo(
    () => subjectUnitOptions.find((unit) => unit.unit_id === mapperUnitId) ?? null,
    [mapperUnitId, subjectUnitOptions],
  )

  const mapperLessons = useMemo(
    () => (selectedMapperUnit ? lessonsByUnit.get(selectedMapperUnit.unit_id) ?? [] : []),
    [lessonsByUnit, selectedMapperUnit],
  )

  const hasAnyLearningObjectives = useMemo(
    () => assessmentObjectives.some((ao) => ao.lessonObjectives.length > 0),
    [assessmentObjectives],
  )

  const levelsView = useMemo(() => {
    return levels
      .map((level) => {
        const criteria = assessmentObjectives
          .flatMap((ao) =>
            ao.lessonObjectives.flatMap((lo) =>
              lo.successCriteria
                .filter((sc) => sc.level === level)
                .map((sc) => {
                  const displayDescription = stripLearningObjectiveFromDescription(sc.description, lo.title)
                  return {
                    ...sc,
                    description: displayDescription,
                    rawDescription: sc.description,
                    aoCode: ao.code,
                    aoTitle: ao.title,
                    loTitle: lo.title,
                  }
                }),
            ),
          )
        return {
          level,
          criteria: criteria.sort((a, b) => {
            if (a.aoCode === b.aoCode) {
              return a.description.localeCompare(b.description)
            }
            return a.aoCode.localeCompare(b.aoCode)
          }),
        }
      })
      .filter((group) => group.criteria.length > 0)
  }, [assessmentObjectives])

  const unitsView = useMemo(() => {
    const unitMap = new Map<
      string,
      {
        unitId: string
        unitName: string
        year?: number
        subject?: string
        entries: {
          level: number
          description: string
          loTitle: string
          aoCode: string
          aoTitle: string
        }[]
      }
    >()

    assessmentObjectives.forEach((ao) => {
      ao.lessonObjectives.forEach((lo) => {
        lo.successCriteria.forEach((sc) => {
          sc.units.forEach((unitId) => {
            const meta = unitLookup.get(unitId)
            if (!unitMap.has(unitId)) {
              unitMap.set(unitId, {
                unitId,
                unitName: meta?.title ?? unitId,
                year: meta?.year,
                subject: meta?.subject ?? undefined,
                entries: [],
              })
            }
            unitMap.get(unitId)?.entries.push({
              level: sc.level,
              description: stripLearningObjectiveFromDescription(sc.description, lo.title),
              loTitle: lo.title,
              aoCode: ao.code,
              aoTitle: ao.title,
            })
          })
        })
      })
    })

    return Array.from(unitMap.values()).sort((a, b) => {
      if (a.year !== undefined && b.year !== undefined && a.year !== b.year) {
        return a.year - b.year
      }
      return a.unitName.localeCompare(b.unitName)
    })
  }, [assessmentObjectives, unitLookup])

  const normalizedUnitFilter = unitFilter.trim().toLowerCase()

  const normalizedFilter = visualFilter.trim().toLowerCase()
  const yearMatches = Array.from(normalizedFilter.matchAll(/yr\s*(\d{1,2})/g)).map((match) =>
    Number.parseInt(match[1], 10),
  )
  const levelMatches = Array.from(normalizedFilter.matchAll(/l\s*(\d{1,2})/g)).map((match) =>
    Number.parseInt(match[1], 10),
  )

  const yearFilterSet = new Set(yearMatches.filter((year) => Number.isFinite(year)))
  const levelFilterSet = new Set(
    levelMatches.filter((level) => Number.isFinite(level) && level >= 1 && level <= 7),
  )

  const textFilter = normalizedFilter
    .replace(/yr\s*\d{1,2}/g, "")
    .replace(/l\s*\d{1,2}/g, "")
    .trim()

  const resetEditingStates = () => {
    setEditingContext(null)
    setEditingTitle("")
    setEditingAssessmentObjective(null)
    setEditingAssessmentObjectiveTitle("")
    setEditingLessonObjective(null)
    setEditingLessonObjectiveTitle("")
    setEditingLessonObjectiveSpecRef("")
    setEditingLessonObjectiveAoId("")
    setEditingLessonObjectiveCurriculumId("")
    setUnitPickerContext(null)
    setSelectedCriteriaIds(new Set<string>())
  }

  const syncFromDetail = (
    detail: CurriculumDetail,
    focus?: { aoId?: string; loId?: string; scId?: string },
  ) => {
    const mapped = mapCurriculumToAssessmentObjectives(detail)
    setAssessmentObjectives(mapped)

    if (!focus) return

    const aoIndex = focus.aoId ? mapped.findIndex((ao) => ao.id === focus.aoId) : -1
    if (aoIndex < 0) return

    if (focus.scId && focus.loId) {
      const loIndex = mapped[aoIndex].lessonObjectives.findIndex((lo) => lo.id === focus.loId)
      if (loIndex < 0) return
      const criterion = mapped[aoIndex].lessonObjectives[loIndex].successCriteria.find(
        (item) => item.id === focus.scId,
      )
      if (!criterion) return
      setEditingContext({ aoIndex, loIndex, criterionId: focus.scId })
      setEditingTitle(criterion.description)
      return
    }

    if (focus.loId) {
      const loIndex = mapped[aoIndex].lessonObjectives.findIndex((lo) => lo.id === focus.loId)
      if (loIndex < 0) return
      setEditingLessonObjective({ aoIndex, loIndex })
      setEditingLessonObjectiveTitle(mapped[aoIndex].lessonObjectives[loIndex].title)
      setEditingLessonObjectiveSpecRef(mapped[aoIndex].lessonObjectives[loIndex].specRef ?? "")
      return
    }

    setEditingAssessmentObjective({ aoIndex })
    setEditingAssessmentObjectiveTitle(mapped[aoIndex].title)
  }

  const refreshCurriculum = async (focus?: { aoId?: string; loId?: string; scId?: string }) => {
    const result = await readCurriculumDetailAction(curriculumId)
    if (result.error) {
      showToast("error", result.error)
      return
    }

    if (result.data) {
      resetEditingStates()
      syncFromDetail(result.data, focus)
    }
  }

  // Removed automatic usage check on mount - now using server-provided initialScUsageMap
  // This eliminates the 5-10 second delay where trash icons would switch to chain icons
  //
  // If we need to refresh usage data (e.g., after operations), we can add a manual refresh function:
  // const refreshScUsage = useCallback(async (scId: string) => {
  //   const result = await checkSuccessCriteriaUsageAction(scId)
  //   if (result.data) {
  //     setScUsageMap(prev => new Map(prev).set(scId, result.data.isAssigned))
  //   }
  // }, [])

  const addAssessmentObjective = () => {
    const newAoIndex = assessmentObjectives.length
    const aoNumber = newAoIndex + 1
    const newAoCode = `AO${aoNumber}`
    const defaultLessonTitle = "New learning objective"
    const defaultCriterionDescription = "New success criterion"

    startTransition(async () => {
      const aoResult = await createCurriculumAssessmentObjectiveAction(curriculumId, {
        code: newAoCode,
        title: "New assessment objective",
        order_index: newAoIndex,
      })

      if (aoResult.error || !aoResult.data) {
        showToast("error", aoResult.error ?? "Failed to create assessment objective.")
        return
      }

      const aoId = aoResult.data.assessment_objective_id

      const loResult = await createCurriculumLearningObjectiveAction(
        aoId,
        { title: defaultLessonTitle, order_index: 0 },
        curriculumId,
      )

      if (loResult.error || !loResult.data) {
        showToast("error", loResult.error ?? "Failed to create learning objective.")
        await refreshCurriculum()
        return
      }

      const loId = loResult.data.learning_objective_id

      const scResult = await createCurriculumSuccessCriterionAction(loId, curriculumId, {
        description: defaultCriterionDescription,
        level: 0,
        order_index: 0,
        unit_ids: [],
      })

      if (scResult.error || !scResult.data) {
        showToast("error", scResult.error ?? "Failed to create success criterion.")
        await refreshCurriculum({ aoId, loId })
        return
      }

      await refreshCurriculum({ aoId, loId, scId: scResult.data.success_criteria_id })
      showToast("success", "Assessment objective added.")
    })
  }

  const addLearningObjective = (aoIndex: number) => {
    const targetAo = assessmentObjectives[aoIndex]
    if (!targetAo) return

    const newSequence = targetAo.lessonObjectives.length

    startTransition(async () => {
      const loResult = await createCurriculumLearningObjectiveAction(
        targetAo.id,
        { title: "New learning objective", order_index: newSequence },
        curriculumId,
      )

      if (loResult.error || !loResult.data) {
        showToast("error", loResult.error ?? "Failed to create learning objective.")
        await refreshCurriculum({ aoId: targetAo.id })
        return
      }

      const loId = loResult.data.learning_objective_id

      const scResult = await createCurriculumSuccessCriterionAction(loId, curriculumId, {
        description: "New success criterion",
        level: 0,
        order_index: 0,
        unit_ids: [],
      })

      if (scResult.error || !scResult.data) {
        showToast("error", scResult.error ?? "Failed to create success criterion.")
        await refreshCurriculum({ aoId: targetAo.id, loId })
        return
      }

      await refreshCurriculum({ aoId: targetAo.id, loId, scId: scResult.data.success_criteria_id })
      showToast("success", "Learning objective added.")
    })
  }

  const addSuccessCriterion = (aoIndex: number, loIndex: number) => {
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    if (!targetAo || !targetLo) return

    startTransition(async () => {
      const scResult = await createCurriculumSuccessCriterionAction(targetLo.id, curriculumId, {
        description: "New success criterion",
        level: 0,
        order_index: targetLo.successCriteria.length,
        unit_ids: [],
      })

      if (scResult.error || !scResult.data) {
        showToast("error", scResult.error ?? "Failed to create success criterion.")
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id })
        return
      }

      await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: scResult.data.success_criteria_id })
      showToast("success", "Success criterion added.")
    })
  }

  const startEditingCriterion = (aoIndex: number, loIndex: number, criterion: SuccessCriterion) => {
    setEditingContext({ aoIndex, loIndex, criterionId: criterion.id })
    setEditingTitle(criterion.description)
  }

  const cancelEditingCriterion = () => {
    setEditingContext(null)
    setEditingTitle("")
  }

  const saveCriterionDescription = () => {
    if (!editingContext) return

    const { aoIndex, loIndex, criterionId } = editingContext
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    const newDescription = editingTitle.trim()

    if (!targetAo || !targetLo) {
      showToast("error", "Unable to locate success criterion.")
      return
    }

    if (newDescription.length === 0) {
      showToast("error", "Description cannot be empty.")
      return
    }

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) =>
        aoIdx === aoIndex
          ? {
              ...ao,
              lessonObjectives: ao.lessonObjectives.map((lo, loIdx) =>
                loIdx === loIndex
                  ? {
                      ...lo,
                      successCriteria: lo.successCriteria.map((sc) =>
                        sc.id === criterionId ? { ...sc, description: newDescription } : sc,
                      ),
                    }
                  : lo,
              ),
            }
          : ao,
      ),
    )

    cancelEditingCriterion()

    startTransition(async () => {
      const result = await updateCurriculumSuccessCriterionAction(criterionId, curriculumId, {
        description: newDescription,
      })

      if (result.error) {
        showToast("error", result.error)
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: criterionId })
        return
      }

      showToast("success", "Success criterion updated.")
    })
  }

  const handleLevelChange = (
    aoIndex: number,
    loIndex: number,
    criterionId: string,
    newLevel: number,
  ) => {
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    if (!targetAo || !targetLo) return

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) =>
        aoIdx === aoIndex
          ? {
              ...ao,
              lessonObjectives: ao.lessonObjectives.map((lo, loIdx) =>
                loIdx === loIndex
                  ? {
                      ...lo,
                      successCriteria: lo.successCriteria.map((sc) =>
                        sc.id === criterionId ? { ...sc, level: newLevel } : sc,
                      ),
                    }
                  : lo,
              ),
            }
          : ao,
      ),
    )

    startTransition(async () => {
      const result = await updateCurriculumSuccessCriterionAction(criterionId, curriculumId, {
        level: newLevel,
      })

      if (result.error) {
        showToast("error", result.error)
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: criterionId })
        return
      }

      showToast("success", "Success criterion updated.")
    })
  }

  const toggleCriterionSelection = (criterionId: string, shouldSelect: boolean) => {
    setSelectedCriteriaIds((prev) => {
      const next = new Set(prev)
      if (shouldSelect) {
        next.add(criterionId)
      } else {
        next.delete(criterionId)
      }
      return next
    })
  }

  const handleDeleteCriterion = async (aoIndex: number, loIndex: number, criterionId: string) => {
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    if (!targetAo || !targetLo) return

    // Check if SC is assigned to activities
    const isAssigned = scUsageMap.get(criterionId)

    if (isAssigned) {
      // Fetch affected lessons and show unassign dialog
      const result = await checkSuccessCriteriaUsageAction(criterionId)
      if (result.data) {
        setUnassignDialog({
          open: true,
          successCriteriaId: criterionId,
          affectedLessons: result.data.affectedLessons
        })
      }
      return
    }

    // Original deletion logic for unassigned SCs
    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) =>
        aoIdx === aoIndex
          ? {
              ...ao,
              lessonObjectives: ao.lessonObjectives.map((lo, loIdx) =>
                loIdx === loIndex
                  ? {
                      ...lo,
                      successCriteria: lo.successCriteria.filter((sc) => sc.id !== criterionId),
                    }
                  : lo,
              ),
            }
          : ao,
      ),
    )

    if (editingContext?.criterionId === criterionId) {
      cancelEditingCriterion()
    }

    if (unitPickerContext?.criterionId === criterionId) {
      setUnitPickerContext(null)
    }

    setSelectedCriteriaIds((prev) => {
      if (!prev.has(criterionId)) return prev
      const next = new Set(prev)
      next.delete(criterionId)
      return next
    })

    startTransition(async () => {
      const result = await deleteCurriculumSuccessCriterionAction(criterionId, curriculumId)

      if (!result.success) {
        showToast("error", result.error ?? "Failed to delete success criterion.")
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id })
        return
      }

      showToast("success", "Success criterion removed.")
    })
  }

  const handleUnassignCriterion = async () => {
    const { successCriteriaId, affectedLessons } = unassignDialog
    if (!successCriteriaId) return

    // Close dialog immediately
    setUnassignDialog({ open: false, successCriteriaId: null, affectedLessons: [] })

    startTransition(async () => {
      const result = await unassignSuccessCriteriaFromActivitiesAction(successCriteriaId, curriculumId)

      if (!result.success) {
        showToast("error", result.error ?? "Failed to unassign success criterion.")
        return
      }

      showToast(
        "success",
        `Success criterion unassigned from ${result.removedCount} ${result.removedCount === 1 ? "activity" : "activities"}.`
      )

      // Update usage map to reflect that SC is no longer assigned
      setScUsageMap((prev) => {
        const next = new Map(prev)
        next.set(successCriteriaId, false)
        return next
      })
    })
  }

  const toggleLessonSuccessCriterion = (
    lessonId: string,
    lessonTitle: string,
    learningObjectiveId: string,
    criterion: SuccessCriterion,
  ) => {
    const lesson = lessonState.find((entry) => entry.lesson_id === lessonId)
    if (!lesson) return

    const existingCriteria = lesson.lesson_success_criteria ?? []
    const hasLink = existingCriteria.some((entry) => entry.success_criteria_id === criterion.id)

    const previousLessons = lessonState.map((entry) => ({
      ...entry,
      lesson_success_criteria: entry.lesson_success_criteria
        ? entry.lesson_success_criteria.map((item) => ({ ...item }))
        : [],
    }))

    const title =
      criterion.description && criterion.description.trim().length > 0
        ? criterion.description.trim()
        : "Success criterion"

    const nextLessonSuccessCriteria = hasLink
      ? existingCriteria.filter((entry) => entry.success_criteria_id !== criterion.id)
      : [...existingCriteria, {
          lesson_id: lessonId,
          success_criteria_id: criterion.id,
          title,
          description: criterion.description ?? null,
          level: criterion.level ?? null,
          learning_objective_id: learningObjectiveId,
        }].sort((a, b) => a.title.localeCompare(b.title))

    setLessonState((prev) =>
      prev.map((entry) =>
        entry.lesson_id === lessonId
          ? {
              ...entry,
              lesson_success_criteria: nextLessonSuccessCriteria,
            }
          : entry,
      ),
    )

    const pendingKey = `${lessonId}-${criterion.id}`
    setPendingLessonSuccessCriteria((prev) => {
      const next = new Set(prev)
      next.add(pendingKey)
      return next
    })

    startTransition(async () => {
      const result = hasLink
        ? await unlinkLessonSuccessCriterionAction({ lessonId, successCriteriaId: criterion.id })
        : await linkLessonSuccessCriterionAction({ lessonId, successCriteriaId: criterion.id })

      setPendingLessonSuccessCriteria((prev) => {
        const next = new Set(prev)
        next.delete(pendingKey)
        return next
      })

      if (!result.success) {
        showToast("error", result.error ?? "Failed to update success criterion mapping.")
        setLessonState(previousLessons)
        return
      }

      showToast(
        "success",
        hasLink
          ? `Removed success criterion from ${lessonTitle}.`
          : `Linked success criterion to ${lessonTitle}.`,
      )
    })
  }

  const toggleUnitForCriterion = (
    aoIndex: number,
    loIndex: number,
    criterionId: string,
    unitId: string,
  ) => {
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    const targetCriterion = targetLo?.successCriteria.find((sc) => sc.id === criterionId)
    if (!targetAo || !targetLo || !targetCriterion) return

    const alreadySelected = targetCriterion.units.includes(unitId)
    const nextUnits = alreadySelected
      ? targetCriterion.units.filter((existing) => existing !== unitId)
      : [...targetCriterion.units, unitId]

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) =>
        aoIdx === aoIndex
          ? {
              ...ao,
              lessonObjectives: ao.lessonObjectives.map((lo, loIdx) =>
                loIdx === loIndex
                  ? {
                      ...lo,
                      successCriteria: lo.successCriteria.map((sc) =>
                        sc.id === criterionId ? { ...sc, units: nextUnits } : sc,
                      ),
                    }
                  : lo,
              ),
            }
          : ao,
      ),
    )

    startTransition(async () => {
      const result = await updateCurriculumSuccessCriterionAction(criterionId, curriculumId, {
        unit_ids: nextUnits,
      })

      if (result.error) {
        showToast("error", result.error)
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: criterionId })
        return
      }

      showToast("success", "Success criterion updated.")
    })
  }

  const startLessonObjectiveEdit = async (
    aoIndex: number,
    loIndex: number,
    currentTitle: string,
    currentSpecRef: string | null,
    aoId: string,
  ) => {
    setEditingLessonObjective({ aoIndex, loIndex })
    setEditingLessonObjectiveTitle(currentTitle)
    setEditingLessonObjectiveSpecRef(currentSpecRef ?? "")
    setEditingLessonObjectiveAoId(aoId)
    setEditingLessonObjectiveCurriculumId(curriculumId)

    if (!allCurriculaWithAOs) {
      const result = await readCurriculaWithAOsAction()
      if (result.data) {
        setAllCurriculaWithAOs(result.data)
      }
    }
  }

  const cancelLessonObjectiveEdit = () => {
    setEditingLessonObjective(null)
    setEditingLessonObjectiveTitle("")
    setEditingLessonObjectiveSpecRef("")
    setEditingLessonObjectiveAoId("")
    setEditingLessonObjectiveCurriculumId("")
  }

  const saveLessonObjectiveEdit = () => {
    if (!editingLessonObjective) return

    const { aoIndex, loIndex } = editingLessonObjective
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    const newTitle = editingLessonObjectiveTitle.trim()
    const newSpecRef = editingLessonObjectiveSpecRef.trim()
    const newAoId = editingLessonObjectiveAoId
    const newCurriculumId = editingLessonObjectiveCurriculumId

    if (!targetAo || !targetLo) {
      showToast("error", "Unable to locate learning objective.")
      return
    }

    if (newTitle.length === 0) {
      showToast("error", "Title cannot be empty.")
      return
    }

    const aoChanged = newAoId !== "" && newAoId !== targetAo.id
    const movingToDifferentCurriculum = aoChanged && newCurriculumId !== curriculumId

    if (movingToDifferentCurriculum) {
      // Remove LO from local state since it's moving to a different curriculum
      setAssessmentObjectives((prev) =>
        prev.map((ao, aoIdx) =>
          aoIdx === aoIndex
            ? { ...ao, lessonObjectives: ao.lessonObjectives.filter((_, loIdx) => loIdx !== loIndex) }
            : ao,
        ),
      )
    } else if (aoChanged) {
      // Move LO to a different AO within the same curriculum
      const loData = { ...targetLo, title: newTitle, specRef: newSpecRef.length > 0 ? newSpecRef : null }
      setAssessmentObjectives((prev) =>
        prev.map((ao) => {
          if (ao.id === targetAo.id) {
            return { ...ao, lessonObjectives: ao.lessonObjectives.filter((lo) => lo.id !== targetLo.id) }
          }
          if (ao.id === newAoId) {
            return { ...ao, lessonObjectives: [...ao.lessonObjectives, loData] }
          }
          return ao
        }),
      )
    } else {
      // Just updating title/specRef within the same AO
      setAssessmentObjectives((prev) =>
        prev.map((ao, aoIdx) =>
          aoIdx === aoIndex
            ? {
                ...ao,
                lessonObjectives: ao.lessonObjectives.map((lo, loIdx) =>
                  loIdx === loIndex
                    ? { ...lo, title: newTitle, specRef: newSpecRef.length > 0 ? newSpecRef : null }
                    : lo,
                ),
              }
            : ao,
        ),
      )
    }

    cancelLessonObjectiveEdit()

    startTransition(async () => {
      // Update title/specRef
      const result = await updateCurriculumLearningObjectiveAction(targetLo.id, curriculumId, {
        title: newTitle,
        spec_ref: newSpecRef.length > 0 ? newSpecRef : null,
      })

      if (result.error) {
        showToast("error", result.error)
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id })
        return
      }

      // Move AO if changed
      if (aoChanged) {
        const moveResult = await moveLearningObjectiveAction(
          targetLo.id,
          newAoId,
          curriculumId,
          newCurriculumId || curriculumId,
        )

        if (moveResult.error) {
          showToast("error", moveResult.error)
          await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id })
          return
        }

        if (movingToDifferentCurriculum) {
          showToast("success", "Learning objective moved to another curriculum.")
          await refreshCurriculum()
        } else {
          showToast("success", "Learning objective moved.")
          await refreshCurriculum({ aoId: newAoId, loId: targetLo.id })
        }
      } else {
        showToast("success", "Learning objective updated.")
      }
    })
  }

  const removeLearningObjective = (aoIndex: number, loIndex: number) => {
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    if (!targetAo || !targetLo) return

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) =>
        aoIdx === aoIndex
          ? {
              ...ao,
              lessonObjectives: ao.lessonObjectives.filter((_, loIdx) => loIdx !== loIndex),
            }
          : ao,
      ),
    )

    setSelectedCriteriaIds((prev) => {
      if (targetLo.successCriteria.length === 0) {
        return prev
      }

      const next = new Set(prev)
      let changed = false
      targetLo.successCriteria.forEach((criterion) => {
        if (next.delete(criterion.id)) {
          changed = true
        }
      })
      return changed ? next : prev
    })

    if (
      editingContext &&
      editingContext.aoIndex === aoIndex &&
      editingContext.loIndex === loIndex
    ) {
      cancelEditingCriterion()
    }

    if (
      unitPickerContext &&
      unitPickerContext.aoIndex === aoIndex &&
      unitPickerContext.loIndex === loIndex
    ) {
      setUnitPickerContext(null)
    }

    if (
      editingLessonObjective &&
      editingLessonObjective.aoIndex === aoIndex &&
      editingLessonObjective.loIndex === loIndex
    ) {
      cancelLessonObjectiveEdit()
    }

    startTransition(async () => {
      const result = await updateCurriculumLearningObjectiveAction(targetLo.id, curriculumId, {
        active: false,
      })

      if (result.error) {
        showToast("error", result.error)
        await refreshCurriculum({ aoId: targetAo.id })
        return
      }

      showToast("success", "Learning objective removed.")
      await refreshCurriculum({ aoId: targetAo.id })
    })
  }

  const startAssessmentObjectiveEdit = (aoIndex: number, currentTitle: string) => {
    setEditingAssessmentObjective({ aoIndex })
    setEditingAssessmentObjectiveTitle(currentTitle)
  }

  const cancelAssessmentObjectiveEdit = () => {
    setEditingAssessmentObjective(null)
    setEditingAssessmentObjectiveTitle("")
  }

  const saveAssessmentObjectiveEdit = () => {
    if (!editingAssessmentObjective) return

    const { aoIndex } = editingAssessmentObjective
    const targetAo = assessmentObjectives[aoIndex]
    const newTitle = editingAssessmentObjectiveTitle.trim()

    if (!targetAo) {
      showToast("error", "Unable to locate assessment objective.")
      return
    }

    if (newTitle.length === 0) {
      showToast("error", "Title cannot be empty.")
      return
    }

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) => (aoIdx === aoIndex ? { ...ao, title: newTitle } : ao)),
    )

    cancelAssessmentObjectiveEdit()

    startTransition(async () => {
      const result = await updateCurriculumAssessmentObjectiveAction(targetAo.id, curriculumId, {
        title: newTitle,
      })

      if (result.error) {
        showToast("error", result.error)
        await refreshCurriculum({ aoId: targetAo.id })
        return
      }

      showToast("success", "Assessment objective updated.")
    })
  }

  const activeCriterion = unitPickerContext
    ? assessmentObjectives[unitPickerContext.aoIndex]?.lessonObjectives[
        unitPickerContext.loIndex
      ]?.successCriteria.find((criterion) => criterion.id === unitPickerContext.criterionId)
    : null

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <div className="space-y-8">
        <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
          <p className="text-sm uppercase tracking-wide text-white/70">Curriculum</p>
          <h1 className="text-3xl font-semibold">{curriculumName}</h1>
        </header>

        {unitsError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Unable to load unit metadata: {unitsError}
          </div>
        ) : null}

        <Tabs defaultValue="builder" className="space-y-6">
          <TabsList className="grid w-full gap-2 sm:grid-cols-4">
            <TabsTrigger value="builder">Curriculum Builder</TabsTrigger>
            <TabsTrigger value="mapper">Curriculum Mapper</TabsTrigger>
            <TabsTrigger value="levels">Levels Output</TabsTrigger>
            <TabsTrigger value="units">Units Output</TabsTrigger>
          </TabsList>

          <TabsContent value="builder" className="mt-0">
            <section className="flex h-[70vh] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="border-b px-5 py-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Curriculum Builder</h2>
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={addAssessmentObjective}
                    disabled={isPending}
                  >
                    <Plus className="h-4 w-4" /> AO
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {assessmentObjectives.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No assessment objectives yet.</p>
                ) : null}

                {assessmentObjectives.map((ao, aoIndex) => {
                  const lessonObjectiveCards = ao.lessonObjectives.map((lo, loIndex) => {
                    const lessonCode = `LO ${aoIndex + 1}.${loIndex + 1}`
                    const sortedSuccessCriteria = [...lo.successCriteria].sort((a, b) =>
                      a.level === b.level
                        ? a.description.localeCompare(b.description)
                        : a.level - b.level,
                    )

                    return (
                      <div key={lo.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            {editingLessonObjective &&
                            editingLessonObjective.aoIndex === aoIndex &&
                            editingLessonObjective.loIndex === loIndex ? (
                              <div className="flex w-full items-start gap-2">
                                <span className="mt-2 inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary">
                                  {lessonCode}
                                </span>
                                <div className="flex-1 space-y-2">
                                  <input
                                    value={editingLessonObjectiveTitle}
                                    onChange={(event) => setEditingLessonObjectiveTitle(event.target.value)}
                                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    placeholder="Learning objective title"
                                  />
                                  <input
                                    value={editingLessonObjectiveSpecRef}
                                    onChange={(event) => setEditingLessonObjectiveSpecRef(event.target.value)}
                                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    placeholder="Spec reference (optional)"
                                  />
                                  {allCurriculaWithAOs ? (
                                    <div className="flex gap-2">
                                      <select
                                        value={editingLessonObjectiveCurriculumId}
                                        onChange={(event) => {
                                          const newCid = event.target.value
                                          setEditingLessonObjectiveCurriculumId(newCid)
                                          const curr = allCurriculaWithAOs.find((c) => c.curriculum_id === newCid)
                                          const firstAo = curr?.assessment_objectives[0]
                                          setEditingLessonObjectiveAoId(firstAo?.assessment_objective_id ?? "")
                                        }}
                                        className="w-1/2 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                      >
                                        {allCurriculaWithAOs.map((c) => (
                                          <option key={c.curriculum_id} value={c.curriculum_id}>
                                            {c.title ?? "Untitled"}
                                          </option>
                                        ))}
                                      </select>
                                      <select
                                        value={editingLessonObjectiveAoId}
                                        onChange={(event) => setEditingLessonObjectiveAoId(event.target.value)}
                                        className="w-1/2 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                      >
                                        {(allCurriculaWithAOs
                                          .find((c) => c.curriculum_id === editingLessonObjectiveCurriculumId)
                                          ?.assessment_objectives ?? []
                                        ).map((aoOption) => (
                                          <option key={aoOption.assessment_objective_id} value={aoOption.assessment_objective_id}>
                                            {aoOption.code}: {aoOption.title ?? "Untitled"}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="flex items-start gap-1 pt-1">
                                  <button
                                    className="rounded border border-emerald-400 p-1 text-emerald-600 transition hover:bg-emerald-50"
                                    onClick={saveLessonObjectiveEdit}
                                    aria-label="Save learning objective"
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    className="rounded border border-destructive/40 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                                    onClick={cancelLessonObjectiveEdit}
                                    aria-label="Cancel learning objective edit"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start gap-2">
                                <span className="inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary">
                                  {lessonCode}
                                </span>
                                <div className="space-y-1">
                                  <h4 className="text-sm font-medium">{lo.title}</h4>
                                  {lo.specRef ? (
                                    <p className="text-xs text-muted-foreground">Spec reference: {lo.specRef}</p>
                                  ) : null}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              className="rounded-full border border-border p-1 transition hover:bg-muted"
                              onClick={() => startLessonObjectiveEdit(aoIndex, loIndex, lo.title, lo.specRef, ao.id)}
                              aria-label="Edit learning objective"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              className="rounded-full border border-border p-1 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => addSuccessCriterion(aoIndex, loIndex)}
                              disabled={isPending}
                              aria-label="Add success criterion"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              className="rounded-full border border-destructive/50 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => removeLearningObjective(aoIndex, loIndex)}
                              disabled={isPending}
                              aria-label="Remove learning objective"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {sortedSuccessCriteria.map((sc) => {
                          const isEditing =
                            editingContext?.aoIndex === aoIndex &&
                            editingContext?.loIndex === loIndex &&
                            editingContext?.criterionId === sc.id
                          const levelStyles = levelStyleMap[sc.level] ?? levelStyleMap[0]
                          const isSelected = selectedCriteriaIds.has(sc.id)

                          const handleCriterionClick = (event: ReactMouseEvent<HTMLDivElement>) => {
                            const target = event.target as HTMLElement
                            if (target.closest("button, select, textarea, input, a")) {
                              return
                            }

                            if (event.metaKey || event.ctrlKey || event.shiftKey) {
                              toggleCriterionSelection(sc.id, !isSelected)
                              return
                            }

                            if (!isSelected) {
                              toggleCriterionSelection(sc.id, true)
                            }

                            if (!isEditing) {
                              startEditingCriterion(aoIndex, loIndex, sc)
                            }
                          }

                          const handleCriterionKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
                            if (event.currentTarget !== event.target) {
                              return
                            }
                            if (event.key === " ") {
                              event.preventDefault()
                              toggleCriterionSelection(sc.id, !isSelected)
                              return
                            }

                            if (event.key === "Enter") {
                              event.preventDefault()
                              if (!isSelected) {
                                toggleCriterionSelection(sc.id, true)
                              }
                              if (!isEditing) {
                                startEditingCriterion(aoIndex, loIndex, sc)
                              }
                            }
                          }

                          return (
                            <div
                              key={sc.id}
                              role="button"
                              tabIndex={0}
                              aria-pressed={isSelected}
                              onClick={handleCriterionClick}
                              onKeyDown={handleCriterionKeyDown}
                              className={`group flex flex-col gap-3 rounded-lg border border-border bg-muted/80 p-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer ${
                                isSelected ? "border-primary/60 bg-primary/10" : "hover:border-primary/30 hover:bg-card/40"
                              }`}
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                                <div className="flex-1 text-sm text-foreground">
                                  {isEditing ? (
                                    <textarea
                                      ref={editingTextareaRef}
                                      value={editingTitle}
                                      onChange={(event) => setEditingTitle(event.target.value)}
                                      className="min-h-[60px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                  ) : (
                                    <p className="text-sm text-foreground">{sc.description}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <select
                                    className={`rounded-md border border-border px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40 ${levelStyles.badge}`}
                                    value={sc.level}
                                    aria-label="Change success criterion level"
                                    onChange={(event) =>
                                      handleLevelChange(aoIndex, loIndex, sc.id, Number(event.target.value))
                                    }
                                  >
                                    {levels.map((level) => (
                                      <option key={level} value={level}>{`Level ${level}`}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-center gap-1 text-muted-foreground sm:pl-2">
                                  {isEditing ? (
                                    <>
                                      <button
                                        className="rounded border border-emerald-400 p-1 text-emerald-600 transition hover:bg-emerald-50"
                                        onClick={saveCriterionDescription}
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        className="rounded border border-destructive/40 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                                        onClick={cancelEditingCriterion}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  ) : null}
                                  {scUsageMap.get(sc.id) ? (
                                    <button
                                      className="rounded border border-blue-500/50 p-1 text-blue-600 transition hover:bg-blue-50"
                                      onClick={() => handleDeleteCriterion(aoIndex, loIndex, sc.id)}
                                      aria-label="Unassign success criterion from activities"
                                      title="This SC is assigned to activities. Click to unassign."
                                    >
                                      <Link2 className="h-3.5 w-3.5" />
                                    </button>
                                  ) : (
                                    <button
                                      className="rounded border border-destructive/50 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                                      onClick={() => handleDeleteCriterion(aoIndex, loIndex, sc.id)}
                                      aria-label="Delete success criterion"
                                      title="Delete this success criterion"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    )
                  })

                  return (
                    <article key={ao.id} className="rounded-2xl border border-border bg-muted/60 p-4 shadow-inner">
                      <header className="mb-3 flex items-start justify-between">
                        <div className="flex-1">
                          {editingAssessmentObjective && editingAssessmentObjective.aoIndex === aoIndex ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                                {ao.code}
                              </span>
                              <input
                                value={editingAssessmentObjectiveTitle}
                                onChange={(event) => setEditingAssessmentObjectiveTitle(event.target.value)}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                              />
                              <button
                                className="rounded border border-emerald-400 p-1 text-emerald-600 transition hover:bg-emerald-50"
                                onClick={saveAssessmentObjectiveEdit}
                                aria-label="Save assessment objective"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                className="rounded border border-destructive/40 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                                onClick={cancelAssessmentObjectiveEdit}
                                aria-label="Cancel assessment objective edit"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                                {ao.code}
                              </span>
                              <h3 className="text-lg font-semibold text-foreground">{ao.title}</h3>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            className="rounded-full border border-border p-1 transition hover:bg-card"
                            onClick={() => startAssessmentObjectiveEdit(aoIndex, ao.title)}
                            aria-label="Edit assessment objective"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-full border border-border p-1 transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => addLearningObjective(aoIndex)}
                            disabled={isPending}
                            aria-label="Add learning objective"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-full border border-border p-1 transition hover:bg-card"
                            onClick={() => {
                              setPasteContent("")
                              setPastePreview(null)
                              setPasteDialog({ open: true, aoIndex })
                            }}
                            aria-label="Paste learning objectives from markdown"
                          >
                            <ClipboardPaste className="h-4 w-4" />
                          </button>
                        </div>
                      </header>

                      <div className="space-y-3">{lessonObjectiveCards}</div>
                    </article>
                  )
                })}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="mapper" className="mt-0">
            <section className="flex h-[70vh] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Curriculum Mapper</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Click a lesson cell to toggle its link to a learning objective or success criterion.
                  </p>
                </div>
                {subjectUnitOptions.length > 0 ? (
                  <div className="flex items-end gap-2">
                    <label
                      htmlFor="mapper-unit-select"
                      className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Unit
                    </label>
                    <select
                      id="mapper-unit-select"
                      value={mapperUnitId}
                      onChange={(event) => setMapperUnitId(event.target.value)}
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {subjectUnitOptions.map((unit) => (
                        <option key={unit.unit_id} value={unit.unit_id}>
                          {unit.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              {lessonsError ? (
                <div className="border-b border-destructive/40 bg-destructive/10 px-5 py-3 text-xs text-destructive">
                  Unable to load lesson metadata: {lessonsError}
                </div>
              ) : null}
              <div className="flex-1 overflow-hidden">
                {subjectUnitOptions.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                    Add units for this subject to start mapping learning objectives.
                  </div>
                ) : !selectedMapperUnit ? (
                  <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                    Select a unit to start mapping lessons.
                  </div>
                ) : mapperLessons.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                    No lessons available for this unit yet.
                  </div>
                ) : !hasAnyLearningObjectives ? (
                  <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                    Add learning objectives to begin mapping lessons.
                  </div>
                ) : (
                  <div className="h-full overflow-auto">
                    <table className="w-full min-w-[900px] border-collapse text-sm">
                      <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th
                            className="sticky left-0 top-0 z-30 border border-border bg-card px-3 py-2 text-left font-semibold text-foreground shadow-sm"
                            style={{ minWidth: "14rem", width: mapperStickyWidth, maxWidth: "33.3333%" }}
                          >
                            Learning Objective
                          </th>
                          {mapperLessons.map((lesson) => (
                            <th
                              key={`mapper-lesson-${lesson.lesson_id}`}
                              className="sticky top-0 z-20 border border-border bg-card px-3 py-2 text-left font-medium text-foreground shadow-sm"
                              title={lesson.title}
                            >
                              {lesson.title}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {assessmentObjectives.map((ao) => {
                          const orderedLessonObjectives = ao.lessonObjectives
                            .slice()
                            .sort((a, b) => a.orderIndex - b.orderIndex)

                          const placeholderLessonTitle =
                            orderedLessonObjectives[0]?.title ?? "No learning objectives yet."

                          if (orderedLessonObjectives.length === 0) {
                            return (
                              <tr key={`mapper-ao-${ao.id}-empty`}>
                                <td
                                  className="sticky left-0 z-20 border border-border bg-card px-3 py-3 align-top shadow-sm"
                                  style={{ minWidth: "14rem", width: mapperStickyWidth, maxWidth: "33.3333%" }}
                                >
                                  <p className="text-sm font-semibold text-foreground">{placeholderLessonTitle}</p>
                                </td>
                                <td
                                  className="border border-border px-3 py-3 text-xs text-muted-foreground"
                                  colSpan={Math.max(mapperLessons.length, 1)}
                                >
                                  Add learning objectives to map lessons for this assessment objective.
                                </td>
                              </tr>
  )
}

                          return orderedLessonObjectives.flatMap((lo) => {
                            const rowKey = `mapper-lo-${lo.id}`

                            const rows: JSX.Element[] = []

                            rows.push(
                              <tr key={rowKey} className="odd:bg-muted/30">
                                <td
                                  className="sticky left-0 z-20 border border-border bg-card px-3 py-3 align-top shadow-sm"
                                  style={{ minWidth: "14rem", width: mapperStickyWidth, maxWidth: "33.3333%" }}
                                >
                                  <p className="text-sm font-medium text-foreground">{lo.title}</p>
                                </td>
                                {mapperLessons.map((lesson) => {
                                  const linkedCount =
                                    lesson.lesson_success_criteria?.filter(
                                      (entry) => (entry.learning_objective_id ?? "") === lo.id,
                                    ).length ?? 0

                                  return (
                                    <td
                                      key={`${rowKey}-${lesson.lesson_id}`}
                                      className="border border-border px-3 py-3 text-xs text-muted-foreground align-middle"
                                    >
                                      {linkedCount > 0 ? (
                                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900">
                                          {linkedCount} linked
                                        </span>
                                      ) : (
                                        <span className="text-[11px] font-medium text-muted-foreground/60">No links</span>
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>,
                            )

                            const sortedCriteria = lo.successCriteria
                              .filter((criterion) => criterion.active !== false)
                              .slice()
                              .sort((a, b) => a.orderIndex - b.orderIndex)

                            sortedCriteria.forEach((criterion) => {
                              const criterionRowKey = `${rowKey}-criterion-${criterion.id}`
                              const levelBadge =
                                typeof criterion.level === "number"
                                  ? `Level ${criterion.level}`
                                  : "Success criterion"

                              rows.push(
                                <tr key={criterionRowKey} className="bg-muted/10">
                                  <td
                                    className="sticky left-0 z-10 border border-border bg-card px-3 py-3 align-top"
                                    style={{ minWidth: "14rem", width: mapperStickyWidth, maxWidth: "33.3333%" }}
                                  >
                                    <div className="pl-6">
                                      <div className="flex items-start gap-2">
                                        <span className="mt-0.5 inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                                          {levelBadge}
                                        </span>
                                        <p className="text-sm text-muted-foreground">{criterion.description}</p>
                                      </div>
                                    </div>
                                  </td>
                                {mapperLessons.map((lesson) => {
                                  const lessonCriteriaSet = new Set(
                                    (lesson.lesson_success_criteria ?? []).map(
                                      (entry) => entry.success_criteria_id,
                                    ),
                                  )
                                  const hasCriterion = lessonCriteriaSet.has(criterion.id)
                                  const criterionPendingKey = `${lesson.lesson_id}-${criterion.id}`
                                  const isPendingCriterion = pendingLessonSuccessCriteria.has(criterionPendingKey)

                                  const handleCriterionToggle = () =>
                                    toggleLessonSuccessCriterion(
                                      lesson.lesson_id,
                                      lesson.title,
                                      lo.id,
                                      criterion,
                                    )

                                  const baseClasses = "border border-border p-0 align-middle transition-colors"
                                  const interactiveClasses = hasCriterion
                                    ? "bg-sky-100 text-sky-900 cursor-pointer"
                                    : "text-muted-foreground hover:bg-sky-50 cursor-pointer"
                                  const pendingClasses = isPendingCriterion ? "bg-sky-50 text-sky-700 cursor-wait" : ""

                                  return (
                                    <td
                                      key={`${criterionRowKey}-${lesson.lesson_id}`}
                                      role="button"
                                      tabIndex={0}
                                      onClick={handleCriterionToggle}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault()
                                          handleCriterionToggle()
                                        }
                                      }}
                                      aria-pressed={hasCriterion}
                                      aria-label={`${hasCriterion ? "Remove" : "Link"} success criterion to ${lesson.title}`}
                                      className={`${baseClasses} ${interactiveClasses} ${pendingClasses}`}
                                    >
                                      <div className="flex h-full w-full items-center justify-center px-2 py-3 text-xs font-medium">
                                        {isPendingCriterion ? (
                                          <>
                                            <Loader2 className="h-4 w-4 animate-spin text-sky-700" />
                                            <span className="sr-only">Updating success criterion…</span>
                                          </>
                                        ) : hasCriterion ? (
                                          <>
                                            <Check className="h-3.5 w-3.5 text-sky-700" />
                                            <span className="sr-only">Remove success criterion from {lesson.title}</span>
                                          </>
                                        ) : (
                                          <span className="text-xs font-medium text-muted-foreground/70">Add</span>
                                        )}
                                      </div>
                                    </td>
                                  )
                                })}
                                </tr>,
                              )
                            })

                            return rows
                          })
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </TabsContent>
          <TabsContent value="levels" className="mt-0">
            <section className="flex h-[70vh] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-lg font-semibold">Levels Visualization</h2>
                <button
                  type="button"
                  onClick={handleLevelsExport}
                  disabled={isExportingLevels}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExportingLevels ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span>{isExportingLevels ? "Exporting..." : "Export DOCX"}</span>
                </button>
              </div>
              <div className="border-b px-5 pb-4">
                <Input
                  value={visualFilter}
                  onChange={(event) => setVisualFilter(event.target.value)}
                  placeholder="Filter visualization (e.g. 'yr 9 l 2 research')"
                  className="max-w-sm"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-4">
                  {levelsView.map(({ level, criteria }) => {
                    if (levelFilterSet.size > 0 && !levelFilterSet.has(level)) {
                      return null
                    }

                    const filteredCriteria = criteria.filter((item) => {
                      const matchesText =
                        textFilter.length === 0 ||
                        item.description.toLowerCase().includes(textFilter) ||
                        item.loTitle.toLowerCase().includes(textFilter) ||
                        item.aoTitle.toLowerCase().includes(textFilter)

                      return matchesText
                    })

                    if (filteredCriteria.length === 0) {
                      return null
                    }

                    return (
                      <div key={level} className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                        <header className="flex items-center justify-between">
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                            {`Level ${level}`}
                          </span>
                          <span className="text-xs text-muted-foreground">{filteredCriteria.length} criteria</span>
                        </header>

                        <div className="space-y-3">
                          {Object.values(
                            filteredCriteria.reduce<Record<string, { aoCode: string; aoTitle: string; items: typeof filteredCriteria }>>(
                              (acc, item) => {
                                const key = `${item.aoCode}-${item.aoTitle}`
                                if (!acc[key]) {
                                  acc[key] = { aoCode: item.aoCode, aoTitle: item.aoTitle, items: [] }
                                }
                                acc[key].items.push(item)
                                return acc
                              },
                              {},
                            ),
                          ).map((group) => (
                            <div key={`${level}-${group.aoCode}`} className="rounded-lg border border-border bg-card p-3">
                              <p className="text-sm font-semibold text-muted-foreground">
                                {group.aoCode}: {group.aoTitle}
                              </p>
                              <ul className="mt-2 space-y-1 pl-5 text-sm text-foreground">
                                {group.items.map((item) => (
                                  <li key={item.id} className="list-disc">
                                    {item.description}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  {levelsView.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No success criteria to display yet.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="units" className="mt-0">
            <section className="flex h-[70vh] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-lg font-semibold">Units Visualization</h2>
                <button
                  type="button"
                  onClick={handleUnitsExport}
                  disabled={isExportingUnits}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExportingUnits ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span>{isExportingUnits ? "Exporting..." : "Export DOCX"}</span>
                </button>
              </div>
              <div className="border-b px-5 pb-4">
                <Input
                  value={visualFilter}
                  onChange={(event) => setVisualFilter(event.target.value)}
                  placeholder="Filter visualization (e.g. 'yr 9 l 2 research')"
                  className="max-w-sm"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-4">
                  {unitsView.map((unit) => {
                    const matchesYear =
                      yearFilterSet.size === 0 ||
                      (unit.year !== undefined && yearFilterSet.has(unit.year))

                    if (!matchesYear) return null

                    const filteredEntries = unit.entries.filter((entry) => {
                      const matchesLevel =
                        levelFilterSet.size === 0 || levelFilterSet.has(entry.level)

                      const matchesText =
                        textFilter.length === 0 ||
                        entry.description.toLowerCase().includes(textFilter) ||
                        entry.loTitle.toLowerCase().includes(textFilter) ||
                        entry.aoTitle.toLowerCase().includes(textFilter) ||
                        unit.unitName.toLowerCase().includes(textFilter) ||
                        (unit.subject?.toLowerCase().includes(textFilter) ?? false)

                      return matchesLevel && matchesText
                    })

                    if (filteredEntries.length === 0) return null

                    const sortedEntries = filteredEntries
                      .slice()
                      .sort(
                        (a, b) =>
                          a.aoCode.localeCompare(b.aoCode) ||
                          a.level - b.level ||
                          a.loTitle.localeCompare(b.loTitle) ||
                          a.description.localeCompare(b.description),
                      )

                    const grouped = new Map<
                      string,
                      {
                        aoCode: string
                        aoTitle: string
                        levels: Map<
                          number,
                          {
                            loTitle: string
                            criteria: typeof sortedEntries
                          }[]
                        >
                      }
                    >()

                    sortedEntries.forEach((entry) => {
                      const aoKey = `${entry.aoCode}__${entry.aoTitle}`
                      if (!grouped.has(aoKey)) {
                        grouped.set(aoKey, {
                          aoCode: entry.aoCode,
                          aoTitle: entry.aoTitle,
                          levels: new Map(),
                        })
                      }
                      const aoEntry = grouped.get(aoKey)!
                      const levelEntry = aoEntry.levels.get(entry.level) ?? []
                      let loEntry = levelEntry.find((item) => item.loTitle === entry.loTitle)
                      if (!loEntry) {
                        loEntry = { loTitle: entry.loTitle, criteria: [] }
                        levelEntry.push(loEntry)
                      }
                      loEntry.criteria.push(entry)
                      aoEntry.levels.set(entry.level, levelEntry)
                    })

                    const badgeClass = unit.year
                      ? yearBadgeMap[unit.year] ?? "bg-primary/10 text-primary"
                      : "bg-primary/10 text-primary"
                    const badgeLabel = unit.year ? `Y${unit.year}` : unit.subject ?? "Unit"

                    return (
                      <div key={unit.unitId} className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                        <header className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold ${badgeClass}`}>
                              {badgeLabel}
                            </span>
                            <h3 className="text-sm font-semibold text-foreground">{unit.unitName}</h3>
                          </div>
                          <span className="text-xs text-muted-foreground">{filteredEntries.length} criteria</span>
                        </header>

                        <div className="space-y-4">
                          {Array.from(grouped.values()).map((aoEntry) => (
                            <div key={`${unit.unitId}-${aoEntry.aoCode}`} className="space-y-2">
                              <header className="font-semibold text-sm text-foreground">
                                {aoEntry.aoCode} · {aoEntry.aoTitle}
                              </header>
                              <div className="overflow-auto rounded-lg border border-border">
                                <table className="min-w-full border-collapse text-sm">
                                  <thead className="bg-muted text-xs font-semibold">
                                    <tr>
                                      <th className="border border-border px-3 py-2 text-left">Level</th>
                                      <th className="border border-border px-3 py-2 text-left">Learning Objective</th>
                                      <th className="border border-border px-3 py-2 text-left">Success Criterion</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Array.from(aoEntry.levels.entries())
                                      .sort((a, b) => a[0] - b[0])
                                      .flatMap(([level, loEntries]) => {
                                        let levelRendered = false
                                        return loEntries.flatMap((loEntry) =>
                                          loEntry.criteria.map((criterion, index) => {
                                            const renderLevel = !levelRendered
                                            const renderLo = index === 0
                                            if (renderLevel) {
                                              levelRendered = true
                                            }
                                            return (
                                              <tr key={`${aoEntry.aoCode}-${level}-${loEntry.loTitle}-${criterion.description}-${index}`}>
                                                {renderLevel ? (
                                                  <td className="border border-border px-3 py-2 align-top" rowSpan={loEntries.reduce((acc, item) => acc + item.criteria.length, 0)}>
                                                    <span className="font-semibold text-foreground">Level {level}</span>
                                                  </td>
                                                ) : null}
                                                {renderLo ? (
                                                  <td className="border border-border px-3 py-2 align-top" rowSpan={loEntry.criteria.length}>
                                                    {loEntry.loTitle}
                                                  </td>
                                                ) : null}
                                                <td className="border border-border px-3 py-2 align-top">{criterion.description}</td>
                                              </tr>
                                            )
                                          }),
                                        )
                                      })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  {unitsView.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No units associated with success criteria yet.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/curriculum" className="underline-offset-4 hover:underline">
            Back to all curricula
          </Link>
          <span>•</span>
          <Link href="/units" className="underline-offset-4 hover:underline">
            Browse units
          </Link>
        </div>
      </div>

      {unitPickerContext && activeCriterion ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setUnitPickerContext(null)} />
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Associate Units</p>
                <p className="text-xs text-muted-foreground">{activeCriterion.description}</p>
              </div>
              <button
                className="rounded border border-border p-1 text-muted-foreground transition hover:bg-muted"
                onClick={() => setUnitPickerContext(null)}
                aria-label="Close unit selector"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex h-full flex-col overflow-hidden">
              <div className="border-b border-border px-5 py-4">
                <Input
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
                  placeholder="Filter units (e.g. 'yr 9 textile')"
                  className="w-full"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Supports free text, `yr 9` and subject keywords.
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-3">
                  {subjectUnitOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {curriculum.subject
                        ? `No units available for ${curriculum.subject}.`
                        : "No units available."}
                    </p>
                  ) : null}
                  {subjectUnitOptions
                    .filter((unit) => {
                      if (!normalizedUnitFilter) return true
                      const tokens = normalizedUnitFilter.split(/\s+/).filter(Boolean)
                      return tokens.every((token) => {
                        if (token.startsWith("yr")) {
                          const year = Number.parseInt(token.replace(/[^0-9]/g, ""), 10)
                          if (!Number.isFinite(year)) return false
                          return unit.year === year
                        }

                        const lower = token.toLowerCase()
                        return (
                          unit.title.toLowerCase().includes(lower) ||
                          (unit.subject ?? "").toLowerCase().includes(lower) ||
                          unit.unit_id.toLowerCase().includes(lower)
                        )
                      })
                    })
                    .map((unit) => {
                      const checked = activeCriterion.units.includes(unit.unit_id)
                      const badgeClass = unit.year
                        ? yearBadgeMap[unit.year] ?? "bg-primary/10 text-primary"
                        : "bg-primary/10 text-primary"
                      const badgeLabel = unit.year ? `Y${unit.year}` : unit.subject ?? "Unit"
                      return (
                        <label
                          key={unit.unit_id}
                          className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm transition hover:border-primary"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              checked={checked}
                              onChange={() =>
                                toggleUnitForCriterion(
                                  unitPickerContext.aoIndex,
                                  unitPickerContext.loIndex,
                                  unitPickerContext.criterionId,
                                  unit.unit_id,
                                )
                              }
                            />
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">{unit.title}</span>
                              <span className="text-xs text-muted-foreground">{unit.unit_id}</span>
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                            {badgeLabel}
                          </span>
                        </label>
                      )
                    })}
                </div>
              </div>
            </div>
          </aside>
        </>
      ) : null}

      <AlertDialog open={unassignDialog.open} onOpenChange={(open) => !open && setUnassignDialog({ open: false, successCriteriaId: null, affectedLessons: [] })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign Success Criterion from Activities</AlertDialogTitle>
            <AlertDialogDescription>
              This success criterion is currently assigned to activities in the following {unassignDialog.affectedLessons.length} {unassignDialog.affectedLessons.length === 1 ? "lesson" : "lessons"}:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
            <ul className="space-y-2">
              {unassignDialog.affectedLessons.map((lesson) => (
                <li key={lesson.lesson_id} className="text-sm">
                  <div className="font-medium text-foreground">{lesson.lesson_title}</div>
                  {lesson.unit_title && (
                    <div className="text-xs text-muted-foreground">Unit: {lesson.unit_title}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <AlertDialogDescription className="mt-2 text-xs text-muted-foreground">
            Unassigning will remove this success criterion from all activities, but the activities themselves, student submissions, and feedback will remain unchanged. Activity scores will be recalculated without this criterion.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnassignCriterion} className="bg-blue-600 hover:bg-blue-700">
              Proceed with Unassign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={pasteDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setPasteDialog({ open: false, aoIndex: null })
            setPasteContent("")
            setPastePreview(null)
          }
        }}
      >
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Paste Learning Objectives</DialogTitle>
            <DialogDescription>
              {pasteDialog.aoIndex !== null && assessmentObjectives[pasteDialog.aoIndex]
                ? `Add LOs to ${assessmentObjectives[pasteDialog.aoIndex].code}: ${assessmentObjectives[pasteDialog.aoIndex].title}`
                : "Paste markdown-formatted learning objectives and success criteria."}
            </DialogDescription>
          </DialogHeader>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
            onClick={() => {
              const prompt = [
                "Context: You are an expert Design and Technology teacher specializing in the Edexcel GCSE (9-1) specification.",
                "",
                "Task: Generate a structured list of Learning Objectives (LOs) and Success Criteria (SC) for a lesson on: [INSERT CHAPTER OR TOPIC NAME HERE].",
                "",
                "Instructions:",
                "",
                'LO Format: Start each LO with "TBAT" (To Be Able To). Include the exact Edexcel Specification reference code in parentheses.',
                "",
                'SC Format: Group 3-4 Success Criteria under each LO. Start each with "I can...".',
                "",
                "Differentiation: Each SC must end with a difficulty level tag from [L2] to [L8], mapped to GCSE grading.",
                "",
                "[L2-3] Identify / Name",
                "[L4-5] Describe / Explain",
                "[L6-8] Analyze / Compare / Evaluate",
                "",
                "Output Format: Provide the response in raw, unformatted markdown inside a code block (using ```) to preserve the syntax exactly as follows:",
                "",
                "## LO: TBAT <Learning Objective title> (Ref: <spec reference>)",
                "- I can <Success criterion description> [L<level>]",
                "- I can <Success criterion description> [L<level>]",
              ].join("\n")
              const el = document.createElement("textarea")
              el.value = prompt
              el.setAttribute("readonly", "")
              el.style.position = "fixed"
              el.style.left = "-9999px"
              el.style.opacity = "0"
              document.body.appendChild(el)
              el.focus()
              el.select()
              document.execCommand("copy")
              document.body.removeChild(el)
              setPromptCopied(true)
              setTimeout(() => setPromptCopied(false), 2000)
            }}
          >
            {promptCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            Copy Prompt
          </button>

          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
            <div className="flex min-h-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Markdown</span>
              <Textarea
                ref={pasteTextareaRef}
                className="min-h-0 flex-1 resize-none overflow-y-auto font-mono text-sm"
                placeholder={`## LO: Understand variables (Ref: 3.1.1)\n- Define what a variable is [L3]\n- Distinguish between types [L4]\n\n## LO: Use conditionals (Ref: 3.1.2)\n- Write if/else statements [L3]`}
                value={pasteContent}
                onChange={(e) => {
                  const value = e.target.value
                  setPasteContent(value)
                  if (value.trim()) {
                    setPastePreview(parseLoScMarkdown(value))
                  } else {
                    setPastePreview(null)
                  }
                }}
              />
            </div>
            <div className="flex min-h-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Preview</span>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-sm">
                {pastePreview ? (
                  pastePreview.success ? (
                    <ul className="space-y-2">
                      {pastePreview.learningObjectives.map((lo, loIdx) => (
                        <li key={loIdx}>
                          <div className="font-medium text-foreground">
                            {lo.title}
                            {lo.specRef && <span className="ml-2 text-xs text-muted-foreground">({lo.specRef})</span>}
                          </div>
                          <ul className="ml-4 mt-1 space-y-0.5">
                            {lo.successCriteria.map((sc, scIdx) => (
                              <li key={scIdx} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{sc.description}</span>
                                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${levelStyleMap[sc.level]?.badge ?? "bg-gray-100 text-gray-600"}`}>
                                  L{sc.level}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-destructive">{pastePreview.error}</p>
                  )
                ) : (
                  <p className="text-muted-foreground/50">Parsed LOs and SCs will appear here.</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <button
              className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted"
              onClick={() => {
                setPasteDialog({ open: false, aoIndex: null })
                setPasteContent("")
                setPastePreview(null)
              }}
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!pastePreview?.success || isPasting}
              onClick={async () => {
                if (!pastePreview?.success || pasteDialog.aoIndex === null) return
                const ao = assessmentObjectives[pasteDialog.aoIndex]
                if (!ao) return

                setIsPasting(true)
                try {
                  const result = await batchCreateLosAndScsAction(
                    ao.id,
                    curriculumId,
                    pastePreview.learningObjectives,
                  )
                  if (result.success && result.data) {
                    showToast("success", `Added ${result.data.loCount} LO${result.data.loCount !== 1 ? "s" : ""} and ${result.data.scCount} SC${result.data.scCount !== 1 ? "s" : ""}.`)
                    setPasteDialog({ open: false, aoIndex: null })
                    setPasteContent("")
                    setPastePreview(null)
                    await refreshCurriculum({ aoId: ao.id })
                  } else {
                    showToast("error", result.error ?? "Failed to add learning objectives.")
                  }
                } catch {
                  showToast("error", "An unexpected error occurred.")
                } finally {
                  setIsPasting(false)
                }
              }}
            >
              {isPasting && <Loader2 className="h-4 w-4 animate-spin" />}
              {pastePreview?.success
                ? `Add ${pastePreview.learningObjectives.length} Learning Objective${pastePreview.learningObjectives.length !== 1 ? "s" : ""}`
                : "Add Learning Objectives"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
