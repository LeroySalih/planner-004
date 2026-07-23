"use server"

import { requireTeacherProfile } from "@/lib/auth"
import { convertToPdfViaGotenberg } from "@/lib/pdf/gotenberg"
import { rasterizePdfToJpegs } from "@/lib/pdf/rasterize-pdf"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"
const MAX_PDF_PAGES = 20
const MAX_BYTES = 10 * 1024 * 1024
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"]
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const DOC_MIME = "application/msword"

export interface WorksheetTeacherImage {
  filePath: string
  fileName: string
}

export interface UploadWorksheetTeacherFileResult {
  images: WorksheetTeacherImage[]
  error: string | null
}

/**
 * Upload a teacher worksheet/answer-sheet asset for a mark-worksheet activity.
 * Images are stored as-is; PDFs are rasterized to one JPEG per page (poppler),
 * so the activity's stored assets are always images (for display + AI marking).
 * Returns the resulting image references to record in body_data.
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
    return { images: [], error: "Missing lesson identifier." }
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return { images: [], error: "Missing activity identifier." }
  }
  if (!(file instanceof File)) {
    return { images: [], error: "No file provided." }
  }
  if (file.size > MAX_BYTES) {
    return { images: [], error: "The file exceeds the 10MB limit." }
  }

  const name = file.name.toLowerCase()
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf")
  const isWord =
    file.type === DOCX_MIME || file.type === DOC_MIME || name.endsWith(".docx") || name.endsWith(".doc")
  const isImage = file.type.startsWith("image/") || IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))
  if (!isPdf && !isWord && !isImage) {
    return { images: [], error: "Only PDF, Word (.doc/.docx), or image files are allowed." }
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const prefix = (typeof prefixRaw === "string" ? prefixRaw : "asset").replace(/[^a-z0-9-]/gi, "") || "asset"
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
    if (isPdf || isWord) {
      // Word documents have no image renderer of their own — convert to PDF
      // (Gotenberg), then rasterize. PDFs skip straight to rasterization.
      let pdfBuffer: Buffer = buffer
      if (isWord) {
        const { pdf, error } = await convertToPdfViaGotenberg(buffer, file.name)
        if (error || !pdf) return { images: [], error: error ?? "Could not convert the document." }
        pdfBuffer = pdf
      }
      const { pages, error } = await rasterizePdfToJpegs(pdfBuffer, { maxPages: MAX_PDF_PAGES })
      if (error) return { images: [], error }
      const base = file.name.replace(/\.(pdf|docx?)$/i, "").replace(/[^a-z0-9-]/gi, "_")
      for (let i = 0; i < pages.length; i += 1) {
        await store(pages[i], `${prefix}-${stamp}-${base}-${i + 1}.jpg`, "image/jpeg")
      }
    } else {
      const cleanName = file.name.replace(/\s+/g, "_")
      await store(buffer, `${prefix}-${stamp}-${cleanName}`, file.type || "image/jpeg")
    }
    return { images: out, error: null }
  } catch (err) {
    console.error("[worksheet-assets] upload failed", err)
    return { images: [], error: err instanceof Error ? err.message : "Upload failed." }
  }
}
