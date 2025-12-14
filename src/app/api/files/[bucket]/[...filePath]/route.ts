import { NextRequest, NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ bucket: string; filePath: string[] }> },
) {
  const profile = await getAuthenticatedProfile()
  if (!profile) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const resolvedParams = await context.params
  const bucket = resolvedParams.bucket
  const filePath = resolvedParams.filePath ?? []
  if (!bucket || filePath.length === 0) {
    return NextResponse.json({ success: false, error: "Missing path" }, { status: 400 })
  }

  const decodedSegments = filePath.map((segment) => decodeURIComponent(segment))
  const fullPath = decodedSegments.join("/")

  const storage = createLocalStorageClient(bucket)
  let { stream, metadata, error } = await storage.getFileStream(fullPath)

  if ((error || !stream || !metadata) && bucket === "lessons" && decodedSegments.length >= 5) {
    const [lessonId, maybeActivities, activityId, pupilSegment, ...rest] = decodedSegments
    if (maybeActivities === "activities" && rest.length > 0) {
      const fallbackFileName = rest.join("/")
      const fallbackPath = await resolveLessonFilePath(bucket, lessonId, activityId, pupilSegment, fallbackFileName)
      if (fallbackPath) {
        const fallback = await storage.getFileStream(fallbackPath)
        stream = fallback.stream
        metadata = fallback.metadata
        error = fallback.error
      }
    }
  }

  if (error || !stream || !metadata) {
    return NextResponse.json({ success: false, error: "File not found" }, { status: 404 })
  }

  const headers = new Headers()
  const typedMetadata = metadata as { content_type?: string; size_bytes?: number; file_name?: string }
  const fileName = typedMetadata.file_name ?? decodedSegments[decodedSegments.length - 1]

  const inferContentType = () => {
    const name = fileName.toLowerCase()
    if (name.endsWith(".webm")) return "audio/webm"
    if (name.endsWith(".mp3")) return "audio/mpeg"
    if (name.endsWith(".wav")) return "audio/wav"
    if (name.endsWith(".ogg")) return "audio/ogg"
    if (name.endsWith(".m4a")) return "audio/mp4"
    if (name.endsWith(".mp4")) return "video/mp4"
    if (name.endsWith(".mov")) return "video/quicktime"
    if (name.endsWith(".png")) return "image/png"
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg"
    if (name.endsWith(".gif")) return "image/gif"
    if (name.endsWith(".webp")) return "image/webp"
    return "application/octet-stream"
  }

  const contentType = typedMetadata.content_type || inferContentType()
  headers.set("Content-Type", contentType)
  if (typeof typedMetadata.size_bytes === "number") {
    headers.set("Content-Length", String(typedMetadata.size_bytes))
  }
  const shouldInline = contentType.startsWith("audio/") || contentType.startsWith("video/") || contentType.startsWith("image/")
  headers.set("Content-Disposition", `${shouldInline ? "inline" : "attachment"}; filename="${fileName}"`)

  return new Response(stream as any, { headers })
}

async function resolveLessonFilePath(
  bucket: string,
  lessonId: string,
  activityId: string,
  pupilSegment: string,
  fileName: string,
) {
  try {
    const { rows } = await query<{
      full_path: string
      pupil_segment: string
    }>(
      `
        with scoped as (
          select
            (case
              when scope_path like 'lessons/%' then scope_path
              else concat('lessons/', scope_path)
            end) as scope_path,
            file_name,
            coalesce(updated_at, created_at) as updated_at
          from stored_files
          where bucket = $1
            and file_name = $2
        ),
        parsed as (
          select
            scope_path,
            file_name,
            updated_at,
            matches[1] as lesson_id,
            matches[2] as activity_id,
            matches[3] as pupil_segment
          from scoped
          cross join lateral regexp_matches(scope_path, '^lessons/([^/]+)/activities/([^/]+)/([^/]+)$') as matches
          where matches is not null
        )
        select scope_path || '/' || file_name as full_path, pupil_segment
        from parsed
        where lesson_id = $3
          and activity_id = $4
        order by case when pupil_segment = $5 then 0 else 1 end, updated_at desc nulls last
        limit 1
      `,
      [bucket, fileName, lessonId, activityId, pupilSegment],
    )

    return rows?.[0]?.full_path ?? null
  } catch (fallbackError) {
    console.error("[files] Failed to resolve lesson file fallback", {
      bucket,
      lessonId,
      activityId,
      pupilSegment,
      fileName,
      error: fallbackError,
    })
    return null
  }
}
