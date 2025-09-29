"use client"

import { useCallback, useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface GroupsFilterControlsProps {
  value: string
  onValueChange: (next: string) => void
}

export function GroupsFilterControls({ value, onValueChange }: GroupsFilterControlsProps) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange(event.target.value)
    },
    [onValueChange],
  )

  const handleClear = useCallback(() => {
    onValueChange("")
  }, [onValueChange])

  const isClearDisabled = useMemo(() => value.trim().length === 0, [value])

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-2">
        <Input
          value={value}
          onChange={handleChange}
          name="q"
          placeholder="Filter by group or subject (use '?' as wildcard)"
          className="flex-1"
          inputMode="search"
          aria-label="Filter groups"
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
