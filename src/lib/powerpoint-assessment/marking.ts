import "server-only"

import { query } from "@/lib/db"
import { callModelJson, defaultMarkingModel, type ModelPart } from "@/lib/ai/model-client"
import { assertUncorruptedModelText } from "@/lib/ai/model-output-guard"
import type { ModelUsage } from "@/lib/ai/model-usage"
import type { ModelJsonCall } from "@/lib/assessment-paper/reading"
import {
  MARK_RESPONSE_SCHEMA,
  PermanentAssessmentMarkingError,
  validateMarkReply,
  type MarkCriterion,
  type MarkReplyRow,
  type ParkHook,
} from "@/lib/assessment-paper/marking"
import { ASSESSMENT_SCRIPTS_BUCKET } from "@/lib/assessment-paper/files"
import {
  readAssessmentQuestions,
  readSubmissionAnswers,
  type AssessmentQuestion,
  type QuestionCriterionMarkInput,
  type SubmissionQuestionAnswer,
} from "@/lib/assessment-paper/store"
import { describeDatabaseSections, filterDatabaseSections } from "@/lib/accdb/describe"
import { formatDatabaseSection } from "@/lib/accdb/section-selectors"
import { DATABASE_MARK_SYSTEM } from "@/lib/database-assessment/marking-text"
import { readDocxText } from "@/lib/docx/evidence"
import { UnreadablePdfError, pdfText } from "@/lib/pdf/poppler"
import { OfficeFileError } from "@/lib/pptx/errors"
import { describePresentationSections, filterPresentationSections } from "@/lib/pptx/describe"
import type { PresentationReport } from "@/lib/pptx/inspect"
import {
  databaseSections,
  evidenceHeading,
  formatPresentationSection,
  presentationSections,
  type QuestionEvidence,
} from "@/lib/powerpoint-assessment/evidence-spec"
import { listPracticalFiles, readPracticalFileBytes, type PracticalFileRow } from "@/lib/powerpoint-assessment/files"
import {
  PDF_MAX_BYTES,
  SLIDE_RENDER_MAX_SLIDES,
  readActivityFile,
  slidesUnavailableNote,
  type DatabaseEvidenceReport,
  type EvidenceDocReport,
  type PdfReport,
  type SlideImagesRead,
} from "@/lib/powerpoint-assessment/reading"
import { practicalTypeConfig, type PracticalAssessmentType } from "@/lib/practical-assessment/types"
import {
  markRequestHash,
  readReusableMark,
  storedResultAsReply,
  type MarkRequestRecord,
} from "@/lib/assessment-paper/mark-reuse"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import type { AiEffort, AiProvider, PracticalUploadSlot } from "@/types"

// One marking call of a practical assessment (PowerPoint or database): one
// question (part) of one pupil's hand-in, every criterion the question tests
// at once, after the read. The system prompt and the words naming evidence
// are per type (MARK_TEXT); everything else branches on the source.
//
// The model sees the question, its mark scheme, its criteria with each one's
// allocation (as places to file the marks, never as standards) and the
// evidence its own sources name, nothing else of the pupil's work:
//
//   presentation      the presentation report's sections the source selects,
//                     regenerated from the stored report (text);
//   database          the database report's sections the source selects,
//                     regenerated from the stored report (text);
//   slide_images      the slides LibreOffice drew at the read (pictures), or a
//                     note that they are not available;
//   file              the pupil's PDF, attached whole;
//   evidence_section  the typed text and/or screenshots under one heading of
//                     the evidence document;
//   reference_file    the text of a teacher's activity file.
//
// The report sections (presentation and database) come first in the user turn,
// before anything question-specific, so that a pupil's questions which select
// the same sections send a byte-identical prefix and the Anthropic prompt
// cache can serve it (see reportParts); the question's own text then names
// which parts of the report above are its evidence.
//
// Every attachment is preceded by a label line naming it. Caps keep one call
// within what a model takes; a question whose evidence is over them fails
// permanently, naming the question, so the teacher narrows its sources.
// Nothing here knows any particular paper: sources, slots and headings are the
// teacher's data.

/** Pictures (screenshots and slides) in one call, at most. */
export const MARK_MAX_IMAGES = 10
/** PDF documents in one call, at most. */
export const MARK_MAX_PDFS = 3
/** PDF pages in one call, at most. */
export const MARK_MAX_PDF_PAGES = 100
/** One picture, at most. */
export const MARK_MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** One PDF, at most: the read refuses a larger one, so it holds the hand-in instead. */
export const MARK_MAX_PDF_BYTES = PDF_MAX_BYTES
/** Every attachment together, at most (before base64). */
export const MARK_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
/** The prompt's text, at most. */
export const MARK_MAX_TEXT_CHARS = 60_000

const RAW_RESPONSE_LIMIT = 4000

export interface PowerPointMarkInput {
  submissionId: string
  activityId: string
  questionId: string
  provider: AiProvider
  model: string
  effort?: AiEffort | null
}

export interface PowerPointMarkingCallRecord {
  request: {
    provider: AiProvider
    model: string
    system: string
    prompt: string
    /** Attachment metadata only; base64 is never stored. */
    attachments: Array<{ label: string; fileName: string; mimeType: string; bytes: number }>
    /** Each block of evidence text in the prompt, by key, with its length (report sections first, as sent). */
    textSections: Array<{ key: string; chars: number }>
    /** Prompt-cache breakpoints in the request (system text + report parts). */
    cacheBreakpoints: number
    maxMarks: number
    questionId: string
    label: string
    scType: null
    criteria: Array<{ successCriteriaId: string; allocation: number }>
    /** The request's fingerprint (mark-reuse.ts). */
    requestHash: string
    /** True when a stored answer to the same request was applied and the model was not called. */
    reused?: true
    /** The Message Batch it went by (message-batches.ts); absent on a direct call. */
    batch?: { id: string; submittedAt: string }
  }
  response: {
    marksAwarded: number
    criteria: MarkReplyRow[]
    /** Teacher-only: what in the evidence decided the marks. */
    evidenceNote: string
    /** The marker held the part for the teacher, with this reason. */
    holdForTeacher?: string
    raw: string
    reused?: true
    /** Token counts the provider reported (model-usage.ts); null when reused or not reported. */
    usage: ModelUsage | null
  }
  durationMs: number
  attempts: number
}

