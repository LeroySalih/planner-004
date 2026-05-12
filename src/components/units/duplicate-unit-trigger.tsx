"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { duplicateUnitAction } from "@/lib/server-updates"

interface DuplicateUnitTriggerProps {
  unitId: string
  unitTitle: string
  variant?: "default" | "outline" | "ghost" | "secondary"
  size?: "default" | "sm" | "lg" | "icon"
}

export function DuplicateUnitTrigger({
  unitId,
  unitTitle,
  variant = "outline",
  size = "default",
}: DuplicateUnitTriggerProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)

  async function handleDuplicate() {
    setIsPending(true)
    try {
      const result = await duplicateUnitAction(unitId)

      if (result.error || !result.data) {
        toast.error(result.error ?? "Failed to duplicate unit.")
        return
      }

      const { newUnitId, fileWarnings } = result.data

      if (fileWarnings.length > 0) {
        toast.warning(`Unit duplicated, but some files could not be copied:\n${fileWarnings.join("\n")}`)
      }

      router.push(`/units/${encodeURIComponent(newUnitId)}`)
    } catch {
      toast.error("An unexpected error occurred while duplicating the unit.")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleDuplicate}
      disabled={isPending}
      aria-label={`Duplicate ${unitTitle}`}
    >
      <Copy className="mr-2 h-4 w-4" />
      {isPending ? "Duplicating…" : "Duplicate"}
    </Button>
  )
}
