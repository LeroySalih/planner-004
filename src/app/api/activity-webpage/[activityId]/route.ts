import { NextRequest, NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"

// Sandboxed CSP for teacher-uploaded HTML:
// - `sandbox allow-scripts allow-popups` → the document runs in an OPAQUE origin,
//   so its JS cannot read app cookies or call our APIs as the logged-in user.
// - resource directives force the file to be self-contained (only inline/data:)
//   and block any network egress (connect-src 'none'), preventing exfiltration.
const SANDBOX_CSP = [
  "sandbox allow-scripts allow-popups",
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

/**
 * Serve a `display-webpage` activity's uploaded HTML file inline (so it opens as
 * a page in a new tab), sandboxed so untrusted teacher HTML can't touch the app.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ activityId: string }> },
) {
  const { activityId } = await context.params
  if (!activityId) {
    return NextResponse.json({ success: false, error: "Missing activity id" }, { status: 400 })
  }

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let lessonId: string | null = null
  let htmlFile: string | null = null
  try {
    const { rows } = await query<{ lesson_id: string | null; body_data: unknown }>(
      "select lesson_id, body_data from activities where activity_id = $1 and type = 'display-webpage' limit 1",
      [activityId],
    )
    const row = rows[0]
    if (row) {
      lessonId = row.lesson_id
      const body = row.body_data as Record<string, unknown> | null
      const candidate = body && typeof body.htmlFile === "string" ? body.htmlFile : null
      htmlFile = candidate && candidate.trim().length > 0 ? candidate : null
    }
  } catch (error) {
    console.error("[activity-webpage] Failed to load activity", { activityId, error })
    return NextResponse.json({ success: false, error: "Failed to load activity" }, { status: 500 })
  }

  if (!lessonId || !htmlFile) {
    return NextResponse.json({ success: false, error: "Webpage not found" }, { status: 404 })
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const fullPath = `${LESSON_FILES_BUCKET}/${lessonId}/activities/${activityId}/${htmlFile}`
  const { stream, metadata, error } = await storage.getFileStream(fullPath)
  if (error || !stream || !metadata) {
    return NextResponse.json({ success: false, error: "Webpage not found" }, { status: 404 })
  }

  const headers = new Headers()
  headers.set("Content-Type", "text/html; charset=utf-8")
  headers.set("Content-Disposition", "inline")
  headers.set("Content-Security-Policy", SANDBOX_CSP)
  headers.set("X-Content-Type-Options", "nosniff")
  const size = (metadata as { size_bytes?: number }).size_bytes
  if (typeof size === "number") {
    headers.set("Content-Length", String(size))
  }

  return new Response(stream as unknown as BodyInit, { headers })
}
