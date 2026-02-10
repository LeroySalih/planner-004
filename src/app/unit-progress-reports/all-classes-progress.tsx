'use client'

import { useEffect, useState } from 'react'
import { getClassProgressAction } from './actions'

type Group = {
  groupId: string
  subject: string
  joinCode: string
}

type AllClassesProgressProps = {
  groups: Group[]
}

type UnitProgress = {
  unitId: string
  unitTitle: string
  unitSubject: string | null
  pupilCount: number
  avgScore: number | null
}

type ClassProgress = {
  groupId: string
  subject: string
  units: UnitProgress[]
  loading: boolean
  error: string | null
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

export function AllClassesProgress({ groups }: AllClassesProgressProps) {
  const [classProgress, setClassProgress] = useState<Map<string, ClassProgress>>(
    new Map(
      groups.map((g) => [
        g.groupId,
        {
          groupId: g.groupId,
          subject: g.subject,
          units: [],
          loading: true,
          error: null,
        },
      ])
    )
  )

  useEffect(() => {
    const loadAllClasses = async () => {
      for (const group of groups) {
        try {
          const units = await getClassProgressAction(group.groupId)
          setClassProgress((prev) => {
            const next = new Map(prev)
            next.set(group.groupId, {
              groupId: group.groupId,
              subject: group.subject,
              units,
              loading: false,
              error: null,
            })
            return next
          })
        } catch (err) {
          setClassProgress((prev) => {
            const next = new Map(prev)
            next.set(group.groupId, {
              groupId: group.groupId,
              subject: group.subject,
              units: [],
              loading: false,
              error: err instanceof Error ? err.message : 'Failed to load',
            })
            return next
          })
        }
      }
    }

    void loadAllClasses()
  }, [groups])

  return (
    <div className="space-y-8">
      {groups.map((group) => {
        const progress = classProgress.get(group.groupId)
        if (!progress) return null

        return (
          <section
            key={group.groupId}
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {group.groupId}
                </h2>
                <p className="text-sm text-muted-foreground">{group.subject}</p>
              </div>
              {progress.units.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {progress.units[0]?.pupilCount ?? 0} pupils
                </span>
              )}
            </div>

            {progress.loading && (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}

            {progress.error && (
              <p className="text-sm text-destructive">Error: {progress.error}</p>
            )}

            {!progress.loading && !progress.error && progress.units.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No units have been assigned to this class yet.
              </p>
            )}

            {!progress.loading && !progress.error && progress.units.length > 0 && (
              <div className="space-y-3">
                {progress.units.map((unit) => (
                  <div
                    key={unit.unitId}
                    className="flex items-center justify-between rounded-lg border border-border bg-background p-4"
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
            )}
          </section>
        )
      })}
    </div>
  )
}