// evidence_note comes first: the model writes its reply in the schema's
// property order (structured output keeps it; every stored reply follows it),
// so the deciding facts are written before the marks rather than as a
// justification of marks already given.
//
// hold_for_teacher (optional): the part needs a value the evidence gives as
// UNKNOWN, so it is held for the teacher with no marks rather than given 0.
export const POWERPOINT_MARK_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    evidence_note: { type: "string" },
    ...MARK_RESPONSE_SCHEMA.properties,
    hold_for_teacher: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  required: ["evidence_note", "criteria"],
} as const

/** The longest hold reason kept; the teacher reads it in the results panel. */
const HOLD_REASON_MAX_CHARS = 500

export const POWERPOINT_MARK_SYSTEM = `You are an experienced secondary school teacher marking one part of a pupil's practical PowerPoint assessment: a presentation the pupil built, with any printouts and evidence document they handed in.

The work is anonymous. Never write the pupil's name, and never guess or ask who they are. Where the mark scheme asks for a name or class, say only whether one is present.

The mark scheme is the only standard. Mark strictly against the evidence given for this part and the mark scheme. Do not award marks for what the pupil might have done, or for anything the evidence does not show. 0 is a valid and expected mark when the evidence does not meet the mark scheme.

Decide each marking point on its own, against every condition in its "Award the mark for" text and every "Check / do not accept" clause. A point is earned only when the evidence shows every one of its conditions met and no do-not-accept clause applies. When the evidence shows any condition not met, the point is not earned, however good the rest of the work is: never award a point while noting that one of its conditions is missing, and never treat a condition as optional because the rest is met.

When the mark scheme asks for a judgement across the presentation, judge every slide in the evidence and every fact the report gives about them, including anything stretched or not at its own aspect ratio, overlapping, off the slide or cut off. Judge the presentation the task asks for: slides the task asks for that are missing or empty count against it, never as having nothing wrong.

The part's marks are recorded under success criteria. These are labels for filing marks, not standards to mark against: never award or withhold a mark, or comment, because of what a criterion says.

The evidence is only what is given for this part:
- The PRESENTATION REPORT is read directly from the pupil's file. Its settings, text, fonts, sizes, colours, positions, backgrounds, transitions, animations, links and images are exact facts: trust it over how anything looks. Never infer a setting the report does not state.
- Each formatting value in the report is the effective value, the one PowerPoint shows, followed in square brackets by where it comes from: set on this slide (layout, master), from layout, from master, from the presentation's default text style, from the shape's style, or default (PowerPoint's built-in value). A value from the master, a layout or the default is as real as one set on the slide: mark it as stated.
- When a marking point needs a value that the report gives as UNKNOWN (reader could not resolve), do not give 0 for it and do not guess: set hold_for_teacher with a reason naming the value and where it is (slide, placeholder or shape), and the teacher checks the part. Use hold_for_teacher only for such an UNKNOWN value, never for a value the report states or for evidence that is missing.
- A SCREENSHOT earns a mark only when what the mark scheme asks for can be read in it. Never infer a setting a screenshot does not show.
- A SLIDE picture is the slide rendered by LibreOffice. Use it for layout and appearance only; fonts and effects may differ slightly from PowerPoint, so take exact settings from the report.
- A FILE is a printout or document the pupil handed in, attached whole.
- A REFERENCE FILE is the teacher's material that the pupil was given, not the pupil's work.

Every comment names the evidence it is based on: the slide number, the file, or the EVIDENCE heading.

Write every comment to the pupil as "you", in plain English a secondary pupil understands. Each comment is one or two short sentences on a single line: no line breaks, no lists, no quotation marks.

The evidence_note is for the teacher only and is never shown to the pupil. Write it first, before the marks: for each marking point, its conditions and do-not-accept clauses, the facts in the evidence that meet or fail each one (slide numbers, report facts, file pages, EVIDENCE headings), and whether the point is earned; then anything you could not see or check. The marks must follow the note: a point the note shows failing one condition gets 0. Plain text only, with no HTML or markup.`

/** What naming the evidence in a PowerPoint prompt says. */
const POWERPOINT_EVIDENCE_NAMES = "slide number, file or EVIDENCE heading"

/**
 * Per practical type: the system prompt, what a comment names as its evidence,
 * and how the teacher can narrow a question's evidence when it is over a cap.
 */
export const MARK_TEXT: Readonly<Record<PracticalAssessmentType, { system: string; evidenceNames: string; narrowHint: string }>> = {
  "powerpoint-assessment": {
    system: POWERPOINT_MARK_SYSTEM,
    evidenceNames: POWERPOINT_EVIDENCE_NAMES,
    narrowHint: "name only the slides it needs",
  },
  "database-assessment": {
    system: DATABASE_MARK_SYSTEM,
    evidenceNames: "EVIDENCE heading, table, query, form or report, or file",
    narrowHint: "name only the parts of the database report or the EVIDENCE headings it needs",
  },
}

/** One block of evidence text in the prompt. */
type TextBlock = { key: string; text: string }

