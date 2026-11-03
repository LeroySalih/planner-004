import "server-only"

import { callModelJson, defaultMarkingModel, type ModelPart } from "@/lib/ai/model-client"
import { assertUncorruptedModelText } from "@/lib/ai/model-output-guard"
import { recordModelCall } from "@/lib/ai/model-call-log"
import { resolveModelRoute } from "@/lib/ai/model-routing"
import { readAssessmentQuestions } from "@/lib/assessment-paper/store"
import { readMarkSchemePdf } from "@/lib/assessment-paper/files"
import type { ModelJsonCall } from "@/lib/assessment-paper/reading"

// The mark scheme split (Marking v2 §5): a teacher-triggered, one-off step
// that sends the paper's mark scheme PDF and its question list to the model
// and gets back each question's own mark scheme text. Nothing is saved here:
// the proposals go to the teacher (the lesson editor, or MCP as a dry run),
// who accepts them per question and saves through setAssessmentQuestions.
//
// The mark scheme is a paper file and holds no pupil data; no script page is
// ever part of this call.

/** Surface key of the split in ai_model_routes (migration 136). */
export const ASSESSMENT_MARK_SCHEME_SURFACE = "surface:assessment-mark-scheme"

export interface MarkSchemeSplitQuestion {
  label: string
  questionText: string | null
  maxMarks: number
}

export interface MarkSchemeSplitReplyRow {
  label: string
  /** The question's mark scheme text; empty when the model found none. */
  markScheme: string
}

export interface MarkSchemeProposal {
  questionId: string
  label: string
  maxMarks: number
  /** The text saved on the question now. */
  current: string | null
  /** The model's text for the question; null when it found none. */
  proposed: string | null
}

export interface MarkSchemeSplit {
  activityId: string
  provider: string
  model: string
  durationMs: number
  proposals: MarkSchemeProposal[]
}

export const MARK_SCHEME_SPLIT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          mark_scheme: { type: "string" },
        },
        required: ["label", "mark_scheme"],
      },
    },
  },
  required: ["questions"],
} as const

export const MARK_SCHEME_SPLIT_SYSTEM = `You are helping a secondary school teacher prepare an assessment paper for marking. You are given the paper's mark scheme and the list of questions on the paper. Your job is to copy out, for each question, the part of the mark scheme that marks it. You do not mark anything.

Copy the mark scheme's own words: its marking points, the marks each point carries, acceptable and rejected answers, and any guidance or levels it gives for that question. Do not summarise, reword, add marking points or invent marks the mark scheme does not give.`

export function buildMarkSchemeSplitPrompt(questions: MarkSchemeSplitQuestion[]): string {
  const list = questions
    .map((q) => `- ${q.label} (${q.maxMarks} mark${q.maxMarks === 1 ? "" : "s"}): ${q.questionText?.trim() || "(question text not given)"}`)
    .join("\n")
  return `The attached PDF is the mark scheme of an assessment paper.

QUESTIONS ON THE PAPER:
${list}

For EVERY question above, give one entry, using its label exactly as written:
- label: the question's label.
- mark_scheme: that question's part of the mark scheme, copied out as plain text, one marking point per line, with the marks shown as in the mark scheme, e.g. "Strong (1)". Include only that question: where the mark scheme covers parts such as 1(a) and 1(b) separately and the paper lists them separately, give each part its own text. Empty if the mark scheme has nothing for that question.`
}

/**
 * Check a split reply against the paper's labels. Any mismatch throws: every
 * label exactly once, nothing extra. Returned in paper order, text trimmed.
 */
