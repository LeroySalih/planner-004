import "server-only"

import { query } from "@/lib/db"
import { callModelJson, defaultMarkingModel, type ModelPart } from "@/lib/ai/model-client"
import { assertUncorruptedModelText } from "@/lib/ai/model-output-guard"
import type { ModelJsonCall } from "@/lib/assessment-paper/reading"
import {
  MARK_RESPONSE_SCHEMA,
  PermanentAssessmentMarkingError,
  validateMarkReply,
  type MarkCriterion,
  type MarkReplyRow,
} from "@/lib/assessment-paper/marking"
import { ASSESSMENT_SCRIPTS_BUCKET } from "@/lib/assessment-paper/files"
import {
  readAssessmentQuestions,
  readSubmissionAnswers,
  type AssessmentQuestion,
  type QuestionCriterionMarkInput,
  type SubmissionQuestionAnswer,
} from "@/lib/assessment-paper/store"
import { readDocxText } from "@/lib/docx/evidence"
import { UnreadablePdfError, pdfText } from "@/lib/pdf/poppler"
import { OfficeFileError } from "@/lib/pptx/errors"
import { describePresentationSections, filterPresentationSections } from "@/lib/pptx/describe"
import type { PresentationReport } from "@/lib/pptx/inspect"
import {
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
  type EvidenceDocReport,
  type PdfReport,
  type SlideImagesRead,
} from "@/lib/powerpoint-assessment/reading"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { PowerPointAssessmentActivityBodySchema, type AiProvider, type PowerPointUploadSlot } from "@/types"

// One marking call of a PowerPoint assessment: one question (part) of one
// pupil's hand-in, every criterion the question tests at once, after the read.
//
// The model sees the question, its mark scheme, its criteria with each one's
// allocation (as places to file the marks, never as standards) and the
// evidence its own sources name, nothing else of the pupil's work:
//
//   presentation      the presentation report's sections the source selects,
//                     regenerated from the stored report (text);
//   slide_images      the slides LibreOffice drew at the read (pictures), or a
//                     note that they are not available;
//   file              the pupil's PDF, attached whole;
//   evidence_section  the typed text and/or screenshots under one heading of
//                     the evidence document;
//   reference_file    the text of a teacher's activity file.
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
}

export interface PowerPointMarkingCallRecord {
  request: {
    provider: AiProvider
    model: string
    system: string
    prompt: string
    /** Attachment metadata only; base64 is never stored. */
    attachments: Array<{ label: string; fileName: string; mimeType: string; bytes: number }>
    /** Each block of evidence text in the prompt, by key, with its length. */
    textSections: Array<{ key: string; chars: number }>
    maxMarks: number
    questionId: string
    label: string
    scType: null
    criteria: Array<{ successCriteriaId: string; allocation: number }>
  }
  response: {
    marksAwarded: number
    criteria: MarkReplyRow[]
    /** Teacher-only: what in the evidence decided the marks. */
    evidenceNote: string
    raw: string
  }
  durationMs: number
  attempts: number
}

// evidence_note comes first: the model writes its reply in the schema's
// property order (structured output keeps it; every stored reply follows it),
// so the deciding facts are written before the marks rather than as a
// justification of marks already given.
export const POWERPOINT_MARK_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    evidence_note: { type: "string" },
    ...MARK_RESPONSE_SCHEMA.properties,
  },
  required: ["evidence_note", "criteria"],
} as const