/**
 * The sections of one pupil file's report (presentation or database) that a
 * question's sources select, in the report's own order. They are sent before
 * the question (reportParts), never inside its evidence list.
 */
export interface ReportEvidence {
  kind: "presentation" | "database"
  /** Its upload slot's key, and the slot's place in the activity's slots (the order reports are sent in). */
  slot: string
  slotIndex: number
  /** The first line of the report's text, naming the slot and file (never the pupil's file name). */
  heading: string
  sections: Array<{ key: string; text: string; order: number }>
}

/** What a question's evidence list says of a report sent above it. */
const REPORT_GIVEN_ABOVE = "given above, before this part (only these parts of the report are given)."

/**
 * The prompt-cache breakpoints in one practical mark request: one on the
 * system text (shared by every question of every pupil of the type) and up to
 * three in the report parts (MAX_CACHE_BREAKPOINTS is 4).
 */
const REPORT_BREAKPOINTS = 3

/**
 * The order of a presentation report's groups. Slides first, then the layout
 * masters, then the slide masters, then the rest (presentation, action
 * buttons, notes, supplied images, media, warnings), so that questions with
 * overlapping section sets share the longest prefix: on dev's PowerPoint
 * assessments "slides" is in most large sets ([master, layouts, slides],
 * [master, slides], [layouts, slides], [slides], [slides, supplied-images])
 * and layouts (about 11 500 characters) outweighs a master (about 1 600).
 */
const PRESENTATION_GROUPS = ["slides", "layouts", "master", "rest"] as const

function presentationGroup(key: string): (typeof PRESENTATION_GROUPS)[number] {
  if (key.startsWith("slide:")) return "slides"
  if (key === "layouts") return "layouts"
  if (key.startsWith("master:")) return "master"
  return "rest"
}

/** One report's sections in the groups they are sent in, in that order. */
export function reportGroups(report: ReportEvidence): ReportEvidence["sections"][] {
  if (report.kind === "database") return report.sections.map((section) => [section])
  return PRESENTATION_GROUPS
    .map((group) => report.sections.filter((s) => presentationGroup(s.key) === group))
    .filter((group) => group.length > 0)
}

/**
 * The report parts of one mark request, sent after the system text and before
 * anything question-specific: per report (in slot order) a heading, then its
 * selected sections in groups, one text part per group. A presentation report
 * has the groups of PRESENTATION_GROUPS, a database report one group per
 * section in the report's order. Every group's text depends only on the
 * pupil's file and the sections in it, never on the question, so two
 * questions selecting the same sections send byte-identical parts, and two
 * whose sets start alike share the parts up to where they differ.
 *
 * A cache breakpoint ends every group when there are at most
 * REPORT_BREAKPOINTS; otherwise the first two groups and the last. A request
 * reads the longest earlier-written prefix it shares, so an exact repeat is
 * read whole and a set that starts alike reads its first groups.
 */
export function reportParts(reports: ReportEvidence[]): ModelPart[] {
  const groups: string[] = []
  for (const report of reports) {
    reportGroups(report).forEach((group, i) => {
      const heading = i === 0 ? `${report.heading}, the parts named under THE PUPIL'S EVIDENCE FOR THIS PART below:\n` : ""
      groups.push(`${heading}${group.map((s) => s.text).join("\n\n")}\n\n`)
    })
  }
  const cached = new Set(
    groups.length <= REPORT_BREAKPOINTS
      ? groups.map((_, i) => i)
      : [0, 1, groups.length - 1],
  )
  return groups.map((text, i) => (cached.has(i) ? { text, cache: true as const } : { text }))
}

/** One attachment, before its bytes are loaded. */
type PendingAttachment = {
  label: string
  fileName: string
  mimeType: string
  bytes: number
  kind: "image" | "pdf"
  pages: number
  load: () => Promise<Buffer>
}

type StoredEvidence = {
  file_id: string
  slot_key: string
  status: "ok" | "error"
  report: unknown
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

function labelKey(label: string) {
  return label.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "")
}

async function readStored(storagePath: string): Promise<Buffer> {
  const { stream, error } = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).getFileStream(storagePath)
  if (error || !stream) throw new Error(`Could not read ${storagePath}: ${error?.message ?? "not found"}`)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** A picture the read stored for this file: only under the file's own evidence folder. */
function evidencePicture(activityId: string, fileId: string, storagePath: string) {
  if (!storagePath.startsWith(`${activityId}/practical/${fileId}/evidence/`) || storagePath.includes("..")) {
    throw new PermanentAssessmentMarkingError(`A picture of file ${fileId} is not stored where its evidence is kept.`)
  }
  return () => readStored(storagePath)
}

/**
 * The name the marker (and the job row) is given for a pupil's file: the
 * slot's key and the file's type, never the pupil's own file name, which may
 * carry their name.
 */
function markerFileName(file: PracticalFileRow) {
  const ext = file.storage_path.slice(file.storage_path.lastIndexOf(".") + 1)
  return `${file.slot_key}.${ext}`
}

function fileNameOf(storagePath: string) {
  return storagePath.slice(storagePath.lastIndexOf("/") + 1)
}

/** The text of a teacher's reference file: docx, PDF or plain text. */
async function referenceText(lessonId: string, activityId: string, fileName: string, label: string): Promise<string> {
  const bytes = await readActivityFile(lessonId, activityId, fileName)
  if (!bytes) {
    throw new PermanentAssessmentMarkingError(
      `Question ${label} reads the reference file "${fileName}", which is not among the activity's files. Upload it to the activity, or mark the question yourself.`,
    )
  }
  const ext = fileName.toLowerCase().split(".").pop() ?? ""
  try {
    if (ext === "docx") return await readDocxText(bytes)
    if (ext === "pdf") return (await pdfText(bytes, { maxChars: MARK_MAX_TEXT_CHARS + 1 })).text
  } catch (error) {
    // The file is bad: retrying cannot help. Anything else (a tool missing,
    // a timeout) is thrown as it is, so the job retries.
    if (!(error instanceof OfficeFileError) && !(error instanceof UnreadablePdfError)) throw error
    throw new PermanentAssessmentMarkingError(
      `Question ${label} reads the reference file "${fileName}", which could not be read (${error.message}).`,
    )
  }
  return bytes.toString("utf8")
}

