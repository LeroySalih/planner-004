import { z } from "zod"

const CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions"
const MODEL_NAME = "gpt-5-mini"

const EvaluationResponseSchema = z.array(
  z.object({
    submissionId: z.string(),
    score: z.number().min(0).max(1),
  }),
)

export interface ShortTextEvaluationInput {
  submissionId: string
  answer: string
}

export interface ShortTextEvaluationResult {
  submissionId: string
  score: number | null
  error?: string
}

interface CallOptions {
  signal?: AbortSignal
}

export async function scoreShortTextAnswers(
  question: string,
  modelAnswer: string,
  inputs: ShortTextEvaluationInput[],
  options: CallOptions = {},
): Promise<ShortTextEvaluationResult[]> {
  if (inputs.length === 0) {
    return []
  }

  const apiKey = process.env.OPEN_AI_KEY
  if (!apiKey) {
    throw new Error("OPEN_AI_KEY is not configured")
  }

  const normalizedQuestion = question.trim()
  const normalizedModelAnswer = modelAnswer.trim()

  const instructions = [
    "You are grading short text answers from pupils.",
    "For each submission you must provide a correctness score between 0 and 1.",
    "Only reply with a JSON array of objects that match this TypeScript definition:",
    "Array<{ submissionId: string; score: number }>",
    "Do not include any extra commentary or text outside of the JSON response.",
    "If a pupil answer is empty or missing, return a score of 0.",
    "Ensure scores stay within the inclusive range [0, 1].",
  ].join(" ")

  const submissionDetails = inputs
    .map(
      (entry, index) =>
        `Submission ${index + 1}:\nsubmissionId: ${entry.submissionId}\nPupil answer: ${
          entry.answer?.trim() || "(blank)"
        }`,
    )
    .join("\n\n")

  const userPrompt = [
    "Question:",
    normalizedQuestion || "(empty question provided to pupils)",
    "",
    "Model answer:",
    normalizedModelAnswer || "(model answer not provided)",
    "",
    "Pupil submissions:",
    submissionDetails,
  ].join("\n")

  const response = await fetch(CHAT_COMPLETIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 600,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } | null }>
  }

  const messageContent = payload.choices?.[0]?.message?.content ?? ""
  const parsedResults = parseEvaluationResponse(messageContent)

  const resultMap = new Map(parsedResults.map((entry) => [entry.submissionId, entry.score]))

  return inputs.map((entry) => {
    const score = resultMap.get(entry.submissionId)
    if (typeof score === "number" && Number.isFinite(score)) {
      const clamped = clamp(score, 0, 1)
      return { submissionId: entry.submissionId, score: clamped }
    }

    return {
      submissionId: entry.submissionId,
      score: null,
      error: score === undefined ? "Score missing in AI response." : "Invalid score returned by AI.",
    }
  })
}

function parseEvaluationResponse(content: string): Array<{ submissionId: string; score: number }> {
  if (!content) {
    throw new Error("Empty response from OpenAI")
  }

  const trimmed = content.trim()
  const jsonMatch = trimmed.match(/```json([\s\S]*?)```/i)
  const jsonPayload = jsonMatch ? jsonMatch[1].trim() : trimmed
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(jsonPayload)
  } catch (error) {
    throw new Error(`OpenAI response was not valid JSON: ${error instanceof Error ? error.message : "Unknown error"}`)
  }

  const parsed = EvaluationResponseSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new Error(`Unable to parse AI scoring response: ${parsed.error.message}`)
  }

  return parsed.data
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
