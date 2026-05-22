"use client"

import Image from "next/image"
import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { PublicLesson } from "@/lib/server-actions/lessons"
import type { LessonActivities } from "@/types"
import { readPublicLessonActivitiesAction } from "@/lib/server-updates"
import { SigninForm } from "@/components/signin"
import { PublicUnitCard } from "@/components/public/PublicUnitCard"
import { PublicLessonView } from "@/components/public/PublicLessonView"
import { Button } from "@/components/ui/button"
import Link from "next/link"

interface SelectedLesson {
  lessonId: string
  lessonTitle: string
  unitTitle: string
  curriculumTitle: string
  activities: LessonActivities
}

interface PublicLessonBrowserProps {
  lessons: PublicLesson[]
  returnTo?: string
}

export function PublicLessonBrowser({ lessons, returnTo }: PublicLessonBrowserProps) {
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [selectedLesson, setSelectedLesson] = useState<SelectedLesson | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const curricula = useMemo(() => {
    const map = new Map<string, string>()
    lessons.forEach((l) => map.set(l.curriculumId, l.curriculumTitle))
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }))
  }, [lessons])

  const filteredUnits = useMemo(() => {
    const filtered =
      activeFilter === "all"
        ? lessons
        : lessons.filter((l) => l.curriculumId === activeFilter)

    const unitMap = new Map<
      string,
      { unitId: string; unitTitle: string; curriculumTitle: string; unitDescription: string | null; lessons: PublicLesson[] }
    >()
    filtered.forEach((l) => {
      if (!unitMap.has(l.unitId)) {
        unitMap.set(l.unitId, {
          unitId: l.unitId,
          unitTitle: l.unitTitle,
          curriculumTitle: l.curriculumTitle,
          unitDescription: l.unitDescription ?? null,
          lessons: [],
        })
      }
      unitMap.get(l.unitId)!.lessons.push(l)
    })
    return Array.from(unitMap.values())
  }, [lessons, activeFilter])

  const handleSelectLesson = async (lesson: PublicLesson) => {
    setIsLoading(true)
    const result = await readPublicLessonActivitiesAction(lesson.lessonId)
    setIsLoading(false)
    if (result.data) {
      setSelectedLesson({
        lessonId: lesson.lessonId,
        lessonTitle: lesson.lessonTitle,
        unitTitle: lesson.unitTitle,
        curriculumTitle: lesson.curriculumTitle,
        activities: result.data,
      })
    } else {
      toast.error(result.error ?? "Failed to load lesson. Please try again.")
    }
  }

  const handleBack = () => setSelectedLesson(null)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border">
        {selectedLesson ? (
          /* State 2: inline lesson view */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-border px-6 py-4">
              <button
                type="button"
                onClick={handleBack}
                className="text-sm text-primary hover:underline"
              >
                ← Back to lessons
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <p className="mb-1 text-xs text-muted-foreground">
                {selectedLesson.curriculumTitle} › {selectedLesson.unitTitle}
              </p>
              <h2 className="mb-6 text-2xl font-bold text-foreground">
                {selectedLesson.lessonTitle}
              </h2>
              <PublicLessonView
                activities={selectedLesson.activities}
                lessonId={selectedLesson.lessonId}
              />
            </div>
          </div>
        ) : (
          /* State 1: hero + curriculum browser */
          <div className="flex flex-1 flex-col overflow-hidden">

            {/* Hero section — 50vh, does not scroll */}
            <div className="relative flex h-[50vh] flex-shrink-0 items-center overflow-hidden border-b border-border bg-amber-50 dark:bg-amber-950/20">
              {/* Text content */}
              <div className="relative z-10 flex h-full w-full flex-col justify-center px-10 sm:w-1/2">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
                  Design and Technology
                </p>
                <h1 className="text-3xl font-extrabold leading-tight text-foreground sm:text-4xl lg:text-5xl">
                  Explore our lessons —{" "}
                  <span className="italic text-amber-600 dark:text-amber-400">
                    one topic at a time.
                  </span>
                </h1>
                <p className="mt-4 max-w-sm text-base text-muted-foreground">
                  Browse public lessons from our curriculum. Sign in to attempt activities and track your progress.
                </p>
              </div>
              {/* Hero image — fills right half */}
              <div className="absolute bottom-0 right-0 hidden h-full w-1/2 sm:block">
                <Image
                  src="/hero-pupils.png"
                  alt="Students with subject crates"
                  fill
                  className="object-contain object-bottom drop-shadow-sm"
                  priority
                />
              </div>
            </div>

            {/* Filter chips — fixed, does not scroll */}
            {curricula.length > 0 && (
              <div className="flex-shrink-0 flex flex-wrap gap-2 border-b border-border px-6 py-3">
                <button
                  type="button"
                  onClick={() => setActiveFilter("all")}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    activeFilter === "all"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  All
                </button>
                {curricula.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveFilter(c.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      activeFilter === c.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            )}

            {/* Scrollable unit cards */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading lesson…
                </div>
              ) : filteredUnits.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No public lessons available yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredUnits.map((unit) => (
                    <PublicUnitCard
                      key={unit.unitId}
                      unitTitle={unit.unitTitle}
                      curriculumTitle={unit.curriculumTitle}
                      unitDescription={unit.unitDescription}
                      lessons={unit.lessons}
                      onSelectLesson={handleSelectLesson}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right panel — fixed width, never scrolls */}
      <div className="flex w-80 flex-shrink-0 flex-col justify-center gap-6 p-8">
        {selectedLesson ? (
          /* State 2 right: sign-in prompt */
          <div className="flex flex-col gap-4 text-center">
            <h3 className="text-lg font-bold text-foreground">Want to do more?</h3>
            <p className="text-sm text-muted-foreground">
              Sign in to attempt activities, track your progress, and access all lessons.
            </p>
            <Button asChild className="w-full">
              <Link href="/signin">Sign in →</Link>
            </Button>
          </div>
        ) : (
          /* State 1 right: full sign-in form */
          <>
            <div>
              <h2 className="text-xl font-bold text-foreground">Sign in to Dino</h2>
              <p className="text-sm text-muted-foreground">
                Enter your email and password to continue.
              </p>
            </div>
            <SigninForm returnTo={returnTo} />
          </>
        )}
      </div>
    </div>
  )
}
