"use client"

import { useRouter, usePathname } from "next/navigation"
import { useCallback, useState, useRef, useTransition } from "react"
import { X, Loader2 } from "lucide-react"

interface ClassFilterProps {
  allGroups: { group_id: string; subject: string }[]
  selectedGroupIds: string[]
}

export function ClassFilter({ allGroups, selectedGroupIds: initialSelectedGroupIds }: ClassFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [selectedGroupIds, setSelectedGroupIds] = useState(initialSelectedGroupIds)
  const [inputValue, setInputValue] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const navigate = useCallback(
    (groupIds: string[]) => {
      setSelectedGroupIds(groupIds)
      startTransition(() => {
        const params = new URLSearchParams()
        if (groupIds.length > 0) {
          params.set("classes", groupIds.join(","))
        }
        const url = params.toString() ? `${pathname}?${params.toString()}` : pathname
        router.replace(url)
      })
    },
    [router, pathname],
  )

  const addGroup = (groupId: string) => {
    if (!selectedGroupIds.includes(groupId)) {
      navigate([...selectedGroupIds, groupId])
    }
    setInputValue("")
    setHighlightedIndex(-1)
  }

  const removeGroup = (groupId: string) => {
    navigate(selectedGroupIds.filter((id) => id !== groupId))
  }

  const filteredGroups = allGroups.filter((g) => {
    if (selectedGroupIds.includes(g.group_id)) return false
    if (!inputValue) return true
    const term = inputValue.toLowerCase()
    return g.group_id.toLowerCase().includes(term) || g.subject.toLowerCase().includes(term)
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen || filteredGroups.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlightedIndex((i) => (i + 1) % filteredGroups.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlightedIndex((i) => (i <= 0 ? filteredGroups.length - 1 : i - 1))
    } else if (e.key === "Tab" && highlightedIndex >= 0) {
      e.preventDefault()
      addGroup(filteredGroups[highlightedIndex].group_id)
    }
  }

  const handleBlur = () => {
    closeTimerRef.current = setTimeout(() => {
      setDropdownOpen(false)
      setHighlightedIndex(-1)
    }, 150)
  }

  const handleDropdownMouseDown = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }

  return (
    <div className="flex items-start gap-2">
      <div className="relative w-[320px]">
        {/* Chips */}
        {selectedGroupIds.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {selectedGroupIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md bg-secondary text-secondary-foreground text-xs px-2 py-1"
              >
                {id}
                <button
                  type="button"
                  onClick={() => removeGroup(id)}
                  className="hover:text-destructive focus:outline-none"
                  aria-label={`Remove ${id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input */}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setDropdownOpen(true)
            setHighlightedIndex(-1)
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Filter classes…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        />

        {/* Dropdown */}
        {dropdownOpen && filteredGroups.length > 0 && (
          <div
            onMouseDown={handleDropdownMouseDown}
            className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-[260px] overflow-y-auto"
          >
            {filteredGroups.map((group, index) => (
              <button
                key={group.group_id}
                type="button"
                onClick={() => addGroup(group.group_id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left ${
                  index === highlightedIndex ? "bg-accent" : "hover:bg-accent"
                }`}
              >
                <span>{group.group_id}</span>
                <span className="text-muted-foreground text-xs">{group.subject}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-2.5" />}
    </div>
  )
}
