import "server-only"

// Shared Gemini transport. Extracted from the pattern already used by
// unit-chat-gemini / lesson-chat-gemini so marking, OCR and chat all retry and
// parse identically.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

/** Transient statuses worth retrying: 429 rate limit, 503 overload, 500 blip. */
const RETRYABLE = new Set([429, 500, 503])
const MAX_ATTEMPTS = 4

export interface GeminiPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

export interface GeminiRequest {
  model?: string
  systemText?: string
  parts: GeminiPart[]
  /** JSON Schema constraining the reply. Omit for free text. */
  responseSchema?: Record<string, unknown>
  temperature?: number
  /** Per-request ceiling. Vision calls need longer than text ones. */
  timeoutMs?: number
}

export function defaultMarkingModel(): string {
  return process.env.GEMINI_MARKING_MODEL ?? "gemini-flash-latest"
}

function apiKey(): string {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (!key) throw new Error("GOOGLE_API_KEY is not configured.")
  return key
}

export interface GeminiResult {
  /** Raw text of the first candidate. */
  text: string
  /** Wall-clock time for the call, including retries. */
  durationMs: number
  /** How many HTTP attempts were made (1 when it succeeded first time). */
  attempts: number
}

/**
 * Call Gemini and return the raw text of the first candidate, with timing.
 *
 * Throws on non-retryable errors and after MAX_ATTEMPTS. Callers run inside the
 * external_jobs worker, so a throw becomes an attempt bump plus backoff — which
 * is the whole point of calling directly rather than through a fire-and-forget
 * webhook.
 */
export async function callGemini(request: GeminiRequest): Promise<GeminiResult> {
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
    throw new Error(`Gemini ${status}: ${text.slice(0, 500)}`)
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("Gemini returned a non-JSON response.")
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

/** Call Gemini with a response schema and parse the JSON reply. */
export async function callGeminiJson<T>(
  request: GeminiRequest,
): Promise<{ data: T; raw: string; durationMs: number; attempts: number }> {
  const result = await callGemini(request)
  try {
    return {
      data: JSON.parse(result.text || "{}") as T,
      raw: result.text,
      durationMs: result.durationMs,
      attempts: result.attempts,
    }
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${result.text.slice(0, 300)}`)
  }
}
