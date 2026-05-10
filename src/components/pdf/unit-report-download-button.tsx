// src/components/pdf/unit-report-download-button.tsx
"use client"

import { FileDown } from "lucide-react"

import { Button } from "@/components/ui/button"

interface UnitReportDownloadButtonProps {
  unitId: string
  variant?: "default" | "secondary" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
}

export function UnitReportDownloadButton({
  unitId,
  variant = "outline",
  size = "sm",
  className,
}: UnitReportDownloadButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={`/api/unit-report/${encodeURIComponent(unitId)}`} download>
        <FileDown className="mr-2 h-4 w-4" />
        Generate Report
      </a>
    </Button>
  )
}
