import "server-only"

// V1 uses Gemini with structured output (responseSchema) rather than function
// calling: the lesson context is small and injected directly, and the model's
// whole reply is a JSON object { message, proposals }. This is the pattern
// already proven for worksheet marking and avoids a tool round-trip.

const MODEL = "gemini-flash-latest"

export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export interface ProposedActivity {
  type: "multiple-choice-question" | "short-text-question"
  title: string
  question: string
  /** MCQ only: 2–4 answer options. */
  options?: string[]
  /** MCQ only: 0-based index into options of the correct answer. */
  correctOptionIndex?: number
  /** STQ only: the model answer used for AI marking. */
  modelAnswer?: string
  /** Success-criteria IDs (must come from the lesson's real SCs). */
  successCriteriaIds?: string[]
  maxMarks?: number
}

export interface LessonChatReply {
  message: string
  proposals: ProposedActivity[]
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    message: { type: "STRING" },
    proposals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["multiple-choice-question", "short-text-question"] },
          title: { type: "STRING" },
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          correctOptionIndex: { type: "INTEGER" },
          modelAnswer: { type: "STRING" },
          successCriteriaIds: { type: "ARRAY", items: { type: "STRING" } },
          maxMarks: { type: "INTEGER" },
        },
        required: ["type", "title", "question"],
      },
    },
  },
  required: ["message", "proposals"],
} as const

/**
 * Ask Gemini for a chat reply plus zero or more proposed MCQ/STQ activities.
 * `systemText` carries the lesson context (LOs, success criteria with IDs, and
 * existing activities); `history` is the bounded conversation window.
 */
export async function generateLessonChatReply(params: {
  systemText: string
  history: ChatTurn[]
  userMessage: string
}): Promise<LessonChatReply> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not configured.")

  const contents = [
    ...params.history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: params.userMessage }] },
  ]

  const payload = {
    systemInstruction: { parts: [{ text: params.systemText }] },
    contents,
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  )

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${text.slice(0, 500)}`)
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("Gemini returned a non-JSON response.")
  }

  const raw = ((data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text)
    .filter(Boolean)
    .join("")

  let parsed: { message?: unknown; proposals?: unknown }
  try {
    parsed = JSON.parse(raw || "{}")
  } catch {
    // Model replied in prose despite the schema — surface it as a message.
    return { message: raw || "Sorry, I couldn't generate a response.", proposals: [] }
  }

  const proposals = Array.isArray(parsed.proposals)
    ? (parsed.proposals as ProposedActivity[])
    : []
  return {
    message: typeof parsed.message === "string" ? parsed.message : "",
    proposals,
  }
}
