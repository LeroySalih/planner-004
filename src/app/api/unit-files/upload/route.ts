import { NextResponse } from "next/server"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const UNIT_FILES_BUCKET = "units"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function buildFilePath(unitId: string, fileName: string) {
  return `${unitId}/${fileName}`
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[unit-files-upload:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  if (!hasRole(profile, "teacher") && !hasRole(profile, "technician")) {
    console.warn(`${tag} Rejected: insufficient role`, { userId: profile.userId })
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const unitId = formData.get("unitId")
  const file = formData.get("file")

  if (typeof unitId !== "string" || unitId.trim() === "") {
    console.warn(`${tag} Missing unitId`)
    return NextResponse.json({ success: false, error: "Missing unitId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    console.warn(`${tag} No file in request`)
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const fileName = file.name
  const fullPath = buildFilePath(unitId, fileName)

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, unitId })

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    console.error(`${tag} Failed to read file buffer`, err)
    return NextResponse.json({ success: false, error: "Failed to read file." }, { status: 500 })
  }

  const storage = createLocalStorageClient(UNIT_FILES_BUCKET)
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    originalPath: fullPath,
  })

  if (error) {
    console.error(`${tag} Storage upload failed`, { fullPath, error: error.message })
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  console.log(`${tag} Complete`, { fullPath, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true })
}
