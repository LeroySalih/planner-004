"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, Check, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  keepUnitCurriculumAction,
  type MultiCurriculumUnit,
} from "@/lib/server-actions/unit-curricula-admin"

export function UnitCurriculaAdmin({ initialUnits }: { initialUnits: MultiCurriculumUnit[] }) {
  const [units, setUnits] = useState<MultiCurriculumUnit[]>(initialUnits)
  const [pending, setPending] = useState<string | null>(null) // `${unitId}:${curriculumId}`

  const keep = async (unit: MultiCurriculumUnit, keepCurriculumId: string, keepTitle: string) => {
    const others = unit.curricula.filter((c) => c.curriculumId !== keepCurriculumId)
    const confirmed = window.confirm(
      `Keep "${keepTitle}" for "${unit.unitTitle}"?\n\n` +
        `This removes the LOs and success criteria of ${others.length} other curriculum/curricula ` +
        `from the unit and from its lessons and activities. Pupil feedback is not deleted. This cannot be undone.`,
    )
    if (!confirmed) return

    const key = `${unit.unitId}:${keepCurriculumId}`
    setPending(key)
    try {
      const res = await keepUnitCurriculumAction({ unitId: unit.unitId, keepCurriculumId })
      if (!res.success) {
        toast.error("Couldn't apply", { description: res.error ?? "Please try again." })
        return
      }
      toast.success(`Kept "${keepTitle}"`, { description: `Removed ${res.removedLinks} link(s) from other curricula.` })
      setUnits((prev) => prev.filter((u) => u.unitId !== unit.unitId))
    } catch (err) {
      toast.error("Couldn't apply", { description: err instanceof Error ? err.message : "Please try again." })
    } finally {
      setPending(null)
    }
  }

  if (units.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Check className="h-5 w-5 text-pa-green" />
          No units span more than one curriculum. Nothing to remediate.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        {units.length} unit(s) reference more than one curriculum. Choose the single curriculum to keep for each — the
        others&apos; LOs and success criteria will be removed from the unit, its lessons and its activities.
      </p>

      {units.map((unit) => (
        <Card key={unit.unitId}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              <Link href={`/units/${unit.unitId}`} className="hover:underline">
                {unit.unitTitle}
              </Link>
              <span className="ml-2 text-xs font-normal text-muted-foreground">{unit.unitId}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unit.curricula.map((c) => {
              const key = `${unit.unitId}:${c.curriculumId}`
              return (
                <div
                  key={c.curriculumId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{c.curriculumTitle}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.loCount} learning objective(s) · {c.scCount} success criterion/criteria
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={pending !== null}
                    onClick={() => keep(unit, c.curriculumId, c.curriculumTitle)}
                  >
                    {pending === key ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    Keep this one
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
