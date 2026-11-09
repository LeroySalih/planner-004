import "server-only"

import { query } from "@/lib/db"
import { callModelJson, defaultMarkingModel, type ModelPart } from "@/lib/ai/model-client"
import { assertUncorruptedModelText } from "@/lib/ai/model-output-guard"
import {
  readAssessmentQuestions,
  readSubmissionAnswers,
  type AssessmentQuestion,
  type QuestionCriterionMarkInput,
  type SubmissionQuestionAnswer,
} from "@/lib/assessment-paper/store"
import { readMarkableScriptId, readMarkablePages, type MarkablePage } from "@/lib/assessment-paper/files"
import type { ModelJsonCall } from "@/lib/assessment-paper/reading"
import type { AiProvider } from "@/types"

// One marking call of an assessment paper: one question of one pupil's
// script, every criterion the question tests at once, after the read.
//
// The model sees the question (label, text, max marks), its mark scheme text,
// its criteria with each one's allocation (as places to record the marks, never
// as standards: marks and comments come from the mark scheme alone), the
// reader's transcription and the pages the answer is on (all markable pages
// when the reader could not read it). With depends_on_question_id set, the earlier question's transcription
// and pages are added, labelled as the earlier answer. Not the whole paper.
// Pages come from readMarkablePages, which never reads the original or page 1.

/** A problem retrying cannot fix: the question or script is not set up for marking. */
export class PermanentAssessmentMarkingError extends Error {
  readonly permanent = true
}

export interface MarkCriterion {
  successCriteriaId: string
  description: string
  allocation: number
}

export interface MarkReplyRow {
  successCriteriaId: string
  awarded: number
  whyNotAwarded: string
  howToImprove: string
}

export interface AssessmentMarkingCallRecord {
  request: {
    provider: AiProvider
    model: string
    system: string
    prompt: string
    /** Attachment metadata only; base64 is never stored. */
    images: Array<{ fileName: string; mimeType: string; bytes: number }>
    maxMarks: number
    questionId: string
    label: string
    scType: null
    scriptId: string
    pages: number[]
    dependsOn: { label: string; pages: number[] } | null
    criteria: Array<{ successCriteriaId: string; allocation: number }>
  }
  response: {
    marksAwarded: number
    criteria: MarkReplyRow[]
    raw: string
  }
  durationMs: number
  attempts: number
}

const RAW_RESPONSE_LIMIT = 4000

export const MARK_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          success_criteria_id: { type: "string" },
          awarded: { type: "integer" },
          why_not_awarded: { type: "string" },
          how_to_improve: { type: "string" },
        },
        required: ["success_criteria_id", "awarded", "why_not_awarded", "how_to_improve"],
      },
    },
  },
  required: ["criteria"],
} as const

export const MARK_SYSTEM = `You are an experienced secondary school teacher marking one question of a pupil's written assessment paper.

The script is anonymous. Never guess, mention or ask about who the pupil is.

The mark scheme is the only standard. Mark strictly against the evidence in the pupil's answer and the mark scheme. Do not award marks for what the pupil might have meant, or for knowledge they did not show. Do not penalise spelling, punctuation or grammar unless the mark scheme says they are being assessed.

The question's marks are recorded under success criteria. These are labels for filing marks, not standards to mark against: never award or withhold a mark, or comment, because of what a criterion says.

Write every comment to the pupil as "you", in plain English a secondary pupil understands. Each comment is one or two short sentences on a single line: no line breaks, no lists, no quotation marks.`

