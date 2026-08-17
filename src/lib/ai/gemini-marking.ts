import "server-only"

import { callGeminiJson, defaultMarkingModel, type GeminiPart } from "@/lib/ai/gemini-client"

export interface CriterionContext {
  successCriteriaId: string
  scType: "binary" | "levelled"
  description: string
  /** Ascending descriptors, lowest first. Empty for binary criteria. */
  descriptors: string[]
}

export interface MarkingRequest {
  /** Overrides the default marking model for this call. */
  model?: string
  /** Set for upload-code: the pupil's answer is source in this language and
   *  feedback must never contain a working solution. */
  code?: { source: string; language: string } | null
  question: string
  modelAnswer: string | null
  markingGuidance: string | null
  pupilAnswer: string
  /** Ceiling for this call: the criterion's marks when marking one criterion. */
  maxMarks: number
  /** Set when this call assesses a single success criterion. */
  criterion?: CriterionContext | null
  /** Images for vision marking (mark-worksheet). Data URIs. */
  images?: Array<{ dataUrl: string; fileName: string }>
}

export interface MarkingResult {
  marksAwarded: number
  feedback: string
  /** What was sent, what came back, and how long it took — persisted on the
   *  queue row so marking runs can be reviewed after the fact. */
  call: MarkingCallRecord
}

export interface MarkingCallRecord {
  request: {
    model: string
    system: string
    prompt: string
    /** Image metadata only. The base64 payload is deliberately excluded — a
     *  worksheet request carries several MB of it and would bloat the queue. */
    images: Array<{ fileName: string; mimeType: string; bytes: number }>
    maxMarks: number
    successCriteriaId: string | null
    scType: "binary" | "levelled" | null
  }
  response: {
    marksAwarded: number
    feedback: string
    /** The model's reply verbatim, truncated for storage. */
    raw: string
  }
  durationMs: number
  attempts: number
}

/** Raw replies are bounded so one odd response cannot bloat the queue table. */
const RAW_RESPONSE_LIMIT = 4000

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    marks_awarded: { type: "integer" },
    feedback: { type: "string" },
  },
  required: ["marks_awarded", "feedback"],
} as const

const BASE_SYSTEM = `You are an experienced secondary school teacher marking a pupil's work.

Mark strictly against the evidence in the pupil's answer. Do not award marks for
what the pupil might have meant, or for knowledge they did not demonstrate. Do
not penalise spelling, punctuation or grammar unless the marking guidance says
they are being assessed.

Write feedback addressed to the pupil in the second person. Be specific about
what earned the marks and what was missing. Two or three sentences.`

/**
 * The criterion-scoped instruction. This is the part that could previously only
 * be *requested* of the n8n flow — most importantly the statement that 0 is a
 * valid score. Without it a model anchors to the lowest descriptor and never
 * returns 0, which silently inflates every mark on a levelled criterion.
 */
function criterionInstruction(criterion: CriterionContext, maxMarks: number): string {
  if (criterion.scType === "binary") {
    return `You are assessing ONE success criterion:

"${criterion.description}"

Award exactly 1 mark if the pupil's answer meets this criterion, or 0 if it does
not. 0 is a valid and expected score when the criterion is not met.

Assess ONLY this criterion. Ignore parts of the answer that address other
criteria — they are marked separately.

Your feedback must be about this criterion alone.`
  }

  const rungs = criterion.descriptors
    .map((descriptor, index) => `  ${index + 1} — ${descriptor}`)
    .join("\n")

  return `You are assessing ONE success criterion, on a scale of 0 to ${maxMarks}:

"${criterion.description}"

The levels, in ascending order:
  0 — none of the descriptors below is met
${rungs}

Award the number of the HIGHEST level the pupil has FULLY met. If they have not
met level 1, award 0. **0 is a valid and expected score** — do not default to
level 1 for an answer that does not reach it.

Assess ONLY this criterion. Ignore parts of the answer that address other
criteria — they are marked separately.

Your feedback must be about this criterion alone, and should say what would be
needed to reach the next level.`
}

function wholeActivityInstruction(maxMarks: number): string {
  return `Award a whole number of marks from 0 to ${maxMarks}. 0 is a valid score.`
}

/**
 * Extra instruction for code marking.
 *
 * The hard requirement is that feedback never hands back a solution. A pupil
 * who is told "here is the corrected function" has learned nothing and the
 * activity is worthless. Naming a construct is fine; writing their answer is
 * not.
 */
function codeInstruction(language: string): string {
  return `The pupil's answer is ${language} source code. Read it as a whole:
consider whether it solves the task, whether the logic is correct, and whether
it would actually run.

**Never write a working solution.** Do not output corrected code, completed
functions, or a rewritten version of the pupil's program — not even partially.
You may name a construct or built-in ("you need a loop here", "look at
\`range()\`", "your condition is inverted"), and you may quote a SHORT fragment
of the PUPIL'S OWN code to point at a problem. You must not supply the code
that would fix it.

Say what is wrong, where, and what the pupil should think about. Leave the
fixing to them.`
}

