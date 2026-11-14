import "server-only"

import { createHash } from "node:crypto"

import sharp from "sharp"

import { query } from "@/lib/db"
import { ASSESSMENT_SCRIPTS_BUCKET } from "@/lib/assessment-paper/files"
import {
  readAssessmentQuestions,
  type AnswerKind,
  type AnswerStatus,
  type AssessmentQuestion,
  type SubmissionQuestionAnswerInput,
} from "@/lib/assessment-paper/store"
import { readDocxParagraphs, readEvidenceDocument, type EvidenceImage } from "@/lib/docx/evidence"
import { convertToPdfViaGotenberg, isGotenbergConfigured } from "@/lib/pdf/gotenberg"
import { UnreadablePdfError, pdfPageCount, pdfText, pdfToPngPages } from "@/lib/pdf/poppler"
import { describePresentation, describePresentationSections, filterPresentationSections } from "@/lib/pptx/describe"
import { OfficeFileError } from "@/lib/pptx/errors"
import { inspectPptx, type PresentationReport } from "@/lib/pptx/inspect"
import { listPracticalFiles, readKnownImages, readPracticalFileBytes, type PracticalFileRow } from "@/lib/powerpoint-assessment/files"
import {
  evidenceHeading,
  presentationSections,
  formatPresentationSection,
  type PresentationSectionSelector,
  type QuestionEvidence,
} from "@/lib/powerpoint-assessment/evidence-spec"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { joinLabels } from "@/lib/utils"
import {
  PowerPointAssessmentActivityBodySchema,
  type PowerPointUploadSlot,
  type PowerPointUploadSlotKind,
} from "@/types"

// The read of a PowerPoint assessment (the `ai_read` job), with no model.
//
// Each handed-in file is read by its slot's kind:
//
//   pptx   inspectPptx, knowing the activity's supplied images -> the report
//          and its description;
//   pdf    pdfinfo's page count and pdftotext's text (capped);
//   docx   the evidence document: the text and pictures under each heading
//          the questions' evidence_section sources name, the blank template's
//          text removed. Pictures are stored, teacher-only, at
//          {activityId}/practical/{fileId}/evidence/{heading}-{n}.png|jpg.
//
// A pptx slot that any question reads as slide_images is also rendered:
// LibreOffice (Gotenberg) converts it to a PDF, and pdftoppm draws each page
// (up to SLIDE_RENDER_MAX_SLIDES), stored teacher-only at
// {activityId}/practical/{fileId}/evidence/slide-{n}.png|jpg. The marker
// judges appearance from these. Rendering is not reading: when the renderer
// is not configured or fails, the presentation is still read, the reason is
// recorded (report.slideImages, the job row's warnings) and the marker is told
// the slides are not available. Nothing is held for it.
//
// What was read is stored per file (practical_submission_evidence) under a
// cache key (the file's sha256, the reader's inputs, READER_VERSION), so an
// unchanged file is not read again when the submission is re-sent.
//
// A file the reader cannot read (a damaged or protected presentation or
// document, an unreadable or oversized PDF) holds the WHOLE submission: no
// question is marked from part of the work. Otherwise each question gets an
// answer (pages: []):
//
//   status  blank when a required source is missing, or no source has
//           anything (-> 0, no mark job; the 0's comment is the answer's
//           blankReason, e.g. "Slide 6 is not in your presentation.", or
//           "No answer submitted" when there is nothing more to say); else
//           answered. A source is missing when its slot has no file; for an
//           evidence_section also when its heading is not in the document, or
//           (want 'text') it has no typed text, (want 'screenshots') no
//           picture, (want 'both') neither text nor a picture: either one is
//           enough. A required presentation source is missing when none of
//           its sections exists (slides:6 in a five-slide file).
//           A missing required screenshot is always blank (teacher decision
//           4): pictures outside every heading are kept for the teacher but
//           never stand in for it.
//   kind    text when every source is typed text (want 'text'), else mixed.
//   transcription
//           the typed answer when the question reads typed text (one source:
//           exactly its text), otherwise a short digest of what the marker
//           will be given.
//
// Facts only: nothing here decides a mark. Nothing here knows any particular
// paper; slots, headings and sections are the teacher's data.

/** Bump when a reader's output changes, so stored evidence is read again. */
export const READER_VERSION = "powerpoint-reader-1"
/** Characters of a PDF's text kept. */
export const PDF_TEXT_MAX_CHARS = 20_000
/** A PDF larger than this is not read: the marker takes no larger (MARK_MAX_PDF_BYTES, marking.ts). */
export const PDF_MAX_BYTES = 10 * 1024 * 1024
/** Slides rendered at most; a longer presentation's later slides are not drawn. */
export const SLIDE_RENDER_MAX_SLIDES = 40
/** pdftoppm resolution: a 13.33-inch widescreen slide comes out 1600 px wide. */
export const SLIDE_RENDER_DPI = 120
/** A rendered slide's long side, at most. */
export const SLIDE_IMAGE_MAX_SIDE = 1600
/** A rendered slide larger than this as a PNG is stored as a JPEG. */
const SLIDE_PNG_MAX_BYTES = 1.5 * 1024 * 1024
const SLIDE_RENDER_TIMEOUT_MS = 180_000
/** Part of a rendered presentation's cache key: bump when rendering changes. */
export const SLIDE_RENDER_VERSION = "slides-1"