export const POWERPOINT_MARK_SYSTEM = `You are an experienced secondary school teacher marking one part of a pupil's practical PowerPoint assessment: a presentation the pupil built, with any printouts and evidence document they handed in.

The work is anonymous. Never write the pupil's name, and never guess or ask who they are. Where the mark scheme asks for a name or class, say only whether one is present.

The mark scheme is the only standard. Mark strictly against the evidence given for this part and the mark scheme. Do not award marks for what the pupil might have done, or for anything the evidence does not show. 0 is a valid and expected mark when the evidence does not meet the mark scheme.

Decide each marking point on its own, against every condition in its "Award the mark for" text and every "Check / do not accept" clause. A point is earned only when the evidence shows every one of its conditions met and no do-not-accept clause applies. When the evidence shows any condition not met, the point is not earned, however good the rest of the work is: never award a point while noting that one of its conditions is missing, and never treat a condition as optional because the rest is met.

When the mark scheme asks for a judgement across the presentation, judge every slide in the evidence and every fact the report gives about them, including anything stretched or not at its own aspect ratio, overlapping, off the slide or cut off. Judge the presentation the task asks for: slides the task asks for that are missing or empty count against it, never as having nothing wrong.

The part's marks are recorded under success criteria. These are labels for filing marks, not standards to mark against: never award or withhold a mark, or comment, because of what a criterion says.

The evidence is only what is given for this part:
- The PRESENTATION REPORT is read directly from the pupil's file. Its settings, text, fonts, sizes, colours, positions, backgrounds, transitions, animations, links and images are exact facts: trust it over how anything looks. Never infer a setting the report does not state.
- A SCREENSHOT earns a mark only when what the mark scheme asks for can be read in it. Never infer a setting a screenshot does not show.
- A SLIDE picture is the slide rendered by LibreOffice. Use it for layout and appearance only; fonts and effects may differ slightly from PowerPoint, so take exact settings from the report.
- A FILE is a printout or document the pupil handed in, attached whole.
- A REFERENCE FILE is the teacher's material that the pupil was given, not the pupil's work.

Every comment names the evidence it is based on: the slide number, the file, or the EVIDENCE heading.

Write every comment to the pupil as "you", in plain English a secondary pupil understands. Each comment is one or two short sentences on a single line: no line breaks, no lists, no quotation marks.

The evidence_note is for the teacher only and is never shown to the pupil. Write it first, before the marks: for each marking point, its conditions and do-not-accept clauses, the facts in the evidence that meet or fail each one (slide numbers, report facts, file pages, EVIDENCE headings), and whether the point is earned; then anything you could not see or check. The marks must follow the note: a point the note shows failing one condition gets 0. Plain text only, with no HTML or markup.`

