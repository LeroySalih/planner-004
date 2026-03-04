"use client"

import { useRouter } from "next/navigation"
import { useMemo } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FlashcardSession } from "@/components/flashcards/flashcard-session"

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yyyy = d.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}

function isWithin30Days(iso: string): boolean {
  const diffMs = Date.now() - new Date(iso).getTime()
  return diffMs < 30 * 24 * 60 * 60 * 1000
}

type FlashCard = {
  sentence: string
  answer: string
  template: string
}

type FlashcardActivity = {
  activityId: string
  activityTitle: string
  lessonId: string
  lessonTitle: string
  lastSession?: {
    completedAt: string
    score: number
  }
}

type Unit = {
  unitId: string
  unitTitle: string
  lessons: {
    lessonId: string
    lessonTitle: string
    lessonOrder: number | null
    startDate: string | null
  }[]
}

type Subject = {
  subject: string | null
  units: Unit[]
}

type Deck = {
  activityId: string
  activityTitle: string
  lessonTitle: string
  cards: FlashCard[]
}

type FlashcardsShellProps = {
  subjects: Subject[]
  flashcardActivities: FlashcardActivity[]
  selectedUnitId: string | null
  selectedActivityId: string | null
  deck: Deck | null
  pupilId: string
}

export function FlashcardsShell({
  subjects,
  flashcardActivities,
  selectedUnitId,
  selectedActivityId,
  deck,
  pupilId,
}: FlashcardsShellProps) {
  const router = useRouter()

  const activitySet = useMemo(
    () => new Set(flashcardActivities.map((a) => a.activityId)),
    [flashcardActivities],
  )

  const allUnits = useMemo(() => {
    const units: Unit[] = []
    for (const subject of subjects) {
      for (const unit of subject.units) {
        units.push(unit)
      }
    }
    return units
  }, [subjects])

  const activeUnit = useMemo(() => {
    if (selectedUnitId) {
      return allUnits.find((u) => u.unitId === selectedUnitId) ?? allUnits[0] ?? null
    }
    return allUnits[0] ?? null
  }, [allUnits, selectedUnitId])

  // Group activities by lesson for sidebar display
  const activitiesByLesson = useMemo(() => {
    if (!activeUnit) return new Map<string, FlashcardActivity[]>()
    const lessonIds = new Set(activeUnit.lessons.map((l) => l.lessonId))
    const map = new Map<string, FlashcardActivity[]>()
    for (const activity of flashcardActivities) {
      if (!lessonIds.has(activity.lessonId)) continue
      const arr = map.get(activity.lessonId) ?? []
      arr.push(activity)
      map.set(activity.lessonId, arr)
    }
    return map
  }, [activeUnit, flashcardActivities])

  const handleUnitChange = (unitId: string) => {
    router.push(`/flashcards?unitId=${encodeURIComponent(unitId)}`)
  }

  const handleActivityClick = (activityId: string) => {
    if (!activeUnit) return
    router.push(
      `/flashcards?unitId=${encodeURIComponent(activeUnit.unitId)}&activityId=${encodeURIComponent(activityId)}`,
    )
  }

  if (allUnits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">No units assigned yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Flashcards</h1>
        <p className="text-sm text-muted-foreground">
          Fill in the missing word to practise key vocabulary
        </p>
      </header>

      <div className="flex items-center gap-3">
        <label htmlFor="unit-select" className="text-sm font-medium whitespace-nowrap">
          Unit:
        </label>
        <Select
          value={activeUnit?.unitId ?? ""}
          onValueChange={handleUnitChange}
        >
          <SelectTrigger id="unit-select" className="w-full max-w-md">
            <SelectValue placeholder="Select a unit" />
          </SelectTrigger>
          <SelectContent>
            {allUnits.map((unit) => (
              <SelectItem key={unit.unitId} value={unit.unitId}>
                {unit.unitTitle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
        {/* Activity sidebar grouped by lesson */}
        <nav className="flex flex-col gap-1">
          {activeUnit?.lessons.map((lesson) => {
            const activities = activitiesByLesson.get(lesson.lessonId)
            if (!activities || activities.length === 0) {
              return (
                <div
                  key={lesson.lessonId}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground/50"
                >
                  {lesson.lessonTitle}
                </div>
              )
            }

            return (
              <div key={lesson.lessonId} className="flex flex-col gap-0.5">
                <h3 className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {lesson.lessonTitle}
                </h3>
                {activities.map((activity) => {
                  const isSelected = activity.activityId === selectedActivityId
                  return (
                    <Button
                      key={activity.activityId}
                      variant={isSelected ? "secondary" : "ghost"}
                      className={cn(
                        "justify-start text-left h-auto py-2 pl-5 flex-col items-start gap-1",
                        isSelected && "font-medium",
                      )}
                      onClick={() => handleActivityClick(activity.activityId)}
                    >
                      <span>{activity.activityTitle}</span>
                      {activity.lastSession && (
                        <span className="flex gap-1.5">
                          <span
                            className={cn(
                              "text-xs rounded-full px-2 py-0.5 font-normal",
                              isWithin30Days(activity.lastSession.completedAt)
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800",
                            )}
                          >
                            {formatDate(activity.lastSession.completedAt)}
                          </span>
                          <span
                            className={cn(
                              "text-xs rounded-full px-2 py-0.5 font-normal",
                              activity.lastSession.score > 0.8
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800",
                            )}
                          >
                            {Math.round(activity.lastSession.score * 100)}%
                          </span>
                        </span>
                      )}
                    </Button>
                  )
                })}
              </div>
            )
          })}
          {activeUnit && activeUnit.lessons.length === 0 && (
            <p className="text-sm text-muted-foreground">No lessons in this unit.</p>
          )}
        </nav>

        {/* Main area */}
        <div className="min-h-[400px]">
          {!selectedActivityId && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                Select a flashcard activity to start practising
              </p>
            </div>
          )}

          {selectedActivityId && deck && deck.cards.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                No flashcard sentences found for this activity.
              </p>
            </div>
          )}

          {selectedActivityId && deck && deck.cards.length > 0 && (
            <FlashcardSession
              key={deck.activityId}
              deck={deck}
              pupilId={pupilId}
            />
          )}

          {selectedActivityId && !deck && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                No flashcard sentences found for this activity.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