export function buildMarkPrompt(input: {
  question: Pick<AssessmentQuestion, "label" | "questionText" | "maxMarks" | "markScheme">
  criteria: MarkCriterion[]
  answer: Pick<SubmissionQuestionAnswer, "kind" | "transcription" | "status">
  pageNumbers: number[]
  dependsOn: { label: string; transcription: string | null; pageNumbers: number[] } | null
  instructions: string | null
}): string {
  const { question, answer } = input
  const criteria = input.criteria
    .map((c) => `- success_criteria_id "${c.successCriteriaId}" (topic: ${c.description.trim() || "none given"}): holds 0 to ${c.allocation}.`)
    .join("\n")
  const answerNote = answer.status === "unreadable"
    ? "The reader could not read this answer. Every page of the script is attached: find the answer to this question yourself."
    : answer.kind === "sketch" || answer.kind === "mixed"
      ? "The answer includes a sketch. The description below is the reader's; check it against the page images, which are the evidence."
      : "The transcription below is the reader's; the page images are the evidence if they differ."
  const earlier = input.dependsOn
    ? `\nEARLIER ANSWER (question ${input.dependsOn.label}, which this question builds on; error carried forward applies — do not penalise again a mistake already penalised there, and credit correct working from the pupil's earlier result):
${input.dependsOn.transcription?.trim() || "(no transcription)"}
${input.dependsOn.pageNumbers.length > 0 ? `It is on page${input.dependsOn.pageNumbers.length === 1 ? "" : "s"} ${input.dependsOn.pageNumbers.join(", ")}, attached after this question's pages and labelled EARLIER ANSWER.` : ""}\n`
    : ""

  return `QUESTION ${question.label} (${question.maxMarks} mark${question.maxMarks === 1 ? "" : "s"}): ${question.questionText?.trim() || "as printed on the attached page"}

MARK SCHEME:
${question.markScheme?.trim() ?? ""}

WHERE TO RECORD THE MARKS (filing only; the topics are not marking standards):
${criteria}
${input.instructions?.trim() ? `\nTEACHER'S INSTRUCTIONS:\n${input.instructions.trim()}\n` : ""}
THE PUPIL'S ANSWER (${answer.kind}${answer.status === "continued" ? ", continued elsewhere on the script" : ""}):
${answer.transcription?.trim() || "(no transcription)"}
${answerNote}
Attached: page${input.pageNumbers.length === 1 ? "" : "s"} ${input.pageNumbers.join(", ")} of the script.
${earlier}
First mark the answer against the mark scheme alone: decide which marking points the pupil earned. 0 is a valid and expected score for an answer that is wrong or missing.
Then record those marks: put each earned point under the entry whose topic it fits best, never more than an entry holds and never one point under two entries. If a point fits no topic, put it under any entry with room. The entries' marks must add up to the marks the mark scheme gives.

Reply with exactly one entry per success_criteria_id above, using it exactly as written.
- why_not_awarded: which mark scheme points the pupil missed or got wrong for the marks not given here. Empty when the entry is full.
- how_to_improve: what to write next time to earn those mark scheme points. Empty when the entry is full.
Base both comments on the mark scheme and the pupil's answer only; never mention or quote the success criteria.`
}

/**
 * Check a reply against the question's criteria. Any mismatch throws, so the
 * job retries: every criterion exactly once, nothing extra, every mark a whole
 * number within that criterion's allocation.
 */
export function validateMarkReply(
  data: unknown,
  criteria: Array<{ successCriteriaId: string; allocation: number }>,
): MarkReplyRow[] {
  const entries = (data as { criteria?: unknown } | null)?.criteria
  if (!Array.isArray(entries)) throw new Error("Marking reply has no criteria list.")

  const allocationOf = new Map(criteria.map((c) => [c.successCriteriaId, c.allocation]))
  const seen = new Map<string, MarkReplyRow>()

  for (const entry of entries) {
    const raw = entry as Record<string, unknown>
    const id = typeof raw?.success_criteria_id === "string" ? raw.success_criteria_id.trim() : ""
    const allocation = allocationOf.get(id)
    if (allocation === undefined) {
      throw new Error(`Marking reply names a criterion this question does not test: ${JSON.stringify(raw?.success_criteria_id ?? null)}.`)
    }
    if (seen.has(id)) throw new Error(`Marking reply lists criterion ${id} more than once.`)
    const awarded = raw.awarded
    if (typeof awarded !== "number" || !Number.isInteger(awarded) || awarded < 0 || awarded > allocation) {
      throw new Error(`Marking reply for criterion ${id} awards ${JSON.stringify(awarded)}; it must be a whole number from 0 to ${allocation}.`)
    }
    seen.set(id, {
      successCriteriaId: id,
      awarded,
      whyNotAwarded: typeof raw.why_not_awarded === "string" ? raw.why_not_awarded.trim() : "",
      howToImprove: typeof raw.how_to_improve === "string" ? raw.how_to_improve.trim() : "",
    })
  }

  const missing = criteria.filter((c) => !seen.has(c.successCriteriaId)).map((c) => c.successCriteriaId)
  if (missing.length > 0) throw new Error(`Marking reply leaves out criterion ${missing.join(", ")}.`)

  return criteria.map((c) => seen.get(c.successCriteriaId)!)
}

/** The pages an answer is marked from: its own, or every page when unreadable or unplaced. */
export function pagesForAnswer(
  answer: Pick<SubmissionQuestionAnswer, "pages" | "status">,
  allPages: MarkablePage[],
): MarkablePage[] {
  if (answer.status === "unreadable" || answer.pages.length === 0) return allPages
  const wanted = new Set(answer.pages)
  return allPages.filter((page) => wanted.has(page.pageNumber))
}

