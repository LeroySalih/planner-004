'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ClassFilterControls, matchesClassFilter } from '@/components/reports/class-filter-controls'
import { ReportGrid } from '@/components/reports/report-grid'
import { getLevelForYearScore, yearGroupFromGroupId, type YearGroupLevels } from '@/lib/levels'
import { formatPercent, getCellBgColor, getMetricColor, SummativeToggle } from './report-ui'

type Group = {
  groupId: string
  subject: string
  active: boolean
  pupilCount: number
  unitCount: number
  avgScore: number | null
}

type GroupListProps = {
  groups: Group[]
  summativeOnly: boolean
  levelRanges: YearGroupLevels[]
}

export function GroupList({ groups, summativeOnly, levelRanges }: GroupListProps) {
  const [classFilter, setClassFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const inactiveCount = groups.filter((group) => !group.active).length
  const shown = groups.filter(
    (group) => (showInactive || group.active) && matchesClassFilter(group.groupId, classFilter),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card p-4">
        <SummativeToggle summativeOnly={summativeOnly} />
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <ClassFilterControls
            idPrefix="group"
            classFilter={classFilter}
            onClassFilterChange={setClassFilter}
            showInactive={showInactive}
            onShowInactiveChange={setShowInactive}
            inactiveCount={inactiveCount}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">No classes with progress data match.</p>
        </div>
      ) : (
        <ReportGrid>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted text-sm font-semibold text-foreground">
                <th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left">Class</th>
                <th className="px-3 py-3 text-left">Subject</th>
                <th className="px-3 py-3 text-center">Pupils</th>
                <th className="px-3 py-3 text-center">Units</th>
                <th className="px-3 py-3 text-center">Average</th>
                <th className="px-3 py-3 text-center">Level</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((group) => {
                const level = getLevelForYearScore(levelRanges, yearGroupFromGroupId(group.groupId), group.avgScore)
                return (
                  <tr key={group.groupId} className="border-b border-border text-sm last:border-b-0">
                    <td className="sticky left-0 z-10 bg-card px-4 py-3 font-medium">
                      <Link
                        href={`/group-progress-reports/${encodeURIComponent(group.groupId)}${summativeOnly ? '?summative=true' : ''}`}
                        className="text-primary hover:underline"
                      >
                        {group.groupId}
                      </Link>
                      {group.active ? null : <span className="ml-2 text-xs text-muted-foreground">inactive</span>}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{group.subject}</td>
                    <td className="px-3 py-3 text-center">{group.pupilCount}</td>
                    <td className="px-3 py-3 text-center">{group.unitCount}</td>
                    <td className={`px-3 py-3 text-center font-semibold ${getCellBgColor(group.avgScore)} ${getMetricColor(group.avgScore)}`}>
                      {formatPercent(group.avgScore)}
                    </td>
                    <td className="px-3 py-3 text-center font-semibold">{level ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ReportGrid>
      )}
    </div>
  )
}
