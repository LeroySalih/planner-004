import "server-only"

// Experiment: read a photo of a pupil's handwritten work and map each answer to
// the lesson's scorable activities, so the answers can be submitted and marked
// through the normal pipeline. The model returns answers as HUMAN-READABLE text
// (option text, answer text, term/definition pairs, item→group, ordered terms);
// the server maps that text to internal IDs and routes it through the existing
// upsert*/save* submit actions. A pupil confirms before anything is submitted.

const MODEL = "gemini-flash-latest"

export type AnswerableType =
  | "multiple-choice-question"
  | "short-text-question"
  | "long-text-question"
  | "text-question"
  | "matcher"
  | "group-items"
  | "sequence"

/** What the model is shown for each activity so it knows what to look for. */
export interface ActivityContext {
  activityId: string
  type: AnswerableType
  /** Question stem / prompt shown to the pupil. */
  question: string
  /** MCQ: the answer options (text only — the model returns the chosen text). */
  options?: string[]
  /** Matcher: the terms and the definitions to pair up. */
  terms?: string[]
  definitions?: string[]
  /** Group-items: the group (bucket) names and the items to place. */
  groups?: string[]
  items?: string[]
  /** Sequence: the items to arrange in order. */
  sequenceItems?: string[]
}

/** The model's extracted answer for one activity (human-readable, pre-mapping). */
export interface ExtractedAnswer {
  activityId: string
  type: AnswerableType
  /** 0–1: how confident the model is it read/associated this answer correctly. */
  confidence: number
  /** MCQ: the chosen option's text (verbatim from the options list). */
  chosenOption?: string
  /** short/long/text-question: the transcribed answer. */
  answerText?: string
  /** matcher: pupil's pairing as {term, definition}. */
  matches?: Array<{ term: string; definition: string }>
  /** group-items: pupil's placement as {item, group}. */
  placements?: Array<{ item: string; group: string }>
  /** sequence: the items in the pupil's order, first to last. */
  order?: string[]
  /** Short note if the answer was unclear/absent. */
  note?: string
}

export interface ExtractResult {
  answers: ExtractedAnswer[]
  /** Model's free-text summary of what it saw (for the review UI / debugging). */
  message: string
}

function activityInstructions(a: ActivityContext): string {
  const lines: string[] = [`- activityId ${a.activityId} · type ${a.type}\n  Q: ${a.question}`]
  if (a.type === "multiple-choice-question" && a.options?.length) {
    lines.push(`  Options: ${a.options.map((o) => `"${o}"`).join(", ")} — return the chosen option's exact text in "chosenOption".`)
  } else if (a.type === "matcher") {
    lines.push(`  Terms: ${(a.terms ?? []).join(" | ")}\n  Definitions: ${(a.definitions ?? []).join(" | ")} — return the pupil's pairing in "matches" as {term, definition} using the exact texts.`)
  } else if (a.type === "group-items") {
    lines.push(`  Groups: ${(a.groups ?? []).join(" | ")}\n  Items: ${(a.items ?? []).join(" | ")} — return "placements" as {item, group} using the exact texts.`)
  } else if (a.type === "sequence") {
    lines.push(`  Items: ${(a.sequenceItems ?? []).join(" | ")} — return "order" as the items in the pupil's order, first to last, using the exact texts.`)
  } else {
    lines.push(`  Return the pupil's written answer in "answerText".`)
  }
  return lines.join("\n")
}

/**
 * Send the photo(s) + the lesson's activities to the vision model and get back a
 * best-effort answer per activity. Throws on transport/config errors; per-answer
 * uncertainty is expressed via `confidence` and `note`, not exceptions.
 */
export async function extractAnswersFromPhotos(params: {
  images: Array<{ mimeType: string; base64: string }>
  activities: ActivityContext[]
}): Promise<ExtractResult> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not configured.")
  if (params.images.length === 0) throw new Error("No photos provided.")

  const systemText = [
    "You read a photo (or photos) of a pupil's HANDWRITTEN answers and match each answer to the correct activity below.",
    "Pupils may number their answers to match the question numbers; use the question text to associate answers correctly.",
    "For each activity, return the pupil's answer in the shape indicated for its type, using the EXACT option/term/definition/item/group texts provided (transcribe free-text answers faithfully).",
    "Set confidence 0–1 for how sure you are you found and read this activity's answer. If you cannot find an answer for an activity, include it with confidence 0, empty fields, and a short note.",
    "Return ONLY JSON of the form:",
    '{ "message": string, "answers": [ { "activityId": string, "type": string, "confidence": number, "chosenOption"?: string, "answerText"?: string, "matches"?: [{"term":string,"definition":string}], "placements"?: [{"item":string,"group":string}], "order"?: [string], "note"?: string } ] }',
    "",
    "Activities:",
    ...params.activities.map(activityInstructions),
  ].join("\n")

  const parts: Array<Record<string, unknown>> = [{ text: "Here are the pupil's handwritten answers. Extract them per the instructions." }]
  for (const img of params.images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } })
  }

  const payload = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  }

  const MAX_ATTEMPTS = 3
  let text = ""
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    )
    const status = res.status
    text = await res.text()
    if (res.ok) break
    if ((status === 503 || status === 429) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    throw new Error(`Gemini ${status}: ${text.slice(0, 400)}`)
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("Vision model returned a non-JSON response.")
  }
  const raw = ((data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text)
    .filter(Boolean)
    .join("")

  let parsed: { message?: unknown; answers?: unknown }
  try {
    parsed = JSON.parse(raw || "{}")
  } catch {
    return { answers: [], message: raw || "Could not read the answers." }
  }

  const answers = Array.isArray(parsed.answers) ? (parsed.answers as ExtractedAnswer[]) : []
  return { answers, message: typeof parsed.message === "string" ? parsed.message : "" }
}
