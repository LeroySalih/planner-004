'use client'

import { useState } from 'react'
import { ClassProgressView } from './class-progress-view'

type Group = {
  groupId: string
  subject: string
  joinCode: string
}

type ClassSelectorProps = {
  groups: Group[]
}

export function ClassSelector({ groups }: ClassSelectorProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="class-select" className="text-sm font-medium text-foreground">
          Select a class
        </label>
        <select
          id="class-select"
          value={selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">-- Select a class --</option>
          {groups.map((group) => (
            <option key={group.groupId} value={group.groupId}>
              {group.groupId} - {group.subject}
            </option>
          ))}
        </select>
      </div>

      {selectedGroupId && <ClassProgressView groupId={selectedGroupId} />}
    </div>
  )
}
