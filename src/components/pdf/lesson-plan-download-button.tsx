// src/components/pdf/lesson-plan-download-button.tsx
"use client"

import { FileDown } from "lucide-react"

import { Button } from "@/components/ui/button"

interface LessonPlanDownloadButtonProps {
  lessonId: string
  variant?: "default" | "secondary" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
}

export function LessonPlanDownloadButton({
  lessonId,
  variant = "outline",
  size = "sm",
  className,
}: LessonPlanDownloadButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={`/api/lesson-plan/${encodeURIComponent(lessonId)}`} download>
        <FileDown className="mr-2 h-4 w-4" />
        Download Plan
      </a>
    </Button>
  )
}
