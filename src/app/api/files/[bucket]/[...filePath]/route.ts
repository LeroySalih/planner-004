import { NextRequest, NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
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
  const { stream, metadata, error } = await storage.getFileStream(fullPath)

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
