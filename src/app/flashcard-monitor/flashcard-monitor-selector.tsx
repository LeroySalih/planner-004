"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Group = { groupId: string; subject: string }
type GroupUnit = { groupId: string; unitId: string; unitTitle: string }
type GroupLesson = { groupId: string; lessonId: string; lessonTitle: string }

type Props = {
  groups: Group[]
  groupUnits: GroupUnit[]
  groupLessons: GroupLesson[]
}

export function FlashcardMonitorSelector({ groups, groupUnits, groupLessons }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>("")

  const units = useMemo(
    () => groupUnits.filter((u) => u.groupId === selectedGroupId),
    [groupUnits, selectedGroupId],
  )

  const lessons = useMemo(
    () => groupLessons.filter((l) => l.groupId === selectedGroupId),
    [groupLessons, selectedGroupId],
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="max-w-sm">
        <label className="mb-2 block text-sm font-medium">Select a group</label>
        <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a group..." />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.groupId} value={g.groupId}>
                {g.groupId}{g.subject ? ` — ${g.subject}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedGroupId && (
        <div className="grid gap-8 md:grid-cols-2">
          {/* Live Monitor */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Live Monitor</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Watch pupil progress in real-time during a flashcard session.
            </p>
            {lessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lessons with key terms found for this group.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lessons.map((l) => (
                  <li key={l.lessonId}>
                    <Link
                      href={`/flashcard-monitor/live/${encodeURIComponent(selectedGroupId)}/${encodeURIComponent(l.lessonId)}`}
                      className="block rounded-md border p-3 text-sm hover:bg-accent transition-colors"
                    >
                      {l.lessonTitle}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Study Tracker */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Study Tracker</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              View flashcard completion dates across pupils and lessons.
            </p>
            {units.length === 0 ? (
              <p className="text-sm text-muted-foreground">No units with key terms found for this group.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {units.map((u) => (
                  <li key={u.unitId}>
                    <Link
                      href={`/flashcard-monitor/study/${encodeURIComponent(selectedGroupId)}/${encodeURIComponent(u.unitId)}`}
                      className="block rounded-md border p-3 text-sm hover:bg-accent transition-colors"
                    >
                      {u.unitTitle}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
