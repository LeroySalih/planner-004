import "server-only"

import { callModelJson, defaultMarkingModel, type ModelPart } from "@/lib/ai/model-client"
import { assertUncorruptedModelText } from "@/lib/ai/model-output-guard"
import {
  readAssessmentQuestions,
  type AnswerKind,
  type AnswerStatus,
  type SubmissionQuestionAnswerInput,
} from "@/lib/assessment-paper/store"
import { readMarkableScriptId, readMarkablePages, type MarkablePage } from "@/lib/assessment-paper/files"
import type { AiProvider } from "@/types"

// The read of an assessment paper: one call per script, before any marking.
// The model sees the question list and the script's markable pages (2..n,
// each labelled with its page number) and says, per question, where the
// answer is and what it says. A sketch is described, not transcribed.
//
// Pages come from readMarkablePages, the only loader a model call may use: it
// never reads the original or page 1, the front sheet.

/** A problem retrying cannot fix: the script or paper is not set up for reading. */
export class PermanentAssessmentReadError extends Error {
  readonly permanent = true
}

export const ANSWER_KINDS: readonly AnswerKind[] = ["text", "sketch", "mixed"]
export const ANSWER_STATUSES: readonly AnswerStatus[] = ["answered", "blank", "unreadable", "continued"]

export interface ReadQuestion {
  questionId: string
  label: string
  questionText: string | null
  maxMarks: number
}

export interface ReadReplyAnswer {
  label: string
  kind: AnswerKind
  transcription: string
  pages: number[]
  status: AnswerStatus
}

/** A model call, as callModelJson makes it. Tests pass a stub. */
export type ModelJsonCall = (request: Parameters<typeof callModelJson>[0]) => Promise<{
  data: unknown
  raw: string
  durationMs: number
  attempts: number
}>

export interface AssessmentReadCallRecord {
  request: {
    provider: AiProvider
    model: string
    system: string
    prompt: string
    /** Attachment metadata only; base64 is never stored. */
    images: Array<{ fileName: string; mimeType: string; bytes: number }>
    scriptId: string
    pages: number[]
    questions: Array<{ label: string; maxMarks: number }>
  }
  response: {
    answers: ReadReplyAnswer[]
    raw: string
  }
  durationMs: number
  attempts: number
}

const RAW_RESPONSE_LIMIT = 4000

export const READ_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          kind: { type: "string", enum: [...ANSWER_KINDS] },
          transcription: { type: "string" },
          pages: { type: "array", items: { type: "integer" } },
          status: { type: "string", enum: [...ANSWER_STATUSES] },
        },
        required: ["label", "kind", "transcription", "pages", "status"],
      },
    },
  },
  required: ["answers"],
} as const

export const READ_SYSTEM = `You are reading a pupil's handwritten answers on a scanned secondary school assessment paper, so that each answer can be marked separately afterwards. You do not mark anything.

The script is anonymous. Never guess, mention or ask about who the pupil is, and leave out any name you see.

Report what the pupil actually wrote, not what they might have meant: keep their spelling, mistakes and crossings-out as they are (omit text that is clearly crossed out). Do not correct, complete or improve an answer.`

export function buildReadPrompt(questions: ReadQuestion[], pageNumbers: number[]): string {
  const list = questions
    .map((q) => `- ${q.label} (${q.maxMarks} mark${q.maxMarks === 1 ? "" : "s"}): ${q.questionText?.trim() || "as printed on the paper"}`)
    .join("\n")
  return `These are pages ${pageNumbers.join(", ")} of a pupil's assessment paper. Page 1, the front sheet, is not included. Each image is labelled with its page number.

QUESTIONS ON THE PAPER:
${list}

For EVERY question above, give one entry, using its label exactly as written:
- label: the question's label.
- status: "answered" if the pupil wrote or drew an answer; "blank" if there is no answer; "unreadable" if there is an answer you cannot read; "continued" if the answer is written partly away from the question (on another page or in spare space).
- kind: "text" for a written answer, "sketch" for a drawing or diagram, "mixed" for both. Use "text" for a blank answer.
- transcription: the pupil's words exactly as written, with line breaks where they matter (working, lists, calculations). For a sketch, describe what is drawn: the shapes, labels, annotations, dimensions and anything shown or missing. Empty for a blank answer.
- pages: the page numbers the answer is on (from ${pageNumbers.join(", ")}). Empty for a blank answer.`
}

/**
 * Check a reply against the questions asked. Any mismatch throws, so the job
 * retries: every label exactly once, nothing extra, kinds and statuses from
 * the lists, pages only from the pages that were sent.
 */
