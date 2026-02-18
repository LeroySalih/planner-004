import { NextResponse } from "next/server"
import archiver from "archiver"
import { PassThrough, Readable } from "node:stream"
import { z } from "zod"

import { readQueueItemsAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { query } from "@/lib/db"

const LESSON_FILES_BUCKET = "lessons"

async function resolveStorageKey(pupilId: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(pupilId)) return cache.get(pupilId)!
  try {
    const { rows } = await query<{ email: string | null }>(
      "select email from profiles where user_id = $1 limit 1",
      [pupilId],
    )
    const email = rows?.[0]?.email?.trim()
    const resolved = email && email.length > 0 ? email : pupilId
    cache.set(pupilId, resolved)
    return resolved
  } catch {
    cache.set(pupilId, pupilId)
    return pupilId
  }
}

function buildSubmissionPaths(lessonId: string, activityId: string, pupilId: string, fileName: string) {
  const basePath = `lessons/${lessonId}/activities/${activityId}/${pupilId}/${fileName}`
  const legacyPath = `${lessonId}/activities/${activityId}/${pupilId}/${fileName}`
  return [basePath, legacyPath].filter((value, index, array) => array.indexOf(value) === index)
}

function sanitizeFolderName(value: string) {
  const trimmed = value.trim()
  return trimmed.replace(/[^a-zA-Z0-9_-]+/g, "_") || "pupil"
}

const DownloadItemSchema = z.object({
  lessonId: z.string().min(1),
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  fileName: z.string().min(1),
})

async function streamToBuffer(readable: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function appendFilesToArchive(
  items: Array<{ lessonId: string; activityId: string; pupilId: string; fileName: string; folderName?: string }>,
  storage: ReturnType<typeof createLocalStorageClient>,
  archive: archiver.Archiver,
) {
  const emailCache = new Map<string, string>()
  for (const item of items) {
    const storageKey = await resolveStorageKey(item.pupilId, emailCache)
    const paths = buildSubmissionPaths(item.lessonId, item.activityId, storageKey, item.fileName)
    let appended = false
    let lastError: { message?: string } | null = null

    for (const path of paths) {
      const { stream, error } = await storage.getFileStream(path)

      if (error || !stream) {
        const normalized = error?.message?.toLowerCase() ?? ""
        if (normalized.includes("not found") || normalized.includes("object not found")) {
          lastError = error
          continue
        }
        if (error) {
          console.error("[queue] Failed to download file for archive:", error, { path })
          lastError = error
        }
        break
      }

      const buffer = await streamToBuffer(stream)
      const folderName = sanitizeFolderName(item.folderName ?? item.pupilId)
      archive.append(buffer, { name: `${folderName}/${item.fileName}` })
      appended = true
      break
    }

    if (!appended && lastError) {
      console.warn("[queue] Skipped missing file during archive", {
        pupilId: item.pupilId,
        fileName: item.fileName,
        error: lastError,
      })
    }
  }
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
    return NextResponse.json({ error: "Missing required selection." }, { status: 400 })
  }

  const queueResult = await readQueueItemsAction({ groupId: "", lessonId, activityId })
  if (queueResult.error || !queueResult.data) {
    return NextResponse.json({ error: queueResult.error ?? "Unable to load queue." }, { status: 400 })
  }

  const items = queueResult.data.filter((item) => item.fileName)
  if (items.length === 0) {
    return NextResponse.json({ error: "No files to download." }, { status: 400 })
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  const archive = archiver("zip", { zlib: { level: 9 } })
  const stream = new PassThrough()
  archive.pipe(stream)

  await appendFilesToArchive(
    items.map((item) => ({
      lessonId,
      activityId,
      pupilId: item.pupilId,
      fileName: item.fileName as string,
      folderName: item.pupilName ?? item.pupilId,
    })),
    storage,
    archive,
  )

  void archive.finalize()

  const webStream = Readable.toWeb(stream) as unknown as ReadableStream
  const safeName = `queue-${activityId}.zip`

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}"`,
    },
  })
}

export async function POST(request: Request) {
  const profile = await requireTeacherProfile()
  if (!profile) {
    return NextResponse.json({ error: "You need to sign in as a teacher." }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const parsed = z
    .object({
      items: z.array(DownloadItemSchema).min(1),
    })
    .safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid download request." }, { status: 400 })
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  const archive = archiver("zip", { zlib: { level: 9 } })
  const stream = new PassThrough()
  archive.pipe(stream)

  await appendFilesToArchive(parsed.data.items, storage, archive)

  void archive.finalize()

  const webStream = Readable.toWeb(stream) as unknown as ReadableStream
  const safeName = `queue-filtered.zip`

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}"`,
    },
  })
}
