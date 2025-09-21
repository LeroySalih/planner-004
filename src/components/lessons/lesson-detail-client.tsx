"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, BookOpen, LinkIcon, Target, Upload } from "lucide-react"

import type {
  LearningObjectiveWithCriteria,
  LessonWithObjectives,
} from "@/lib/server-updates"
import type { Unit } from "@/types"
import { LessonFilesManager } from "@/components/lessons/lesson-files-manager"
import { LessonLinksManager } from "@/components/lessons/lesson-links-manager"
import { LessonObjectivesSidebar } from "@/components/lessons/lesson-objectives-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface LessonDetailClientProps {
  lesson: LessonWithObjectives
  unit: Unit | null
  learningObjectives: LearningObjectiveWithCriteria[]
  lessonFiles: { name: string; path: string; created_at?: string; updated_at?: string; size?: number }[]
}

export function LessonDetailClient({ lesson, unit, learningObjectives, lessonFiles }: LessonDetailClientProps) {
  const router = useRouter()
  const [currentLesson, setCurrentLesson] = useState<LessonWithObjectives>(lesson)
  const [isObjectivesSidebarOpen, setIsObjectivesSidebarOpen] = useState(false)

  const isActive = currentLesson.active !== false

  const handleLessonUpdated = (updated: LessonWithObjectives) => {
    setCurrentLesson(updated)
    router.refresh()
  }

  return (
    <>
      <main className="container mx-auto flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/lessons">
            <Badge variant="outline" className="flex items-center gap-2 px-3 py-1">
              <ArrowLeft className="h-4 w-4" /> Back to Lessons
            </Badge>
          </Link>
          {unit && (
            <Link href={`/units/${unit.unit_id}`} className="text-sm text-primary underline-offset-2 hover:underline">
              View parent unit
            </Link>
          )}
        </div>

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
                        <ul className="space-y-2 rounded-md bg-muted/30 p-3 text-sm text-muted-foreground">
                          {objective.learning_objective.success_criteria.map((criterion) => (
                            <li key={criterion.success_criteria_id} className="list-disc pl-4 marker:text-primary">
                              {criterion.title}
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
