"use server"

import type { LessonActivity } from "@/types"
import {
  getActivityFileDownloadUrlAction,
  listActivityFilesAction,
} from "@/lib/server-updates"

interface ActivityPreviewResolution {
  activity: LessonActivity & { orderIndex: number }
  imageUrl: string | null
}

interface ResolveActivityAssetsResult {
  activitiesWithPreview: ActivityPreviewResolution[]
}

export async function resolveActivityAssets(
  lessonId: string,
  activities: (LessonActivity & { orderIndex: number })[],
): Promise<ResolveActivityAssetsResult> {
  const activitiesWithPreview: ActivityPreviewResolution[] = await Promise.all(
    activities.map(async (activity) => {
      const imageUrl = await resolveActivityImageUrl(lessonId, activity)
      return { activity, imageUrl }
    }),
  )

  return { activitiesWithPreview }
}

function extractImageDescriptor(activity: LessonActivity): { url: string | null; fileName: string | null } {
  if (activity.type !== "display-image") {
    return { url: null, fileName: null }
  }

  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return { url: null, fileName: null }
  }

  const record = activity.body_data as Record<string, unknown>
  const url = typeof record.imageUrl === "string" && record.imageUrl.trim().length > 0 ? record.imageUrl : null
  const fileName =
    typeof record.imageFile === "string" && record.imageFile.trim().length > 0 ? record.imageFile : null

  return { url, fileName }
}

export async function resolveActivityImageUrl(
  lessonId: string,
  activity: LessonActivity,
): Promise<string | null> {
  const { url, fileName } = extractImageDescriptor(activity)
  if (url) {
    return url
  }

  if (activity.type !== "display-image") {
    return null
  }

  const candidateFileName = fileName ?? (await fetchFirstActivityFileName(lessonId, activity.activity_id))
  if (!candidateFileName) {
    return null
  }

  try {
    const result = await getActivityFileDownloadUrlAction(lessonId, activity.activity_id, candidateFileName)
    if (!result.success || !result.url) {
      console.error("[activities] Failed to create signed image URL", result.error)
      return null
    }
    return result.url
  } catch (error) {
    console.error("[activities] Unexpected error resolving image URL", error)
    return null
  }
}

async function fetchFirstActivityFileName(lessonId: string, activityId: string): Promise<string | null> {
  try {
    const filesResult = await listActivityFilesAction(lessonId, activityId)
    if (filesResult.error) {
      console.error("[activities] Failed to list activity files:", filesResult.error)
      return null
    }
    const firstFile = filesResult.data?.[0]
    return firstFile?.name ?? null
  } catch (error) {
    console.error("[activities] Unexpected error listing activity files", error)
    return null
  }
}
