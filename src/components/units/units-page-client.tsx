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
import { UnitCreateSidebar } from "@/components/units/unit-create-sidebar"

interface UnitsPageClientProps {
  units: Unit[]
  subjects: Subjects
}

export function UnitsPageClient({ units, subjects }: UnitsPageClientProps) {
  const router = useRouter()
  const [allUnits, setAllUnits] = useState<Unit[]>(units)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const [isCreateSidebarOpen, setIsCreateSidebarOpen] = useState(false)

  const subjectOptions = useMemo(() => {
    const fromUnits = new Set(allUnits.map((unit) => unit.subject))
    subjects.forEach((subject) => fromUnits.add(subject.subject))
    return Array.from(fromUnits).sort((a, b) => a.localeCompare(b))
  }, [subjects, allUnits])

  const filteredUnits = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    return allUnits.filter((unit) => {
      const matchesSubject = !selectedSubject || unit.subject === selectedSubject
      const matchesSearch =
        !term ||
        unit.title.toLowerCase().includes(term) ||
        unit.subject.toLowerCase().includes(term) ||
        unit.unit_id.toLowerCase().includes(term)
      return matchesSubject && matchesSearch
    })
  }, [allUnits, searchTerm, selectedSubject])

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
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by title, subject, or unit ID..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="pl-10"
            />
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
          </div>
        </div>

        {searchTerm && (
          <p className="text-sm text-muted-foreground">
            Showing {filteredUnits.length} of {allUnits.length} units
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredUnits.map((unit) => (
          <UnitCard key={unit.unit_id} unit={unit} onClick={handleCardClick} />
        ))}
      </div>

      {filteredUnits.length === 0 && (
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
          setAllUnits((prev) => [...prev, newUnit])
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
