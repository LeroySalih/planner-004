import "server-only"

// Unit-level curriculum-development chat. Like the lesson chat, this uses Gemini
// with structured output (responseSchema): the model's whole reply is a JSON
// object { message, proposals }, and the teacher confirms each proposal. Unlike
// the lesson chat (which authors activities), the unit chat proposes structural
// items: new lessons, a re-ordered lesson sequence, and new learning
// objectives / success criteria.

const MODEL = "gemini-flash-latest"

export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export type UnitProposalType =
  | "lesson"
  | "lesson-reorder"
  | "learning-objective"
  | "success-criterion"

export interface UnitProposal {
  type: UnitProposalType
  /** Human-readable label for the proposal card. */
  title: string
  // ── lesson ──
  /** lesson: optional learning-objective IDs to link to the new lesson (must be real LO IDs). */
  learningObjectiveIds?: string[]
  // ── lesson-reorder ──
  /** lesson-reorder: the unit's lesson IDs in the desired new order (must be the unit's real lesson IDs). */
  lessonOrder?: string[]
  // ── learning-objective ──
  /** learning-objective: parent assessment objective ID (must be a real AO from the context). */
  assessmentObjectiveId?: string
  /** learning-objective: optional specification reference. */
  specRef?: string
  // ── success-criterion ──
  /** success-criterion: parent learning objective ID (must be a real LO from the context). */
  learningObjectiveId?: string
  /** success-criterion: the criterion text. */
  description?: string
  /** success-criterion: level 1–9. */
  level?: number
  /** Persisted outcome so reopening the chat shows what was added/discarded. */
  status?: "added" | "discarded"
}

export interface UnitChatReply {
  message: string
  proposals: UnitProposal[]
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
          type: {
            type: "STRING",
            enum: ["lesson", "lesson-reorder", "learning-objective", "success-criterion"],
          },
          title: { type: "STRING" },
          learningObjectiveIds: { type: "ARRAY", items: { type: "STRING" } },
          lessonOrder: { type: "ARRAY", items: { type: "STRING" } },
          assessmentObjectiveId: { type: "STRING" },
          specRef: { type: "STRING" },
          learningObjectiveId: { type: "STRING" },
          description: { type: "STRING" },
          level: { type: "INTEGER" },
        },
        // Require the content fields so controlled generation always emits them
        // (Gemini drops optional fields); the model fills the relevant ones for
        // the chosen type and leaves the others empty.
        required: [
          "type", "title", "lessonOrder", "assessmentObjectiveId",
          "learningObjectiveId", "description", "level",
        ],
      },
    },
  },
  required: ["message", "proposals"],
} as const

/**
 * Ask Gemini for a chat reply plus zero or more proposed structural changes to
 * the unit. `systemText` carries the unit context (lessons with IDs and order,
 * plus AOs/LOs/SCs with IDs); `history` is the bounded conversation window.
 */
export async function generateUnitChatReply(params: {
  systemText: string
  history: ChatTurn[]
  userMessage: string
}): Promise<UnitChatReply> {
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

  // Gemini occasionally returns 503 (UNAVAILABLE, transient overload) or 429;
  // retry those a few times with backoff before surfacing the error.
  const MAX_ATTEMPTS = 4
  let text = ""
  let status = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    )
    status = response.status
    text = await response.text()
    if (response.ok) break
    if ((status === 503 || status === 429) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))) // 1.5s, 3s, 4.5s
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

  const proposals = Array.isArray(parsed.proposals) ? (parsed.proposals as UnitProposal[]) : []
  return {
    message: typeof parsed.message === "string" ? parsed.message : "",
    proposals,
  }
}