/**
 * Mark one question of one pupil's script. Returns the rows to record (one per
 * criterion the question tests) and the call for the job row; or no rows and
 * no call, with the reason, when the question is no longer to be sent (made
 * teacher-only, or its mark scheme removed, since the job was queued).
 */
export async function markAssessmentQuestion(
  input: {
    submissionId: string
    activityId: string
    questionId: string
    provider: AiProvider
    model: string
  },
  call: ModelJsonCall = callModelJson,
): Promise<{ rows: QuestionCriterionMarkInput[]; call: AssessmentMarkingCallRecord | null; skipped: string | null }> {
  const questions = await readAssessmentQuestions(input.activityId)
  const question = questions.find((q) => q.questionId === input.questionId)
  if (!question) throw new PermanentAssessmentMarkingError(`Question ${input.questionId} is not on this assessment paper.`)
  if (question.marking === "teacher") return { rows: [], call: null, skipped: "teacher-only" }
  if (!question.markScheme?.trim()) return { rows: [], call: null, skipped: "no mark scheme" }

  const answers = await readSubmissionAnswers(input.submissionId)
  const answer = answers.get(question.questionId)
  if (!answer) {
    throw new PermanentAssessmentMarkingError(`Question ${question.label} has not been read on this script; send the script again.`)
  }

  const scriptId = await readMarkableScriptId(input.submissionId)
  if (!scriptId) {
    throw new PermanentAssessmentMarkingError("No script that passed the front sheet check is stored for this submission; upload the script again.")
  }

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

  const { rows: activityRows } = await query<{ instructions: string | null }>(
    "select body_data->>'instructions' as instructions from activities where activity_id = $1",
    [input.activityId],
  )

  const allPages = await readMarkablePages(scriptId)
  const answerPages = pagesForAnswer(answer, allPages)

  const earlierQuestion = question.dependsOnQuestionId
    ? questions.find((q) => q.questionId === question.dependsOnQuestionId) ?? null
    : null
  const earlierAnswer = earlierQuestion ? answers.get(earlierQuestion.questionId) ?? null : null
  const earlierPages = earlierAnswer && earlierAnswer.status !== "blank" && earlierAnswer.pages.length > 0
    ? allPages.filter((page) => earlierAnswer.pages.includes(page.pageNumber))
    : []

  const prompt = buildMarkPrompt({
    question,
    criteria,
    answer,
    pageNumbers: answerPages.map((page) => page.pageNumber),
    dependsOn: earlierQuestion
      ? {
          label: earlierQuestion.label,
          transcription: earlierAnswer?.status === "blank" ? "(left blank)" : earlierAnswer?.transcription ?? null,
          pageNumbers: earlierPages.map((page) => page.pageNumber),
        }
      : null,
    instructions: activityRows[0]?.instructions ?? null,
  })

  const parts: ModelPart[] = [{ text: prompt }]
  const images: AssessmentMarkingCallRecord["request"]["images"] = []
  const attach = (label: string, page: MarkablePage) => {
    parts.push({ text: label })
    parts.push({ inline_data: { mime_type: "image/png", data: page.bytes.toString("base64") } })
    images.push({ fileName: `page-${page.pageNumber}.png`, mimeType: "image/png", bytes: page.bytes.byteLength })
  }
  for (const page of answerPages) attach(`PAGE ${page.pageNumber}:`, page)
  for (const page of earlierPages) attach(`EARLIER ANSWER (question ${earlierQuestion!.label}), PAGE ${page.pageNumber}:`, page)

  const model = input.model || defaultMarkingModel()
  const reply = await call({
    provider: input.provider,
    model,
    systemText: MARK_SYSTEM,
    parts,
    responseSchema: MARK_RESPONSE_SCHEMA,
    timeoutMs: 180_000,
    maxTokens: 16000,
  })

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
    skipped: null,
    call: {
      request: {
        provider: input.provider,
        model,
        system: MARK_SYSTEM,
        prompt,
        images,
        maxMarks: question.maxMarks,
        questionId: question.questionId,
        label: question.label,
        scType: null,
        scriptId,
        pages: answerPages.map((page) => page.pageNumber),
        dependsOn: earlierQuestion
          ? { label: earlierQuestion.label, pages: earlierPages.map((page) => page.pageNumber) }
          : null,
        criteria: criteria.map((c) => ({ successCriteriaId: c.successCriteriaId, allocation: c.allocation })),
      },
      response: {
        marksAwarded: replyRows.reduce((sum, row) => sum + row.awarded, 0),
        criteria: replyRows,
        raw: reply.raw.slice(0, RAW_RESPONSE_LIMIT),
      },
      durationMs: reply.durationMs,
      attempts: reply.attempts,
    },
  }
}
