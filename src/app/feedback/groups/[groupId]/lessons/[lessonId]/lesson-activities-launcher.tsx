"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { listLessonActivitiesAction } from "@/lib/server-updates"
import type { LessonWithObjectives } from "@/types"
import { Button } from "@/components/ui/button"

interface LessonActivitiesLauncherProps {
  lesson: LessonWithObjectives
  unitTitle: string | null
}

export function LessonActivitiesLauncher({ lesson, unitTitle: _unitTitle }: LessonActivitiesLauncherProps) {
  const router = useRouter()
  void _unitTitle
  const [activityCount, setActivityCount] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let isMounted = true

    const fetchActivityCount = async () => {
      setIsLoading(true)
      try {
        const result = await listLessonActivitiesAction(lesson.lesson_id)
        if (result.error) {
          throw new Error(result.error)
        }
        if (!isMounted) return
        setActivityCount((result.data ?? []).length)
      } catch (error) {
        console.error("[feedback] Failed to load activity count:", error)
        toast.error("Unable to load activity count", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchActivityCount()

    return () => {
      isMounted = false
    }
  }, [lesson.lesson_id])

  const countLabel = activityCount === null ? "…" : activityCount
  const hasActivities = typeof activityCount === "number" && activityCount > 0
  const isButtonDisabled = isLoading || !hasActivities

  const handleClick = () => {
    if (isButtonDisabled) {
      if (!isLoading) {
        toast.info("This lesson doesn't have any activities yet.")
      }
      return
    }

    router.push(`/lessons/${encodeURIComponent(lesson.lesson_id)}/activities`)
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={handleClick}
      disabled={isButtonDisabled}
    >
      {isLoading ? "Loading activities…" : `Show activities (${countLabel})`}
    </Button>
  )
}