export function validateMarkSchemeSplitReply(data: unknown, labels: string[]): MarkSchemeSplitReplyRow[] {
  const entries = (data as { questions?: unknown } | null)?.questions
  if (!Array.isArray(entries)) throw new Error("Mark scheme reply has no questions list.")

  const asked = new Set(labels)
  const seen = new Map<string, MarkSchemeSplitReplyRow>()
  for (const entry of entries) {
    const raw = entry as Record<string, unknown>
    const label = typeof raw?.label === "string" ? raw.label.trim() : ""
    if (!asked.has(label)) {
      throw new Error(`Mark scheme reply names a question that is not on the paper: ${JSON.stringify(raw?.label ?? null)}.`)
    }
    if (seen.has(label)) throw new Error(`Mark scheme reply lists question ${label} more than once.`)
    if (typeof raw.mark_scheme !== "string") {
      throw new Error(`Mark scheme reply for question ${label} has no mark_scheme text.`)
    }
    seen.set(label, { label, markScheme: raw.mark_scheme.trim() })
  }

  const missing = labels.filter((label) => !seen.has(label))
  if (missing.length > 0) throw new Error(`Mark scheme reply leaves out question ${missing.join(", ")}.`)

  return labels.map((label) => seen.get(label)!)
}

/**
 * Ask the model to split the paper's mark scheme by question. Returns one
 * proposal per question, beside its current text; saves nothing.
 */
export async function proposeMarkSchemeSplit(
  activityId: string,
  call: ModelJsonCall = callModelJson,
): Promise<MarkSchemeSplit> {
  const questions = await readAssessmentQuestions(activityId)
  if (questions.length === 0) throw new Error("The paper has no questions yet; add them first.")
  const pdf = await readMarkSchemePdf(activityId)
  if (!pdf) throw new Error("No mark scheme is attached to this paper; upload it first.")

  const route = await resolveModelRoute(ASSESSMENT_MARK_SCHEME_SURFACE, null)
  const model = route.model || defaultMarkingModel()
  const prompt = buildMarkSchemeSplitPrompt(questions)
  const parts: ModelPart[] = [
    { text: prompt },
    { inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } },
  ]
  const attachments = [{ fileName: "mark-scheme.pdf", kind: `application/pdf (${pdf.byteLength} bytes)` }]

  let reply: Awaited<ReturnType<ModelJsonCall>> | null = null
  try {
    reply = await call({
      provider: route.provider,
      model,
      systemText: MARK_SCHEME_SPLIT_SYSTEM,
      parts,
      responseSchema: MARK_SCHEME_SPLIT_RESPONSE_SCHEMA,
      timeoutMs: 300_000,
      maxTokens: 16000,
    })
    const rows = validateMarkSchemeSplitReply(reply.data, questions.map((q) => q.label))
    for (const row of rows) {
      // Mark schemes are multi-line by nature.
      assertUncorruptedModelText(row.markScheme, { model, field: `mark_scheme (${row.label})`, mode: "lenient" })
    }

    void recordModelCall({
      surface: ASSESSMENT_MARK_SCHEME_SURFACE,
      provider: route.provider,
      model,
      system: MARK_SCHEME_SPLIT_SYSTEM,
      userMessage: prompt,
      historyTurns: 0,
      attachments,
      response: { proposalCount: rows.filter((row) => row.markScheme).length, raw: reply.raw },
      durationMs: reply.durationMs,
      context: { activityId },
    })

    const textOf = new Map(rows.map((row) => [row.label, row.markScheme]))
    return {
      activityId,
      provider: route.provider,
      model,
      durationMs: reply.durationMs,
      proposals: questions.map((q) => ({
        questionId: q.questionId,
        label: q.label,
        maxMarks: q.maxMarks,
        current: q.markScheme,
        proposed: textOf.get(q.label) || null,
      })),
    }
  } catch (error) {
    void recordModelCall({
      surface: ASSESSMENT_MARK_SCHEME_SURFACE,
      provider: route.provider,
      model,
      system: MARK_SCHEME_SPLIT_SYSTEM,
      userMessage: prompt,
      historyTurns: 0,
      attachments,
      response: reply ? { raw: reply.raw } : null,
      durationMs: reply?.durationMs ?? null,
      error: error instanceof Error ? error.message : String(error),
      context: { activityId },
    })
    throw error
  }
}
