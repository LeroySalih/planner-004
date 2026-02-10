'use client'

import { useEffect, useState } from 'react'
import { getClassProgressAction } from './actions'

type ClassProgressViewProps = {
  groupId: string
}

type UnitProgress = {
  unitId: string
  unitTitle: string
  unitSubject: string | null
  pupilCount: number
  avgScore: number | null
}

function formatPercent(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

function getMetricColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'bg-muted'
  }
  const percent = value * 100
  if (percent < 40) {
    return 'bg-red-100 dark:bg-red-900/30'
  } else if (percent < 70) {
    return 'bg-amber-100 dark:bg-amber-900/30'
  } else {
    return 'bg-green-100 dark:bg-green-900/30'
  }
}

export function ClassProgressView({ groupId }: ClassProgressViewProps) {
  const [loading, setLoading] = useState(true)
  const [units, setUnits] = useState<UnitProgress[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await getClassProgressAction(groupId)
        setUnits(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load class progress')
      } finally {
        setLoading(false)
      }
    }

    void loadData()
  }, [groupId])

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Loading class progress...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-destructive">Error: {error}</p>
      </div>
    )
  }

  if (units.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          No units have been assigned to this class yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Assigned Units</h2>
        <span className="text-sm text-muted-foreground">
          {units[0]?.pupilCount ?? 0} pupils in class
        </span>
      </div>

      <div className="space-y-3">
        {units.map((unit) => (
          <div
            key={unit.unitId}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex-1">
              <h3 className="font-medium text-foreground">{unit.unitTitle}</h3>
              {unit.unitSubject && (
                <p className="text-sm text-muted-foreground">{unit.unitSubject}</p>
              )}
            </div>

            <div className="flex flex-shrink-0 gap-3">
              <div className={`rounded-md px-3 py-2 text-center ${getMetricColor(unit.avgScore)}`}>
                <div className="text-lg font-semibold text-foreground">
                  {formatPercent(unit.avgScore)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Score
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