/**
 * The evidence of one question: text blocks for the prompt and the
 * attachments (not yet loaded), from the question's sources only.
 */
async function assembleEvidence(input: {
  question: AssessmentQuestion
  answer: SubmissionQuestionAnswer
  activityId: string
  lessonId: string
  slots: PracticalUploadSlot[]
  files: PracticalFileRow[]
  evidence: StoredEvidence[]
}): Promise<{ blocks: TextBlock[]; attachments: PendingAttachment[]; reports: ReportEvidence[] }> {
  const { question, answer } = input
  const blocks: TextBlock[] = []
  const attachments: PendingAttachment[] = []
  const reports = new Map<string, ReportEvidence>()
  // Two sources on one slot send that report once, their sections merged.
  const addReport = (
    kind: ReportEvidence["kind"],
    slot: string,
    heading: string,
    sections: Array<{ key: string; text: string; order: number }>,
  ) => {
    const id = `${kind}:${slot}`
    const report = reports.get(id) ?? {
      kind,
      slot,
      slotIndex: input.slots.findIndex((s) => s.key === slot),
      heading,
      sections: [],
    }
    for (const section of sections) {
      if (!report.sections.some((s) => s.key === section.key)) report.sections.push(section)
    }
    report.sections.sort((a, b) => a.order - b.order)
    reports.set(id, report)
  }
  const slotOf = (key: string) => input.slots.find((slot) => slot.key === key)
  const fileOf = (key: string) => input.files.find((file) => file.slot_key === key) ?? null
  const evidenceOf = (file: PracticalFileRow) => {
    const row = input.evidence.find((e) => e.file_id === file.file_id)
    if (!row || row.status !== "ok") {
      throw new PermanentAssessmentMarkingError(
        `Question ${question.label}: ${markerFileName(file)} has not been read; send the work again.`,
      )
    }
    return row.report
  }

  // A typed answer the teacher corrected stands in for the typed text read.
  const teacherTyped = answer.provenance === "teacher" && Boolean(answer.transcription?.trim())
  const typedSources = question.evidence.filter((s) => s.source === "evidence_section" && s.want !== "screenshots")
  if (teacherTyped && typedSources.length > 0) {
    const headings = typedSources.map((s) => evidenceHeading(s as { heading?: string }, question.label)).join(", ")
    blocks.push({
      key: "typed:teacher",
      text: `EVIDENCE ${headings}, TYPED TEXT (as corrected by the teacher):\n${answer.transcription!.trim()}`,
    })
  }

  for (const [index, source] of question.evidence.entries()) {
    await addSource(source, index)
  }
  const ordered = [...reports.values()]
    .filter((report) => report.sections.length > 0)
    .sort((a, b) => a.slotIndex - b.slotIndex || a.kind.localeCompare(b.kind))
  return { blocks, attachments, reports: ordered }

  async function addSource(source: QuestionEvidence, index: number) {
    if (source.source === "reference_file") {
      const text = await referenceText(input.lessonId, input.activityId, source.fileName, question.label)
      blocks.push({
        key: `reference:${source.fileName}`,
        text: `REFERENCE FILE ${source.fileName} (the teacher's material given to the pupil, not the pupil's work):\n${text.trim()}`,
      })
      return
    }

    const slot = slotOf(source.slot)
    const slotLabel = slot?.label ?? source.slot
    const file = fileOf(source.slot)
    if (!file) {
      blocks.push({ key: `missing:${source.slot}:${index}`, text: `${slotLabel.toUpperCase()}: not handed in.` })
      return
    }

    if (source.source === "presentation") {
      const report = evidenceOf(file) as PresentationReport & { slideImages?: unknown }
      const selectors = presentationSections(source)
      const formatted = selectors.map(formatPresentationSection)
      const all = describePresentationSections(report)
      const sections = filterPresentationSections(all, formatted)
      const slideCount = report.presentation.slideCount
      const absent = selectors.flatMap((s) => s.slides ?? []).filter((n) => n > slideCount)
      const what = source.sections ? formatted.join(", ") : "every part but media"
      const name = `PRESENTATION REPORT, ${slotLabel} (${markerFileName(file)})`
      addReport("presentation", source.slot, name, sections.map((s) => ({ key: s.key, text: s.text, order: all.indexOf(s) })))
      const lines = [
        `${name}, ${what}: ${sections.length > 0 ? REPORT_GIVEN_ABOVE : "(none of these parts is in the presentation)"}`,
      ]
      if (absent.length > 0) {
        lines.push(`(${absent.length === 1 ? "slide" : "slides"} ${absent.join(", ")} ${absent.length === 1 ? "is" : "are"} not in this presentation, which has ${plural(slideCount, "slide")})`)
      }
      blocks.push({ key: `presentation:${source.slot}:${formatted.join(",")}`, text: lines.join("\n") })
      return
    }

    if (source.source === "slide_images") {
      const report = evidenceOf(file) as PresentationReport & { slideImages?: SlideImagesRead }
      const rendered = report.slideImages ?? null
      const slideCount = report.presentation.slideCount
      const wanted = source.slides ?? Array.from({ length: slideCount }, (_, i) => i + 1)
      const key = `slide_images:${source.slot}`
      if (!rendered || rendered.status === "unavailable") {
        const reason = rendered ? rendered.reason : "the slides were not rendered when the work was read"
        blocks.push({ key, text: `SLIDE PICTURES, ${slotLabel} (${markerFileName(file)}): ${slidesUnavailableNote(reason)} Judge appearance only from what the presentation report states.` })
        return
      }
      const notes: string[] = []
      for (const slide of wanted) {
        const image = rendered.images.find((im) => im.slide === slide)
        if (image) {
          attachments.push({
            label: `SLIDE ${slide} (rendered by LibreOffice; fonts and effects may differ slightly from PowerPoint):`,
            fileName: fileNameOf(image.path),
            mimeType: image.mimeType,
            bytes: image.bytes,
            kind: "image",
            pages: 0,
            load: evidencePicture(input.activityId, file.file_id, image.path),
          })
        } else if (slide > slideCount) {
          notes.push(`slide ${slide} is not in this presentation, which has ${plural(slideCount, "slide")}`)
        } else {
          notes.push(`slide ${slide} was not rendered (only the first ${SLIDE_RENDER_MAX_SLIDES} are)`)
        }
      }
      if (notes.length > 0) {
        blocks.push({ key, text: `SLIDE PICTURES, ${slotLabel} (${markerFileName(file)}): ${notes.join("; ")}.` })
      }
      return
    }

    if (source.source === "file") {
      const report = evidenceOf(file) as PdfReport
      attachments.push({
        label: `FILE ${slotLabel} (${markerFileName(file)}, ${plural(report.pageCount, "page")}):`,
        fileName: markerFileName(file),
        mimeType: "application/pdf",
        bytes: file.bytes,
        kind: "pdf",
        pages: report.pageCount,
        load: () => readPracticalFileBytes(file.file_id),
      })
      return
    }

    if (source.source === "database") {
      const report = evidenceOf(file) as DatabaseEvidenceReport
      const formatted = databaseSections(source).map(formatDatabaseSection)
      // A named table or query the database does not have comes back as a
      // block of its own saying so, with the names it does have: that is this
      // question's own, so it stays in its evidence list.
      const all = describeDatabaseSections(report)
      const sections = filterDatabaseSections(all, formatted)
      const found = sections.filter((s) => !s.absent)
      const missing = sections.filter((s) => s.absent)
      const what = source.sections ? formatted.join(", ") : "every part but records"
      const name = `DATABASE REPORT, ${slotLabel} (${markerFileName(file)})`
      addReport("database", source.slot, name, found.map((s) => ({ key: s.selector, text: s.text, order: all.indexOf(s) })))
      blocks.push({
        key: `database:${source.slot}:${formatted.join(",")}`,
        text: [
          `${name}, ${what}: ${
            found.length > 0 ? REPORT_GIVEN_ABOVE : missing.length > 0 ? "" : "(none of these parts is in the database)"
          }`.trimEnd(),
          ...missing.map((s) => s.text),
        ].join("\n"),
      })
      return
    }

    // evidence_section
    const report = evidenceOf(file) as EvidenceDocReport
    const heading = evidenceHeading(source, question.label)
    const key = `evidence:${source.slot}:${labelKey(heading)}`
    const section = report.sections.find((s) => labelKey(s.label) === labelKey(heading))
    if (!section) {
      blocks.push({ key, text: `EVIDENCE ${heading}: the heading is not in ${markerFileName(file)}.` })
      return
    }
    const lines: string[] = []
    if (source.want !== "screenshots" && !teacherTyped) {
      lines.push(`EVIDENCE ${heading}, TYPED TEXT (${markerFileName(file)}):`, section.text.trim() || "(no typed text)")
    }
    if (source.want !== "text") {
      if (section.images.length === 0) lines.push(`EVIDENCE ${heading}: no screenshots.`)
      section.images.forEach((image, n) => {
        attachments.push({
          label: `EVIDENCE ${heading}, SCREENSHOT ${n + 1}:`,
          fileName: fileNameOf(image.path),
          mimeType: image.mimeType,
          bytes: image.bytes,
          kind: "image",
          pages: 0,
          load: evidencePicture(input.activityId, file.file_id, image.path),
        })
      })
      if (section.notShown.length > 0) {
        lines.push(
          `EVIDENCE ${heading}: ${plural(section.notShown.length, "picture")} could not be shown (${section.notShown
            .map((p) => `${p.name}: ${p.reason}`)
            .join("; ")}).`,
        )
      }
    }
    if (lines.length > 0) blocks.push({ key, text: lines.join("\n") })
  }
}

