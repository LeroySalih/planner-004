"use client"

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Search, X } from "lucide-react"

import type {
  AssessmentObjective,
  Curriculum,
  LearningObjectiveWithCriteria,
  LessonSuccessCriterion,
  LessonWithObjectives,
} from "@/types"
import {
  INITIAL_LESSON_OBJECTIVE_FORM_STATE,
  INITIAL_LESSON_SUCCESS_CRITERION_FORM_STATE,
} from "@/lib/lesson-form-state"
import {
  createLessonLearningObjectiveFormAction,
  createLessonSuccessCriterionFormAction,
  setLessonSuccessCriteriaAction,
} from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface LessonObjectivesSidebarProps {
  unitId: string
  lesson: LessonWithObjectives
  learningObjectives: LearningObjectiveWithCriteria[]
  curricula: Curriculum[]
  assessmentObjectives: AssessmentObjective[]
  selectedSuccessCriteria: LessonSuccessCriterion[]
  isOpen: boolean
  onClose: () => void
  onUpdate: (lesson: LessonWithObjectives) => void
}

type ObjectiveSelectionState = "none" | "partial" | "all"

type ObjectiveSelection = {
  objective: LearningObjectiveWithCriteria
  criteria: LearningObjectiveWithCriteria["success_criteria"]
  criterionIds: string[]
  state: ObjectiveSelectionState
}

type ObjectiveSelectionDisplay = ObjectiveSelection & {
  displayCriteria: LearningObjectiveWithCriteria["success_criteria"]
}

type AssessmentObjectiveOption = {
  id: string
  title: string | null
  code: string | null
  order: number
}

type CurriculumFilterOption = {
  id: string
  label: string
  isFallback: boolean
}

type CurriculumOption = {
  id: string
  title: string
  subject: string | null
  isFallback: boolean
}

