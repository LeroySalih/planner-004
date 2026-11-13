import type { CriterionContext, MarkingRequest } from "@/lib/ai/marking"
import { pastVersionNames } from "@/lib/storage/file-versions"
import {
  classifyUploadFile,
  uploadFileAiMarkingEnabled,
  unreadableExtensions,
  unreadableUploadMessage,
} from "@/lib/upload-file/ai-marking"
import { UploadFileActivityBodySchema } from "@/types"

// Builds the marking request for an upload-file activity with AI marking on:
// the pupil's current files go to the model as images, PDF documents or text.
// Files the model cannot read (a .docx, say) are left out and named in the
// prompt; only when it can read none is the work refused before a call, and
// the teacher told to mark it themselves.

/**
 * A problem retrying cannot fix: no readable file, files too large, AI
 * marking turned off. marking-queue reads `permanent` and fails the submission
 * at once with this message instead of retrying.
 */
export class UploadFileMarkingError extends Error {
  readonly permanent = true
}

/** Caps on what one marking call carries. Claude takes images up to 5 MB and requests up to 32 MB. */
export const UPLOAD_FILE_MARKING_LIMITS = Object.freeze({
  maxFiles: 10,
  maxImageBytes: 5 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxTextChars: 60_000,
})

export type UploadedFileRef = { name: string; path: string }

/**
 * The pupil's current files on this submission. Replacing a file keeps the
 * old copy in uploaded_files under a stamped name; that copy is a past
 * version and is not marked (src/lib/storage/file-versions.ts).
 */
export function currentUploadedFiles(submissionBody: unknown): UploadedFileRef[] {
  const record = (submissionBody ?? {}) as { uploaded_files?: unknown; upload_file_name?: unknown }
  const files: UploadedFileRef[] = Array.isArray(record.uploaded_files)
    ? record.uploaded_files
      .filter((file): file is { name: string; path?: unknown } =>
        typeof file === "object" && file !== null && typeof (file as { name?: unknown }).name === "string")
      .map((file) => ({ name: file.name, path: typeof file.path === "string" ? file.path : "" }))
    : typeof record.upload_file_name === "string" && record.upload_file_name
      ? [{ name: record.upload_file_name, path: "" }]
      : []
  const past = pastVersionNames(files.map((file) => file.name))
  return files.filter((file) => !past.has(file.name))
}

/**
 * Whether a submission should be queued: null to queue it, `skip` when the
 * activity is not AI-marked, or the message the teacher sees when the AI
 * cannot read the work. Looks at file names only, so it costs nothing.
 */
export function uploadFileQueueDecision(
  activityBody: unknown,
  submissionBody: unknown,
): null | { skip: true } | { refuse: string } {
  if (!uploadFileAiMarkingEnabled(activityBody)) return { skip: true }
  const files = currentUploadedFiles(submissionBody)
  const unreadable = unreadableUploadMessage(files.map((file) => file.name))
  if (unreadable) return { refuse: unreadable }
  const readable = files.filter((file) => classifyUploadFile(file.name)).length
  if (readable > UPLOAD_FILE_MARKING_LIMITS.maxFiles) {
    return { refuse: `${readable} files is more than the AI reads at once (${UPLOAD_FILE_MARKING_LIMITS.maxFiles}); mark this yourself.` }
  }
  return null
}

/** Rich text instructions as plain text for the prompt. */
function plainText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/**
 * The marking request for one upload-file submission. `readFile` returns a
 * stored file's bytes; the queue passes the lessons bucket, a check passes a
 * stub. Throws UploadFileMarkingError for anything a retry will not fix.
 */
