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

/**
 * Call Gemini and return the raw text of the first candidate.
 *
 * Throws on non-retryable errors and after MAX_ATTEMPTS. Callers run inside the
 * external_jobs worker, so a throw becomes an attempt bump plus backoff — which
 * is the whole point of calling directly rather than through a fire-and-forget
 * webhook.
 */
export async function callGemini(request: GeminiRequest): Promise<string> {
  const model = request.model ?? defaultMarkingModel()

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

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
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

  return parts.map((part) => part.text).filter(Boolean).join("")
}

/** Call Gemini with a response schema and parse the JSON reply. */
export async function callGeminiJson<T>(request: GeminiRequest): Promise<T> {
  const raw = await callGemini(request)
  try {
    return JSON.parse(raw || "{}") as T
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${raw.slice(0, 300)}`)
  }
}
