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

type Lesson = {
  lessonId: string
  lessonTitle: string
  lessonOrder: number | null
  startDate: string | null
}

type Unit = {
  unitId: string
  unitTitle: string
  lessons: Lesson[]
}

type Subject = {
  subject: string | null
  units: Unit[]
}

type KeyTerm = {
  term: string
  definition: string
}

type Deck = {
  lessonId: string
  lessonTitle: string
  terms: KeyTerm[]
}

type FlashcardsShellProps = {
  subjects: Subject[]
  lessonsWithKeyTerms: string[]
  selectedUnitId: string | null
  selectedLessonId: string | null
  deck: Deck | null
  pupilId: string
}

export function FlashcardsShell({
  subjects,
  lessonsWithKeyTerms,
  selectedUnitId,
  selectedLessonId,
  deck,
  pupilId,
}: FlashcardsShellProps) {
  const router = useRouter()

  const keyTermsSet = useMemo(
    () => new Set(lessonsWithKeyTerms),
    [lessonsWithKeyTerms],
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

  const handleUnitChange = (unitId: string) => {
    router.push(`/flashcards?unitId=${encodeURIComponent(unitId)}`)
  }

  const handleLessonClick = (lessonId: string) => {
    if (!activeUnit) return
    router.push(
      `/flashcards?unitId=${encodeURIComponent(activeUnit.unitId)}&lessonId=${encodeURIComponent(lessonId)}`,
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
          Practise key terminology from your lessons
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
        {/* Lesson sidebar */}
        <nav className="flex flex-col gap-1">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Lessons
          </h2>
          {activeUnit?.lessons.map((lesson) => {
            const hasKeyTerms = keyTermsSet.has(lesson.lessonId)
            const isSelected = lesson.lessonId === selectedLessonId

            if (!hasKeyTerms) {
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
              <Button
                key={lesson.lessonId}
                variant={isSelected ? "secondary" : "ghost"}
                className={cn(
                  "justify-start text-left h-auto py-2",
                  isSelected && "font-medium",
                )}
                onClick={() => handleLessonClick(lesson.lessonId)}
              >
                {lesson.lessonTitle}
              </Button>
            )
          })}
          {activeUnit && activeUnit.lessons.length === 0 && (
            <p className="text-sm text-muted-foreground">No lessons in this unit.</p>
          )}
        </nav>

        {/* Main area */}
        <div className="min-h-[400px]">
          {!selectedLessonId && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                Select a lesson to start practising flashcards
              </p>
            </div>
          )}

          {selectedLessonId && deck && deck.terms.length < 4 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                This lesson needs at least 4 key terms to run a flashcard session
                (currently {deck.terms.length}).
              </p>
            </div>
          )}

          {selectedLessonId && deck && deck.terms.length >= 4 && (
            <FlashcardSession
              key={deck.lessonId}
              deck={deck}
              pupilId={pupilId}
            />
          )}

          {selectedLessonId && !deck && (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                No key terms found for this lesson.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
