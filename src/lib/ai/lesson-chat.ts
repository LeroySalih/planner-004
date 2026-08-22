import "server-only"

// Structured output rather than tool calling: the lesson context is small and
// injected directly, and the model's whole reply is a JSON object
// { message, proposals }. This avoids a tool round-trip.
//
// Chat runs on Claude; generateImage below still uses Gemini, because Claude
// does not generate images.

import { callClaudeChatJson, type ChatPart } from "@/lib/ai/anthropic-client"
import { assertUncorruptedModelText } from "@/lib/ai/model-output-guard"
import { resolveModelRoute } from "@/lib/ai/model-routing"

export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export type ProposedActivityType =
  | "multiple-choice-question"
  | "short-text-question"
  | "text"
  | "display-section"
  | "show-video"
  | "upload-file"
  | "upload-url"
  | "voice"
  | "matcher"
  | "group-items"
  | "sequence"
  | "display-image"
  | "file-download"
  | "display-webpage"
  | "upload-worksheet"
  | "upload-spreadsheet"
  | "learning-objective"
  | "success-criterion"
  | "conversion-failed"

export interface ProposedActivity {
  type: ProposedActivityType
  title: string
  /** MCQ/STQ only: the question stem. */
  question?: string
  /** MCQ only: 2–4 answer options, each flagged correct/incorrect. */
  options?: Array<{ text: string; correct: boolean }>
  /** STQ only: the model answer used for AI marking. */
  modelAnswer?: string
  /**
   * Multi-purpose text: Display Text content, Display Section heading, or the
   * pupil-facing prompt for upload-file / upload-url / voice.
   */
  text?: string
  /** Display Video: the video URL. */
  videoUrl?: string
  /** Matcher: 2–8 term/definition pairs. */
  pairs?: Array<{ term: string; definition: string }>
  /** Group Items: 2–4 group (bucket) names. */
  groups?: string[]
  /** Group Items: 2–12 items, each assigned to a group by its name. */
  items?: Array<{ text: string; group: string }>
  /** Sequence: 2–12 terms in the CORRECT order. */
  sequence?: string[]
  /** File types (display-image/file-download/display-webpage): the attached file this proposal uses. */
  attachmentId?: string
  /** Display Image: concise alt text. */
  imageAlt?: string
  /** Display Image: set to a detailed image description ONLY when the teacher asks
   * you to generate/create an image (and none is attached). The server renders it
   * with the image model and fills fileRef. Leave empty when an image is attached. */
  imagePrompt?: string
  /** Upload Exam / Upload Spreadsheet: what pupils should do. */
  task?: string
  /** Upload Exam / Upload Spreadsheet: how the AI should mark it. */
  markingGuidance?: string
  /** Success-criteria IDs (must come from the lesson's real SCs). */
  successCriteriaIds?: string[]
  maxMarks?: number
  // ── Curriculum authoring (learning-objective / success-criterion) ──
  /** learning-objective: parent assessment objective ID (must be a real AO from the context). */
  assessmentObjectiveId?: string
  /** learning-objective: optional specification reference. */
  specRef?: string
  /** success-criterion: parent learning objective ID (must be a real LO from the context). */
  learningObjectiveId?: string
  /** success-criterion: the criterion text. */
  description?: string
  /** success-criterion: level 1–9. */
  level?: number
  // ── Server-injected (resolved from attachmentId; not produced by the model) ──
  fileRef?: string
  fileName?: string
  fileKind?: "image" | "html" | "file"
  /** Persisted outcome so reopening the chat shows what was added/discarded. */
  status?: "added" | "discarded"
}

export interface ChatAttachment {
  attachmentId: string
  fileName: string
  kind: "image" | "html" | "file"
  /** Downscaled data URI for images, sent to the model as vision input. */
  dataUrl?: string
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
          type: {
            type: "STRING",
            enum: [
              "multiple-choice-question",
              "short-text-question",
              "text",
              "display-section",
              "show-video",
              "upload-file",
              "upload-url",
              "voice",
              "matcher",
              "group-items",
              "sequence",
              "display-image",
              "file-download",
              "display-webpage",
              "upload-worksheet",
              "upload-spreadsheet",
              "learning-objective",
              "success-criterion",
              "conversion-failed",
            ],
          },
          title: { type: "STRING" },
          question: { type: "STRING" },
          assessmentObjectiveId: { type: "STRING" },
          specRef: { type: "STRING" },
          learningObjectiveId: { type: "STRING" },
          description: { type: "STRING" },
          level: { type: "INTEGER" },
          text: { type: "STRING" },
          videoUrl: { type: "STRING" },
          attachmentId: { type: "STRING" },
          imageAlt: { type: "STRING" },
          imagePrompt: { type: "STRING" },
          task: { type: "STRING" },
          markingGuidance: { type: "STRING" },
          options: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING" },
                correct: { type: "BOOLEAN" },
              },
              required: ["text", "correct"],
            },
          },
          modelAnswer: { type: "STRING" },
          pairs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { term: { type: "STRING" }, definition: { type: "STRING" } },
              required: ["term", "definition"],
            },
          },
          groups: { type: "ARRAY", items: { type: "STRING" } },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { text: { type: "STRING" }, group: { type: "STRING" } },
              required: ["text", "group"],
            },
          },
          sequence: { type: "ARRAY", items: { type: "STRING" } },
          successCriteriaIds: { type: "ARRAY", items: { type: "STRING" } },
          maxMarks: { type: "INTEGER" },
        },
        // Require the content fields so controlled generation always emits them
        // (Gemini drops optional fields); the model fills the relevant ones for
        // the chosen type and leaves the others empty.
        required: [
          "type", "title", "question", "text", "videoUrl", "modelAnswer",
          "options", "pairs", "groups", "items", "sequence", "attachmentId", "imageAlt",
          "imagePrompt", "task", "markingGuidance",
          "assessmentObjectiveId", "learningObjectiveId", "description", "level",
        ],
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
export interface ActivityReference {
  label: string
  kind: "image" | "text"
  /** Downscaled data URI for image activities, sent as vision. */
  dataUrl?: string
  /** Text content for text activities. */
  text?: string
}

