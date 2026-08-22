import "server-only"

import { callClaudeRaw, type ChatPart } from "@/lib/ai/anthropic-client"
import type { AiProvider } from "@/types"

// Shared transport for model calls: marking, OCR and chat all retry and parse
// identically through here.
//
// The wire format below is currently Gemini's, but nothing outside this module
// depends on that — callers pass a model id and get text or parsed JSON back.
// Adding a second provider means branching inside callModel, not touching its
// callers.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

/** Transient statuses worth retrying: 429 rate limit, 503 overload, 500 blip. */
const RETRYABLE = new Set([429, 500, 503])
const MAX_ATTEMPTS = 4

export interface ModelPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

export interface ModelRequest {
  /** Which provider's wire format to use. Defaults to google. */
  provider?: AiProvider
  model?: string
  systemText?: string
  parts: ModelPart[]
  /** JSON Schema constraining the reply. Omit for free text. */
  responseSchema?: Record<string, unknown>
  temperature?: number
  /** Per-request ceiling. Vision calls need longer than text ones. */
  timeoutMs?: number
}

/**
 * Last-resort fallback, for the same reason as DEFAULT_CHAT_MODEL: callers
 * pass a resolved model, and this is only reached if the routes table cannot
 * be read. GEMINI_MARKING_MODEL predates the routes table and is kept so an
 * existing deployment's .env still means something.
 */
export function defaultMarkingModel(): string {
  return process.env.GEMINI_MARKING_MODEL ?? "gemini-flash-latest"
}

function apiKey(): string {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (!key) throw new Error("GOOGLE_API_KEY is not configured.")
  return key
}

export interface ModelResult {
  /** Raw text of the first candidate. */
  text: string
  /** Wall-clock time for the call, including retries. */
  durationMs: number
  /** How many HTTP attempts were made (1 when it succeeded first time). */
  attempts: number
}

/**
 * Call the model and return the raw text of the first candidate, with timing.
 *
 * Throws on non-retryable errors and after MAX_ATTEMPTS. Callers run inside the
 * external_jobs worker, so a throw becomes an attempt bump plus backoff — which
 * is the whole point of calling directly rather than through a fire-and-forget
 * webhook.
 */
/** Gemini parts carry inline_data; Claude wants typed image/document blocks. */
function toChatParts(parts: ModelPart[]): ChatPart[] {
  return parts.flatMap((part): ChatPart[] => {
    if (part.text !== undefined) return [{ kind: "text", text: part.text }]
    if (!part.inline_data) return []
    const { mime_type, data } = part.inline_data
    return mime_type === "application/pdf"
      ? [{ kind: "document", mimeType: mime_type, base64: data }]
      : [{ kind: "image", mimeType: mime_type, base64: data }]
  })
}

export async function callModel(request: ModelRequest): Promise<ModelResult> {
  if (request.provider === "anthropic") {
    const result = await callClaudeRaw({
      model: request.model,
      system: request.systemText,
      userParts: toChatParts(request.parts),
      schema: request.responseSchema,
      // Marking feedback is a couple of sentences plus an integer; the chat
      // default would be an order of magnitude more headroom than needed.
      maxTokens: 2000,
      timeoutMs: request.timeoutMs,
    })
    // The SDK retries internally and does not report the count, so this is the
    // one attempt we observed rather than the number actually made.
    return { text: result.raw, durationMs: result.durationMs, attempts: 1 }
  }

  const model = request.model ?? defaultMarkingModel()
  const startedAt = performance.now()

  const payload: Record<string, unknown> = {
    contents: [{ role: "user", parts: request.parts }],
    generationConfig: {
      temperature: request.temperature ?? 0.2,
      ...(request.responseSchema
        ? { responseMimeType: "application/json", responseSchema: request.responseSchema }
        : {}),
    },
  }

  if (request.systemText) {
    payload.systemInstruction = { parts: [{ text: request.systemText }] }
  }

  let status = 0
  let text = ""
  let attemptsUsed = 0

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    attemptsUsed = attempt + 1
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey(), "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(request.timeoutMs ?? 120_000),
    })

    status = response.status
    text = await response.text()
    if (response.ok) break

    if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
      continue
    }
    throw new Error(`${model} ${status}: ${text.slice(0, 500)}`)
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${model} returned a non-JSON response.`)
  }

  const parts = (data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  })?.candidates?.[0]?.content?.parts ?? []

  return {
    text: parts.map((part) => part.text).filter(Boolean).join(""),
    durationMs: Math.round(performance.now() - startedAt),
    attempts: attemptsUsed,
  }
}

/** Call the model with a response schema and parse the JSON reply. */
export async function callModelJson<T>(
  request: ModelRequest,
): Promise<{ data: T; raw: string; durationMs: number; attempts: number }> {
  const result = await callModel(request)
  try {
    return {
      data: JSON.parse(result.text || "{}") as T,
      raw: result.text,
      durationMs: result.durationMs,
      attempts: result.attempts,
    }
  } catch {
    throw new Error(`${request.model ?? "model"} returned unparseable JSON: ${result.text.slice(0, 300)}`)
  }
}
