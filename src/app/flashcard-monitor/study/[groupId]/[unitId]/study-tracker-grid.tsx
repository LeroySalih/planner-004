"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"

type Lesson = { lessonId: string; title: string }
type Pupil = { pupilId: string; firstName: string; lastName: string }
type Cell = { pupilId: string; lessonId: string; completedAt: string }

type Props = {
  lessons: Lesson[]
  pupils: Pupil[]
  cells: Cell[]
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate().toString().padStart(2, "0")
  const month = d.toLocaleString("en-GB", { month: "short" })
  return `${day} ${month}`
}

export function StudyTrackerGrid({ lessons, pupils, cells }: Props) {
  const cellMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of cells) {
      map.set(`${c.pupilId}:${c.lessonId}`, c.completedAt)
    }
    return map
  }, [cells])

  if (lessons.length === 0) {
    return <p className="text-sm text-muted-foreground">No lessons with key terms found in this unit.</p>
  }

  if (pupils.length === 0) {
    return <p className="text-sm text-muted-foreground">No pupils in this group.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left font-medium">
              Pupil
            </th>
            {lessons.map((l) => (
              <th
                key={l.lessonId}
                className="px-3 py-3 text-center font-medium"
                title={l.title}
              >
                <span className="block max-w-[8rem] truncate">{l.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pupils.map((p, i) => (
            <tr
              key={p.pupilId}
              className={cn("border-b last:border-0", i % 2 === 0 && "bg-muted/20")}
            >
              <td className="sticky left-0 z-10 bg-background px-4 py-2.5 font-medium whitespace-nowrap">
                {p.firstName} {p.lastName}
              </td>
              {lessons.map((l) => {
                const completedAt = cellMap.get(`${p.pupilId}:${l.lessonId}`)
                return (
                  <td key={l.lessonId} className="px-3 py-2.5 text-center whitespace-nowrap">
                    {completedAt ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {formatDate(completedAt)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
