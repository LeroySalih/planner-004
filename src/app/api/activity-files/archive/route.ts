import { NextResponse } from "next/server"
import archiver from "archiver"
import { PassThrough, Readable, Readable as NodeReadable } from "node:stream"

import { requireTeacherProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"

function buildPrefixes(lessonId: string, activityId: string) {
  return [`lessons/${lessonId}/activities/${activityId}`, `${lessonId}/activities/${activityId}`]
}

function sanitizeFileName(value: string) {
  const trimmed = value.trim()
  return trimmed.replace(/[^a-zA-Z0-9_.-]+/g, "_") || "file"
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const lessonId = url.searchParams.get("lessonId")
  const activityId = url.searchParams.get("activityId")

  const profile = await requireTeacherProfile()
  if (!profile) {
    return NextResponse.json({ error: "You need to sign in as a teacher." }, { status: 401 })
  }

  if (!lessonId || !activityId) {
    return NextResponse.json({ error: "Missing lesson or activity identifier." }, { status: 400 })
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const prefixes = buildPrefixes(lessonId, activityId)

  const files: { name: string; path: string }[] = []
  for (const prefix of prefixes) {
    const { data, error } = await storage.list(prefix, { limit: 200 })
    if (error) {
      const normalized = error.message?.toLowerCase() ?? ""
      if (normalized.includes("not found") || normalized.includes("object not found")) {
        continue
      }
      return NextResponse.json({ error: "Unable to list files for activity." }, { status: 400 })
    }
    for (const item of data ?? []) {
      const safeName = sanitizeFileName(item.name)
      const exists = files.find((entry) => entry.name === safeName)
      if (!exists) {
        files.push({ name: safeName, path: `${prefix}/${item.name}` })
      }
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded yet." }, { status: 404 })
  }

  const archive = archiver("zip", { zlib: { level: 9 } })
  const stream = new PassThrough()
  archive.pipe(stream)

  for (const file of files) {
    const { stream: fileStream } = await storage.getFileStream(file.path)
    if (fileStream) {
      archive.append(fileStream as unknown as NodeReadable, { name: file.name })
    }
  }

  void archive.finalize()

  const webStream = Readable.toWeb(stream) as unknown as ReadableStream
  const safeArchiveName = `activity-${activityId}.zip`

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeArchiveName}"`,
    },
  })
}