export async function buildUploadFileMarkingRequest({
  activityBody,
  submissionBody,
  maxMarks,
  criterion,
  readFile,
}: {
  activityBody: unknown
  submissionBody: unknown
  maxMarks: number
  criterion: CriterionContext | null
  readFile: (path: string) => Promise<Buffer>
}): Promise<MarkingRequest> {
  const parsedActivity = UploadFileActivityBodySchema.safeParse(activityBody ?? {})
  const activity = parsedActivity.success ? parsedActivity.data : {}
  if (!uploadFileAiMarkingEnabled(activity)) {
    throw new UploadFileMarkingError("AI marking is turned off for this activity; mark this yourself.")
  }
  const markingGuidance = (activity.markingGuidance ?? "").trim()
  if (!markingGuidance) {
    throw new UploadFileMarkingError(
      "The activity has no marking prompt. Add one in the lesson editor, then resend the work for marking.",
    )
  }

  const decision = uploadFileQueueDecision(activity, submissionBody)
  if (decision && "refuse" in decision) throw new UploadFileMarkingError(decision.refuse)

  const allFiles = currentUploadedFiles(submissionBody)
  const files = allFiles.filter((file) => classifyUploadFile(file.name))
  const skipped = allFiles.filter((file) => !classifyUploadFile(file.name))
  const images: NonNullable<MarkingRequest["images"]> = []
  const listing: string[] = []
  const texts: string[] = []
  let totalBytes = 0
  let totalTextChars = 0
  const textFileCount = files.filter((file) => classifyUploadFile(file.name)?.kind === "text").length

  for (const file of files) {
    const kind = classifyUploadFile(file.name)!
    if (!file.path) {
      throw new UploadFileMarkingError(`${file.name} was uploaded before files were tracked and cannot be found; mark this yourself.`)
    }
    // A missing file is not retried into existence, but a storage blip is
    // worth another attempt, so read errors are left to the queue's retry.
    const bytes = await readFile(file.path)
    totalBytes += bytes.length
    if (totalBytes > UPLOAD_FILE_MARKING_LIMITS.maxTotalBytes) {
      throw new UploadFileMarkingError(
        `The uploaded files are more than the AI reads at once (${megabytes(UPLOAD_FILE_MARKING_LIMITS.maxTotalBytes)}); mark this yourself.`,
      )
    }

    if (kind.kind === "text") {
      const text = bytes.toString("utf8")
      if (text.includes("\u0000")) {
        throw new UploadFileMarkingError(`${file.name} is not a text file the AI can read; mark this yourself.`)
      }
      // The cap is on all the text together: it all goes in one prompt.
      totalTextChars += text.length
      if (totalTextChars > UPLOAD_FILE_MARKING_LIMITS.maxTextChars) {
        throw new UploadFileMarkingError(
          `${textFileCount > 1 ? "The text files are" : `${file.name} is`} longer than the AI reads (${UPLOAD_FILE_MARKING_LIMITS.maxTextChars.toLocaleString("en-GB")} characters); mark this yourself.`,
        )
      }
      listing.push(`- ${file.name} (shown below)`)
      texts.push(`--- File: ${file.name} ---\n${text.trim() || "(empty file)"}\n--- End of ${file.name} ---`)
      continue
    }

    if (kind.kind === "image" && bytes.length > UPLOAD_FILE_MARKING_LIMITS.maxImageBytes) {
      throw new UploadFileMarkingError(
        `${file.name} is larger than the AI reads (${megabytes(UPLOAD_FILE_MARKING_LIMITS.maxImageBytes)} per image); mark this yourself.`,
      )
    }
    listing.push(`- ${file.name} (attached ${kind.kind === "pdf" ? "PDF" : "image"})`)
    images.push({ dataUrl: `data:${kind.mimeType};base64,${bytes.toString("base64")}`, fileName: file.name })
  }

  // The model is told what it was not shown, so it marks only what it can see
  // and says so, rather than guessing at the missing work.
  const skippedNote = skipped.length > 0
    ? [
      `The pupil also uploaded ${skipped.map((file) => file.name).join(", ")}, which you cannot read (${unreadableExtensions(skipped.map((file) => file.name)).join(", ")} files are not shown). Mark only the work in the files you can see; where a criterion depends on work that may be in the files you cannot see, say so in your feedback so the teacher can check it.`,
    ]
    : []
  const pupilAnswer = [
    `The pupil uploaded ${allFiles.length} file${allFiles.length === 1 ? "" : "s"}. Mark the work in ${skipped.length > 0 ? "the ones listed here" : "them"}:`,
    listing.join("\n"),
    ...skippedNote,
    ...texts,
  ].join("\n\n")

  return {
    question: plainText(activity.instructions) || "Mark the pupil's uploaded work.",
    modelAnswer: null,
    markingGuidance,
    pupilAnswer,
    maxMarks,
    criterion,
    images,
  }
}
