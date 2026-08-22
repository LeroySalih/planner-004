import "server-only"

import { callClaudeChatJson } from "@/lib/ai/anthropic-client"
import { assertUncorruptedModelText } from "@/lib/ai/model-output-guard"
import { resolveModelRoute } from "@/lib/ai/model-routing"
import { recordModelCall } from "@/lib/ai/model-call-log"

// Unit-level curriculum-development chat. Like the lesson chat, this uses Claude
// with structured output (responseSchema): the model's whole reply is a JSON
// object { message, proposals }, and the teacher confirms each proposal. Unlike
// the lesson chat (which authors activities), the unit chat proposes structural
// items: new lessons, a re-ordered lesson sequence, and new learning
// objectives / success criteria.


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
 * Ask the model for a chat reply plus zero or more proposed structural changes to
 * the unit. `systemText` carries the unit context (lessons with IDs and order,
 * plus AOs/LOs/SCs with IDs); `history` is the bounded conversation window.
 */
export async function generateUnitChatReply(params: {
  systemText: string
  history: ChatTurn[]
  userMessage: string
}): Promise<UnitChatReply> {
  const route = await resolveModelRoute("surface:unit-chat")
  // The model id is configurable; the provider is not. Only the Anthropic
  // transport carries multi-turn history, so a route pointing elsewhere — a
  // stale row, or an unreadable routes table falling back to the Gemini
  // default — would otherwise send a Gemini model id to the Anthropic API and
  // fail as an unexplained 404.
  if (route.provider !== "anthropic") {
    throw new Error(
      `Unit chat is routed to provider "${route.provider}", which cannot serve it. Fix the route at /admin/ai-models.`,
    )
  }
  // Declared outside the try so the failure path can still log the reply that
  // caused it. A guard rejection happens *after* a successful call, and that
  // reply is the single most useful thing to look at afterwards.
  let reply: Awaited<ReturnType<typeof callClaudeChatJson<{ message?: unknown; proposals?: unknown }>>> | null = null
  const startedAt = Date.now()

  const log = (over: { response?: Parameters<typeof recordModelCall>[0]["response"]; error?: string | null }) =>
    void recordModelCall({
      surface: "surface:unit-chat",
      provider: route.provider,
      model: route.model,
      system: params.systemText,
      userMessage: params.userMessage,
      historyTurns: params.history.length,
      durationMs: reply?.durationMs ?? Date.now() - startedAt,
      ...over,
    })

  try {
    reply = await callClaudeChatJson<{ message?: unknown; proposals?: unknown }>({
      model: route.model,
      system: params.systemText,
      history: params.history,
      userParts: [{ kind: "text", text: params.userMessage }],
      schema: RESPONSE_SCHEMA,
    })

    if (!reply.data) {
      // Model replied in prose despite the schema — surface it as a message.
      log({ response: { raw: reply.raw }, error: "reply was not JSON" })
      return { message: reply.raw || "Sorry, I couldn't generate a response.", proposals: [] }
    }

    const message = typeof reply.data.message === "string" ? reply.data.message : ""
    // Corrupted JSON escaping still parses, so nothing above would have noticed.
    assertUncorruptedModelText(message, { model: reply.model, field: "chat message", mode: "lenient" })

    const proposals = Array.isArray(reply.data.proposals) ? (reply.data.proposals as UnitProposal[]) : []
    log({ response: { message, proposalCount: proposals.length, raw: reply.raw } })
    return { message, proposals }
  } catch (err) {
    log({
      response: reply ? { raw: reply.raw } : null,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
