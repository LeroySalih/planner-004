"use client"

import { useId } from "react"

import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

// Teacher file lists hide past versions (src/lib/storage/file-versions.ts)
// until this is switched on. Nothing renders when there are none to show.
export function PastVersionsSwitch({
  count,
  checked,
  onCheckedChange,
}: {
  count: number
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()
  if (count === 0) return null
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Show past versions ({count})
      </Label>
    </div>
  )
}

export function PastVersionBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Past version
    </Badge>
  )
}