/** pptx bytes -> PDF bytes, or why not. */
export type PresentationRenderer = (pptx: Buffer) => Promise<{ pdf: Buffer | null; error: string | null }>

/** The readers, injectable so a check can count calls. */
export interface PowerPointReaders {
  inspectPptx: typeof inspectPptx
  readEvidenceDocument: typeof readEvidenceDocument
  pdfPageCount: typeof pdfPageCount
  pdfText: typeof pdfText
  /** Absent: LibreOffice via Gotenberg (renderWithGotenberg). */
  renderPresentation?: PresentationRenderer
}

/** The default renderer: Gotenberg's LibreOffice route, hidden slides included so pages match slide numbers. */
export const renderWithGotenberg: PresentationRenderer = async (pptx) => {
  if (!isGotenbergConfigured()) {
    return { pdf: null, error: "the slide renderer (Gotenberg) is not configured on this server" }
  }
  const converted = await convertToPdfViaGotenberg(pptx, "presentation.pptx", {
    timeoutMs: SLIDE_RENDER_TIMEOUT_MS,
    fields: { exportHiddenSlides: "true" },
  })
  return converted.pdf
    ? converted
    : { pdf: null, error: (converted.error ?? "the slide renderer failed").replace(/\.$/, "") }
}

const DEFAULT_READERS: PowerPointReaders = { inspectPptx, readEvidenceDocument, pdfPageCount, pdfText }

export type EvidenceKind = "presentation" | "pdf" | "evidence_doc"

const EVIDENCE_KIND: Record<PowerPointUploadSlotKind, EvidenceKind> = {
  pptx: "presentation",
  pdf: "pdf",
  docx: "evidence_doc",
}

/** A picture the reader stored from an evidence document. */
export type StoredEvidenceImage = {
  path: string
  name: string
  mimeType: "image/png" | "image/jpeg"
  width: number
  height: number
  bytes: number
}

/** A slide drawn by LibreOffice, stored teacher-only. */
export type SlideImage = {
  slide: number
  path: string
  mimeType: "image/png" | "image/jpeg"
  width: number
  height: number
  bytes: number
}

/** practical_submission_evidence.report.slideImages of a rendered presentation. */
export type SlideImagesRead =
  | {
      status: "ok"
      /** Slides in the presentation. */
      slideCount: number
      /** Slide numbers past SLIDE_RENDER_MAX_SLIDES, not drawn. */
      notRendered: number[]
      images: SlideImage[]
    }
  | { status: "unavailable"; reason: string }

export type EvidenceDocSection = {
  label: string
  heading: string
  text: string
  images: StoredEvidenceImage[]
  notShown: { name: string; reason: string }[]
}

/** practical_submission_evidence.report for an evidence document. */
export type EvidenceDocReport = {
  sections: EvidenceDocSection[]
  /** Outside every heading: kept for the teacher, never marked. */
  unplaced: { text: string; images: StoredEvidenceImage[]; notShown: { name: string; reason: string }[] }
  missingHeadings: string[]
  warnings: string[]
  template: { fileName: string; used: boolean } | null
}

/** practical_submission_evidence.report for a PDF. */
export type PdfReport = { pageCount: number; text: string; chars: number; truncated: boolean }

export type SlotEvidence =
  | {
      kind: "presentation"
      status: "ok"
      report: PresentationReport
      description: string
      /** Null when no question reads the slot's slides as pictures. */
      slideImages: SlideImagesRead | null
    }
  | { kind: "pdf"; status: "ok"; report: PdfReport }
  | { kind: "evidence_doc"; status: "ok"; report: EvidenceDocReport }
  | { kind: EvidenceKind; status: "error"; error: string; tooLarge?: boolean }

export type SlotRead = {
  slot: PowerPointUploadSlot
  file: PracticalFileRow | null
  evidence: SlotEvidence | null
  cached: boolean
  durationMs: number
}

export interface PowerPointReadCallRecord {
  request: {
    reader: "powerpoint"
    readerVersion: string
    /** No pupil file names: the slot's label, the file id and its type. */
    files: { slot: string; label: string; fileId: string; ext: string; bytes: number; sha256: string; cached: boolean }[]
    durations: Record<string, number>
  }
  response: {
    slots: {
      slot: string
      kind: EvidenceKind
      status: "ok" | "error"
      error?: string
      cached: boolean
      slidesRendered?: number
      sectionsFound?: string[]
      missingHeadings?: string[]
      unplacedPictures?: number
      warnings: string[]
    }[]
    answers: { label: string; kind: AnswerKind; status: AnswerStatus }[]
    held: string | null
  }
  durationMs: number
}

export type PowerPointRead = {
  /** Every question's answer; empty when held. */
  answers: SubmissionQuestionAnswerInput[]
  /** Why the whole submission is not marked (mark_error, for the teacher: may name the pupil's files), or null. */
  held: string | null
  /** The same reason with no pupil file names, for logs and job rows. */
  heldForLog: string | null
  slots: SlotRead[]
  call: PowerPointReadCallRecord
}

function sha256(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex")
}

