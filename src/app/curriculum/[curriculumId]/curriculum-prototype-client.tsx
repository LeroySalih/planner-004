"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import Link from "next/link"
import { Check, Pencil, Plus, Trash2, X, Boxes } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import type { CurriculumDetail, Units } from "@/types"
import {
  createCurriculumAssessmentObjectiveAction,
  createCurriculumLearningObjectiveAction,
  createCurriculumSuccessCriterionAction,
  updateCurriculumAssessmentObjectiveAction,
  updateCurriculumLearningObjectiveAction,
  updateCurriculumSuccessCriterionAction,
  deleteCurriculumSuccessCriterionAction,
  readCurriculumDetailAction,
} from "@/lib/server-updates"

interface CurriculumPrototypeClientProps {
  curriculum: CurriculumDetail
  units: Units
  unitsError?: string | null
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

const levels = [1, 2, 3, 4, 5, 6, 7]

const levelStyleMap: Record<number, { badge: string; text: string }> = {
  1: { badge: "bg-emerald-100 text-emerald-900", text: "text-emerald-900" },
  2: { badge: "bg-emerald-200 text-emerald-900", text: "text-emerald-900" },
  3: { badge: "bg-emerald-300 text-emerald-900", text: "text-emerald-900" },
  4: { badge: "bg-emerald-400 text-emerald-900", text: "text-emerald-900" },
  5: { badge: "bg-emerald-500 text-emerald-50", text: "text-emerald-50" },
  6: { badge: "bg-emerald-600 text-emerald-50", text: "text-emerald-50" },
  7: { badge: "bg-emerald-700 text-emerald-50", text: "text-emerald-50" },
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

      return {
        id: ao.assessment_objective_id,
        code: ao.code,
        title: ao.title,
        orderIndex: ao.order_index ?? aoIndex,
        unitId: ao.unit_id ?? null,
        lessonObjectives: learningObjectives
          .slice()
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
          .map((lo, loIndex) => ({
            id: lo.learning_objective_id,
            title: lo.title,
            orderIndex: lo.order_index ?? loIndex,
            successCriteria: (lo.success_criteria ?? [])
              .slice()
              .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
              .map((criterion, criterionIndex) => ({
                id: criterion.success_criteria_id,
                level: criterion.level ?? 1,
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
  unitsError,
}: CurriculumPrototypeClientProps) {
  const curriculumId = curriculum.curriculum_id
  const curriculumName = curriculum.title

  const [assessmentObjectives, setAssessmentObjectives] = useState<AssessmentObjective[]>(() =>
    mapCurriculumToAssessmentObjectives(curriculum),
  )
  const [visualFilter, setVisualFilter] = useState("")
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [unitFilter, setUnitFilter] = useState("")
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<Set<string>>(() => new Set<string>())
  const [bulkUnitId, setBulkUnitId] = useState("")

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
  const [unitPickerContext, setUnitPickerContext] = useState<
    | {
        aoIndex: number
        loIndex: number
        criterionId: string
      }
    | null
  >(null)

  useEffect(() => {
    setAssessmentObjectives(mapCurriculumToAssessmentObjectives(curriculum))
    setSelectedCriteriaIds(new Set<string>())
  }, [curriculum])

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
      setBulkUnitId("")
      return
    }

    setBulkUnitId((prev) => {
      if (prev && subjectUnitOptions.some((unit) => unit.unit_id === prev)) {
        return prev
      }
      return subjectUnitOptions[0]?.unit_id ?? ""
    })
  }, [subjectUnitOptions])

  const levelsView = useMemo(() => {
    return levels
      .map((level) => {
        const criteria = assessmentObjectives
          .flatMap((ao) =>
            ao.lessonObjectives.flatMap((lo) =>
              lo.successCriteria
                .filter((sc) => sc.level === level)
                .map((sc) => ({
                  ...sc,
                  aoCode: ao.code,
                  aoTitle: ao.title,
                  loTitle: lo.title,
                })),
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
              description: sc.description,
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
      return
    }

    setEditingAssessmentObjective({ aoIndex })
    setEditingAssessmentObjectiveTitle(mapped[aoIndex].title)
  }

  const refreshCurriculum = async (focus?: { aoId?: string; loId?: string; scId?: string }) => {
    const result = await readCurriculumDetailAction(curriculumId)
    if (result.error) {
      setFeedback({ type: "error", message: result.error })
      return
    }

    if (result.data) {
      resetEditingStates()
      syncFromDetail(result.data, focus)
    }
  }

  const addAssessmentObjective = () => {
    const newAoIndex = assessmentObjectives.length
    const aoNumber = newAoIndex + 1
    const newAoCode = `AO${aoNumber}`
    const defaultLessonTitle = "New learning objective"
    const defaultCriterionDescription = "New success criterion"

    startTransition(async () => {
      setFeedback(null)
      const aoResult = await createCurriculumAssessmentObjectiveAction(curriculumId, {
        code: newAoCode,
        title: "New assessment objective",
        order_index: newAoIndex,
      })

      if (aoResult.error || !aoResult.data) {
        setFeedback({ type: "error", message: aoResult.error ?? "Failed to create assessment objective." })
        return
      }

      const aoId = aoResult.data.assessment_objective_id

      const loResult = await createCurriculumLearningObjectiveAction(
        aoId,
        { title: defaultLessonTitle, order_index: 0 },
        curriculumId,
      )

      if (loResult.error || !loResult.data) {
        setFeedback({ type: "error", message: loResult.error ?? "Failed to create learning objective." })
        await refreshCurriculum()
        return
      }

      const loId = loResult.data.learning_objective_id

      const scResult = await createCurriculumSuccessCriterionAction(loId, curriculumId, {
        description: defaultCriterionDescription,
        level: 1,
        order_index: 0,
        unit_ids: [],
      })

      if (scResult.error || !scResult.data) {
        setFeedback({ type: "error", message: scResult.error ?? "Failed to create success criterion." })
        await refreshCurriculum({ aoId, loId })
        return
      }

      await refreshCurriculum({ aoId, loId, scId: scResult.data.success_criteria_id })
      setFeedback({ type: "success", message: "Assessment objective added." })
    })
  }

  const addLearningObjective = (aoIndex: number) => {
    const targetAo = assessmentObjectives[aoIndex]
    if (!targetAo) return

    const newSequence = targetAo.lessonObjectives.length

    startTransition(async () => {
      setFeedback(null)
      const loResult = await createCurriculumLearningObjectiveAction(
        targetAo.id,
        { title: "New learning objective", order_index: newSequence },
        curriculumId,
      )

      if (loResult.error || !loResult.data) {
        setFeedback({ type: "error", message: loResult.error ?? "Failed to create learning objective." })
        await refreshCurriculum({ aoId: targetAo.id })
        return
      }

      const loId = loResult.data.learning_objective_id

      const scResult = await createCurriculumSuccessCriterionAction(loId, curriculumId, {
        description: "New success criterion",
        level: 1,
        order_index: 0,
        unit_ids: [],
      })

      if (scResult.error || !scResult.data) {
        setFeedback({ type: "error", message: scResult.error ?? "Failed to create success criterion." })
        await refreshCurriculum({ aoId: targetAo.id, loId })
        return
      }

      await refreshCurriculum({ aoId: targetAo.id, loId, scId: scResult.data.success_criteria_id })
      setFeedback({ type: "success", message: "Learning objective added." })
    })
  }

  const addSuccessCriterion = (aoIndex: number, loIndex: number) => {
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    if (!targetAo || !targetLo) return

    startTransition(async () => {
      setFeedback(null)
      const scResult = await createCurriculumSuccessCriterionAction(targetLo.id, curriculumId, {
        description: "New success criterion",
        level: 1,
        order_index: targetLo.successCriteria.length,
        unit_ids: [],
      })

      if (scResult.error || !scResult.data) {
        setFeedback({ type: "error", message: scResult.error ?? "Failed to create success criterion." })
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id })
        return
      }

      await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: scResult.data.success_criteria_id })
      setFeedback({ type: "success", message: "Success criterion added." })
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
      setFeedback({ type: "error", message: "Unable to locate success criterion." })
      return
    }

    if (newDescription.length === 0) {
      setFeedback({ type: "error", message: "Description cannot be empty." })
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
      setFeedback(null)
      const result = await updateCurriculumSuccessCriterionAction(criterionId, curriculumId, {
        description: newDescription,
      })

      if (result.error) {
        setFeedback({ type: "error", message: result.error })
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: criterionId })
        return
      }

      setFeedback({ type: "success", message: "Success criterion updated." })
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
      setFeedback(null)
      const result = await updateCurriculumSuccessCriterionAction(criterionId, curriculumId, {
        level: newLevel,
      })

      if (result.error) {
        setFeedback({ type: "error", message: result.error })
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: criterionId })
        return
      }

      setFeedback({ type: "success", message: "Success criterion updated." })
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

  const handleDeleteCriterion = (aoIndex: number, loIndex: number, criterionId: string) => {
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
      setFeedback(null)
      const result = await deleteCurriculumSuccessCriterionAction(criterionId, curriculumId)

      if (!result.success) {
        setFeedback({ type: "error", message: result.error ?? "Failed to delete success criterion." })
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id })
        return
      }

      setFeedback({ type: "success", message: "Success criterion removed." })
    })
  }

  const toggleUnitPickerPopover = (
    event: ReactMouseEvent<HTMLButtonElement>,
    aoIndex: number,
    loIndex: number,
    criterionId: string,
  ) => {
    event.stopPropagation()
    setUnitPickerContext((prev) => {
      if (prev && prev.aoIndex === aoIndex && prev.loIndex === loIndex && prev.criterionId === criterionId) {
        return null
      }
      setUnitFilter("")
      return { aoIndex, loIndex, criterionId }
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
      setFeedback(null)
      const result = await updateCurriculumSuccessCriterionAction(criterionId, curriculumId, {
        unit_ids: nextUnits,
      })

      if (result.error) {
        setFeedback({ type: "error", message: result.error })
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id, scId: criterionId })
        return
      }

      setFeedback({ type: "success", message: "Success criterion updated." })
    })
  }

  const handleBulkAssignUnit = () => {
    const unitId = bulkUnitId
    const targetIds = Array.from(selectedCriteriaIds)

    if (!unitId) {
      setFeedback({ type: "error", message: "Select a unit to assign before continuing." })
      return
    }

    if (targetIds.length === 0) {
      setFeedback({ type: "error", message: "Select at least one success criterion to update." })
      return
    }

    const targetSet = new Set(targetIds)
    const updates: {
      aoId: string
      loId: string
      criterionId: string
      nextUnits: string[]
    }[] = []

    const nextAssessmentObjectives = assessmentObjectives.map((ao) => {
      let aoChanged = false
      const nextLessonObjectives = ao.lessonObjectives.map((lo) => {
        let loChanged = false
        const nextSuccessCriteria = lo.successCriteria.map((sc) => {
          if (!targetSet.has(sc.id) || sc.units.includes(unitId)) {
            return sc
          }

          const nextUnits = [...sc.units, unitId]
          updates.push({ aoId: ao.id, loId: lo.id, criterionId: sc.id, nextUnits })
          loChanged = true
          aoChanged = true
          return { ...sc, units: nextUnits }
        })

        return loChanged ? { ...lo, successCriteria: nextSuccessCriteria } : lo
      })

      return aoChanged ? { ...ao, lessonObjectives: nextLessonObjectives } : ao
    })

    if (updates.length === 0) {
      setFeedback({
        type: "error",
        message: "Selected success criteria already include the chosen unit.",
      })
      return
    }

    setAssessmentObjectives(nextAssessmentObjectives)

    startTransition(async () => {
      setFeedback(null)
      const results = await Promise.all(
        updates.map(({ criterionId, nextUnits }) =>
          updateCurriculumSuccessCriterionAction(criterionId, curriculumId, { unit_ids: nextUnits }),
        ),
      )

      const failed = results.find((result) => result.error)

      if (failed) {
        setFeedback({ type: "error", message: failed.error ?? "Failed to update success criteria." })
        await refreshCurriculum()
        return
      }

      setFeedback({ type: "success", message: "Unit assigned to selected success criteria." })
      setSelectedCriteriaIds(new Set<string>())
    })
  }

  const startLessonObjectiveEdit = (aoIndex: number, loIndex: number, currentTitle: string) => {
    setEditingLessonObjective({ aoIndex, loIndex })
    setEditingLessonObjectiveTitle(currentTitle)
  }

  const cancelLessonObjectiveEdit = () => {
    setEditingLessonObjective(null)
    setEditingLessonObjectiveTitle("")
  }

  const saveLessonObjectiveEdit = () => {
    if (!editingLessonObjective) return

    const { aoIndex, loIndex } = editingLessonObjective
    const targetAo = assessmentObjectives[aoIndex]
    const targetLo = targetAo?.lessonObjectives[loIndex]
    const newTitle = editingLessonObjectiveTitle.trim()

    if (!targetAo || !targetLo) {
      setFeedback({ type: "error", message: "Unable to locate learning objective." })
      return
    }

    if (newTitle.length === 0) {
      setFeedback({ type: "error", message: "Title cannot be empty." })
      return
    }

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) =>
        aoIdx === aoIndex
          ? {
              ...ao,
              lessonObjectives: ao.lessonObjectives.map((lo, loIdx) =>
                loIdx === loIndex ? { ...lo, title: newTitle } : lo,
              ),
            }
          : ao,
      ),
    )

    cancelLessonObjectiveEdit()

    startTransition(async () => {
      setFeedback(null)
      const result = await updateCurriculumLearningObjectiveAction(targetLo.id, curriculumId, {
        title: newTitle,
      })

      if (result.error) {
        setFeedback({ type: "error", message: result.error })
        await refreshCurriculum({ aoId: targetAo.id, loId: targetLo.id })
        return
      }

      setFeedback({ type: "success", message: "Learning objective updated." })
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
      setFeedback({ type: "error", message: "Unable to locate assessment objective." })
      return
    }

    if (newTitle.length === 0) {
      setFeedback({ type: "error", message: "Title cannot be empty." })
      return
    }

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) => (aoIdx === aoIndex ? { ...ao, title: newTitle } : ao)),
    )

    cancelAssessmentObjectiveEdit()

    startTransition(async () => {
      setFeedback(null)
      const result = await updateCurriculumAssessmentObjectiveAction(targetAo.id, curriculumId, {
        title: newTitle,
      })

      if (result.error) {
        setFeedback({ type: "error", message: result.error })
        await refreshCurriculum({ aoId: targetAo.id })
        return
      }

      setFeedback({ type: "success", message: "Assessment objective updated." })
    })
  }

  const activeCriterion = unitPickerContext
    ? assessmentObjectives[unitPickerContext.aoIndex]?.lessonObjectives[
        unitPickerContext.loIndex
      ]?.successCriteria.find((criterion) => criterion.id === unitPickerContext.criterionId)
    : null

  const bulkAssignmentDisabled = selectedCriteriaIds.size === 0 || !bulkUnitId || subjectUnitOptions.length === 0

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <div className="space-y-8">
        <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
          <p className="text-sm uppercase tracking-wide text-white/70">Curriculum Prototype</p>
          <h1 className="text-3xl font-semibold">{curriculumName}</h1>
          <p className="mt-2 text-sm text-white/80">Prototype view for {curriculum.subject ?? "Unassigned subject"}</p>
        </header>

        {unitsError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Unable to load unit metadata: {unitsError}
          </div>
        ) : null}

        {feedback ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              feedback.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        {isPending ? <p className="text-xs text-muted-foreground">Saving changes…</p> : null}

        <div className="grid gap-6 lg:grid-cols-2">
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
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-col gap-1">
                  <label htmlFor="bulk-unit-select" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Assign unit
                  </label>
                  <select
                    id="bulk-unit-select"
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                    value={bulkUnitId}
                    onChange={(event) => setBulkUnitId(event.target.value)}
                    disabled={subjectUnitOptions.length === 0}
                  >
                    <option value="" disabled>
                      {subjectUnitOptions.length === 0
                        ? "No units available"
                        : "Select a unit"}
                    </option>
                    {subjectUnitOptions.map((unit) => (
                      <option key={unit.unit_id} value={unit.unit_id}>
                        {unit.title}
                      </option>
                    ))}
                  </select>
                  {subjectUnitOptions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No units match this subject yet.
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleBulkAssignUnit}
                  disabled={bulkAssignmentDisabled || isPending}
                >
                  Add unit to selected SC
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
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary">
                                {lessonCode}
                              </span>
                              <input
                                value={editingLessonObjectiveTitle}
                                onChange={(event) => setEditingLessonObjectiveTitle(event.target.value)}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                              />
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
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary">
                                {lessonCode}
                              </span>
                              <h4 className="text-sm font-medium">{lo.title}</h4>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            className="rounded-full border border-border p-1 transition hover:bg-muted"
                            onClick={() => startLessonObjectiveEdit(aoIndex, loIndex, lo.title)}
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
                        </div>
                      </div>

                      <div className="space-y-2">
                        {sortedSuccessCriteria.map((sc) => {
                          const isEditing =
                            editingContext?.aoIndex === aoIndex &&
                            editingContext?.loIndex === loIndex &&
                            editingContext?.criterionId === sc.id
                          const levelStyles = levelStyleMap[sc.level] ?? levelStyleMap[1]
                          const isPickingUnits =
                            unitPickerContext?.aoIndex === aoIndex &&
                            unitPickerContext?.loIndex === loIndex &&
                            unitPickerContext?.criterionId === sc.id
                          const isSelected = selectedCriteriaIds.has(sc.id)

                          return (
                            <div
                              key={sc.id}
                              className={`flex flex-col gap-2 rounded-lg border border-border bg-muted/80 p-3 text-sm transition-colors ${
                                isSelected ? "border-primary/60 bg-primary/10" : ""
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => toggleCriterionSelection(sc.id, checked === true)}
                                    aria-label="Select success criterion"
                                  />
                                  <select
                                    className={`rounded-md border border-border px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40 ${levelStyles.badge}`}
                                    value={sc.level}
                                    onChange={(event) =>
                                      handleLevelChange(aoIndex, loIndex, sc.id, Number(event.target.value))
                                    }
                                  >
                                    {levels.map((level) => (
                                      <option key={level} value={level}>{`Level ${level}`}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-center gap-1 text-muted-foreground">
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
                                  ) : (
                                    <button
                                      className="rounded border border-border p-1 transition hover:bg-card"
                                      onClick={() => startEditingCriterion(aoIndex, loIndex, sc)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <button
                                    className={`rounded border border-border p-1 transition hover:bg-card ${
                                      isPickingUnits ? "bg-card" : ""
                                    }`}
                                    onClick={(event) =>
                                      toggleUnitPickerPopover(event, aoIndex, loIndex, sc.id)
                                    }
                                  >
                                    <Boxes className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    className="rounded border border-destructive/50 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                                    onClick={() => handleDeleteCriterion(aoIndex, loIndex, sc.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                              {isEditing ? (
                                <textarea
                                  value={editingTitle}
                                  onChange={(event) => setEditingTitle(event.target.value)}
                                  className="min-h-[60px] rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                              ) : (
                                <p className="text-foreground">{sc.description}</p>
                              )}
                              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                {sc.units.length > 0 ? (
                                  sc.units.map((unitId) => {
                                    const meta = unitLookup.get(unitId)
                                    const badgeClass = meta?.year
                                      ? yearBadgeMap[meta.year] ?? "bg-primary/10 text-primary"
                                      : "bg-primary/10 text-primary"
                                    const badgeLabel = meta?.year ? `Y${meta.year}` : meta?.subject ?? "Unit"
                                    const unitLabel = meta?.title ?? unitId
                                    return (
                                      <span
                                        key={unitId}
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${badgeClass}`}
                                      >
                                        <span className="font-semibold">{badgeLabel}</span>
                                        <span>{unitLabel}</span>
                                      </span>
                                    )
                                  })
                                ) : (
                                  <span className="italic text-muted-foreground/70">No units associated yet.</span>
                                )}
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
                      </div>
                    </header>

                    <div className="space-y-3">{lessonObjectiveCards}</div>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="flex h-[70vh] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
            <Tabs defaultValue="levels" className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-lg font-semibold">Output Visualization</h2>
                <TabsList className="grid h-9 grid-cols-2">
                  <TabsTrigger value="levels">Levels</TabsTrigger>
                  <TabsTrigger value="units">Units</TabsTrigger>
                </TabsList>
              </div>

              <div className="border-b px-5 pb-4">
                <Input
                  value={visualFilter}
                  onChange={(event) => setVisualFilter(event.target.value)}
                  placeholder="Filter visualization (e.g. 'yr 9 l 2 research')"
                  className="max-w-sm"
                />
              </div>

              <TabsContent value="levels" className="flex-1 overflow-y-auto px-5 py-4">
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
                                    {item.description} — {item.loTitle}
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
              </TabsContent>

              <TabsContent value="units" className="flex-1 overflow-y-auto px-5 py-4">
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

                        <div className="space-y-2">
                          {filteredEntries
                            .slice()
                            .sort(
                              (a, b) =>
                                a.aoCode.localeCompare(b.aoCode) ||
                                a.level - b.level ||
                                a.description.localeCompare(b.description),
                            )
                            .map((entry, index) => (
                              <div key={`${unit.unitId}-${index}`} className="rounded-lg border border-border bg-card p-3">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-foreground">
                                    {`Level ${entry.level}`}
                                  </span>
                                  <span className="font-semibold">{entry.loTitle}</span>
                                </div>
                                <p className="mt-1 text-sm font-medium text-foreground">{entry.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  {entry.aoCode} · {entry.aoTitle}
                                </p>
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
              </TabsContent>
            </Tabs>
          </section>
        </div>

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
    </main>
  )
}
