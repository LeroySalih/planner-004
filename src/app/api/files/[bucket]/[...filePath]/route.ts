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
  headers.set("Content-Type", typedMetadata.content_type || "application/octet-stream")
  if (typeof typedMetadata.size_bytes === "number") {
    headers.set("Content-Length", String(typedMetadata.size_bytes))
  }
  headers.set(
    "Content-Disposition",
    `attachment; filename="${typedMetadata.file_name ?? decodedSegments[decodedSegments.length - 1]}"`,
  )

  return new Response(stream as any, { headers })
}
