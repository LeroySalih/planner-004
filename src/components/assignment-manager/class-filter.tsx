"use client"

import { useRouter, usePathname } from "next/navigation"
import { useCallback, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChevronDown, Loader2, X } from "lucide-react"

interface ClassFilterProps {
  allGroups: { group_id: string; subject: string }[]
  selectedGroupIds: string[]
}

export function ClassFilter({ allGroups, selectedGroupIds: initialSelectedGroupIds }: ClassFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [selectedGroupIds, setSelectedGroupIds] = useState(initialSelectedGroupIds)

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
        router.refresh()
      })
    },
    [router, pathname],
  )

  const toggleGroup = (groupId: string) => {
    const next = selectedGroupIds.includes(groupId)
      ? selectedGroupIds.filter((id) => id !== groupId)
      : [...selectedGroupIds, groupId]
    navigate(next)
  }

  const selectAll = () => navigate(allGroups.map((g) => g.group_id))
  const clearAll = () => navigate([])

  const label =
    selectedGroupIds.length === 0
      ? "No classes selected"
      : selectedGroupIds.length <= 3
        ? selectedGroupIds.join(", ")
        : `${selectedGroupIds.length} classes selected`

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="min-w-[200px] justify-between"
          >
            <span className="truncate">{label}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">Filter classes</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={selectAll}>
                All
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearAll}>
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-2">
            {allGroups.map((group) => (
              <label
                key={group.group_id}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
              >
                <Checkbox
                  checked={selectedGroupIds.includes(group.group_id)}
                  onCheckedChange={() => toggleGroup(group.group_id)}
                />
                <span>{group.group_id}</span>
                <span className="text-muted-foreground text-xs ml-auto">{group.subject}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  )
}