/** Throws, permanently, when a question's evidence is over a cap. */
function assertWithinCaps(label: string, attachments: PendingAttachment[], promptChars: number, narrowHint: string) {
  const problems: string[] = []
  const images = attachments.filter((a) => a.kind === "image")
  const pdfs = attachments.filter((a) => a.kind === "pdf")
  if (images.length > MARK_MAX_IMAGES) problems.push(`${images.length} pictures (at most ${MARK_MAX_IMAGES})`)
  if (pdfs.length > MARK_MAX_PDFS) problems.push(`${pdfs.length} PDFs (at most ${MARK_MAX_PDFS})`)
  const pages = pdfs.reduce((sum, a) => sum + a.pages, 0)
  if (pages > MARK_MAX_PDF_PAGES) problems.push(`${pages} PDF pages (at most ${MARK_MAX_PDF_PAGES})`)
  for (const a of images) {
    if (a.bytes > MARK_MAX_IMAGE_BYTES) problems.push(`${a.fileName} is ${mb(a.bytes)} (a picture is at most ${mb(MARK_MAX_IMAGE_BYTES)})`)
  }
  for (const a of pdfs) {
    if (a.bytes > MARK_MAX_PDF_BYTES) problems.push(`${a.fileName} is ${mb(a.bytes)} (a PDF is at most ${mb(MARK_MAX_PDF_BYTES)})`)
  }
  const total = attachments.reduce((sum, a) => sum + a.bytes, 0)
  if (total > MARK_MAX_ATTACHMENT_BYTES) problems.push(`${mb(total)} of attachments (at most ${mb(MARK_MAX_ATTACHMENT_BYTES)})`)
  if (promptChars > MARK_MAX_TEXT_CHARS) problems.push(`${promptChars} characters of text (at most ${MARK_MAX_TEXT_CHARS})`)
  if (problems.length > 0) {
    throw new PermanentAssessmentMarkingError(
      `Question ${label}: its evidence is too large to mark in one call: ${problems.join("; ")}. Narrow its evidence sources (for example ${narrowHint}), or mark it yourself.`,
    )
  }
}

