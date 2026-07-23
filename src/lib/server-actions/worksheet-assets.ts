"use server"

import { requireTeacherProfile } from "@/lib/auth"
import { rasterizePdfToJpegs } from "@/lib/pdf/rasterize-pdf"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { enqueueJob, triggerJobProcessor } from "@/lib/jobs/external-jobs"

const LESSON_FILES_BUCKET = "lessons"
const MAX_PDF_PAGES = 20
const MAX_BYTES = 10 * 1024 * 1024
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"]
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const DOC_MIME = "application/msword"
// Small delay so the caller's activity save completes before the conversion job
// writes the resulting pages back into the activity's body_data.
const DOC_CONVERT_DELAY_SECS = 5

export interface WorksheetTeacherImage {
  filePath: string
  fileName: string
}

export interface UploadWorksheetTeacherFileResult {
  /** Images available immediately (uploaded images + rasterized PDF pages). */
  images: WorksheetTeacherImage[]
  /** Files being converted asynchronously via the queue (Word docs). */
  pending: Array<{ fileName: string }>
  error: string | null
}

/**
 * Upload a teacher worksheet/answer-sheet asset for a mark-worksheet activity.
 * Images are stored as-is; PDFs are rasterized to JPEGs inline (poppler, local).
 * Word documents (.doc/.docx) require the external Gotenberg service, so they
 * are stored raw and a `doc_convert` job is enqueued — the job converts and
 * appends the resulting pages to the activity's body_data. All external-service
 * work therefore flows through the tracked job queue.
 */
export async function uploadWorksheetTeacherFileAction(
  formData: FormData,
): Promise<UploadWorksheetTeacherFileResult> {
  const profile = await requireTeacherProfile()

  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const prefixRaw = formData.get("prefix")
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return { images: [], pending: [], error: "Missing lesson identifier." }
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return { images: [], pending: [], error: "Missing activity identifier." }
  }
  if (!(file instanceof File)) {
    return { images: [], pending: [], error: "No file provided." }
  }
  if (file.size > MAX_BYTES) {
    return { images: [], pending: [], error: "The file exceeds the 10MB limit." }
  }

  const name = file.name.toLowerCase()
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf")
  const isWord =
    file.type === DOCX_MIME || file.type === DOC_MIME || name.endsWith(".docx") || name.endsWith(".doc")
  const isImage = file.type.startsWith("image/") || IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))
  if (!isPdf && !isWord && !isImage) {
    return { images: [], pending: [], error: "Only PDF, Word (.doc/.docx), or image files are allowed." }
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const prefix = (typeof prefixRaw === "string" ? prefixRaw : "asset").replace(/[^a-z0-9-]/gi, "") || "asset"
  const group: "worksheet" | "answer" = prefix === "answer" ? "answer" : "worksheet"
  const stamp = Date.now()
  const out: WorksheetTeacherImage[] = []

  const store = async (buffer: Buffer, fileName: string, contentType: string) => {
    const fullPath = `${LESSON_FILES_BUCKET}/${lessonId}/activities/${activityId}/${fileName}`
    const { error } = await storage.upload(fullPath, buffer, {
      contentType,
      uploadedBy: profile.userId,
      originalPath: fullPath,
    })
    if (error) throw new Error(error.message)
    out.push({ filePath: fullPath, fileName })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())

    if (isWord) {
      // External service (Gotenberg) → route through the tracked job queue.
      const cleanName = file.name.replace(/\s+/g, "_")
      const rawPath = `${LESSON_FILES_BUCKET}/${lessonId}/activities/${activityId}/_pending/${stamp}-${cleanName}`
      const { error: uploadError } = await storage.upload(rawPath, buffer, {
        contentType: file.type || DOCX_MIME,
        uploadedBy: profile.userId,
        originalPath: rawPath,
      })
      if (uploadError) return { images: [], pending: [], error: uploadError.message }

      await enqueueJob(
        "doc_convert",
        { lessonId, activityId, group, rawFilePath: rawPath, fileName: file.name, uploadedBy: profile.userId },
        { processAfterSeconds: DOC_CONVERT_DELAY_SECS },
      )
      void triggerJobProcessor()
      return { images: [], pending: [{ fileName: file.name }], error: null }
    }

    if (isPdf) {
      const { pages, error } = await rasterizePdfToJpegs(buffer, { maxPages: MAX_PDF_PAGES })
      if (error) return { images: [], pending: [], error }
      const base = file.name.replace(/\.pdf$/i, "").replace(/[^a-z0-9-]/gi, "_")
      for (let i = 0; i < pages.length; i += 1) {
        await store(pages[i], `${prefix}-${stamp}-${base}-${i + 1}.jpg`, "image/jpeg")
      }
    } else {
      const cleanName = file.name.replace(/\s+/g, "_")
      await store(buffer, `${prefix}-${stamp}-${cleanName}`, file.type || "image/jpeg")
    }
    return { images: out, pending: [], error: null }
  } catch (err) {
    console.error("[worksheet-assets] upload failed", err)
    return { images: [], pending: [], error: err instanceof Error ? err.message : "Upload failed." }
  }
}
