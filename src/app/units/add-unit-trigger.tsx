"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { Subjects, Unit } from "@/types"

const UnitEditSidebar = dynamic(() => import("@/components/units/unit-edit-sidebar").then((mod) => mod.UnitEditSidebar), {
  ssr: false,
  loading: () => <div className="text-sm text-muted-foreground">Loading form…</div>,
})

type AddUnitTriggerProps = {
  subjects: Subjects
  curricula: { curriculum_id: string; subject: string | null; title: string }[]
}

export function AddUnitTrigger({ subjects, curricula }: AddUnitTriggerProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Fake empty unit to reuse edit sidebar for creation.
  const placeholderUnit: Unit = {
    unit_id: "",
    title: "",
    subject: subjects[0]?.subject ?? "",
    description: "",
    active: true,
    year: null,
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>+ Add Unit</Button>
      <UnitEditSidebar
        unit={placeholderUnit}
        subjects={subjects}
        curricula={curricula}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onOptimisticUpdate={() => {
          setIsOpen(false)
        }}
      />
    </>
  )
}
