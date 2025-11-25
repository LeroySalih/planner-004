"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, BookOpen, Search } from "lucide-react"

import type { Subjects, Unit } from "@/types"
import { truncateText } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { UnitCreateSidebar } from "@/components/units/unit-create-sidebar"

interface UnitsPageClientProps {
  units: Unit[]
  subjects: Subjects
  initialFilter: {
    search: string
    subject: string | null
    showInactive: boolean
  }
}

export function UnitsPageClient({ units, subjects, initialFilter }: UnitsPageClientProps) {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState(initialFilter.search)
  const [selectedSubject, setSelectedSubject] = useState<string | null>(initialFilter.subject)
  const [isCreateSidebarOpen, setIsCreateSidebarOpen] = useState(false)
  const [showInactive, setShowInactive] = useState(initialFilter.showInactive)

  const subjectOptions = useMemo(() => {
    const fromUnits = new Set(units.map((unit) => unit.subject))
    subjects.forEach((subject) => {
      if (subject.active !== false) {
        fromUnits.add(subject.subject)
      }
    })
    return Array.from(fromUnits).sort((a, b) => a.localeCompare(b))
  }, [subjects, units])

  const applyFilters = (nextSearch: string, nextSubject: string | null, includeInactive: boolean) => {
    setSearchTerm(nextSearch)
    setSelectedSubject(nextSubject)
    setShowInactive(includeInactive)

    const params = new URLSearchParams()
    if (nextSearch.trim()) params.set("q", nextSearch.trim())
    if (nextSubject) params.set("subject", nextSubject)
    if (includeInactive) params.set("inactive", "1")

    const query = params.toString()
    router.replace(query ? `/units?${query}` : "/units")
    router.refresh()
  }

  const handleCardClick = (unitId: string) => {
    router.push(`/units/${unitId}`)
  }

  return (
    <main className="container mx-auto p-6">
      <div className="mb-8 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/assignments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Assignments
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold text-balance">Units Overview</h1>
          </div>
          <div className="ml-auto">
            <Button onClick={() => setIsCreateSidebarOpen(true)}>+ Add Unit</Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-md">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by title, subject, or unit ID..."
                value={searchTerm}
                onChange={(event) => applyFilters(event.target.value, selectedSubject, showInactive)}
                className="pl-10"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Use &quot;?&quot; to match any single character.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={selectedSubject === null ? "default" : "outline"}
              size="sm"
              onClick={() => applyFilters(searchTerm, null, showInactive)}
            >
              All Subjects
            </Button>
            {subjectOptions.map((subjectOption) => (
              <Button
                key={subjectOption}
                variant={selectedSubject === subjectOption ? "default" : "outline"}
                size="sm"
                onClick={() => applyFilters(searchTerm, subjectOption, showInactive)}
              >
                {subjectOption}
              </Button>
            ))}
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <Switch
                id="show-inactive-switch"
                checked={showInactive}
                onCheckedChange={(checked) => applyFilters(searchTerm, selectedSubject, Boolean(checked))}
              />
              <Label htmlFor="show-inactive-switch" className="text-sm font-medium">
                Show inactive units
              </Label>
            </div>
          </div>
        </div>

        {(searchTerm || selectedSubject !== null || showInactive) && (
          <p className="text-sm text-muted-foreground">
            Showing {units.length} units
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {units.map((unit) => (
          <UnitCard key={unit.unit_id} unit={unit} onClick={handleCardClick} />
        ))}
      </div>

      {units.length === 0 && (
        <div className="py-12 text-center">
          <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">No units found</h3>
          <p className="text-muted-foreground">Try adjusting your search or subject filters.</p>
        </div>
      )}

      <UnitCreateSidebar
        isOpen={isCreateSidebarOpen}
        onClose={() => setIsCreateSidebarOpen(false)}
        subjects={subjects}
        onCreate={(newUnit) => {
          setIsCreateSidebarOpen(false)
          router.refresh()
        }}
      />
    </main>
  )
}

function UnitCard({ unit, onClick }: { unit: Unit; onClick: (unitId: string) => void }) {
  const isActive = unit.active ?? true
  const statusClassName = isActive
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-rose-100 text-rose-700 border-rose-200"
  const descriptionSnippet = unit.description
    ? truncateText(unit.description, 250)
    : "No description provided yet."

  return (
    <Card className="cursor-pointer transition hover:border-primary" onClick={() => onClick(unit.unit_id)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg font-semibold text-balance">{unit.title}</CardTitle>
          <Badge variant="outline" className="shrink-0">
            {unit.subject}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          <span>Unit ID: {unit.unit_id}</span>
        </div>
        <p className="text-sm text-muted-foreground">{descriptionSnippet}</p>
        <Badge variant="outline" className={statusClassName}>
          {isActive ? "Active" : "Inactive"}
        </Badge>
      </CardContent>
    </Card>
  )
}