/** One block of evidence text in the prompt. */
type TextBlock = { key: string; text: string }

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
  slots: PowerPointUploadSlot[]
  files: PracticalFileRow[]
  evidence: StoredEvidence[]
}): Promise<{ blocks: TextBlock[]; attachments: PendingAttachment[] }> {
  const { question, answer } = input
  const blocks: TextBlock[] = []
  const attachments: PendingAttachment[] = []
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
  return { blocks, attachments }

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
      const sections = filterPresentationSections(describePresentationSections(report), formatted)
      const slideCount = report.presentation.slideCount
      const absent = selectors.flatMap((s) => s.slides ?? []).filter((n) => n > slideCount)
      const what = source.sections ? formatted.join(", ") : "every part but media"
      const lines = [
        `PRESENTATION REPORT, ${slotLabel} (${markerFileName(file)}), ${what}:`,
        sections.length > 0 ? sections.map((s) => s.text).join("\n\n") : "(none of these parts is in the presentation)",
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
function assertWithinCaps(label: string, attachments: PendingAttachment[], promptChars: number) {
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
      `Question ${label}: its evidence is too large to mark in one call: ${problems.join("; ")}. Narrow its evidence sources (for example name only the slides it needs), or mark it yourself.`,
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
- why_not_awarded: which mark scheme points the pupil missed for the marks not given here, naming the evidence (slide number, file or EVIDENCE heading). Empty when the entry is full.
- how_to_improve: what to do next time to earn those mark scheme points. Empty when the entry is full.
Base both comments on the mark scheme and the evidence only; never mention or quote the success criteria.
- evidence_note (teacher only, written first): point by point, the conditions and the deciding facts in the evidence, whether each point is earned, and anything you could not see or check.`
}

/**
 * Mark one question of one pupil's hand-in. Returns the rows to record (one
 * per criterion the question tests), the marker's teacher-only note and the
 * call for the job row; or no rows and no call, with the reason, when the
 * question is no longer to be sent (made teacher-only, or its mark scheme
 * removed, since the job was queued).
 */
export async function markPowerPointQuestion(
  input: PowerPointMarkInput,
  call: ModelJsonCall = callModelJson,
): Promise<{
  rows: QuestionCriterionMarkInput[]
  evidenceNote: string | null
  call: PowerPointMarkingCallRecord | null
  skipped: string | null
}> {
  const questions = await readAssessmentQuestions(input.activityId)
  const question = questions.find((q) => q.questionId === input.questionId)
  if (!question) throw new PermanentAssessmentMarkingError(`Question ${input.questionId} is not on this assessment.`)
  if (question.marking === "teacher") return { rows: [], evidenceNote: null, call: null, skipped: "teacher-only" }
  if (!question.markScheme?.trim()) return { rows: [], evidenceNote: null, call: null, skipped: "no mark scheme" }

  const answer = (await readSubmissionAnswers(input.submissionId)).get(question.questionId)
  if (!answer) {
    throw new PermanentAssessmentMarkingError(`Question ${question.label} has not been read on this hand-in; send the work again.`)
  }

  const { rows: activityRows } = await query<{ lesson_id: string; body_data: unknown }>(
    "select lesson_id, body_data from activities where activity_id = $1",
    [input.activityId],
  )
  const activity = activityRows[0]
  if (!activity) throw new PermanentAssessmentMarkingError(`Activity ${input.activityId} not found.`)
  const body = PowerPointAssessmentActivityBodySchema.safeParse(activity.body_data ?? {})
  if (!body.success) {
    throw new PermanentAssessmentMarkingError("This PowerPoint assessment's upload slots are not set up; set them up, then send the work again.")
  }

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

  const { blocks, attachments } = await assembleEvidence({
    question,
    answer,
    activityId: input.activityId,
    lessonId: activity.lesson_id,
    slots: body.data.uploadSlots,
    files,
    evidence,
  })

  const prompt = buildPowerPointMarkPrompt({
    question,
    criteria,
    instructions: body.data.instructions ?? null,
    blocks,
    attachmentLabels: attachments.map((a) => a.label),
  })
  const promptChars = prompt.length + attachments.reduce((sum, a) => sum + a.label.length, 0)
  assertWithinCaps(question.label, attachments, promptChars)

  const parts: ModelPart[] = [{ text: prompt }]
  for (const attachment of attachments) {
    const data = await attachment.load()
    parts.push({ text: attachment.label })
    parts.push({ inline_data: { mime_type: attachment.mimeType, data: data.toString("base64") } })
  }

  const model = input.model || defaultMarkingModel()
  const reply = await call({
    provider: input.provider,
    model,
    systemText: POWERPOINT_MARK_SYSTEM,
    parts,
    responseSchema: POWERPOINT_MARK_RESPONSE_SCHEMA,
    timeoutMs: 180_000,
    maxTokens: 16000,
  })

  const replyRows = validateMarkReply(reply.data, criteria)
  for (const row of replyRows) {
    assertUncorruptedModelText(row.whyNotAwarded, { model, field: `why_not_awarded (${question.label}, ${row.successCriteriaId})` })
    assertUncorruptedModelText(row.howToImprove, { model, field: `how_to_improve (${question.label}, ${row.successCriteriaId})` })
  }
  const rawNote = (reply.data as { evidence_note?: unknown } | null)?.evidence_note
  if (typeof rawNote !== "string") throw new Error("Marking reply has no evidence_note.")
  const evidenceNote = rawNote.trim()
  assertUncorruptedModelText(evidenceNote, { model, field: `evidence_note (${question.label})`, mode: "note" })

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
    call: {
      request: {
        provider: input.provider,
        model,
        system: POWERPOINT_MARK_SYSTEM,
        prompt,
        attachments: attachments.map((a) => ({ label: a.label, fileName: a.fileName, mimeType: a.mimeType, bytes: a.bytes })),
        textSections: blocks.map((b) => ({ key: b.key, chars: b.text.length })),
        maxMarks: question.maxMarks,
        questionId: question.questionId,
        label: question.label,
        scType: null,
        criteria: criteria.map((c) => ({ successCriteriaId: c.successCriteriaId, allocation: c.allocation })),
      },
      response: {
        marksAwarded: replyRows.reduce((sum, row) => sum + row.awarded, 0),
        criteria: replyRows,
        evidenceNote,
        raw: reply.raw.slice(0, RAW_RESPONSE_LIMIT),
      },
      durationMs: reply.durationMs,
      attempts: reply.attempts,
    },
  }
}
