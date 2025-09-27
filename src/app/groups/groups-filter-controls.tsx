"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface GroupsFilterControlsProps {
  initialValue: string
}

export function GroupsFilterControls({ initialValue }: GroupsFilterControlsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const createNextUrl = useCallback(
    (nextValue: string) => {
      const params = new URLSearchParams(searchParams?.toString())

      if (nextValue.trim().length > 0) {
        params.set("q", nextValue)
      } else {
        params.delete("q")
      }

      const query = params.toString()
      return query ? `${pathname}?${query}` : pathname
    },
    [pathname, searchParams],
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value
      setValue(nextValue)
      router.replace(createNextUrl(nextValue))
    },
    [createNextUrl, router],
  )

  const handleClear = useCallback(() => {
    setValue("")
    router.replace(pathname)
  }, [pathname, router])

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