function mb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`
}

export function buildPowerPointMarkPrompt(input: {
  question: Pick<AssessmentQuestion, "label" | "questionText" | "maxMarks" | "markScheme">
  criteria: MarkCriterion[]
  instructions: string | null
  blocks: TextBlock[]
  attachmentLabels: string[]
  /** What a comment names as its evidence; PowerPoint's when absent. */
  evidenceNames?: string
}): string {
  const { question } = input
  const criteria = input.criteria
    .map((c) => `- success_criteria_id "${c.successCriteriaId}" (topic: ${c.description.trim() || "none given"}): holds 0 to ${c.allocation}.`)
    .join("\n")
  const evidence = input.blocks.length > 0 ? input.blocks.map((b) => b.text).join("\n\n") : "(no text evidence)"
  const attached = input.attachmentLabels.length > 0
    ? `ATTACHED AFTER THIS TEXT, each after its label:\n${input.attachmentLabels.map((l) => `- ${l.replace(/:$/, "")}`).join("\n")}`
    : "Nothing is attached: mark from the text above."

  return `PART ${question.label} (${question.maxMarks} mark${question.maxMarks === 1 ? "" : "s"}): ${question.questionText?.trim() || "as set out in the task"}

MARK SCHEME:
${question.markScheme?.trim() ?? ""}

WHERE TO RECORD THE MARKS (filing only; the topics are not marking standards):
${criteria}
${input.instructions?.trim() ? `\nTHE TASK'S INSTRUCTIONS TO PUPILS:\n${input.instructions.trim()}\n` : ""}
THE PUPIL'S EVIDENCE FOR THIS PART (nothing else of their work is given):

${evidence}

${attached}

First write the evidence_note: take the mark scheme's marking points one at a time, list every condition in "Award the mark for" and every "Check / do not accept" clause, and set against each the facts in the evidence that meet or fail it.
Then decide each point from that list alone: it is earned only when every condition is met and no do-not-accept clause applies; one condition not met, or one do-not-accept clause applying, is 0 for that point, even when everything else is right. 0 is a valid and expected score when the evidence does not show a point.
Then record those marks: put each earned point under the entry whose topic it fits best, never more than an entry holds and never one point under two entries. If a point fits no topic, put it under any entry with room. The entries' marks must add up to the marks the mark scheme gives.

