// AI marking of upload-file activities: the rules shared by the editor, MCP,
// the upload route and the marking queue. No server imports, so the lesson
// editor can use it.
//
// An upload-file activity is teacher-marked unless body_data.aiMarking is on.
// Then each success criterion is marked by a model from the pupil's current
// files against body_data.markingGuidance (the editor's "Marking prompt").

import { UploadFileActivityBodySchema, type UploadFileActivityBody } from "@/types"

/** body_data.aiMarking is on. Absent or anything but true is off. */
export function uploadFileAiMarkingEnabled(bodyData: unknown): boolean {
  return typeof bodyData === "object" && bodyData !== null && (bodyData as { aiMarking?: unknown }).aiMarking === true
}

/**
 * Why this body cannot be saved, or null. The schema is lenient so old rows
 * still read; saving with AI marking on needs a marking prompt, as upload-code
 * needs its marking guidance, or every pupil's upload would fail to mark.
 */
export function uploadFileAiMarkingError(bodyData: unknown): string | null {
  const parsed = UploadFileActivityBodySchema.safeParse(bodyData ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return `${issue.path.join(".") || "body"}: ${issue.message}`
  }
  const body: UploadFileActivityBody = parsed.data
  if (body.aiMarking === true && !(body.markingGuidance ?? "").trim()) {
    return "Add a marking prompt so the AI knows what to look for, or turn off Mark with AI."
  }
  return null
}

/** How a pupil's file reaches the model. */
export type UploadFileModelKind = "image" | "pdf" | "text"

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

const TEXT_EXTENSIONS = new Set(["txt", "csv", "md", "py", "html", "htm", "css", "js", "json"])

/** The lower-case extension without the dot, or "" when there is none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : ""
}

/** How the model reads a file of this name, or null when it cannot. */
export function classifyUploadFile(fileName: string): { kind: UploadFileModelKind; mimeType: string } | null {
  const ext = fileExtension(fileName)
  if (IMAGE_MIME[ext]) return { kind: "image", mimeType: IMAGE_MIME[ext] }
  if (ext === "pdf") return { kind: "pdf", mimeType: "application/pdf" }
  if (TEXT_EXTENSIONS.has(ext)) return { kind: "text", mimeType: "text/plain" }
  return null
}

/** The extensions of the files the AI cannot read, as ".docx", once each. */
export function unreadableExtensions(fileNames: string[]): string[] {
  return [...new Set(
    fileNames.filter((name) => !classifyUploadFile(name)).map((name) => fileExtension(name) ? `.${fileExtension(name)}` : "extension-less"),
  )]
}

/**
 * Shown to the teacher (submissions.mark_error) when the AI can read none of
 * the work. A mix is marked from the files it can read, so this is null then.
 */
export function unreadableUploadMessage(fileNames: string[]): string | null {
  if (fileNames.length === 0) return "There are no uploaded files for the AI to read; mark this yourself."
  if (fileNames.some((name) => classifyUploadFile(name))) return null
  return `AI can't read ${unreadableExtensions(fileNames).join(", ")} files; mark this yourself.`
}