function fieldOrNotSet(value: string | null | undefined): string {
  return typeof value === "string" && value.trim() !== "" ? value : "Not Set"
}

/**
 * Remove handed-back solutions from code feedback.
 *
 * The prompt forbids writing working code, but a prompt is guidance, not a
 * guarantee — and the cost of it being ignored is a pupil handed the answer.
 * Fenced blocks longer than SOLUTION_LINE_LIMIT are replaced with a note.
 *
 * Short fences survive deliberately: "use `range()`" or a two-line quote of the
 * pupil's own code pointing at a bug are useful and are not solutions. This
 * catches the case that actually matters — a pasted working program.
 */
const SOLUTION_LINE_LIMIT = 3
const FENCED_BLOCK = /```[^\n]*\n([\s\S]*?)```/g

export function stripSolutionCode(feedback: string): string {
  return feedback
    .replace(FENCED_BLOCK, (match, body: string) => {
      const lines = body.split("\n").filter((line) => line.trim().length > 0)
      if (lines.length <= SOLUTION_LINE_LIMIT) return match
      return "_(a code sample was removed here — work out the fix from the points above)_"
    })
    .trim()
}

/**
 * Mark one submission — against a single success criterion when `criterion` is
 * set, otherwise against the activity as a whole.
 *
 * Returns whole marks clamped to 0..maxMarks. The response schema constrains
 * the model to an integer, and this clamps as a second line of defence: a
 * levelled criterion with 3 descriptors can only ever yield 0, 1, 2 or 3.
 */
export async function markWithGemini(request: MarkingRequest): Promise<MarkingResult> {
  const maxMarks = Math.max(1, Math.floor(request.maxMarks))

  const instruction = [
    request.criterion
      ? criterionInstruction(request.criterion, maxMarks)
      : wholeActivityInstruction(maxMarks),
    request.code ? codeInstruction(request.code.language) : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const textBlock = [
    `QUESTION / TASK:\n${fieldOrNotSet(request.question)}`,
    `MODEL ANSWER:\n${fieldOrNotSet(request.modelAnswer)}`,
    `MARKING GUIDANCE:\n${fieldOrNotSet(request.markingGuidance)}`,
    request.code
      ? `PUPIL SUBMISSION (${request.code.language}):\n\`\`\`${request.code.language}\n${request.code.source || "(no code submitted)"}\n\`\`\``
      : request.images?.length
      ? "PUPIL ANSWER: see the attached images."
      : `PUPIL ANSWER:\n${request.pupilAnswer || "(no answer given)"}`,
  ].join("\n\n")

  const prompt = `${instruction}\n\n${textBlock}`
  const parts: GeminiPart[] = [{ text: prompt }]
  const imageMeta: MarkingCallRecord["request"]["images"] = []

  for (const image of request.images ?? []) {
    const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(image.dataUrl)
    if (!match) continue
    parts.push({ inline_data: { mime_type: match[1], data: match[2] } })
    imageMeta.push({
      fileName: image.fileName,
      mimeType: match[1],
      // Decoded size, which is what the model actually receives.
      bytes: Math.floor((match[2].length * 3) / 4),
    })
  }

  const model = request.model ?? defaultMarkingModel()

  const reply = await callGeminiJson<{ marks_awarded?: unknown; feedback?: unknown }>({
    model,
    systemText: BASE_SYSTEM,
    parts,
    responseSchema: RESPONSE_SCHEMA,
    // Vision calls carry several images and need longer than a text call.
    timeoutMs: request.images?.length ? 180_000 : 90_000,
  })

  const rawMarks = typeof reply.data.marks_awarded === "number" ? reply.data.marks_awarded : 0
  const marksAwarded = Math.max(0, Math.min(maxMarks, Math.round(rawMarks)))
  const rawFeedback = typeof reply.data.feedback === "string" ? reply.data.feedback.trim() : ""
  // A prompt is not a guarantee. Strip anything that looks like a handed-back
  // solution before it can reach a pupil.
  const feedback = request.code ? stripSolutionCode(rawFeedback) : rawFeedback

  return {
    marksAwarded,
    feedback,
    call: {
      request: {
        model,
        system: BASE_SYSTEM,
        prompt,
        images: imageMeta,
        maxMarks,
        successCriteriaId: request.criterion?.successCriteriaId ?? null,
        scType: request.criterion?.scType ?? null,
      },
      response: {
        marksAwarded,
        feedback,
        raw: reply.raw.slice(0, RAW_RESPONSE_LIMIT),
      },
      durationMs: reply.durationMs,
      attempts: reply.attempts,
    },
  }
}
