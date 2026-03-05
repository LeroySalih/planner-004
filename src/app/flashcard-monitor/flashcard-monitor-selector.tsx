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
type GroupActivity = { groupId: string; activityId: string; activityTitle: string }

type Props = {
  groups: Group[]
  groupUnits: GroupUnit[]
  groupActivities: GroupActivity[]
}

export function FlashcardMonitorSelector({ groups, groupUnits, groupActivities }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>("")

  const units = useMemo(
    () => groupUnits.filter((u) => u.groupId === selectedGroupId),
    [groupUnits, selectedGroupId],
  )

  const activities = useMemo(
    () => groupActivities.filter((a) => a.groupId === selectedGroupId),
    [groupActivities, selectedGroupId],
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
        <div className="grid gap-8 md:grid-cols-3">
          {/* Live Monitor */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Live Monitor</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Watch pupil progress in real-time during a flashcard session.
            </p>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No flashcard activities found for this group.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {activities.map((a) => (
                  <li key={a.activityId}>
                    <Link
                      href={`/flashcard-monitor/live/${encodeURIComponent(selectedGroupId)}/${encodeURIComponent(a.activityId)}`}
                      className="block rounded-md border p-3 text-sm hover:bg-accent transition-colors"
                    >
                      {a.activityTitle}
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
              View flashcard completion dates across pupils and activities.
            </p>
            {units.length === 0 ? (
              <p className="text-sm text-muted-foreground">No units with flashcard activities found for this group.</p>
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

          {/* Class Activity */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Class Activity</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              See all pupils&apos; current flashcard activity in real-time.
            </p>
            <Link
              href={`/flashcard-monitor/class/${encodeURIComponent(selectedGroupId)}`}
              className="block rounded-md border p-3 text-sm hover:bg-accent transition-colors"
            >
              View class activity →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
