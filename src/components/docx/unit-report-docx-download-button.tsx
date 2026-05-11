// src/components/docx/unit-report-docx-download-button.tsx
"use client"

import { FileDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface UnitReportDocxDownloadButtonProps {
  unitId: string
  variant?: "default" | "secondary" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
}

export function UnitReportDocxDownloadButton({
  unitId,
  variant = "outline",
  size = "sm",
  className,
}: UnitReportDocxDownloadButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={`/api/unit-report-docx/${encodeURIComponent(unitId)}`} download>
        <FileDown className="mr-2 h-4 w-4" />
        Download Report (.docx)
      </a>
    </Button>
  )
}
