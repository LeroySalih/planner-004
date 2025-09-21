"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, BookOpen, Layers, Search } from "lucide-react"

import type { LessonWithObjectives, Subjects, Unit } from "@/types"
import { createWildcardRegExp } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

interface LessonsPageClientProps {
  lessons: LessonWithObjectives[]
  units: Unit[]
  subjects: Subjects
}

export function LessonsPageClient({ lessons, units, subjects }: LessonsPageClientProps) {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const unitsById = useMemo(() => {
    const map = new Map<string, Unit>()
    units.forEach((unit) => {
      map.set(unit.unit_id, unit)
    })
    return map
  }, [units])

  const subjectOptions = useMemo(() => {
    const set = new Set<string>()
    units.forEach((unit) => set.add(unit.subject))
    subjects.forEach((item) => set.add(item.subject))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [subjects, units])

  const filteredLessons = useMemo(() => {
    const term = searchTerm.trim()
    const searchRegex = term ? createWildcardRegExp(term) : null

    return lessons.filter((lesson) => {
      const unit = unitsById.get(lesson.unit_id)
      const subject = unit?.subject ?? ""

      const matchesSubject = !selectedSubject || subject === selectedSubject
      const matchesActivity = showInactive || lesson.active !== false

      if (!searchRegex) {
        return matchesSubject && matchesActivity
      }

      const matchesSearch =
        searchRegex.test(lesson.title) ||
        searchRegex.test(lesson.lesson_id) ||
        (unit ? searchRegex.test(unit.title) || searchRegex.test(unit.subject) : false)

      return matchesSubject && matchesActivity && matchesSearch
    })
  }, [lessons, searchTerm, selectedSubject, showInactive, unitsById])

  const handleLessonClick = (lessonId: string) => {
    router.push(`/lessons/${lessonId}`)
  }

  return (
    <main className="container mx-auto p-6">
      <div className="mb-8 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/units">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Units
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold text-balance">Lessons Overview</h1>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-md">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by lesson, unit, or subject..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="pl-10"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Use &quot;?&quot; to match any single character.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={selectedSubject === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedSubject(null)}
            >
              All Subjects
            </Button>
            {subjectOptions.map((subjectOption) => (
              <Button
                key={subjectOption}
                variant={selectedSubject === subjectOption ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedSubject(subjectOption)}
              >
                {subjectOption}
              </Button>
            ))}
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <Switch
                id="lessons-show-inactive"
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(Boolean(checked))}
              />
              <Label htmlFor="lessons-show-inactive" className="text-sm font-medium">
                Show inactive lessons
              </Label>
            </div>
          </div>
        </div>

        {(searchTerm || selectedSubject !== null || showInactive) && (
          <p className="text-sm text-muted-foreground">
            Showing {filteredLessons.length} of {lessons.length} lessons
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredLessons.map((lesson) => (
          <LessonCard
            key={lesson.lesson_id}
            lesson={lesson}
            unit={unitsById.get(lesson.unit_id) ?? null}
            onClick={handleLessonClick}
          />
        ))}
      </div>

      {filteredLessons.length === 0 && (
        <div className="py-12 text-center">
          <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">No lessons found</h3>
          <p className="text-muted-foreground">Try adjusting your search or subject filters.</p>
        </div>
      )}
    </main>
  )
}

function LessonCard({
  lesson,
  unit,
  onClick,
}: {
  lesson: LessonWithObjectives
  unit: Unit | null
  onClick: (lessonId: string) => void
}) {
  const isActive = lesson.active !== false
  const statusClassName = isActive
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-rose-100 text-rose-700 border-rose-200"

  return (
    <Card className="cursor-pointer transition hover:border-primary" onClick={() => onClick(lesson.lesson_id)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg font-semibold text-balance">{lesson.title}</CardTitle>
          <Badge variant="outline" className="shrink-0">
            {unit?.subject ?? "Unknown"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers className="h-4 w-4" />
          <span>Unit: {unit?.title ?? lesson.unit_id}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {lesson.lesson_objectives.length} objective{lesson.lesson_objectives.length === 1 ? "" : "s"}
        </div>
        <Badge variant="outline" className={statusClassName}>
          {isActive ? "Active" : "Inactive"}
        </Badge>
      </CardContent>
    </Card>
  )
}
