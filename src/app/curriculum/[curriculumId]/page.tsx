"use client"

import { Pencil, Plus, Trash2, Check, X, Boxes } from "lucide-react"
import Link from "next/link"
import { use, useEffect, useMemo, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"

interface CurriculumPageProps {
  params: Promise<{
    curriculumId: string
  }>
}

type SuccessCriterion = {
  id: string
  level: number
  description: string
  units: string[]
}

type LessonObjective = {
  code: string
  title: string
  successCriteria: SuccessCriterion[]
}

type AssessmentObjective = {
  code: string
  title: string
  lessonObjectives: LessonObjective[]
}

const initialAssessmentObjectives: AssessmentObjective[] = [
  {
    code: "AO1",
    title: "Investigate",
    lessonObjectives: [
      {
        code: "LO 1.1",
        title: "TBAT identify clients",
        successCriteria: [
          {
            id: "sc-1",
            level: 1,
            description: "I can identify a client",
            units: ["Learn Isometric Drawing"],
          },
          {
            id: "sc-2",
            level: 2,
            description: "I can ask a client for their preferences for a design",
            units: ["Product Design Basics", "Material Properties"],
          },
          {
            id: "sc-3",
            level: 3,
            description: "I can correctly categorise a client's needs and wants",
            units: ["Cardboard Engineering"],
          },
        ],
      },
      {
        code: "LO 1.2",
        title: "TBAT create design specifications",
        successCriteria: [
          {
            id: "sc-4",
            level: 2,
            description: "I can produce a design specification that meets user needs",
            units: ["Product Design Basics"],
          },
          {
            id: "sc-5",
            level: 3,
            description: "I can justify design specifications using research evidence",
            units: ["Material Properties"],
          },
        ],
      },
    ],
  },
  {
    code: "AO2",
    title: "Design",
    lessonObjectives: [
      {
        code: "LO 2.1",
        title: "TBAT produce annotated design ideas",
        successCriteria: [
          {
            id: "sc-6",
            level: 1,
            description: "I can draw cubes and cuboids in isometric style",
            units: ["Learn Isometric Drawing"],
          },
          {
            id: "sc-7",
            level: 2,
            description: "I can annotate ideas explaining material choices",
            units: ["Product Design Basics"],
          },
        ],
      },
    ],
  },
  {
    code: "AO3",
    title: "Make",
    lessonObjectives: [
      {
        code: "LO 3.1",
        title: "TBAT operate workshop tools safely",
        successCriteria: [
          {
            id: "sc-8",
            level: 1,
            description: "I can safely use the DT classroom",
            units: ["Safety in Workshop"],
          },
          {
            id: "sc-9",
            level: 2,
            description: "I can set up workshop equipment independently",
            units: ["Material Properties"],
          },
        ],
      },
    ],
  },
]

const levels = [1, 2, 3, 4, 5, 6, 7]

const availableUnits: { name: string; year: number }[] = [
  { name: "Learn Isometric Drawing", year: 7 },
  { name: "Make a Door Hanger", year: 8 },
  { name: "Cardboard Engineering", year: 7 },
  { name: "Product Design Basics", year: 9 },
  { name: "Material Properties", year: 10 },
  { name: "Safety in Workshop", year: 7 },
  { name: "Sustainable Materials", year: 11 },
  { name: "Advanced CAD", year: 12 },
  { name: "Design for Manufacture", year: 13 },
]

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

export default function CurriculumLandingPage({ params }: CurriculumPageProps) {
  const resolvedParams = use(params)
  const { curriculumId } = resolvedParams
  const curriculumName = curriculumId.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

  const [assessmentObjectives, setAssessmentObjectives] = useState<AssessmentObjective[]>(initialAssessmentObjectives)
  const [editingContext, setEditingContext] = useState<
    { aoIndex: number; loIndex: number; criterionId: string } | null
  >(null)
  const [editingAssessmentObjective, setEditingAssessmentObjective] = useState<
    { aoIndex: number } | null
  >(null)
  const [editingAssessmentObjectiveTitle, setEditingAssessmentObjectiveTitle] = useState("")
  const [editingLessonObjective, setEditingLessonObjective] = useState<
    { aoIndex: number; loIndex: number } | null
  >(null)
  const [editingLessonObjectiveTitle, setEditingLessonObjectiveTitle] = useState("")
  const [editingTitle, setEditingTitle] = useState("")
  const [unitPickerContext, setUnitPickerContext] = useState<
    | {
        aoIndex: number
        loIndex: number
        criterionId: string
        position: { top: number; left: number }
      }
    | null
  >(null)
  const [visualFilter, setVisualFilter] = useState("")

  useEffect(() => {
    if (!unitPickerContext) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUnitPickerContext(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [unitPickerContext])

  const toggleUnitPickerPopover = (
    event: ReactMouseEvent<HTMLButtonElement>,
    aoIndex: number,
    loIndex: number,
    criterionId: string,
  ) => {
    event.stopPropagation()

    const triggerElement = event.currentTarget
    if (!triggerElement) {
      return
    }

    const triggerRect = triggerElement.getBoundingClientRect()
    const preferredTop = triggerRect.bottom + window.scrollY + 8
    const preferredLeft = triggerRect.left + window.scrollX
    const panelWidth = 256
    const panelHeight = 280

    const viewportTop = window.scrollY + 16
    const viewportBottom = window.scrollY + window.innerHeight - 16
    const viewportLeft = window.scrollX + 16
    const viewportRight = window.scrollX + window.innerWidth - 16

    let computedTop = preferredTop
    if (computedTop + panelHeight > viewportBottom) {
      computedTop = triggerRect.top + window.scrollY - panelHeight - 8
    }
    if (computedTop < viewportTop) {
      computedTop = viewportTop
    }

    let computedLeft = preferredLeft
    if (computedLeft + panelWidth > viewportRight) {
      computedLeft = viewportRight - panelWidth
    }
    if (computedLeft < viewportLeft) {
      computedLeft = viewportLeft
    }

    setUnitPickerContext((prev) => {
      if (
        prev &&
        prev.aoIndex === aoIndex &&
        prev.loIndex === loIndex &&
        prev.criterionId === criterionId
      ) {
        return null
      }

      return {
        aoIndex,
        loIndex,
        criterionId,
        position: { top: computedTop, left: computedLeft },
      }
    })
  }

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

        const sortedCriteria = criteria.sort((a, b) => {
          if (a.aoCode === b.aoCode) {
            return a.description.localeCompare(b.description)
          }
          return a.aoCode.localeCompare(b.aoCode)
        })

        return { level, criteria: sortedCriteria }
      })
      .filter((group) => group.criteria.length > 0)
  }, [assessmentObjectives])

  const unitLookup = useMemo(() => {
    return new Map(availableUnits.map((unit) => [unit.name, unit]))
  }, [])

  const unitsView = useMemo(() => {
    const unitMap = new Map<
      string,
      {
        unitName: string
        year?: number
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
          sc.units.forEach((unitName) => {
            const meta = unitLookup.get(unitName)
            if (!unitMap.has(unitName)) {
              unitMap.set(unitName, {
                unitName,
                year: meta?.year,
                entries: [],
              })
            }

            unitMap.get(unitName)?.entries.push({
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

  const normalizedFilter = visualFilter.trim().toLowerCase()
  const yearMatches = Array.from(normalizedFilter.matchAll(/yr\s*(\d{1,2})/g)).map((match) =>
    Number.parseInt(match[1], 10),
  )
  const levelMatches = Array.from(normalizedFilter.matchAll(/l\s*(\d{1,2})/g)).map((match) =>
    Number.parseInt(match[1], 10),
  )
  const filteredYears = yearMatches.filter((year) => Number.isFinite(year))
  const filteredLevels = levelMatches.filter((level) => Number.isFinite(level) && level >= 1 && level <= 7)

  const yearFilterSet = new Set(filteredYears)
  const levelFilterSet = new Set(filteredLevels)

  const textFilter = normalizedFilter
    .replace(/yr\s*\d{1,2}/g, "")
    .replace(/l\s*\d{1,2}/g, "")
    .trim()

  const startEditing = (aoIndex: number, loIndex: number, criterion: SuccessCriterion) => {
    setEditingContext({ aoIndex, loIndex, criterionId: criterion.id })
    setEditingTitle(criterion.description)
  }

  const cancelEditing = () => {
    setEditingContext(null)
    setEditingTitle("")
  }

  const saveEditing = () => {
    if (!editingContext) return

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) => {
        if (aoIdx !== editingContext.aoIndex) return ao

        return {
          ...ao,
          lessonObjectives: ao.lessonObjectives.map((lo, loIdx) => {
            if (loIdx !== editingContext.loIndex) return lo
            return {
              ...lo,
              successCriteria: lo.successCriteria.map((sc) =>
                sc.id === editingContext.criterionId ? { ...sc, description: editingTitle } : sc,
              ),
            }
          }),
        }
      }),
    )

    cancelEditing()
  }

  const addSuccessCriterion = (aoIndex: number, loIndex: number) => {
    const newId = `sc-${Date.now()}`
    const stubCriterion: SuccessCriterion = {
      id: newId,
      level: 1,
      description: "New success criterion",
      units: [],
    }

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) => {
        if (aoIdx !== aoIndex) return ao
        return {
          ...ao,
          lessonObjectives: ao.lessonObjectives.map((lo, loIdx) => {
            if (loIdx !== loIndex) return lo
            return {
              ...lo,
              successCriteria: [...lo.successCriteria, stubCriterion],
            }
          }),
        }
      }),
    )

    setEditingContext({ aoIndex, loIndex, criterionId: newId })
    setEditingTitle(stubCriterion.description)
  }

  const addAssessmentObjective = () => {
    const newAoIndex = assessmentObjectives.length
    const aoNumber = newAoIndex + 1
    const newAoCode = `AO${aoNumber}`
    const newLessonObjectiveTitle = "New learning objective"
    const newSuccessCriterionId = `sc-${Date.now()}`
    const newSuccessCriterion: SuccessCriterion = {
      id: newSuccessCriterionId,
      level: 1,
      description: "New success criterion",
      units: [],
    }

    const newLessonObjective: LessonObjective = {
      code: `LO ${aoNumber}.1`,
      title: newLessonObjectiveTitle,
      successCriteria: [newSuccessCriterion],
    }

    const newAo: AssessmentObjective = {
      code: newAoCode,
      title: "New assessment objective",
      lessonObjectives: [newLessonObjective],
    }

    setAssessmentObjectives((prev) => [...prev, newAo])

    setEditingAssessmentObjective({ aoIndex: newAoIndex })
    setEditingAssessmentObjectiveTitle("New assessment objective")
    setEditingLessonObjective({ aoIndex: newAoIndex, loIndex: 0 })
    setEditingLessonObjectiveTitle(newLessonObjectiveTitle)
    setEditingContext({ aoIndex: newAoIndex, loIndex: 0, criterionId: newSuccessCriterionId })
    setEditingTitle(newSuccessCriterion.description)
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

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) => {
        if (aoIdx !== editingLessonObjective.aoIndex) return ao
        return {
          ...ao,
          lessonObjectives: ao.lessonObjectives.map((lo, loIdx) => {
            if (loIdx !== editingLessonObjective.loIndex) return lo
            return {
              ...lo,
              title: editingLessonObjectiveTitle,
            }
          }),
        }
      }),
    )

    cancelLessonObjectiveEdit()
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

    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) =>
        aoIdx === editingAssessmentObjective.aoIndex
          ? { ...ao, title: editingAssessmentObjectiveTitle }
          : ao,
      ),
    )

    cancelAssessmentObjectiveEdit()
  }

  const addLearningObjective = (aoIndex: number) => {
    setAssessmentObjectives((prev) =>
      prev.map((ao, aoIdx) => {
        if (aoIdx !== aoIndex) return ao

        const newSequence = ao.lessonObjectives.length + 1
        const aoNumber = aoIndex + 1
        const newLessonObjective: LessonObjective = {
          code: `LO ${aoNumber}.${newSequence}`,
          title: "New learning objective",
          successCriteria: [
            {
              id: `sc-${Date.now()}`,
              level: 1,
              description: "New success criterion",
              units: [],
            },
          ],
        }

        return {
          ...ao,
          lessonObjectives: [...ao.lessonObjectives, newLessonObjective],
        }
      }),
    )
  }

  const handleLevelChange = (
    aoIndex: number,
    loIndex: number,
    criterionId: string,
    newLevel: number,
  ) => {
    setAssessmentObjectives((prev) =>
      prev.map((ao, aIdx) => {
        if (aIdx !== aoIndex) return ao
        return {
          ...ao,
          lessonObjectives: ao.lessonObjectives.map((lo, lIdx) => {
            if (lIdx !== loIndex) return lo
            return {
              ...lo,
              successCriteria: lo.successCriteria.map((sc) =>
                sc.id === criterionId ? { ...sc, level: newLevel } : sc,
              ),
            }
          }),
        }
      }),
    )
  }

  const handleDeleteCriterion = (aoIndex: number, loIndex: number, criterionId: string) => {
    setAssessmentObjectives((prev) =>
      prev.map((ao, aIdx) => {
        if (aIdx !== aoIndex) return ao
        return {
          ...ao,
          lessonObjectives: ao.lessonObjectives.map((lo, lIdx) => {
            if (lIdx !== loIndex) return lo
            return {
              ...lo,
              successCriteria: lo.successCriteria.filter((sc) => sc.id !== criterionId),
            }
          }),
        }
      }),
    )

    if (editingContext && editingContext.criterionId === criterionId) {
      cancelEditing()
    }

    if (unitPickerContext && unitPickerContext.criterionId === criterionId) {
      setUnitPickerContext(null)
    }
  }

  const toggleUnitForCriterion = (
    aoIndex: number,
    loIndex: number,
    criterionId: string,
    unit: string,
  ) => {
    setAssessmentObjectives((prev) =>
      prev.map((ao, aIdx) => {
        if (aIdx !== aoIndex) return ao
        return {
          ...ao,
          lessonObjectives: ao.lessonObjectives.map((lo, lIdx) => {
            if (lIdx !== loIndex) return lo
            return {
              ...lo,
              successCriteria: lo.successCriteria.map((sc) => {
                if (sc.id !== criterionId) return sc
                const alreadySelected = sc.units.includes(unit)
                return {
                  ...sc,
                  units: alreadySelected
                    ? sc.units.filter((existing) => existing !== unit)
                    : [...sc.units, unit],
                }
              }),
            }
          }),
        }
      }),
    )
  }

  const activeCriterion = unitPickerContext
    ? assessmentObjectives[unitPickerContext.aoIndex].lessonObjectives[
        unitPickerContext.loIndex
      ].successCriteria.find((sc) => sc.id === unitPickerContext.criterionId)
    : null

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <div className="space-y-8">
        <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
          <p className="text-sm uppercase tracking-wide text-white/70">Subject Data Entry Sheet</p>
          <h1 className="text-3xl font-semibold">Design &amp; Technology · Curriculum Structure</h1>
          <p className="mt-2 text-sm text-white/80">Prototype view for {curriculumName}</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Builder Column */}
          <section className="flex h-[70vh] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-lg font-semibold">Curriculum Builder</h2>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground transition hover:bg-muted"
                    onClick={() => addAssessmentObjective()}
                  >
                    <Plus className="h-4 w-4" /> AO
                  </button>
                </div>
              </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {assessmentObjectives.map((ao, aoIndex) => (
              <article key={ao.code} className="rounded-2xl border border-border bg-muted/60 p-4 shadow-inner">
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
                      className="rounded-full border border-border p-1 transition hover:bg-card"
                      onClick={() => addLearningObjective(aoIndex)}
                      aria-label="Add learning objective"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </header>

                  <div className="space-y-3">
                    {ao.lessonObjectives.map((lo, loIndex) => (
                      <div key={lo.code} className="space-y-3 rounded-xl border border-border bg-card p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            {editingLessonObjective &&
                            editingLessonObjective.aoIndex === aoIndex &&
                            editingLessonObjective.loIndex === loIndex ? (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary">
                                  {lo.code}
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
                                  {lo.code}
                                </span>
                                <h4 className="text-sm font-medium">{lo.title}</h4>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              className="rounded-full border border-border p-1 transition hover:bg-muted"
                              onClick={() =>
                                startLessonObjectiveEdit(aoIndex, loIndex, lo.title)
                              }
                              aria-label="Edit learning objective"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              className="rounded-full border border-border p-1 transition hover:bg-muted"
                              onClick={() => addSuccessCriterion(aoIndex, loIndex)}
                              aria-label="Add success criterion"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {[...lo.successCriteria]
                            .sort((a, b) => (a.level === b.level ? a.description.localeCompare(b.description) : a.level - b.level))
                            .map((sc) => {
                            const isEditing =
                              editingContext?.aoIndex === aoIndex &&
                              editingContext?.loIndex === loIndex &&
                              editingContext?.criterionId === sc.id
                            const levelStyles = levelStyleMap[sc.level] ?? levelStyleMap[1]
                            const isPickingUnits =
                              unitPickerContext?.aoIndex === aoIndex &&
                              unitPickerContext?.loIndex === loIndex &&
                              unitPickerContext?.criterionId === sc.id

                            return (
                            <div
                              key={sc.id}
                              className="flex flex-col gap-2 rounded-lg border border-border bg-muted/80 p-3 text-sm"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
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
                                        onClick={saveEditing}
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        className="rounded border border-destructive/40 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                                        onClick={cancelEditing}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="rounded border border-border p-1 transition hover:bg-card"
                                      onClick={() => startEditing(aoIndex, loIndex, sc)}
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
                                  sc.units.map((unit) => {
                                    const meta = unitLookup.get(unit)
                                    const badgeClass = meta ? yearBadgeMap[meta.year] ?? "bg-primary/10 text-primary" : "bg-primary/10 text-primary"
                                    const yearLabel = meta ? `Y${meta.year}` : "Y?"
                                    return (
                                      <span
                                        key={unit}
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${badgeClass}`}
                                      >
                                        <span className="font-semibold">{yearLabel}</span>
                                        <span>{unit}</span>
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
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Output Column */}
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
                  placeholder="Filter visualization..."
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
                      const matchesYear =
                        yearFilterSet.size === 0 ||
                        item.units.some((unit) => {
                          const meta = unitLookup.get(unit)
                          return meta?.year !== undefined && yearFilterSet.has(meta.year)
                        })

                      const matchesText =
                        textFilter.length === 0 ||
                        item.description.toLowerCase().includes(textFilter) ||
                        item.aoTitle.toLowerCase().includes(textFilter) ||
                        item.loTitle.toLowerCase().includes(textFilter) ||
                        item.units.some((unit) => unit.toLowerCase().includes(textFilter))

                      return matchesYear && matchesText
                    })

                    if (filteredCriteria.length === 0) {
                      return null
                    }

                    const levelStyles = levelStyleMap[level] ?? levelStyleMap[1]

                    const groupedByAO = new Map<
                      string,
                      {
                        aoCode: string
                        aoTitle: string
                        items: (typeof filteredCriteria)[number][]
                      }
                    >()

                    filteredCriteria.forEach((item) => {
                      if (!groupedByAO.has(item.aoCode)) {
                        groupedByAO.set(item.aoCode, {
                          aoCode: item.aoCode,
                          aoTitle: item.aoTitle,
                          items: [],
                        })
                      }
                      groupedByAO.get(item.aoCode)?.items.push(item)
                    })

                    const groupedCriteria = Array.from(groupedByAO.values()).map((group) => ({
                      ...group,
                      items: group.items
                        .slice()
                        .sort((a, b) => a.description.localeCompare(b.description)),
                    }))

                    return (
                      <div key={level} className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                        <header className="flex items-center justify-between">
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold ${levelStyles.badge}`}
                          >
                            {`Level ${level}`}
                          </span>
                          <span className="text-xs text-muted-foreground">{filteredCriteria.length} criteria</span>
                        </header>

                        <div className="space-y-3">
                          {groupedCriteria.map((group) => (
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
                </div>
              </TabsContent>

              <TabsContent value="units" className="flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-4">
                  {unitsView.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No units associated with success criteria yet.</p>
                  ) : (
                    unitsView.map((unitGroup) => {
                      const matchesYearForGroup =
                        yearFilterSet.size === 0 ||
                        (unitGroup.year !== undefined && yearFilterSet.has(unitGroup.year))

                      if (!matchesYearForGroup) {
                        return null
                      }

                      const filteredEntries = unitGroup.entries.filter((entry) => {
                        const matchesLevel =
                          levelFilterSet.size === 0 || levelFilterSet.has(entry.level)

                        const matchesText =
                          textFilter.length === 0 ||
                          entry.description.toLowerCase().includes(textFilter) ||
                          entry.loTitle.toLowerCase().includes(textFilter) ||
                          entry.aoTitle.toLowerCase().includes(textFilter) ||
                          unitGroup.unitName.toLowerCase().includes(textFilter)

                        return matchesLevel && matchesText
                      })

                      if (filteredEntries.length === 0) {
                        return null
                      }
                      const badgeClass = unitGroup.year
                        ? yearBadgeMap[unitGroup.year] ?? "bg-primary/10 text-primary"
                        : "bg-primary/10 text-primary"
                      const yearLabel = unitGroup.year ? `Y${unitGroup.year}` : "Y?"

                      return (
                        <div key={unitGroup.unitName} className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                          <header className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold ${badgeClass}`}>
                                {yearLabel}
                              </span>
                              <h3 className="text-sm font-semibold text-foreground">{unitGroup.unitName}</h3>
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
                                <div key={`${unitGroup.unitName}-${index}`} className="rounded-lg border border-border bg-card p-3">
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
                    })
                  )}
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
      {unitPickerContext && activeCriterion && (
        <>
          <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setUnitPickerContext(null)} />
          <div
            className="fixed z-50 w-64 rounded-lg border border-border bg-background p-3 text-xs shadow-lg"
            style={{
              top: unitPickerContext.position.top,
              left: unitPickerContext.position.left,
            }}
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground">Associate Units</p>
              <button
                className="rounded border border-border p-1 text-muted-foreground transition hover:bg-muted"
                onClick={() => setUnitPickerContext(null)}
                aria-label="Close unit selector"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {availableUnits.map((unit) => {
                const checked = activeCriterion.units.includes(unit.name)
                const badgeClass = yearBadgeMap[unit.year] ?? "bg-primary/10 text-primary"
                return (
                  <label key={unit.name} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={checked}
                      onChange={() =>
                        toggleUnitForCriterion(
                          unitPickerContext.aoIndex,
                          unitPickerContext.loIndex,
                          unitPickerContext.criterionId,
                          unit.name,
                        )
                      }
                    />
                    <span className="inline-flex items-center gap-2 text-foreground">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                        {`Y${unit.year}`}
                      </span>
                      <span>{unit.name}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