Reply with exactly one entry per success_criteria_id above, using it exactly as written.
- why_not_awarded: which mark scheme points the pupil missed for the marks not given here, naming the evidence (${input.evidenceNames ?? POWERPOINT_EVIDENCE_NAMES}). Empty when the entry is full.
- how_to_improve: what to do next time to earn those mark scheme points. Empty when the entry is full.
Base both comments on the mark scheme and the evidence only; never mention or quote the success criteria.
- evidence_note (teacher only, written first): point by point, the conditions and the deciding facts in the evidence, whether each point is earned, and anything you could not see or check.
- hold_for_teacher: leave it out, unless a marking point needs a value the evidence gives as UNKNOWN (reader could not resolve). Then give its reason (which value, where), and still give one entry per success_criteria_id: the part is held for the teacher and none of these marks is recorded. When nothing needs the teacher, leave hold_for_teacher out entirely: never send it with a reason such as "None".`
}

/**
 * Mark one question of one pupil's hand-in. Returns the rows to record (one
 * per criterion the question tests), the marker's teacher-only note and the
 * call for the job row; or no rows and no call, with the reason, when the
 * question is no longer to be sent (made teacher-only, or its mark scheme
 * removed, since the job was queued).
 */
/** What the reply handler needs of a prepared practical mark request: JSON, so it can wait in a Message Batch item. */
export interface PowerPointMarkContext {
  provider: AiProvider
  model: string
  system: string
  prompt: string
  attachments: PowerPointMarkingCallRecord["request"]["attachments"]
  textSections: PowerPointMarkingCallRecord["request"]["textSections"]
  cacheBreakpoints: number
  question: { questionId: string; label: string; maxMarks: number }
  criteria: Array<{ successCriteriaId: string; allocation: number }>
  requestHash: string
}

export type PowerPointMarkResult = {
  rows: QuestionCriterionMarkInput[]
  evidenceNote: string | null
  call: PowerPointMarkingCallRecord | null
  skipped: string | null
  /** The marker held the part for the teacher (an UNKNOWN value): no rows, this reason. */
  hold?: string | null
  /** The request and its validated result, to store once applied (mark-reuse.ts); null when not marked. */
  markRequest?: MarkRequestRecord | null
  /** The request waits in a Message Batch: nothing to apply yet. */
  parked?: true
}

/**
 * Mark one question of one hand-in. With `park`, a request that is not
 * answered by a stored mark may be parked for a Message Batch instead of
 * called; its reply later goes through finishPowerPointQuestionMark, as a
 * direct reply does here.
 */
export async function markPowerPointQuestion(
  input: PowerPointMarkInput,
  call: ModelJsonCall = callModelJson,
  options: { park?: ParkHook<PowerPointMarkContext> } = {},
): Promise<PowerPointMarkResult> {
  const questions = await readAssessmentQuestions(input.activityId)
  const question = questions.find((q) => q.questionId === input.questionId)
  if (!question) throw new PermanentAssessmentMarkingError(`Question ${input.questionId} is not on this assessment.`)
  if (question.marking === "teacher") return { rows: [], evidenceNote: null, call: null, skipped: "teacher-only" }
  if (!question.markScheme?.trim()) return { rows: [], evidenceNote: null, call: null, skipped: "no mark scheme" }

  const answer = (await readSubmissionAnswers(input.submissionId)).get(question.questionId)
  if (!answer) {
    throw new PermanentAssessmentMarkingError(`Question ${question.label} has not been read on this hand-in; send the work again.`)
  }

  const { rows: activityRows } = await query<{ lesson_id: string; type: string | null; body_data: unknown }>(
    "select lesson_id, type, body_data from activities where activity_id = $1",
    [input.activityId],
  )
  const activity = activityRows[0]
  if (!activity) throw new PermanentAssessmentMarkingError(`Activity ${input.activityId} not found.`)
  let config: ReturnType<typeof practicalTypeConfig>
  try {
    config = practicalTypeConfig(activity.type)
  } catch {
    throw new PermanentAssessmentMarkingError(`Activity ${input.activityId} is not a practical assessment.`)
  }
  const text = MARK_TEXT[config.type]
  const parsed = config.bodySchema.safeParse(activity.body_data ?? {})
  if (!parsed.success) {
    throw new PermanentAssessmentMarkingError(`This ${config.labelLower}'s upload slots are not set up; set them up, then send the work again.`)
  }
  const body = parsed.data as { uploadSlots: PracticalUploadSlot[]; instructions?: string | null }

  const files = await listPracticalFiles(input.submissionId)
  const { rows: evidence } = await query<StoredEvidence>(
    `select file_id::text as file_id, slot_key, status, report
       from practical_submission_evidence where submission_id = $1`,
    [input.submissionId],
  )

  const { rows: criterionRows } = await query<{ success_criteria_id: string; description: string | null }>(
    "select success_criteria_id, description from success_criteria where success_criteria_id = any($1::text[])",
    [question.criteria.map((c) => c.successCriteriaId)],
  )
  const descriptionOf = new Map(criterionRows.map((row) => [row.success_criteria_id, row.description ?? ""]))
  const criteria: MarkCriterion[] = question.criteria.map((c) => ({
    successCriteriaId: c.successCriteriaId,
    description: descriptionOf.get(c.successCriteriaId) ?? "",
    allocation: Number(c.maxMarks),
  }))

  const { blocks, attachments, reports } = await assembleEvidence({
    question,
    answer,
    activityId: input.activityId,
    lessonId: activity.lesson_id,
    slots: body.uploadSlots,
    files,
    evidence,
  })

  const questionPrompt = buildPowerPointMarkPrompt({
    question,
    criteria,
    instructions: body.instructions ?? null,
    blocks,
    attachmentLabels: attachments.map((a) => a.label),
    evidenceNames: text.evidenceNames,
  })
  // The reports first, then the question: the shared prefix (reportParts).
  const shared = reportParts(reports)
  const prompt = [...shared.map((part) => part.text), questionPrompt].join("")
  const promptChars = prompt.length + attachments.reduce((sum, a) => sum + a.label.length, 0)
  assertWithinCaps(question.label, attachments, promptChars, text.narrowHint)

  const parts: ModelPart[] = [...shared, { text: questionPrompt }]
  for (const attachment of attachments) {
    const data = await attachment.load()
    parts.push({ text: attachment.label })
    parts.push({ inline_data: { mime_type: attachment.mimeType, data: data.toString("base64") } })
  }

  const model = input.model || defaultMarkingModel()
  const request = {
    provider: input.provider,
    model,
    systemText: text.system,
    cacheSystem: true,
    parts,
    responseSchema: POWERPOINT_MARK_RESPONSE_SCHEMA,
    timeoutMs: 180_000,
    maxTokens: 16000,
  }
  const allocations = criteria.map((c) => ({ successCriteriaId: c.successCriteriaId, allocation: c.allocation }))
  const requestHash = markRequestHash({ ...request, effort: input.effort ?? null, criteria: allocations })
  const context: PowerPointMarkContext = {
    provider: input.provider,
    model,
    system: text.system,
    prompt,
    attachments: attachments.map((a) => ({ label: a.label, fileName: a.fileName, mimeType: a.mimeType, bytes: a.bytes })),
    textSections: [
      ...reports.flatMap((r) => reportGroups(r).flat().map((sec) => ({ key: `report:${r.kind}:${r.slot}:${sec.key}`, chars: sec.text.length }))),
      ...blocks.map((b) => ({ key: b.key, chars: b.text.length })),
    ],
    cacheBreakpoints: 1 + shared.filter((part) => part.cache).length,
    question: { questionId: question.questionId, label: question.label, maxMarks: question.maxMarks },
    criteria: allocations,
    requestHash,
  }
  // The same request already answered for this submission and question: its
  // stored answer goes through the same checks as a fresh reply, no call.
  const stored = await readReusableMark(input.submissionId, question.questionId, requestHash)
  if (stored) {
    return finishPowerPointQuestionMark(context, { data: storedResultAsReply(stored), raw: "", durationMs: 0, attempts: 0, usage: null }, { reused: true })
  }
  if (options.park && (await options.park({ request, requestHash, context }))) {
    return { rows: [], evidenceNote: null, call: null, skipped: null, parked: true }
  }
  return finishPowerPointQuestionMark(context, await call(request))
}

