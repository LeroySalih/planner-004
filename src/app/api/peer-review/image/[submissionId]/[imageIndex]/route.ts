import { NextRequest, NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"

async function resolvePupilStorageKey(userId: string): Promise<string> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM profiles WHERE user_id = $1 LIMIT 1`,
    [userId],
  )
  return rows[0]?.email?.trim() ?? userId
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ submissionId: string; imageIndex: string }> },
) {
  const { submissionId, imageIndex: imageIndexStr } = await context.params

  if (!submissionId) {
    return NextResponse.json({ error: "Missing submission ID" }, { status: 400 })
  }

  const imageIndex = parseInt(imageIndexStr, 10)
  if (isNaN(imageIndex) || imageIndex < 0) {
    return NextResponse.json({ error: "Invalid image index" }, { status: 400 })
  }

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Load submission to get the file info
  const { rows } = await query<{
    submission_id: string
    activity_id: string
    user_id: string
    body: unknown
  }>(
    `SELECT s.submission_id, s.activity_id, s.user_id, s.body
     FROM submissions s
     WHERE s.submission_id = $1
     LIMIT 1`,
    [submissionId],
  )

  if (rows.length === 0) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 })
  }

  const submission = rows[0]
  const body = submission.body as { files?: Array<{ fileId: string; fileName: string; mimeType: string; order: number }> } | null

  if (!body?.files || !Array.isArray(body.files)) {
    return NextResponse.json({ error: "No files in submission" }, { status: 404 })
  }

  // Sort by order and get the requested index
  const sortedFiles = [...body.files].sort((a, b) => a.order - b.order)
  if (imageIndex >= sortedFiles.length) {
    return NextResponse.json({ error: "Image index out of range" }, { status: 404 })
  }

  const fileEntry = sortedFiles[imageIndex]

  // Get the lesson_id for building the storage path
  const { rows: activityRows } = await query<{ lesson_id: string }>(
    `SELECT lesson_id FROM activities WHERE activity_id = $1 LIMIT 1`,
    [submission.activity_id],
  )

  if (activityRows.length === 0) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 })
  }

  const lessonId = activityRows[0].lesson_id
  const pupilStorageKey = await resolvePupilStorageKey(submission.user_id)
  const storagePath = `lessons/${lessonId}/activities/${submission.activity_id}/${pupilStorageKey}/${fileEntry.fileName}`

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { stream, metadata, error } = await storage.getFileStream(storagePath)

  if (error || !stream) {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }

  const headers = new Headers()
  const typedMetadata = metadata as { content_type?: string; size_bytes?: number } | null
  headers.set("Content-Type", typedMetadata?.content_type ?? fileEntry.mimeType ?? "application/octet-stream")
  if (typedMetadata?.size_bytes) {
    headers.set("Content-Length", String(typedMetadata.size_bytes))
  }
  headers.set("Content-Disposition", "inline")
  headers.set("Cache-Control", "private, max-age=3600")

  return new Response(stream as any, { headers })
}
