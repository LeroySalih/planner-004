"use client"

import { useState } from "react"
import Link from "next/link"
import { initialData } from "@/data/sample-data"
import type { Unit } from "@/types/assignment"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Search, BookOpen } from "lucide-react"

export default function UnitsPage() {
  console.log("[v0] Units page is rendering")
  console.log("[v0] Available units:", initialData.units.length)

  const [searchTerm, setSearchTerm] = useState("")
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)

  // Filter units based on search term and selected subject
  const filteredUnits = initialData.units.filter((unit) => {
    const matchesSearch =
      unit.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      unit.subject.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesSubject = !selectedSubject || unit.subject === selectedSubject
    return matchesSearch && matchesSubject
  })

  // Get unique subjects for filtering
  const subjects = Array.from(new Set(initialData.units.map((unit) => unit.subject)))

  // Get subject color based on subject name
  const getSubjectColor = (subject: string) => {
    switch (subject) {
      case "Mathematics":
        return "bg-blue-100 text-blue-800 border-blue-200"
      case "Science":
        return "bg-green-100 text-green-800 border-green-200"
      case "History":
        return "bg-amber-100 text-amber-800 border-amber-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  return (
    <main className="container mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Assignments
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold text-balance">Units Overview</h1>
          </div>
        </div>

        {/* Search and Filter Section */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search units by title or subject..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedSubject === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedSubject(null)}
            >
              All Subjects
            </Button>
            {subjects.map((subject) => (
              <Button
                key={subject}
                variant={selectedSubject === subject ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedSubject(subject)}
              >
                {subject}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUnits.map((unit) => (
          <UnitCard key={unit.unit_id} unit={unit} getSubjectColor={getSubjectColor} />
        ))}
      </div>

      {filteredUnits.length === 0 && (
        <div className="text-center py-12">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No units found</h3>
          <p className="text-muted-foreground">Try adjusting your search terms or filters.</p>
        </div>
      )}
    </main>
  )
}

function UnitCard({
  unit,
  getSubjectColor,
}: {
  unit: Unit
  getSubjectColor: (subject: string) => string
}) {
  const handleCardClick = () => {
    // Navigate to individual unit page (placeholder for now)
    console.log(`[v0] Navigating to unit: ${unit.unit_id}`)
    // In a real app, this would navigate to /units/[unit_id]
  }

  return (
    <Card className="cursor-pointer" onClick={handleCardClick}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg font-semibold text-balance">{unit.title}</CardTitle>
          <Badge variant="outline" className={`${getSubjectColor(unit.subject)} shrink-0`}>
            {unit.subject}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          <span>Unit ID: {unit.unit_id}</span>
        </div>
        <p className="text-sm text-muted-foreground mt-2">Click to view detailed unit information and assignments.</p>
      </CardContent>
    </Card>
  )
}
