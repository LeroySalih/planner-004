"use server"

import { revalidatePath } from "next/cache"

import { requireTeacherProfile } from "@/lib/auth"
import { rasterizePdfToJpegs } from "@/lib/pdf/rasterize-pdf"
import { convertToPdfViaGotenberg } from "@/lib/pdf/gotenberg"
import { createLessonActivityAction } from "@/lib/server-actions/lesson-activities"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const MAX_PAGES = 10
const MAX_BYTES = 10 * 1024 * 1024
const LESSON_FILES_BUCKET = "lessons"
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"

export interface ImportSlidesResult {
  success: boolean
  error: string | null
  created: number
}

/**
 * Import a slide deck (.pdf or .pptx): obtain a PDF (PDFs pass through, PPTX is
 * converted via Gotenberg), rasterize each page to a JPEG, and append one
 * `display-image` activity per page to the end of the lesson. Teacher-only.
 */
export async function importSlidesAction(
  formData: FormData,
): Promise<ImportSlidesResult> {
  const profile = await requireTeacherProfile()

  const lessonId = formData.get("lessonId")
  const unitId = formData.get("unitId")
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return { success: false, error: "Missing lesson identifier.", created: 0 }
  }
  if (typeof unitId !== "string" || unitId.trim() === "") {
    return { success: false, error: "Missing unit identifier.", created: 0 }
  }
  if (!(file instanceof File)) {
    return { success: false, error: "No file provided.", created: 0 }
  }

  const name = file.name.toLowerCase()
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf")
  const isPptx = file.type === PPTX_MIME || name.endsWith(".pptx")
  if (!isPdf && !isPptx) {
    return {
      success: false,
      error: "Please upload a PDF or PowerPoint (.pptx) file.",
      created: 0,
    }
  }
  if (file.size > MAX_BYTES) {
    return { success: false, error: "The file exceeds the 10MB limit.", created: 0 }
  }

  const uploaded = Buffer.from(await file.arrayBuffer())

  // Normalise to a PDF: PPTX goes through Gotenberg; PDFs are used as-is.
  let pdfBuffer: Buffer
  if (isPptx) {
    const { pdf, error } = await convertToPdfViaGotenberg(uploaded, file.name)
    if (error || !pdf) {
      return { success: false, error: error ?? "Could not convert the file.", created: 0 }
    }
    pdfBuffer = pdf
  } else {
    pdfBuffer = uploaded
  }

  const { pages, error } = await rasterizePdfToJpegs(pdfBuffer, { maxPages: MAX_PAGES })
  if (error) {
    return { success: false, error, created: 0 }
  }
  if (pages.length === 0) {
    return { success: false, error: "No pages found in the file.", created: 0 }
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const baseTitle = file.name.replace(/\.(pdf|pptx)$/i, "").trim() || "Slide"

  let created = 0
  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1
    const fileName = `slide-${pageNumber}.jpg`

    const result = await createLessonActivityAction(unitId, lessonId, {
      title: `${baseTitle} — Slide ${pageNumber}`,
      type: "display-image",
      bodyData: { imageFile: fileName },
    })

    if (!result.success || !result.data) {
      return {
        success: created > 0,
        error: `Imported ${created} slide(s), then failed: ${result.error ?? "unable to create activity."}`,
        created,
      }
    }

    const activityId = (result.data as { activity_id: string }).activity_id
    const fullPath = `${LESSON_FILES_BUCKET}/${lessonId}/activities/${activityId}/${fileName}`
    const { error: uploadError } = await storage.upload(fullPath, pages[index], {
      contentType: "image/jpeg",
      uploadedBy: profile.userId,
      originalPath: fullPath,
    })

    if (uploadError) {
      return {
        success: created > 0,
        error: `Imported ${created} slide(s), then failed to store an image: ${uploadError.message}`,
        created,
      }
    }

    created += 1
  }

  revalidatePath(`/lessons/${lessonId}`)
  revalidatePath(`/units/${unitId}`)

  return { success: true, error: null, created }
}
