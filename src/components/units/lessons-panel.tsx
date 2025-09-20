"use client"

import { useState } from "react"
import { BookOpen, Plus } from "lucide-react"

import type { Lesson } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LessonSidebar } from "@/components/units/lesson-sidebar"

interface LessonsPanelProps {
  unitId: string
  initialLessons: Lesson[]
}

export function LessonsPanel({ unitId, initialLessons }: LessonsPanelProps) {
  const [lessons, setLessons] = useState(initialLessons)
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const openCreateSidebar = () => {
    setSelectedLesson(null)
    setIsSidebarOpen(true)
  }

  const openEditSidebar = (lesson: Lesson) => {
    setSelectedLesson(lesson)
    setIsSidebarOpen(true)
  }

  const upsertLesson = (lesson: Lesson) => {
    setLessons((prev) => {
      const existingIndex = prev.findIndex((item) => item.lesson_id === lesson.lesson_id)
      if (existingIndex !== -1) {
        const next = [...prev]
        next[existingIndex] = lesson
        return next
      }
      return [...prev, lesson].sort((a, b) => a.title.localeCompare(b.title))
    })
  }

  const deactivateLesson = (lessonId: string) => {
    setLessons((prev) =>
      prev.map((lesson) =>
        lesson.lesson_id === lessonId ? { ...lesson, active: false } : lesson,
      ),
    )
  }

  const activeLessons = lessons.filter((lesson) => lesson.active !== false)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <BookOpen className="h-5 w-5 text-primary" />
            Lessons
          </CardTitle>
          <CardDescription>Only active lessons appear in this list.</CardDescription>
        </div>
        <Button size="sm" onClick={openCreateSidebar}>
          <Plus className="mr-2 h-4 w-4" />
          Add Lesson
        </Button>
      </CardHeader>
      <CardContent>
        {activeLessons.length > 0 ? (
          <div className="space-y-3">
            {activeLessons.map((lesson) => (
              <button
                key={lesson.lesson_id}
                type="button"
                onClick={() => openEditSidebar(lesson)}
                className="w-full rounded-lg border border-border p-4 text-left transition hover:border-primary"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{lesson.title}</span>
                  <Badge variant="outline" className="text-xs">
                    {lesson.active === false ? "Inactive" : "Active"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Click to edit or deactivate this lesson.
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No active lessons yet. Click “Add Lesson” to create the first one.
          </div>
        )}
      </CardContent>

      <LessonSidebar
        unitId={unitId}
        lesson={selectedLesson}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onCreateOrUpdate={upsertLesson}
        onDeactivate={deactivateLesson}
      />
    </Card>
  )
}
