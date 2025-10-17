"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, BookOpen, LinkIcon, List, Target, Upload } from "lucide-react"

import type {
  LearningObjectiveWithCriteria,
  LessonWithObjectives,
} from "@/lib/server-updates"
import type { LessonActivity, Unit } from "@/types"
import { LessonFilesManager } from "@/components/lessons/lesson-files-manager"
import { LessonLinksManager } from "@/components/lessons/lesson-links-manager"
import { LessonActivitiesManager } from "@/components/lessons/lesson-activities-manager"
import { LessonObjectivesSidebar } from "@/components/lessons/lesson-objectives-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface LessonNavLink {
  lesson_id: string
  title: string
}

interface LessonDetailClientProps {
  lesson: LessonWithObjectives
  unit: Unit | null
  learningObjectives: LearningObjectiveWithCriteria[]
  lessonFiles: { name: string; path: string; created_at?: string; updated_at?: string; size?: number }[]
  lessonActivities: LessonActivity[]
  previousLesson: LessonNavLink | null
  nextLesson: LessonNavLink | null
}

export function LessonDetailClient({
  lesson,
  unit,
  learningObjectives,
  lessonFiles,
  lessonActivities,
  previousLesson,
  nextLesson,
}: LessonDetailClientProps) {
  const router = useRouter()
  const [currentLesson, setCurrentLesson] = useState<LessonWithObjectives>(lesson)
  const [isObjectivesSidebarOpen, setIsObjectivesSidebarOpen] = useState(false)

  const isActive = currentLesson.active !== false

  const lessonSuccessCriteria = useMemo(() => {
    return (currentLesson.lesson_success_criteria ?? []).map((criterion) => {
      const learningObjective = currentLesson.lesson_objectives.find(
        (objective) => objective.learning_objective_id === (criterion.learning_objective_id ?? ""),
      )

      return {
        successCriteriaId: criterion.success_criteria_id,
        title: criterion.title,
        learningObjectiveId: criterion.learning_objective_id ?? null,
        learningObjectiveTitle: learningObjective?.learning_objective?.title ?? learningObjective?.title ?? null,
      }
    })
  }, [currentLesson.lesson_objectives, currentLesson.lesson_success_criteria])

  const handleLessonUpdated = (updated: LessonWithObjectives) => {
    setCurrentLesson(updated)
    router.refresh()
  }

  return (
    <>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <div>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link href="/lessons">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Lessons
            </Link>
          </Button>
        </div>

        <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs uppercase tracking-wide text-slate-300">Unit</span>
                <Link
                  href={unit ? `/units/${unit.unit_id}` : `/units/${currentLesson.unit_id}`}
                  className="text-xl font-semibold text-white underline-offset-4 transition hover:text-slate-200 hover:underline"
                >
                  {unit?.title ?? currentLesson.unit_id}
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {previousLesson ? (
                  <Link
                    href={`/lessons/${previousLesson.lesson_id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-white/20 px-3 py-1 text-slate-100 transition hover:bg-white/10"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="font-medium">{previousLesson.title}</span>
                  </Link>
                ) : null}
                {nextLesson ? (
                  <Link
                    href={`/lessons/${nextLesson.lesson_id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-white/20 px-3 py-1 text-slate-100 transition hover:bg-white/10"
                  >
                    <span className="font-medium">{nextLesson.title}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold text-white">{currentLesson.title}</h1>
              <p className="text-sm text-slate-200">Lesson overview</p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-3xl font-bold">{currentLesson.title}</CardTitle>
              <p className="text-sm text-muted-foreground">Lesson ID: {currentLesson.lesson_id}</p>
            </div>
            <Badge
              variant="outline"
              className={isActive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}
            >
              {isActive ? "Active" : "Inactive"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                <span>Unit: {unit?.title ?? currentLesson.unit_id}</span>
              </div>
              {unit?.subject && <Badge variant="secondary">{unit.subject}</Badge>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold">
              <Target className="h-5 w-5 text-primary" />
              Learning Objectives
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setIsObjectivesSidebarOpen(true)}>
              Edit Objectives
            </Button>
          </CardHeader>
          <CardContent>
            {currentLesson.lesson_objectives.length > 0 ? (
              <ul className="space-y-3">
                {currentLesson.lesson_objectives.map((objective) => (
                  <li key={objective.learning_objective_id} className="space-y-2 rounded-md border border-border p-3">
                    <div className="font-medium">
                      {objective.learning_objective?.title ?? objective.title}
                    </div>
                    {objective.learning_objective?.success_criteria &&
                      objective.learning_objective.success_criteria.length > 0 && (
                        <ul className="space-y-2 list-disc pl-6 text-sm text-muted-foreground">
                          {objective.learning_objective.success_criteria.map((criterion) => (
                            <li key={criterion.success_criteria_id}>
                              <span className="font-semibold text-primary">Level {criterion.level}:</span>{" "}
                              <span className="text-foreground">{criterion.description}</span>
                              {criterion.active === false ? (
                                <Badge variant="destructive" className="ml-2 text-xs">
                                  Inactive
                                </Badge>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No learning objectives are linked to this lesson yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold">
              <List className="h-5 w-5 text-primary" />
              Lesson Activities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LessonActivitiesManager
              unitId={unit?.unit_id ?? currentLesson.unit_id}
              lessonId={currentLesson.lesson_id}
              initialActivities={lessonActivities}
              availableSuccessCriteria={lessonSuccessCriteria}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <LinkIcon className="h-5 w-5 text-primary" />
                Lesson Links
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LessonLinksManager
                unitId={unit?.unit_id ?? currentLesson.unit_id}
                lessonId={currentLesson.lesson_id}
                initialLinks={currentLesson.lesson_links ?? []}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <Upload className="h-5 w-5 text-primary" />
                Lesson Files
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LessonFilesManager
                unitId={unit?.unit_id ?? currentLesson.unit_id}
                lessonId={currentLesson.lesson_id}
                initialFiles={lessonFiles}
              />
            </CardContent>
          </Card>
        </div>
      </main>

      <LessonObjectivesSidebar
        unitId={unit?.unit_id ?? currentLesson.unit_id}
        lesson={currentLesson}
        learningObjectives={learningObjectives}
        isOpen={isObjectivesSidebarOpen}
        onClose={() => setIsObjectivesSidebarOpen(false)}
        onUpdate={handleLessonUpdated}
      />
    </>
  )
}