export function LessonObjectivesSidebar({
  unitId,
  lesson,
  learningObjectives,
  curricula,
  assessmentObjectives,
  selectedSuccessCriteria,
  isOpen,
  onClose,
  onUpdate,
}: LessonObjectivesSidebarProps) {
  const [objectives, setObjectives] = useState<LearningObjectiveWithCriteria[]>(learningObjectives)
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<string[]>(() =>
    Array.from(new Set(selectedSuccessCriteria.map((criterion) => criterion.success_criteria_id))),
  )
  const [filterValue, setFilterValue] = useState("")
  const [isCreateObjectiveOpen, setIsCreateObjectiveOpen] = useState(false)
  const [isCreateCriterionOpen, setIsCreateCriterionOpen] = useState(false)
  const [objectiveForNewCriterion, setObjectiveForNewCriterion] =
    useState<LearningObjectiveWithCriteria | null>(null)
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string>("")
  const [isNestedPending, setIsNestedPending] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setObjectives(learningObjectives)
  }, [learningObjectives])

  useEffect(() => {
    setSelectedCriteriaIds(
      Array.from(new Set(selectedSuccessCriteria.map((criterion) => criterion.success_criteria_id))),
    )
  }, [selectedSuccessCriteria])

  const assessmentObjectivesById = useMemo(() => {
    const map = new Map<string, AssessmentObjective>()
    for (const ao of assessmentObjectives) {
      map.set(ao.assessment_objective_id, ao)
    }
    return map
  }, [assessmentObjectives])

  const scopedObjectives = useMemo(() => {
    if (!selectedCurriculumId) {
      return objectives
    }

    return objectives.filter((objective) => {
      const curriculumId =
        objective.assessment_objective_curriculum_id ??
        assessmentObjectivesById.get(objective.assessment_objective_id ?? "")?.curriculum_id ??
        null
      return curriculumId === selectedCurriculumId
    })
  }, [assessmentObjectivesById, objectives, selectedCurriculumId])

  const baseObjectiveSelections = useMemo<ObjectiveSelection[]>(() => {
    const selectedSet = new Set(selectedCriteriaIds)

    return scopedObjectives.map((objective) => {
      const criteria = objective.success_criteria ?? []
      const criterionIds = criteria.map((criterion) => criterion.success_criteria_id)
      const selectedCount = criterionIds.filter((id) => selectedSet.has(id)).length

      let state: ObjectiveSelectionState = "none"
      if (selectedCount === criterionIds.length && criterionIds.length > 0) {
        state = "all"
      } else if (selectedCount > 0) {
        state = "partial"
      }

      return {
        objective,
        criteria,
        criterionIds,
        state,
      }
    })
  }, [scopedObjectives, selectedCriteriaIds])

  const filteredObjectiveSelections = useMemo<ObjectiveSelectionDisplay[]>(() => {
    const query = filterValue.trim().toLowerCase()

    if (query.length === 0) {
      return baseObjectiveSelections.map((entry) => ({
        ...entry,
        displayCriteria: entry.criteria,
      }))
    }

    return baseObjectiveSelections
      .map((entry) => {
        const objectiveLabels = [
          entry.objective.title ?? "",
          entry.objective.assessment_objective_title ?? "",
          entry.objective.spec_ref ?? "",
        ]
        const objectiveMatches = objectiveLabels.some((label) =>
          label.toLowerCase().includes(query),
        )
        const matchingCriteria = (entry.criteria ?? []).filter((criterion) =>
          (criterion.description ?? "").toLowerCase().includes(query),
        )

        return {
          ...entry,
          displayCriteria: objectiveMatches ? entry.criteria : matchingCriteria,
        }
      })
      .filter((entry) => entry.displayCriteria.length > 0)
  }, [baseObjectiveSelections, filterValue])

  const isFilterActive = filterValue.trim().length > 0
  const isBusy = isPending || isNestedPending

  const objectivesById = useMemo(() => {
    const map = new Map<string, LearningObjectiveWithCriteria>()
    for (const objective of objectives) {
      if (objective.learning_objective_id) {
        map.set(objective.learning_objective_id, objective)
      }
    }
    return map
  }, [objectives])

  const unitAssessmentObjectives = useMemo(() => {
    return assessmentObjectives.filter(
      (ao) => ao.curriculum_id && ao.unit_id === unitId,
    )
  }, [assessmentObjectives, unitId])

  const defaultAssessmentObjectiveId = useMemo(() => {
    for (const lessonObjective of lesson.lesson_objectives ?? []) {
      const aoId =
        lessonObjective.learning_objective?.assessment_objective_id ??
        lessonObjective.learning_objective?.assessment_objective?.assessment_objective_id ??
        null
      if (aoId) {
        return aoId
      }
    }

    const firstSelectedObjectiveId = selectedSuccessCriteria
      .map((criterion) => criterion.learning_objective_id)
      .find((id): id is string => Boolean(id))

    if (firstSelectedObjectiveId) {
      const linkedObjective = objectivesById.get(firstSelectedObjectiveId)
      if (linkedObjective?.assessment_objective_id) {
        return linkedObjective.assessment_objective_id
      }
    }

    if (unitAssessmentObjectives.length > 0) {
      return unitAssessmentObjectives[0].assessment_objective_id
    }

    const firstWithCurriculum = assessmentObjectives.find((ao) => ao.curriculum_id)
    return firstWithCurriculum ? firstWithCurriculum.assessment_objective_id : null
  }, [
    assessmentObjectives,
    lesson.lesson_objectives,
    objectivesById,
    selectedSuccessCriteria,
    unitAssessmentObjectives,
  ])

  const activeCurriculumIds = useMemo(() => {
    return new Set(curricula.map((curriculum) => curriculum.curriculum_id))
  }, [curricula])

  const defaultCurriculumId = useMemo(() => {
    const pickFirstActive = () => curricula[0]?.curriculum_id ?? null
    const normalizeCandidate = (candidate: string | null | undefined) => {
      if (!candidate) return null
      return activeCurriculumIds.has(candidate) ? candidate : null
    }

    if (defaultAssessmentObjectiveId) {
      const ao = assessmentObjectivesById.get(defaultAssessmentObjectiveId)
      if (ao?.curriculum_id) {
        const fromAo = normalizeCandidate(ao.curriculum_id)
        if (fromAo) return fromAo
      }
    }

    if (unitAssessmentObjectives.length > 0) {
      const fromUnit = normalizeCandidate(unitAssessmentObjectives[0].curriculum_id ?? null)
      if (fromUnit) return fromUnit
    }

    const firstWithCurriculum = assessmentObjectives.find((ao) => ao.curriculum_id)
    if (firstWithCurriculum?.curriculum_id) {
      const fromFirst = normalizeCandidate(firstWithCurriculum.curriculum_id)
      if (fromFirst) return fromFirst
    }

    return pickFirstActive()
  }, [
    assessmentObjectives,
    assessmentObjectivesById,
    curricula,
    defaultAssessmentObjectiveId,
    activeCurriculumIds,
    unitAssessmentObjectives,
  ])

  const curriculumFilterOptions = useMemo<CurriculumFilterOption[]>(() => {
    const map = new Map<string, CurriculumFilterOption>()

    const ensureOption = (id: string | null | undefined, label: string, isFallback = false) => {
      if (!id) return
      if (map.has(id)) return
      map.set(id, { id, label, isFallback })
    }

    for (const curriculum of curricula) {
      const label = curriculum.subject
        ? `${curriculum.title} (${curriculum.subject})`
        : curriculum.title
      ensureOption(curriculum.curriculum_id, label, false)
    }

    for (const objective of assessmentObjectives) {
      if (!objective.curriculum_id) continue
      if (!activeCurriculumIds.has(objective.curriculum_id)) continue
      if (map.has(objective.curriculum_id)) {
        continue
      }
      ensureOption(objective.curriculum_id, `Curriculum ${objective.curriculum_id}`, true)
    }

    for (const objective of objectives) {
      const curriculumId =
        objective.assessment_objective_curriculum_id ??
        assessmentObjectivesById.get(objective.assessment_objective_id ?? "")?.curriculum_id ??
        null
      if (!curriculumId) continue
      if (!activeCurriculumIds.has(curriculumId)) continue
      if (map.has(curriculumId)) continue
      ensureOption(curriculumId, `Curriculum ${curriculumId}`, true)
    }

    if (defaultCurriculumId && activeCurriculumIds.has(defaultCurriculumId) && !map.has(defaultCurriculumId)) {
      ensureOption(defaultCurriculumId, `Curriculum ${defaultCurriculumId}`, true)
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [
    assessmentObjectives,
    assessmentObjectivesById,
    curricula,
    defaultCurriculumId,
    activeCurriculumIds,
    objectives,
  ])

  useEffect(() => {
    if (!isOpen) {
      setSelectedCurriculumId("")
      return
    }

    setSelectedCurriculumId((current) => {
      if (current && curriculumFilterOptions.some((option) => option.id === current)) {
        return current
      }
      if (
        defaultCurriculumId &&
        curriculumFilterOptions.some((option) => option.id === defaultCurriculumId)
      ) {
        return defaultCurriculumId
      }
      return curriculumFilterOptions[0]?.id ?? ""
    })
  }, [curriculumFilterOptions, defaultCurriculumId, isOpen])

  const toggleObjective = useCallback(
    (objectiveId: string, nextChecked: boolean) => {
      const objective = objectives.find((entry) => entry.learning_objective_id === objectiveId)
      if (!objective) {
        return
      }

      const criterionIds = (objective.success_criteria ?? []).map(
        (criterion) => criterion.success_criteria_id,
      )

      setSelectedCriteriaIds((prev) => {
        const next = new Set(prev)
        if (nextChecked) {
          for (const id of criterionIds) {
            next.add(id)
          }
        } else {
          for (const id of criterionIds) {
            next.delete(id)
          }
        }
        return Array.from(next)
      })
    },
    [objectives],
  )

  const toggleCriterion = useCallback((criterionId: string, nextChecked: boolean) => {
    setSelectedCriteriaIds((prev) => {
      const next = new Set(prev)
      if (nextChecked) {
        next.add(criterionId)
      } else {
        next.delete(criterionId)
      }
      return Array.from(next)
    })
  }, [])

  const handleSave = useCallback(() => {
    if (isBusy) return

    startTransition(async () => {
      try {
        const result = await setLessonSuccessCriteriaAction(
          lesson.lesson_id,
          unitId,
          selectedCriteriaIds,
        )

        if (result.status === "error") {
          throw new Error(result.message ?? "Unable to queue lesson update")
        }

        toast.success("Lesson success criteria update queued")
        setIsCreateObjectiveOpen(false)
        setIsCreateCriterionOpen(false)
        setObjectiveForNewCriterion(null)
        onClose()
      } catch (error) {
        console.error("[lesson-objectives-sidebar] Failed to update lesson success criteria:", error)
        toast.error("Failed to update lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }, [isBusy, lesson.lesson_id, onClose, selectedCriteriaIds, unitId])

  const handleOpenCreateObjective = () => {
    setIsCreateCriterionOpen(false)
    setObjectiveForNewCriterion(null)
    setIsCreateObjectiveOpen(true)
  }

  const handleOpenCreateCriterion = (objective: LearningObjectiveWithCriteria) => {
    setIsCreateObjectiveOpen(false)
    setObjectiveForNewCriterion(objective)
    setIsCreateCriterionOpen(true)
  }

  const handleCloseSidebar = useCallback(() => {
    if (isBusy) return
    setIsCreateObjectiveOpen(false)
    setIsCreateCriterionOpen(false)
    setObjectiveForNewCriterion(null)
    onClose()
  }, [isBusy, onClose])

  const handleLearningObjectiveCreated = useCallback(
    (objective: LearningObjectiveWithCriteria) => {
      setObjectives((prev) => {
        const next = [...prev]
        const index = next.findIndex(
          (entry) => entry.learning_objective_id === objective.learning_objective_id,
        )

        if (index >= 0) {
          next[index] = {
            ...objective,
            success_criteria: next[index].success_criteria ?? [],
          }
        } else {
          next.push({ ...objective, success_criteria: objective.success_criteria ?? [] })
        }

        return next.sort((a, b) => {
          const aOrder = a.order_index ?? 0
          const bOrder = b.order_index ?? 0
          if (aOrder !== bOrder) {
            return aOrder - bOrder
          }
          return (a.title ?? "").localeCompare(b.title ?? "")
        })
      })

      toast.success("Learning objective created")
      setIsCreateObjectiveOpen(false)
      const createdCurriculumId =
        objective.assessment_objective_curriculum_id ??
        assessmentObjectivesById.get(objective.assessment_objective_id ?? "")?.curriculum_id ??
        null
      if (createdCurriculumId) {
        setSelectedCurriculumId((current) =>
          current && current === createdCurriculumId ? current : createdCurriculumId,
        )
      }
      if (objective.success_criteria && objective.success_criteria.length > 0) {
        setSelectedCriteriaIds((prev) => {
          const next = new Set(prev)
          for (const criterion of objective.success_criteria ?? []) {
            if (criterion?.success_criteria_id) {
              next.add(criterion.success_criteria_id)
            }
          }
          return Array.from(next)
        })
      }
    },
    [assessmentObjectivesById],
  )

  const handleSuccessCriterionCreated = useCallback(
    (objectiveId: string, criterion: LearningObjectiveWithCriteria["success_criteria"][number]) => {
      setObjectives((prev) =>
        prev.map((objective) => {
          if (objective.learning_objective_id !== objectiveId) {
            return objective
          }

          const existingCriteria = objective.success_criteria ?? []
          const existingIndex = existingCriteria.findIndex(
            (entry) => entry.success_criteria_id === criterion.success_criteria_id,
          )

          const nextCriteria =
            existingIndex >= 0
              ? existingCriteria.map((entry, idx) =>
                  idx === existingIndex ? { ...criterion } : entry,
                )
              : [...existingCriteria, { ...criterion }]

          nextCriteria.sort((a, b) => {
            const aOrder = a.order_index ?? 0
            const bOrder = b.order_index ?? 0
            if (aOrder !== bOrder) {
              return aOrder - bOrder
            }
            return (a.description ?? "").localeCompare(b.description ?? "")
          })

          return {
            ...objective,
            success_criteria: nextCriteria,
          }
        }),
      )

      setSelectedCriteriaIds((prev) =>
        prev.includes(criterion.success_criteria_id)
          ? prev
          : [...prev, criterion.success_criteria_id],
      )

      toast.success("Success criterion created")
      setIsCreateCriterionOpen(false)
      setObjectiveForNewCriterion(null)
    },
    [],
  )

  const dialogDefaultCurriculumId = selectedCurriculumId || defaultCurriculumId

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={handleCloseSidebar} />
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col overflow-visible">
        <Card className="flex h-full flex-col rounded-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Edit Lesson Objectives</CardTitle>
            <Button variant="ghost" size="icon" onClick={handleCloseSidebar} disabled={isBusy}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden">
            <p className="text-sm text-muted-foreground">
              Choose the success criteria that apply to{" "}
              <span className="font-medium">{lesson.title}</span>.
            </p>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
                placeholder="Filter learning objectives or success criteria"
                className="pl-9"
                aria-label="Filter learning objectives and success criteria"
                disabled={isBusy}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full sm:w-64">
                <Select
                  value={selectedCurriculumId}
                  onValueChange={setSelectedCurriculumId}
                  disabled={isBusy || curriculumFilterOptions.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select curriculum" />
                  </SelectTrigger>
                  <SelectContent>
                    {curriculumFilterOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.isFallback ? `${option.label} • Unlisted` : option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenCreateObjective}
                disabled={isBusy}
                className="sm:w-auto"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add LO
              </Button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-2">
              {filteredObjectiveSelections.length > 0 ? (
                filteredObjectiveSelections.map(({ objective, displayCriteria, state }) => {
                  const checkboxState =
                    state === "all" ? true : state === "partial" ? "indeterminate" : false

                  return (
                    <div
                      key={objective.learning_objective_id}
                      className="space-y-3 rounded-md border border-border/60 p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <label className="flex flex-1 items-start gap-3">
                          <Checkbox
                            checked={checkboxState}
                            onCheckedChange={(value) =>
                              toggleObjective(
                                objective.learning_objective_id,
                                value === true || value === "indeterminate",
                              )
                            }
                            disabled={isBusy}
                          />
                          <div className="space-y-1">
                            <div className="font-medium leading-tight text-foreground">
                              {objective.title}
                              {objective.spec_ref ? (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  ({objective.spec_ref})
                                </span>
                              ) : null}
                            </div>
                            {objective.assessment_objective_title ? (
                              <p className="text-xs text-muted-foreground">
                                {objective.assessment_objective_title}
                              </p>
                            ) : null}
                          </div>
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenCreateCriterion(objective)}
                          disabled={isBusy}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          New SC
                        </Button>
                      </div>

                      {displayCriteria.length > 0 ? (
                        <ul className="space-y-2 border-l pl-3 text-sm text-muted-foreground">
                          {displayCriteria.map((criterion) => {
                            const checked = selectedCriteriaIds.includes(
                              criterion.success_criteria_id,
                            )
                            return (
                              <li key={criterion.success_criteria_id}>
                                <label className="flex items-start gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) =>
                                      toggleCriterion(
                                        criterion.success_criteria_id,
                                        value === true,
                                      )
                                    }
                                    disabled={isBusy}
                                  />
                                  <div className="space-y-1">
                                    <div className="font-medium text-foreground">
                                      {criterion.description}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Level {criterion.level}
                                      {!criterion.active ? (
                                        <span className="ml-2 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-semibold text-destructive">
                                          Inactive
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="pl-7 text-xs text-muted-foreground">
                          No success criteria match the current filter for this objective.
                        </p>
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isFilterActive
                    ? "No learning objectives match the current filter."
                    : "No learning objectives are available for this curriculum."}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={handleCloseSidebar} disabled={isBusy}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isBusy}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  "Save Objectives"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <LearningObjectiveCreateDialog
          open={isCreateObjectiveOpen}
          lessonId={lesson.lesson_id}
          curricula={curricula}
          assessmentObjectives={assessmentObjectives}
          defaultCurriculumId={dialogDefaultCurriculumId}
          defaultAssessmentObjectiveId={defaultAssessmentObjectiveId}
          onOpenChange={setIsCreateObjectiveOpen}
          onCreated={handleLearningObjectiveCreated}
          onPendingChange={setIsNestedPending}
        />

        {isCreateCriterionOpen && objectiveForNewCriterion ? (
          <SuccessCriterionCreateSidebar
            lessonId={lesson.lesson_id}
            objective={objectiveForNewCriterion}
            onClose={() => {
              setIsCreateCriterionOpen(false)
              setObjectiveForNewCriterion(null)
            }}
            onCreated={handleSuccessCriterionCreated}
            onPendingChange={setIsNestedPending}
          />
        ) : null}
      </div>
    </div>
  )
}

interface LearningObjectiveCreateDialogProps {
  open: boolean
  lessonId: string
  curricula: Curriculum[]
  assessmentObjectives: AssessmentObjective[]
  defaultCurriculumId: string | null
  defaultAssessmentObjectiveId: string | null
  onOpenChange: (open: boolean) => void
  onCreated: (objective: LearningObjectiveWithCriteria) => void
  onPendingChange?: (pending: boolean) => void
}

function LearningObjectiveCreateDialog({
  open,
  lessonId,
  curricula,
  assessmentObjectives,
  defaultCurriculumId,
  defaultAssessmentObjectiveId,
  onOpenChange,
  onCreated,
  onPendingChange,
}: LearningObjectiveCreateDialogProps) {
  const [title, setTitle] = useState("")
  const [specRef, setSpecRef] = useState("")
  const [successCriterionDescription, setSuccessCriterionDescription] = useState("")
  const [successCriterionLevel, setSuccessCriterionLevel] = useState("1")
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string>("")
  const [selectedAssessmentObjectiveId, setSelectedAssessmentObjectiveId] = useState<string>("")

  const [formState, formAction, pending] = useActionState(
    createLessonLearningObjectiveFormAction,
    INITIAL_LESSON_OBJECTIVE_FORM_STATE,
  )

  useEffect(() => {
    onPendingChange?.(pending)
    return () => {
      onPendingChange?.(false)
    }
  }, [pending, onPendingChange])

  useEffect(() => {
    setTitle("")
    setSpecRef("")
    setSuccessCriterionDescription("")
    setSuccessCriterionLevel("1")
    if (!open) {
      setSelectedCurriculumId("")
      setSelectedAssessmentObjectiveId("")
      return
    }
  }, [open])

  const curriculumOptions = useMemo<CurriculumOption[]>(() => {
    const options: CurriculumOption[] = curricula.map((curriculum) => ({
      id: curriculum.curriculum_id,
      title: curriculum.title,
      subject: curriculum.subject ?? null,
      isFallback: false,
    }))

    const knownIds = new Set(options.map((option) => option.id))
    for (const objective of assessmentObjectives) {
      const curriculumId = objective.curriculum_id
      if (!curriculumId || knownIds.has(curriculumId)) {
        continue
      }
      options.push({
        id: curriculumId,
        title: `Curriculum ${curriculumId}`,
        subject: null,
        isFallback: true,
      })
      knownIds.add(curriculumId)
    }

    return options.sort((a, b) => a.title.localeCompare(b.title))
  }, [assessmentObjectives, curricula])

  const assessmentObjectivesByCurriculum = useMemo(() => {
    const map = new Map<string, AssessmentObjectiveOption[]>()

    for (const objective of assessmentObjectives) {
      const curriculumId = objective.curriculum_id
      if (!curriculumId) continue

      const option: AssessmentObjectiveOption = {
        id: objective.assessment_objective_id,
        title: objective.title ?? null,
        code: objective.code ?? null,
        order: objective.order_index ?? 0,
      }

      const list = map.get(curriculumId) ?? []
      list.push(option)
      map.set(curriculumId, list)
    }

    for (const [curriculumId, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.order !== b.order) {
          return a.order - b.order
        }
        const aTitle = a.title ?? ""
        const bTitle = b.title ?? ""
        return aTitle.localeCompare(bTitle)
      })
      map.set(curriculumId, list)
    }

    return map
  }, [assessmentObjectives])

  useEffect(() => {
    if (!open) {
      return
    }

    const resolvedCurriculumId =
      (defaultCurriculumId &&
      curriculumOptions.some((option) => option.id === defaultCurriculumId)
        ? defaultCurriculumId
        : curriculumOptions[0]?.id) ?? ""

    const candidates = resolvedCurriculumId
      ? assessmentObjectivesByCurriculum.get(resolvedCurriculumId) ?? []
      : []

    const resolvedAssessmentObjectiveId =
      (defaultAssessmentObjectiveId &&
      candidates.some((option) => option.id === defaultAssessmentObjectiveId)
        ? defaultAssessmentObjectiveId
        : candidates[0]?.id) ?? ""

    setSelectedCurriculumId(resolvedCurriculumId)
    setSelectedAssessmentObjectiveId(resolvedAssessmentObjectiveId)
  }, [
    open,
    defaultCurriculumId,
    defaultAssessmentObjectiveId,
    curriculumOptions,
    assessmentObjectivesByCurriculum,
  ])

  useEffect(() => {
    if (!open) {
      return
    }

    if (!selectedCurriculumId) {
      setSelectedAssessmentObjectiveId("")
      return
    }

    const candidates = assessmentObjectivesByCurriculum.get(selectedCurriculumId) ?? []
    if (candidates.length === 0) {
      setSelectedAssessmentObjectiveId("")
      return
    }

    if (!candidates.some((option) => option.id === selectedAssessmentObjectiveId)) {
      setSelectedAssessmentObjectiveId(candidates[0].id)
    }
  }, [
    open,
    selectedCurriculumId,
    assessmentObjectivesByCurriculum,
    selectedAssessmentObjectiveId,
  ])

  useEffect(() => {
    if (formState.status === "success" && formState.learningObjective) {
      onCreated(formState.learningObjective)
      onOpenChange(false)
    }
  }, [formState, onCreated, onOpenChange])

  const filteredAssessmentObjectiveOptions = useMemo(() => {
    if (!selectedCurriculumId) {
      return []
    }
    return assessmentObjectivesByCurriculum.get(selectedCurriculumId) ?? []
  }, [assessmentObjectivesByCurriculum, selectedCurriculumId])

  const hasCurriculumOptions = curriculumOptions.length > 0
  const hasAssessmentObjective = filteredAssessmentObjectiveOptions.length > 0
  const showError = formState.status === "error" && formState.message
  const canSubmit =
    Boolean(title.trim()) &&
    Boolean(selectedAssessmentObjectiveId) &&
    hasAssessmentObjective &&
    Boolean(successCriterionDescription.trim()) &&
    successCriterionLevel.trim().length > 0

  const handleClose = () => {
    if (pending) return
    onOpenChange(false)
  }

  const handleLevelChange = (value: string) => {
    const numericOnly = value.replace(/[^0-9]/g, "")
    if (numericOnly.length === 0) {
      setSuccessCriterionLevel("")
      return
    }
    const numericValue = Math.min(9, Math.max(1, Number.parseInt(numericOnly, 10)))
    setSuccessCriterionLevel(String(numericValue))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault()
          }
        }}
        onPointerDownOutside={(event) => {
          if (pending) {
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          if (pending) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add Learning Objective</DialogTitle>
          <DialogDescription>
            Create a new learning objective and link it to this lesson.
          </DialogDescription>
        </DialogHeader>

        {hasCurriculumOptions ? (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="lessonId" value={lessonId} />
            <div className="space-y-2">
              <Label htmlFor="lesson-objective-curriculum">Curriculum</Label>
              <select
                id="lesson-objective-curriculum"
                value={selectedCurriculumId}
                onChange={(event) => setSelectedCurriculumId(event.target.value)}
                disabled={pending || !hasCurriculumOptions}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {hasCurriculumOptions ? (
                  curriculumOptions.map((option) => {
                    const label = option.subject
                      ? `${option.title} (${option.subject})`
                      : option.title
                    const displayLabel = option.isFallback ? `${label} • Unlisted` : label
                    return (
                      <option key={option.id} value={option.id}>
                        {displayLabel}
                      </option>
                    )
                  })
                ) : (
                  <option value="">No curricula available</option>
                )}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lesson-objective-title">Title</Label>
              <Input
                id="lesson-objective-title"
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Describe the learning objective"
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lesson-objective-spec-ref">
                Spec reference <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="lesson-objective-spec-ref"
                name="specRef"
                value={specRef}
                onChange={(event) => setSpecRef(event.target.value)}
                placeholder="e.g. AO1.3"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lesson-objective-sc-description">Default success criterion</Label>
              <Input
                id="lesson-objective-sc-description"
                name="successCriterionDescription"
                value={successCriterionDescription}
                onChange={(event) => setSuccessCriterionDescription(event.target.value)}
                placeholder="Describe the success criterion"
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lesson-objective-sc-level">Success criterion level (1-9)</Label>
              <Input
                id="lesson-objective-sc-level"
                name="successCriterionLevel"
                type="number"
                min={1}
                max={9}
                inputMode="numeric"
                value={successCriterionLevel}
                onChange={(event) => handleLevelChange(event.target.value)}
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lesson-objective-assessment-objective">Assessment objective</Label>
              {hasAssessmentObjective ? (
                <select
                  id="lesson-objective-assessment-objective"
                  name="assessmentObjectiveId"
                  value={selectedAssessmentObjectiveId}
                  onChange={(event) => setSelectedAssessmentObjectiveId(event.target.value)}
                  disabled={pending}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                >
                  {filteredAssessmentObjectiveOptions.map((option) => {
                    const code = option.code?.trim()
                    if (code && option.title) {
                      return (
                        <option key={option.id} value={option.id}>
                          {code} — {option.title}
                        </option>
                      )
                    }
                    const label = option.title ?? code ?? "Assessment objective"
                    return (
                      <option key={option.id} value={option.id}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              ) : (
                <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  No assessment objectives are available for the selected curriculum.
                </div>
              )}
            </div>
            {showError ? (
              <p className="text-sm font-medium text-destructive">{formState.message}</p>
            ) : null}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !canSubmit}>
                {pending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Creating…
                  </>
                ) : (
                  "Create objective"
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>No curricula are available yet. Create a curriculum with assessment objectives before adding a learning objective.</p>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface SuccessCriterionCreateSidebarProps {
  lessonId: string
  objective: LearningObjectiveWithCriteria
  onClose: () => void
  onCreated: (
    objectiveId: string,
    criterion: LearningObjectiveWithCriteria["success_criteria"][number],
  ) => void
  onPendingChange?: (pending: boolean) => void
}

function SuccessCriterionCreateSidebar({
  lessonId,
  objective,
  onClose,
  onCreated,
  onPendingChange,
}: SuccessCriterionCreateSidebarProps) {
  const [description, setDescription] = useState("")
  const [level, setLevel] = useState("1")

  const [formState, formAction, pending] = useActionState(
    createLessonSuccessCriterionFormAction,
    INITIAL_LESSON_SUCCESS_CRITERION_FORM_STATE,
  )

  useEffect(() => {
    onPendingChange?.(pending)
    return () => {
      onPendingChange?.(false)
    }
  }, [pending, onPendingChange])

  useEffect(() => {
    setDescription("")
    setLevel("1")
  }, [objective.learning_objective_id])

  useEffect(() => {
    if (formState.status === "success" && formState.successCriterion) {
      onCreated(objective.learning_objective_id, formState.successCriterion)
    }
  }, [formState, objective.learning_objective_id, onCreated])

  const showError = formState.status === "error" && formState.message

  const handleLevelChange = (value: string) => {
    const numericOnly = value.replace(/[^0-9]/g, "")
    if (numericOnly.length === 0) {
      setLevel("")
      return
    }
    const numericValue = Math.min(9, Math.max(1, Number.parseInt(numericOnly, 10)))
    setLevel(String(numericValue))
  }

  const handleClose = () => {
    if (pending) return
    onClose()
  }

  return (
    <div className="absolute inset-y-0 right-0 z-50 flex h-full w-full max-w-md border-l bg-background shadow-2xl">
      <Card className="flex h-full flex-col rounded-none border-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold">Add Success Criterion</CardTitle>
          <Button variant="ghost" size="icon" onClick={handleClose} disabled={pending}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4 overflow-y-auto pb-6">
          <form action={formAction} className="flex flex-1 flex-col gap-4">
            <input type="hidden" name="lessonId" value={lessonId} />
            <input type="hidden" name="learningObjectiveId" value={objective.learning_objective_id} />

            <div className="space-y-1 rounded-md border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{objective.title}</p>
              {objective.assessment_objective_title ? (
                <p>{objective.assessment_objective_title}</p>
              ) : null}
              {objective.spec_ref ? <p>Spec ref: {objective.spec_ref}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="lesson-success-criterion-description">Title</Label>
              <Input
                id="lesson-success-criterion-description"
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the success criterion"
                required
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lesson-success-criterion-level">Level (1-9)</Label>
              <Input
                id="lesson-success-criterion-level"
                name="level"
                type="number"
                min={1}
                max={9}
                inputMode="numeric"
                value={level}
                onChange={(event) => handleLevelChange(event.target.value)}
                required
                disabled={pending}
              />
            </div>

            {showError ? (
              <p className="text-sm font-medium text-destructive">{formState.message}</p>
            ) : null}

            <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={handleClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !description.trim() || !level || Number.isNaN(Number(level))}
              >
                {pending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Creating…
                  </>
                ) : (
                  "Create success criterion"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