/** How an evidence heading is matched to a section the reader found. */
export function evidenceLabelKey(label: string) {
  return label.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function readStored(bucket: string, storagePath: string): Promise<Buffer | null> {
  const { stream, error } = await createLocalStorageClient(bucket).getFileStream(storagePath)
  if (error || !stream) return null
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** An ordinary activity file (the teacher's material), or null when there is none of that name. */
export async function readActivityFile(lessonId: string, activityId: string, fileName: string): Promise<Buffer | null> {
  return readStored("lessons", `lessons/${lessonId}/activities/${activityId}/${fileName}`)
}

type ActivityContext = {
  activityId: string
  lessonId: string
  slots: PowerPointUploadSlot[]
  evidenceTemplateFile: string | null
  /** Why the activity's body cannot be read, or null. */
  bodyError: string | null
}

async function readActivity(submissionId: string): Promise<ActivityContext> {
  const { rows } = await query<{ activity_id: string; lesson_id: string; body_data: unknown }>(
    `select a.activity_id, a.lesson_id, a.body_data
       from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1`,
    [submissionId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Submission ${submissionId} not found.`)
  const body = PowerPointAssessmentActivityBodySchema.safeParse(row.body_data ?? {})
  return {
    activityId: row.activity_id,
    lessonId: row.lesson_id,
    slots: body.success ? body.data.uploadSlots : [],
    evidenceTemplateFile: body.success ? body.data.evidenceTemplateFile ?? null : null,
    bodyError: body.success
      ? null
      : "Not marked: this PowerPoint assessment's upload slots are not set up. Set them up in the lesson editor, then send the work again.",
  }
}

/** The headings each docx slot is read for, from the questions' evidence_section sources (one per heading). */
function headingsBySlot(questions: AssessmentQuestion[]): Map<string, string[]> {
  const out = new Map<string, Map<string, string>>()
  for (const question of questions) {
    for (const source of question.evidence) {
      if (source.source !== "evidence_section") continue
      const heading = evidenceHeading(source, question.label)
      const keyed = out.get(source.slot) ?? new Map<string, string>()
      if (!keyed.has(evidenceLabelKey(heading))) keyed.set(evidenceLabelKey(heading), heading)
      out.set(source.slot, keyed)
    }
  }
  return new Map([...out].map(([slot, keyed]) => [slot, [...keyed.values()].sort()]))
}

/** The pptx slots some question reads as slide_images. */
function renderedSlots(questions: AssessmentQuestion[]): Set<string> {
  return new Set(questions.flatMap((q) => q.evidence.flatMap((source) => (source.source === "slide_images" ? [source.slot] : []))))
}

export type StoredEvidenceRow = {
  status: "ok" | "error"
  error: string | null
  cache_key: string
  report: unknown
  description: string | null
}

/** A practical_submission_evidence row as the reader stored it. */
export function evidenceFromRow(kind: EvidenceKind, row: StoredEvidenceRow): SlotEvidence {
  if (row.status === "error") {
    return {
      kind,
      status: "error",
      error: row.error ?? "The file could not be read.",
      tooLarge: (row.report as { refusal?: string } | null)?.refusal === "too-large",
    }
  }
  if (kind === "presentation") {
    // Stored as the report with the rendering beside it (see readFile).
    const { slideImages, ...report } = row.report as PresentationReport & { slideImages?: SlideImagesRead }
    return {
      kind,
      status: "ok",
      report: report as PresentationReport,
      description: row.description ?? "",
      slideImages: slideImages ?? null,
    }
  }
  if (kind === "pdf") return { kind, status: "ok", report: row.report as PdfReport }
  return { kind, status: "ok", report: row.report as EvidenceDocReport }
}

async function removeEvidenceImages(activityId: string, fileId: string) {
  const folder = `${activityId}/practical/${fileId}/evidence`
  const { rows } = await query<{ path: string }>(
    `select scope_path || '/' || file_name as path from stored_files
      where bucket = $1 and (scope_path = $2 or scope_path like $3)`,
    [ASSESSMENT_SCRIPTS_BUCKET, folder, `${folder.replace(/[\\%_]/g, "\\$&")}/%`],
  )
  if (rows.length === 0) return
  const { error } = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(rows.map((row) => row.path))
  if (error) throw new Error(`Could not clear what was read before from file ${fileId}: ${error.message}`)
}

async function storeEvidenceImages(
  activityId: string,
  fileId: string,
  stem: string,
  images: EvidenceImage[],
  paths: string[],
): Promise<StoredEvidenceImage[]> {
  const storage = createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET)
  const stored: StoredEvidenceImage[] = []
  for (const [index, image] of images.entries()) {
    const ext = image.mimeType === "image/png" ? "png" : "jpg"
    const storagePath = `${activityId}/practical/${fileId}/evidence/${stem}-${index + 1}.${ext}`
    const { error } = await storage.upload(storagePath, image.data, {
      contentType: image.mimeType,
      uploadedBy: null,
      originalPath: storagePath,
    })
    if (error) throw new Error(`Storage upload failed: ${error.message}`)
    paths.push(storagePath)
    stored.push({
      path: storagePath,
      name: image.name,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
    })
  }
  return stored
}

/** "Rendered slides are not available: <reason>." */
export function slidesUnavailableNote(reason: string) {
  return `Rendered slides are not available: ${reason}.`
}

/**
 * Draw a presentation's slides: LibreOffice's PDF, its page count checked
 * against the presentation's slides, then at most SLIDE_RENDER_MAX_SLIDES
 * pages drawn, each scaled to SLIDE_IMAGE_MAX_SIDE and stored. Any failure
 * is the 'unavailable' result with the reason; it never throws for the
 * renderer or the PDF, only for storage.
 */
async function renderSlideImages(
  activityId: string,
  fileId: string,
  pptx: Buffer,
  report: PresentationReport,
  render: PresentationRenderer,
  paths: string[],
): Promise<SlideImagesRead> {
  const unavailable = (reason: string): SlideImagesRead => ({ status: "unavailable", reason })
  let pdf: Buffer | null
  try {
    const converted = await render(pptx)
    pdf = converted.pdf
    if (!pdf) return unavailable(converted.error ?? "the slide renderer failed")
  } catch (error) {
    return unavailable(`the slide renderer failed (${messageOf(error)})`)
  }

  const slideCount = report.presentation.slideCount
  let pages: number
  try {
    pages = await pdfPageCount(pdf)
  } catch {
    return unavailable("the slide renderer's PDF could not be read")
  }
  if (pages !== slideCount) {
    return unavailable(`the slide renderer drew ${plural(pages, "page")} for ${plural(slideCount, "slide")}, so pages cannot be matched to slides`)
  }
  const drawn = Math.min(pages, SLIDE_RENDER_MAX_SLIDES)
  if (drawn === 0) return { status: "ok", slideCount, notRendered: [], images: [] }

  let pngs: Buffer[]
  try {
    pngs = await pdfToPngPages(pdf, { dpi: SLIDE_RENDER_DPI, firstPage: 1, lastPage: drawn })
  } catch {
    return unavailable("the rendered slides could not be drawn as pictures")
  }
  if (pngs.length !== drawn) {
    return unavailable(`the rendered slides came out as ${plural(pngs.length, "picture")}, not ${drawn}`)
  }

  const storage = createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET)
  const images: SlideImage[] = []
  for (const [index, png] of pngs.entries()) {
    const slide = index + 1
    const resized = sharp(png).resize({
      width: SLIDE_IMAGE_MAX_SIDE,
      height: SLIDE_IMAGE_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    let data = await resized.clone().png({ compressionLevel: 9 }).toBuffer()
    let mimeType: SlideImage["mimeType"] = "image/png"
    if (data.byteLength > SLIDE_PNG_MAX_BYTES) {
      data = await resized.clone().jpeg({ quality: 85 }).toBuffer()
      mimeType = "image/jpeg"
    }
    const meta = await sharp(data).metadata()
    const storagePath = `${activityId}/practical/${fileId}/evidence/slide-${slide}.${mimeType === "image/png" ? "png" : "jpg"}`
    const { error } = await storage.upload(storagePath, data, { contentType: mimeType, uploadedBy: null, originalPath: storagePath })
    if (error) throw new Error(`Storage upload failed: ${error.message}`)
    paths.push(storagePath)
    images.push({ slide, path: storagePath, mimeType, width: meta.width ?? 0, height: meta.height ?? 0, bytes: data.byteLength })
  }
  const notRendered = Array.from({ length: pages - drawn }, (_, i) => drawn + i + 1)
  return { status: "ok", slideCount, notRendered, images }
}

type ReadOutcome = {
  evidence: SlotEvidence
  report: unknown
  description: string | null
  imagePaths: string[]
}

/** Read one file. A file the reader refuses comes back as status 'error'; anything else throws (and is retried). */
async function readFile(
  context: ActivityContext,
  slot: PowerPointUploadSlot,
  file: PracticalFileRow,
  bytes: Buffer,
  inputs: {
    knownImages: Awaited<ReturnType<typeof readKnownImages>>
    headings: string[]
    templateParagraphs: string[] | null
    /** Draw the slides too (a question reads them as slide_images). */
    renderSlides: boolean
  },
  readers: PowerPointReaders,
): Promise<ReadOutcome> {
  const kind = EVIDENCE_KIND[slot.kind]
  const refused = (error: string): ReadOutcome => ({
    evidence: { kind, status: "error", error },
    report: null,
    description: null,
    imagePaths: [],
  })

  if (slot.kind === "pptx") {
    // Slides drawn from an earlier read of this file go first.
    await removeEvidenceImages(context.activityId, file.file_id)
    let report: PresentationReport
    try {
      report = await readers.inspectPptx(bytes, { knownImages: inputs.knownImages })
    } catch (error) {
      if (error instanceof OfficeFileError) return refused(error.message)
      throw error
    }
    const description = describePresentation(report)
    const imagePaths: string[] = []
    const slideImages = inputs.renderSlides
      ? await renderSlideImages(
          context.activityId,
          file.file_id,
          bytes,
          report,
          readers.renderPresentation ?? renderWithGotenberg,
          imagePaths,
        )
      : null
    return {
      evidence: { kind: "presentation", status: "ok", report, description, slideImages },
      report: slideImages ? { ...report, slideImages } : report,
      description,
      imagePaths,
    }
  }

  if (slot.kind === "pdf") {
    if (bytes.byteLength > PDF_MAX_BYTES) {
      return {
        evidence: {
          kind,
          status: "error",
          error: `${slot.label} is larger than ${PDF_MAX_BYTES / (1024 * 1024)} MB; save it again with smaller pictures.`,
          tooLarge: true,
        },
        report: { refusal: "too-large" },
        description: null,
        imagePaths: [],
      }
    }
    try {
      const pageCount = await readers.pdfPageCount(bytes)
      const text = await readers.pdfText(bytes, { maxChars: PDF_TEXT_MAX_CHARS })
      const report: PdfReport = { pageCount, text: text.text, chars: text.chars, truncated: text.truncated }
      return { evidence: { kind: "pdf", status: "ok", report }, report, description: null, imagePaths: [] }
    } catch (error) {
      // pdfinfo or pdftotext refused the file: it is the file. Anything else
      // (the tools missing, a timeout) is thrown, so the job retries and
      // nothing is stored.
      if (error instanceof UnreadablePdfError) return refused(error.message)
      throw error
    }
  }

  let read: Awaited<ReturnType<typeof readEvidenceDocument>>
  try {
    read = await readers.readEvidenceDocument(bytes, {
      headings: inputs.headings,
      templateParagraphs: inputs.templateParagraphs ?? undefined,
    })
  } catch (error) {
    if (error instanceof OfficeFileError) return refused(error.message)
    throw error
  }

  await removeEvidenceImages(context.activityId, file.file_id)
  const imagePaths: string[] = []
  const sections: EvidenceDocSection[] = []
  for (const section of read.sections) {
    sections.push({
      label: section.label,
      heading: section.heading,
      text: section.text,
      images: await storeEvidenceImages(context.activityId, file.file_id, evidenceLabelKey(section.label), section.images, imagePaths),
      notShown: section.notShown,
    })
  }
  const unplacedImages = await storeEvidenceImages(context.activityId, file.file_id, "_unplaced", read.unplaced.images, imagePaths)
  const warnings = [...read.warnings]
  const templateName = context.evidenceTemplateFile
  if (templateName && inputs.templateParagraphs === null) {
    warnings.unshift(
      `The evidence template "${templateName}" could not be read from the activity's files, so its text is not removed from the pupil's.`,
    )
  }
  const report: EvidenceDocReport = {
    sections,
    unplaced: { text: read.unplaced.text, images: unplacedImages, notShown: read.unplaced.notShown },
    missingHeadings: read.missingHeadings,
    warnings,
    template: templateName ? { fileName: templateName, used: inputs.templateParagraphs !== null } : null,
  }
  return { evidence: { kind: "evidence_doc", status: "ok", report }, report, description: null, imagePaths }
}

/**
 * Read every handed-in file of a submission (reusing stored evidence whose
 * cache key matches), store what was read, and work out each question's
 * answer. Nothing about the submission's marking is written here; the job
 * (jobs.ts) holds it or completes the read.
 */
export async function readPowerPointSubmission(
  input: { submissionId: string },
  readers: PowerPointReaders = DEFAULT_READERS,
): Promise<PowerPointRead> {
  const started = Date.now()
  const context = await readActivity(input.submissionId)
  const questions = await readAssessmentQuestions(context.activityId)
  const files = await listPracticalFiles(input.submissionId)
  const fileBySlot = new Map(files.map((file) => [file.slot_key, file]))
  const headings = headingsBySlot(questions)
  const toRender = renderedSlots(questions)

  // The reader's inputs besides the file: they are part of the cache key.
  const needsPptx = context.slots.some((slot) => slot.kind === "pptx" && fileBySlot.has(slot.key))
  const knownImages = needsPptx ? await readKnownImages(context.activityId) : []
  const knownImagesHash = sha256(JSON.stringify(knownImages.map((k) => [k.name, k.sha256]).sort()))
  let templateParagraphs: string[] | null = null
  let templateHash = "none"
  const needsDocx = context.slots.some((slot) => slot.kind === "docx" && fileBySlot.has(slot.key))
  if (needsDocx && context.evidenceTemplateFile) {
    const template = await readActivityFile(context.lessonId, context.activityId, context.evidenceTemplateFile)
    if (template) {
      templateHash = sha256(template)
      try {
        templateParagraphs = await readDocxParagraphs(template)
      } catch {
        templateParagraphs = null
        templateHash = `unreadable:${templateHash}`
      }
    } else {
      templateHash = "missing"
    }
  }

  const { rows: storedRows } = await query<StoredEvidenceRow & { file_id: string }>(
    `select file_id::text as file_id, status, error, cache_key, report, description
       from practical_submission_evidence where submission_id = $1`,
    [input.submissionId],
  )
  const storedByFile = new Map(storedRows.map((row) => [row.file_id, row]))

  const slots: SlotRead[] = []
  for (const slot of context.slots) {
    const file = fileBySlot.get(slot.key) ?? null
    if (!file) {
      slots.push({ slot, file: null, evidence: null, cached: false, durationMs: 0 })
      continue
    }
    const kind = EVIDENCE_KIND[slot.kind]
    const slotHeadings = headings.get(slot.key) ?? []
    const renderSlides = slot.kind === "pptx" && toRender.has(slot.key)
    const inputsHash =
      slot.kind === "pptx"
        ? `${knownImagesHash}${renderSlides ? `:${SLIDE_RENDER_VERSION}` : ""}`
        : slot.kind === "docx"
          ? sha256(JSON.stringify({ headings: slotHeadings, template: templateHash }))
          : "-"
    const cacheKey = `${file.sha256}:${inputsHash}:${READER_VERSION}`
    const stored = storedByFile.get(file.file_id)
    if (stored && stored.cache_key === cacheKey) {
      slots.push({ slot, file, evidence: evidenceFromRow(kind, stored), cached: true, durationMs: 0 })
      continue
    }

    const fileStarted = Date.now()
    const bytes = await readPracticalFileBytes(file.file_id)
    const outcome = await readFile(
      context,
      slot,
      file,
      bytes,
      { knownImages, headings: slotHeadings, templateParagraphs, renderSlides },
      readers,
    )
    // Slides that could not be rendered are tried again on the next read.
    const storedKey =
      outcome.evidence.kind === "presentation" && outcome.evidence.status === "ok" && outcome.evidence.slideImages?.status === "unavailable"
        ? `${cacheKey}:not-rendered`
        : cacheKey
    await query(
      `insert into practical_submission_evidence
         (file_id, submission_id, slot_key, kind, status, error, cache_key, report, description, image_paths, extracted_at)
       values ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, timezone('utc', now()))
       on conflict (file_id) do update
         set submission_id = excluded.submission_id, slot_key = excluded.slot_key, kind = excluded.kind,
             status = excluded.status, error = excluded.error, cache_key = excluded.cache_key,
             report = excluded.report, description = excluded.description,
             image_paths = excluded.image_paths, extracted_at = excluded.extracted_at`,
      [
        file.file_id,
        input.submissionId,
        slot.key,
        kind,
        outcome.evidence.status,
        outcome.evidence.status === "error" ? outcome.evidence.error : null,
        storedKey,
        outcome.report === null ? null : JSON.stringify(outcome.report),
        outcome.description,
        outcome.imagePaths,
      ],
    )
    slots.push({ slot, file, evidence: outcome.evidence, cached: false, durationMs: Date.now() - fileStarted })
  }

  const held = context.bodyError ?? holdReason(slots, (read) => read.file!.original_name)
  const heldForLog = context.bodyError ?? holdReason(slots, (read) => `file ${read.file!.file_id}.${storedExtension(read.file!)}`)
  const answers = held ? [] : questions.map((question) => answerFor(question, slots))

  const call: PowerPointReadCallRecord = {
    request: {
      reader: "powerpoint",
      readerVersion: READER_VERSION,
      files: slots.flatMap((read) =>
        read.file
          ? [{
              slot: read.slot.key,
              label: read.slot.label,
              fileId: read.file.file_id,
              ext: storedExtension(read.file),
              bytes: read.file.bytes,
              sha256: read.file.sha256,
              cached: read.cached,
            }]
          : [],
      ),
      durations: Object.fromEntries(slots.filter((read) => read.file).map((read) => [read.slot.key, read.durationMs])),
    },
    response: {
      slots: slots.flatMap((read) => (read.file && read.evidence ? [slotSummary(read)] : [])),
      answers: answers.map((answer) => ({
        label: questions.find((q) => q.questionId === answer.questionId)?.label ?? answer.questionId,
        kind: answer.kind,
        status: answer.status,
      })),
      held: heldForLog,
    },
    durationMs: Date.now() - started,
  }
  return { answers, held, heldForLog, slots, call }
}

function slotSummary(read: SlotRead): PowerPointReadCallRecord["response"]["slots"][number] {
  const evidence = read.evidence!
  const base = { slot: read.slot.key, kind: evidence.kind, status: evidence.status, cached: read.cached }
  if (evidence.status === "error") return { ...base, error: evidence.error, warnings: [] }
  const warnings = evidenceWarnings(evidence)
  if (evidence.kind === "presentation") {
    const slides = evidence.slideImages
    return { ...base, ...(slides?.status === "ok" ? { slidesRendered: slides.images.length } : {}), warnings }
  }
  if (evidence.kind === "pdf") return { ...base, warnings }
  return {
    ...base,
    sectionsFound: evidence.report.sections.map((section) => section.label),
    missingHeadings: evidence.report.missingHeadings,
    unplacedPictures: evidence.report.unplaced.images.length,
    warnings,
  }
}

/** What the reader noticed about one file it read, for the teacher (and the job row). */
export function evidenceWarnings(evidence: SlotEvidence): string[] {
  if (evidence.status === "error") return []
  if (evidence.kind === "presentation") {
    const slides = evidence.slideImages
    return [
      ...evidence.report.warnings,
      ...(slides?.status === "unavailable" ? [slidesUnavailableNote(slides.reason)] : []),
      ...(slides?.status === "ok" && slides.notRendered.length > 0
        ? [`Slides after ${SLIDE_RENDER_MAX_SLIDES} were not rendered.`]
        : []),
    ]
  }
  if (evidence.kind === "pdf") {
    return evidence.report.truncated ? [`Text cut to ${PDF_TEXT_MAX_CHARS} characters of ${evidence.report.chars}.`] : []
  }
  return evidence.report.warnings
}

/** Why the whole submission cannot be marked: a required file missing, or any file the reader refused. */
function holdReason(slots: SlotRead[], fileName: (read: SlotRead) => string): string | null {
  const missing = slots.filter((read) => read.slot.required && !read.file).map((read) => read.slot.label)
  if (missing.length > 0) return `Not marked: no ${joinLabels(missing)} handed in.`
  const refused = slots.flatMap((read) => (read.evidence?.status === "error" ? [{ read, evidence: read.evidence }] : []))
  if (refused.length === 0) return null
  const tooLarge = refused.filter((r) => r.evidence.tooLarge).map((r) => r.evidence.error)
  const unreadable = refused.filter((r) => !r.evidence.tooLarge)
  const sentences = [
    ...tooLarge,
    ...(unreadable.length > 0
      ? [`${unreadable
          .map((r) => `${r.read.slot.label} (${fileName(r.read)}) could not be read: ${r.evidence.error}`)
          .join(" ")} Upload a working file again.`]
      : []),
  ]
  return `Not marked: ${sentences.join(" ")}`
}

/** The stored file's type, from its storage path (original.<ext>). */
function storedExtension(file: PracticalFileRow) {
  return file.storage_path.slice(file.storage_path.lastIndexOf(".") + 1)
}


function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "")
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

const SECTION_NAMES: Record<string, string> = {
  presentation: "presentation settings",
  master: "slide masters",
  layouts: "layouts",
  slides: "every slide",
  "action-buttons": "action buttons",
  notes: "notes and handout masters",
  "supplied-images": "supplied images",
  media: "media",
  warnings: "warnings",
}

function sectionName(selector: PresentationSectionSelector) {
  if (selector.slides) return `${selector.slides.length === 1 ? "slide" : "slides"} ${selector.slides.join(", ")}`
  return SECTION_NAMES[selector.key] ?? selector.key
}

type SourceFinding = {
  /** Whether the pupil's work has something for this source. */
  present: boolean
  required: boolean
  /** Typed text the question reads (want 'text' or 'both'). */
  typed: { heading: string; text: string } | null
  digest: string
  /** A pupil-file source (not the teacher's reference file). */
  pupil: boolean
  textOnly: boolean
  /**
   * When nothing is there: why, in plain words for the pupil (no file names),
   * or undefined when there is no more to say than NO_ANSWER_COMMENT.
   */
  missing?: string
  /**
   * A required evidence_section whose heading holds nothing that answers it
   * but pictures DINO cannot show: why, for the teacher. The question is held
   * for them (status 'unreadable'), neither marked nor given 0.
   */
  unshowable?: string
}

function findSource(source: QuestionEvidence, label: string, slots: SlotRead[]): SourceFinding {
  if (source.source === "reference_file") {
    return { present: true, required: false, typed: null, digest: `Reference: ${source.fileName}.`, pupil: false, textOnly: false }
  }
  const read = slots.find((r) => r.slot.key === source.slot)
  const file = read?.file ?? null
  const evidence = read?.evidence?.status === "ok" ? read.evidence : null
  const slotLabel = read?.slot.label ?? source.slot
  const notHandedIn = `${slotLabel}: not handed in.`
  const didNotHandIn = `You did not hand in ${slotLabel}.`

  if (source.source === "presentation") {
    const required = source.required ?? false
    if (!file) return { present: false, required, typed: null, digest: notHandedIn, pupil: true, textOnly: false, missing: didNotHandIn }
    if (evidence?.kind !== "presentation") return { present: false, required, typed: null, digest: notHandedIn, pupil: true, textOnly: false }
    const selectors = presentationSections(source)
    const found = filterPresentationSections(
      describePresentationSections(evidence.report),
      selectors.map(formatPresentationSection),
    )
    const what = source.sections ? selectors.map(sectionName).join(", ") : "the whole presentation"
    return {
      present: found.length > 0,
      required,
      typed: null,
      digest: found.length > 0 ? `${file.original_name}: ${what}.` : `${file.original_name}: ${what} not in the file.`,
      pupil: true,
      textOnly: false,
      missing: found.length > 0 ? undefined : slidesNotInPresentation(selectors, evidence.report.presentation.slideCount),
    }
  }

  if (source.source === "slide_images") {
    if (!file) return { present: false, required: false, typed: null, digest: notHandedIn, pupil: true, textOnly: false, missing: didNotHandIn }
    const which = source.slides ? `${source.slides.length === 1 ? "slide" : "slides"} ${source.slides.join(", ")}` : "every slide"
    const rendered = evidence?.kind === "presentation" ? evidence.slideImages : null
    const digest = rendered?.status === "unavailable"
      ? `${file.original_name}: pictures of ${which} not available.`
      : `${file.original_name}: pictures of ${which}.`
    return { present: true, required: false, typed: null, digest, pupil: true, textOnly: false }
  }

  if (source.source === "file") {
    const required = source.required ?? false
    if (!file) return { present: false, required, typed: null, digest: notHandedIn, pupil: true, textOnly: false, missing: didNotHandIn }
    if (evidence?.kind !== "pdf") return { present: false, required, typed: null, digest: notHandedIn, pupil: true, textOnly: false }
    return {
      present: true,
      required,
      typed: null,
      digest: `${file.original_name}: ${plural(evidence.report.pageCount, "page")}.`,
      pupil: true,
      textOnly: false,
    }
  }

  // evidence_section
  const required = source.required ?? false
  const heading = evidenceHeading(source, label)
  const textOnly = source.want === "text"
  if (!file) return { present: false, required, typed: null, digest: notHandedIn, pupil: true, textOnly, missing: didNotHandIn }
  if (evidence?.kind !== "evidence_doc") return { present: false, required, typed: null, digest: notHandedIn, pupil: true, textOnly }
  const where = `${fileStem(file.original_name)} ${heading}`
  const section = evidence.report.sections.find((s) => evidenceLabelKey(s.label) === evidenceLabelKey(heading))
  if (!section) {
    return {
      present: false,
      required,
      typed: null,
      digest: `${where}: heading not found.`,
      pupil: true,
      textOnly,
      missing: `There is no ${heading} section in your ${slotLabel}.`,
    }
  }
  const text = section.text.trim()
  const pictures = section.images.length
  const typed = source.want !== "screenshots" && text ? { heading, text } : null
  const present = source.want === "text" ? Boolean(text) : source.want === "screenshots" ? pictures > 0 : Boolean(text) || pictures > 0
  const parts = [
    source.want !== "screenshots" ? (text ? "typed answer" : "no typed answer") : null,
    source.want !== "text" ? (pictures > 0 ? plural(pictures, "screenshot") : "no screenshots") : null,
  ].filter(Boolean)
  const unshowable =
    required && !present && source.want !== "text" && section.notShown.length > 0
      ? unshowableText(heading, section.notShown.map((picture) => picture.name))
      : undefined
  const missing = present
    ? undefined
    : source.want === "text"
      ? `You did not write an answer under ${heading} in your ${slotLabel}.`
      : source.want === "screenshots"
        ? `There is no screenshot under ${heading} in your ${slotLabel}.`
        : `There is nothing under ${heading} in your ${slotLabel}.`
  return { present, required, typed, digest: `${where}: ${parts.join(", ")}.`, pupil: true, textOnly, unshowable, missing }
}

/**
 * "Slide 6 is not in your presentation." for a presentation source that
 * found nothing because the slides it asks for are past the last one;
 * undefined when that is not why.
 */
export function slidesNotInPresentation(selectors: PresentationSectionSelector[], slideCount: number): string | undefined {
  const absent = [...new Set(selectors.flatMap((selector) => selector.slides ?? []))]
    .filter((slide) => slide > slideCount)
    .sort((a, b) => a - b)
  if (absent.length === 0) return undefined
  return absent.length === 1
    ? `Slide ${absent[0]} is not in your presentation.`
    : `Slides ${joinLabels(absent.map(String))} are not in your presentation.`
}

/** 'the screenshot under "1j" is a .emf picture DINO cannot show' */
function unshowableText(heading: string, names: string[]) {
  const types = [...new Set(names.map((name) => /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase()).filter(Boolean))]
  const kinds = types.length > 0 ? `${joinLabels(types.map((t) => `.${t}`))} picture` : "picture"
  return names.length === 1
    ? `the screenshot under "${heading}" is a ${kinds} DINO cannot show`
    : `the screenshots under "${heading}" are ${kinds}s DINO cannot show`
}

/** One question's answer from what was read. */
export function answerFor(question: AssessmentQuestion, slots: SlotRead[]): SubmissionQuestionAnswerInput {
  const findings = question.evidence.map((source) => findSource(source, question.label, slots))
  const pupilFindings = findings.filter((f) => f.pupil)
  const unshowable = pupilFindings.flatMap((f) => (f.unshowable ? [f.unshowable] : []))
  const blank =
    pupilFindings.some((f) => f.required && !f.present && !f.unshowable) ||
    (pupilFindings.length > 0 && !pupilFindings.some((f) => f.present || f.unshowable))
  if (!blank && unshowable.length > 0) {
    // Held for the teacher (completeAssessmentRead); the text names why.
    const kind: AnswerKind = "mixed"
    return {
      questionId: question.questionId,
      kind,
      transcription: `${unshowable.join("; ")}; mark it yourself.`,
      pages: [],
      status: "unreadable",
    }
  }
  const typed = findings.flatMap((f) => (f.typed ? [f.typed] : []))
  const transcription =
    typed.length === 1
      ? typed[0].text
      : typed.length > 1
        ? typed.map((t) => `${t.heading}: ${t.text}`).join("\n\n")
        : findings.map((f) => f.digest).join(" ") || null
  const kind: AnswerKind = pupilFindings.length > 0 && pupilFindings.every((f) => f.textOnly) ? "text" : "mixed"
  if (!blank) return { questionId: question.questionId, kind, transcription, pages: [], status: "answered" }
  // Why, from the sources that made it blank: the required ones missing, or
  // (nothing there at all) every one.
  const requiredMissing = pupilFindings.filter((f) => f.required && !f.present && !f.unshowable)
  const reasons = [...new Set((requiredMissing.length > 0 ? requiredMissing : pupilFindings).flatMap((f) => (f.missing ? [f.missing] : [])))]
  return {
    questionId: question.questionId,
    kind,
    transcription,
    pages: [],
    status: "blank",
    ...(reasons.length > 0 ? { blankReason: reasons.join(" ") } : {}),
  }
}
