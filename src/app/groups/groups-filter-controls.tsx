"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface GroupsFilterControlsProps {
  value: string
  onValueChange: (next: string) => void
}

export function GroupsFilterControls({ value, onValueChange }: GroupsFilterControlsProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value)
  }, [])

  const handleCommit = useCallback(() => {
    onValueChange(draft)
  }, [draft, onValueChange])

  const handleClear = useCallback(() => {
    setDraft("")
    onValueChange("")
  }, [onValueChange])

  const isClearDisabled = useMemo(() => draft.trim().length === 0, [draft])

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-2">
        <Input
          value={draft}
          onChange={handleChange}
          name="q"
          placeholder="Filter by group or subject (use '?' as wildcard)"
          className="flex-1"
          inputMode="search"
          aria-label="Filter groups"
          onBlur={handleCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              handleCommit()
            }
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={handleClear} disabled={isClearDisabled}>
          Clear
        </Button>
      </div>
    </div>
  )
}
