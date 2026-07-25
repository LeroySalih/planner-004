"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Lock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { setUnitCurriculumAction } from "@/lib/server-actions/unit-curriculum"

interface CurriculumOption {
  curriculum_id: string
  subject: string | null
  title: string
}

export function UnitCurriculumSelector({
  unitId,
  subject,
  curricula,
  initialCurriculumId,
  locked,
}: {
  unitId: string
  subject: string
  curricula: CurriculumOption[]
  initialCurriculumId: string | null
  locked: boolean
}) {
  const router = useRouter()
  const options = curricula.filter((c) => c.subject === subject)
  const [value, setValue] = useState<string>(initialCurriculumId ?? "")
  const [saving, setSaving] = useState(false)

  const currentTitle =
    curricula.find((c) => c.curriculum_id === (initialCurriculumId ?? ""))?.title ?? null

  if (locked) {
    return (
      <Badge variant="outline" className="gap-1">
        <Lock className="h-3 w-3" />
        Curriculum: {currentTitle ?? "—"}
      </Badge>
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await setUnitCurriculumAction({ unitId, curriculumId: value || null })
      if (!res.success) {
        toast.error("Couldn't set curriculum", { description: res.error ?? "Please try again." })
        return
      }
      toast.success("Curriculum updated")
      router.refresh()
    } catch (err) {
      toast.error("Couldn't set curriculum", { description: err instanceof Error ? err.message : "Please try again." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={setValue} disabled={saving || options.length === 0}>
        <SelectTrigger className="h-8 w-56 text-xs">
          <SelectValue placeholder={options.length ? "Choose a curriculum" : "No curricula for this subject"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c.curriculum_id} value={c.curriculum_id}>
              {c.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="h-8" onClick={save} disabled={saving || value === (initialCurriculumId ?? "")}>
        Save
      </Button>
    </div>
  )
}