/**
 * The reply to a prepared practical mark request, direct, reused or from a
 * Message Batch: the evidence note, the hold rule, the criteria checks and
 * the output guard, then the rows to apply, the call record and the
 * mark-reuse record. Throws on a bad reply, so the job retries.
 */
export function finishPowerPointQuestionMark(
  context: PowerPointMarkContext,
  reply: Awaited<ReturnType<ModelJsonCall>>,
  options: { reused?: boolean } = {},
): PowerPointMarkResult {
  const { model, question, criteria } = context
  const reused = options.reused === true
  const markRequest = (result: MarkRequestRecord["result"]): MarkRequestRecord => ({
    questionId: question.questionId,
    requestHash: context.requestHash,
    model,
    result,
  })

  const rawNote = (reply.data as { evidence_note?: unknown } | null)?.evidence_note
  if (typeof rawNote !== "string") throw new Error("Marking reply has no evidence_note.")
  const evidenceNote = rawNote.trim()
  assertUncorruptedModelText(evidenceNote, { model, field: `evidence_note (${question.label})`, mode: "note" })

  const callRecord = (recorded: MarkReplyRow[], note: string, heldFor: string | null): PowerPointMarkingCallRecord => {
    return {
      request: {
        provider: context.provider,
        model,
        system: context.system,
        prompt: context.prompt,
        attachments: context.attachments,
        textSections: context.textSections,
        cacheBreakpoints: context.cacheBreakpoints,
        maxMarks: question.maxMarks,
        questionId: question.questionId,
        label: question.label,
        scType: null,
        criteria,
        requestHash: context.requestHash,
        ...(reused ? { reused: true as const } : {}),
      },
      response: {
        marksAwarded: recorded.reduce((sum, row) => sum + row.awarded, 0),
        criteria: recorded,
        evidenceNote: note,
        ...(heldFor !== null ? { holdForTeacher: heldFor } : {}),
        raw: reply.raw.slice(0, RAW_RESPONSE_LIMIT),
        ...(reused ? { reused: true as const } : {}),
        usage: reply.usage ?? null,
      },
      durationMs: reply.durationMs,
      attempts: reply.attempts,
    }
  }

  let hold = holdReason(reply.data)
  // "None", "N/A" … in the hold field is a model's way of saying no hold, but
  // only when it marked every criterion; with no valid criteria it stays a
  // hold, so a real reason that starts "None of …" still reaches the teacher.
  if (hold !== null && isNotAHoldReason(hold) && repliesWithValidCriteria(reply.data, criteria)) hold = null
  if (hold !== null) {
    assertUncorruptedModelText(hold, { model, field: `hold_for_teacher (${question.label})`, mode: "note" })
    return {
      rows: [],
      evidenceNote: evidenceNote || null,
      skipped: null,
      hold,
      markRequest: markRequest({ rows: [], evidenceNote, hold }),
      call: callRecord([], evidenceNote, hold),
    }
  }

  const replyRows = validateMarkReply(reply.data, criteria)
  for (const row of replyRows) {
    assertUncorruptedModelText(row.whyNotAwarded, { model, field: `why_not_awarded (${question.label}, ${row.successCriteriaId})` })
    assertUncorruptedModelText(row.howToImprove, { model, field: `how_to_improve (${question.label}, ${row.successCriteriaId})` })
  }
  return {
    rows: replyRows.map((row) => ({
      questionId: question.questionId,
      successCriteriaId: row.successCriteriaId,
      awarded: row.awarded,
      whyNotAwarded: row.whyNotAwarded || null,
      howToImprove: row.howToImprove || null,
    })),
    evidenceNote: evidenceNote || null,
    skipped: null,
    hold: null,
    markRequest: markRequest({ rows: replyRows, evidenceNote, hold: null }),
    call: callRecord(replyRows, evidenceNote, null),
  }
}

/**
 * A hold reason that says nothing needs holding ("None.", "N/A", "No hold
 * needed" …). A model sometimes sends hold_for_teacher with such a reason
 * beside full marks; that is not a hold. Compared case-insensitively with
 * punctuation removed, on the start of the reason.
 */
const NOT_A_HOLD = /^(none|n ?a|null|no ?hold|not ?needed|no ?issues?)\b/

/** True when a hold reason is empty or says that nothing needs holding (NOT_A_HOLD). */
export function isNotAHoldReason(reason: string): boolean {
  const words = reason
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  return words === "" || NOT_A_HOLD.test(words)
}

/**
 * The reply's hold_for_teacher reason, on one line and capped; null when the
 * reply has none: absent, null, or an empty reason. A reason that says nothing
 * needs holding (isNotAHoldReason) is returned: the caller drops it only when
 * the reply also marks every criterion.
 */
function repliesWithValidCriteria(data: unknown, criteria: Parameters<typeof validateMarkReply>[1]): boolean {
  try {
    validateMarkReply(data, criteria)
    return true
  } catch {
    return false
  }
}

export function holdReason(data: unknown): string | null {
  const hold = (data as { hold_for_teacher?: unknown } | null)?.hold_for_teacher
  if (!hold || typeof hold !== "object") return null
  const reason = (hold as { reason?: unknown }).reason
  if (typeof reason !== "string") return null
  const text = reason.replace(/\s+/g, " ").trim()
  if (text === "") return null
  return text.length > HOLD_REASON_MAX_CHARS ? `${text.slice(0, HOLD_REASON_MAX_CHARS - 1)}…` : text
}