export async function generateLessonChatReply(params: {
  systemText: string
  history: ChatTurn[]
  userMessage: string
  attachments?: ChatAttachment[]
  references?: ActivityReference[]
  /** Documents (e.g. PDFs) sent for native understanding, as base64 + mime type. */
  documents?: Array<{ mimeType: string; base64: string }>
}): Promise<LessonChatReply> {
  const attachments = params.attachments ?? []
  const attachmentNote = attachments.length
    ? "\n\nAttached files (reference by attachmentId):\n" +
      attachments.map((a) => `- ${a.attachmentId}: ${a.kind} "${a.fileName}"`).join("\n")
    : ""

  const references = params.references ?? []
  const referenceNote = references.length
    ? "\n\nExisting lesson activities to use as reference (context only — do NOT recreate them; base the new activities on them):\n" +
      references
        .map((r) => (r.kind === "text" ? `- "${r.label}": ${r.text ?? ""}` : `- "${r.label}" (image shown below)`))
        .join("\n")
    : ""

  const documents = params.documents ?? []
  const userParts: ChatPart[] = [
    { kind: "text", text: params.userMessage + attachmentNote + referenceNote },
  ]
  // Order is preserved from the Gemini implementation on purpose. Claude reads
  // images slightly better when they precede the text, but referenceNote says
  // "image shown below", so reordering here would make the prompt lie.
  for (const d of documents) {
    userParts.push({ kind: "document", mimeType: d.mimeType, base64: d.base64 })
  }
  for (const a of attachments) {
    if (a.kind === "image" && a.dataUrl) {
      const m = /^data:(.+?);base64,(.*)$/.exec(a.dataUrl)
      userParts.push({ kind: "image", mimeType: m ? m[1] : "image/jpeg", base64: m ? m[2] : a.dataUrl })
    }
  }
  for (const r of references) {
    if (r.kind === "image" && r.dataUrl) {
      const m = /^data:(.+?);base64,(.*)$/.exec(r.dataUrl)
      userParts.push({ kind: "image", mimeType: m ? m[1] : "image/jpeg", base64: m ? m[2] : r.dataUrl })
    }
  }

  const route = await resolveModelRoute("surface:lesson-chat")
  // The model id is configurable; the provider is not. Only the Anthropic
  // transport carries multi-turn history, so a route pointing elsewhere — a
  // stale row, or an unreadable routes table falling back to the Gemini
  // default — would otherwise send a Gemini model id to the Anthropic API and
  // fail as an unexplained 404.
  if (route.provider !== "anthropic") {
    throw new Error(
      `Lesson chat is routed to provider "${route.provider}", which cannot serve it. Fix the route at /admin/ai-models.`,
    )
  }
  const reply = await callClaudeChatJson<{ message?: unknown; proposals?: unknown }>({
    model: route.model,
    system: params.systemText,
    history: params.history,
    userParts,
    schema: RESPONSE_SCHEMA,
  })

  if (!reply.data) {
    // Model replied in prose despite the schema — surface it as a message.
    return { message: reply.raw || "Sorry, I couldn't generate a response.", proposals: [] }
  }

  const message = typeof reply.data.message === "string" ? reply.data.message : ""
  // Corrupted JSON escaping still parses, so nothing above would have noticed.
  assertUncorruptedModelText(message, { model: reply.model, field: "chat message", mode: "lenient" })

  const proposals = Array.isArray(reply.data.proposals)
    ? (reply.data.proposals as ProposedActivity[])
    : []
  return { message, proposals }
}


/**
 * Generate an image from a text prompt using a Gemini flash-image model. Returns
 * the raw image bytes + mime type (the model replies with inline base64 image
 * data). Throws on failure so callers can skip the proposal gracefully.
 */
export async function generateImage(prompt: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not configured.")

  // Model id is configurable; the provider is not. No Anthropic model generates
  // images, so a route pointing anywhere else is a misconfiguration to surface
  // rather than an endpoint to attempt.
  const route = await resolveModelRoute("surface:image-generation")
  if (route.provider !== "google") {
    throw new Error(
      `Image generation is routed to "${route.provider}", which cannot generate images. Fix the route at /admin/ai-models.`,
    )
  }
  const imageModel = route.model

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  }

  const MAX_ATTEMPTS = 3
  let lastError = ""
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    )
    const text = await response.text()
    if (!response.ok) {
      lastError = `Gemini image ${response.status}: ${text.slice(0, 300)}`
      if ((response.status === 503 || response.status === 429) && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      throw new Error(lastError)
    }

    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error("Gemini image model returned a non-JSON response.")
    }
    const parts =
      (data as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> })
        ?.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find((p) => p.inlineData?.data)
    if (!imagePart?.inlineData?.data) {
      throw new Error("The image model did not return an image (it may have been blocked by a safety filter).")
    }
    return {
      buffer: Buffer.from(imagePart.inlineData.data, "base64"),
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
    }
  }
  throw new Error(lastError || "Image generation failed.")
}