export function validateReadReply(
  data: unknown,
  labels: string[],
  pageNumbers: number[],
): ReadReplyAnswer[] {
  const entries = (data as { answers?: unknown } | null)?.answers
  if (!Array.isArray(entries)) throw new Error("Read reply has no answers list.")

  const asked = new Set(labels)
  const allowedPages = new Set(pageNumbers)
  const seen = new Map<string, ReadReplyAnswer>()

  for (const entry of entries) {
    const raw = entry as Record<string, unknown>
    const label = typeof raw?.label === "string" ? raw.label.trim() : ""
    if (!asked.has(label)) {
      throw new Error(`Read reply names a question that is not on the paper: ${JSON.stringify(raw?.label ?? null)}.`)
    }
    if (seen.has(label)) throw new Error(`Read reply lists question ${label} more than once.`)

    const kind = raw.kind as AnswerKind
    if (!ANSWER_KINDS.includes(kind)) {
      throw new Error(`Read reply for question ${label} has kind ${JSON.stringify(raw.kind)}.`)
    }
    const status = raw.status as AnswerStatus
    if (!ANSWER_STATUSES.includes(status)) {
      throw new Error(`Read reply for question ${label} has status ${JSON.stringify(raw.status)}.`)
    }
    if (!Array.isArray(raw.pages)) throw new Error(`Read reply for question ${label} has no pages list.`)
    const pages: number[] = []
    for (const page of raw.pages) {
      if (typeof page !== "number" || !Number.isInteger(page) || !allowedPages.has(page)) {
        throw new Error(
          `Read reply for question ${label} names page ${JSON.stringify(page)}; pages must be from ${pageNumbers.join(", ")}.`,
        )
      }
      if (!pages.includes(page)) pages.push(page)
    }
    pages.sort((a, b) => a - b)

    const transcription = typeof raw.transcription === "string" ? raw.transcription.trim() : ""
    seen.set(label, {
      label,
      kind,
      status,
      transcription: status === "blank" ? "" : transcription,
      pages: status === "blank" ? [] : pages,
    })
  }

  const missing = labels.filter((label) => !seen.has(label))
  if (missing.length > 0) throw new Error(`Read reply leaves out question ${missing.join(", ")}.`)

  return labels.map((label) => seen.get(label)!)
}

/** The parts of a read request: the prompt, then each markable page with its number. */
export function buildReadParts(
  prompt: string,
  pages: MarkablePage[],
): { parts: ModelPart[]; images: AssessmentReadCallRecord["request"]["images"] } {
  const parts: ModelPart[] = [{ text: prompt }]
  const images: AssessmentReadCallRecord["request"]["images"] = []
  for (const page of pages) {
    parts.push({ text: `PAGE ${page.pageNumber}:` })
    parts.push({ inline_data: { mime_type: "image/png", data: page.bytes.toString("base64") } })
    images.push({ fileName: `page-${page.pageNumber}.png`, mimeType: "image/png", bytes: page.bytes.byteLength })
  }
  return { parts, images }
}

/**
 * Read one pupil's script: one model call over the markable pages. Returns
 * the answers to store, by question id, and the call for the job row.
 */
export async function readAssessmentScript(
  input: {
    submissionId: string
    activityId: string
    provider: AiProvider
    model: string
  },
  call: ModelJsonCall = callModelJson,
): Promise<{ answers: SubmissionQuestionAnswerInput[]; call: AssessmentReadCallRecord }> {
  const questions = await readAssessmentQuestions(input.activityId)
  if (questions.length === 0) {
    throw new PermanentAssessmentReadError("The paper has no questions; add them in the lesson editor, then send it again.")
  }

  const scriptId = await readMarkableScriptId(input.submissionId)
  if (!scriptId) {
    throw new PermanentAssessmentReadError(
      "No script that passed the front sheet check is stored for this submission; upload the script again.",
    )
  }
  const pages = await readMarkablePages(scriptId)
  const pageNumbers = pages.map((page) => page.pageNumber)

  const prompt = buildReadPrompt(questions, pageNumbers)
  const { parts, images } = buildReadParts(prompt, pages)
  const model = input.model || defaultMarkingModel()

  const reply = await call({
    provider: input.provider,
    model,
    systemText: READ_SYSTEM,
    parts,
    responseSchema: READ_RESPONSE_SCHEMA,
    timeoutMs: 300_000,
    maxTokens: 16000,
  })

  const labels = questions.map((q) => q.label)
  const answers = validateReadReply(reply.data, labels, pageNumbers)
  for (const answer of answers) {
    // Transcriptions are multi-line by nature, so only the unambiguous
    // corruption signatures apply.
    assertUncorruptedModelText(answer.transcription, { model, field: `transcription (${answer.label})`, mode: "lenient" })
  }

  const questionIdOf = new Map(questions.map((q) => [q.label, q.questionId]))
  return {
    answers: answers.map((answer) => ({
      questionId: questionIdOf.get(answer.label)!,
      kind: answer.kind,
      transcription: answer.transcription || null,
      pages: answer.pages,
      status: answer.status,
    })),
    call: {
      request: {
        provider: input.provider,
        model,
        system: READ_SYSTEM,
        prompt,
        images,
        scriptId,
        pages: pageNumbers,
        questions: questions.map((q) => ({ label: q.label, maxMarks: q.maxMarks })),
      },
      response: { answers, raw: reply.raw.slice(0, RAW_RESPONSE_LIMIT) },
      durationMs: reply.durationMs,
      attempts: reply.attempts,
    },
  }
}
