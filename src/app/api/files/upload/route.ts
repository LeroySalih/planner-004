import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  const profile = await getAuthenticatedProfile()
  if (!profile) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const formData = await request.formData()
  const bucket = formData.get("bucket")
  const scopeValue = formData.get("scope")
  const scope = typeof scopeValue === "string" ? scopeValue : ""
  const file = formData.get("file")

  if (typeof bucket !== "string" || bucket.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing bucket" }, { status: 400 })
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const storage = createLocalStorageClient(bucket)
  const fullPath = [scope, file.name].filter(Boolean).join("/")
  const arrayBuffer = await file.arrayBuffer()

  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    uploadedBy: profile.userId,
    originalPath: `${bucket}/${fullPath}`,
  })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const downloadUrl = [bucket, scope, file.name].filter(Boolean).map(encodeURIComponent).join("/")
  return NextResponse.json({
    success: true,
    path: fullPath,
    url: `/api/files/${downloadUrl}`,
  })
}
