"use client"

import { useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type UnitSearchControlsProps = {
  subjectOptions: string[]
}

export function UnitSearchControls({ subjectOptions }: UnitSearchControlsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const search = searchParams.get("q") ?? ""
  const subject = searchParams.get("subject") ?? ""
  const includeInactive = (searchParams.get("inactive") ?? "") === "1"

  const applyFilters = useCallback(
    (nextSearch: string, nextSubject: string, nextIncludeInactive: boolean) => {
      const params = new URLSearchParams()
      if (nextSearch.trim()) params.set("q", nextSearch.trim())
      if (nextSubject.trim()) params.set("subject", nextSubject.trim())
      if (nextIncludeInactive) params.set("inactive", "1")
      const query = params.toString()
      router.replace(query ? `/units?${query}` : "/units")
      router.refresh()
    },
    [router],
  )

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="w-full sm:max-w-md">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by title, subject, or unit ID..."
            defaultValue={search}
            onChange={(event) => applyFilters(event.target.value, subject, includeInactive)}
            className="pl-10"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Use &quot;?&quot; to match any single character.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={subject === "" ? "default" : "outline"}
          size="sm"
          onClick={() => applyFilters(search, "", includeInactive)}
        >
          All Subjects
        </Button>
        {subjectOptions.map((subjectOption) => (
          <Button
            key={subjectOption}
            variant={subject === subjectOption ? "default" : "outline"}
            size="sm"
            onClick={() => applyFilters(search, subjectOption, includeInactive)}
          >
            {subjectOption}
          </Button>
        ))}
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <Switch
            id="show-inactive-switch"
            checked={includeInactive}
            onCheckedChange={(checked) => applyFilters(search, subject, Boolean(checked))}
          />
          <Label htmlFor="show-inactive-switch" className="text-sm font-medium">
            Show inactive units
          </Label>
        </div>
      </div>
    </div>
  )
}
