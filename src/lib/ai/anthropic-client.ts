import "server-only"

import Anthropic from "@anthropic-ai/sdk"

import { modelResponseStarted, wantsModelStart } from "@/lib/ai/model-call-started"
import { anthropicUsage, type ModelUsage } from "@/lib/ai/model-usage"

/**
 * Anthropic transport.
 *
 * Named for the provider, not a model: `model-client.ts` is the neutral shared
 * entry point, and this is the adapter behind it that speaks one provider's
 * wire format. Callers still pass a model id, so swapping Sonnet for Opus is a
 * config change, not a code change.
 *
 * `callClaudeRaw` is the single entry point. It takes optional multi-turn
 * history because the lesson and unit chats need it — flattening a conversation
 * into one turn loses what the model is meant to be continuing — while marking
 * calls in through `model-client.ts` with one user turn and no history.
 */

/**
 * Last-resort fallback only. Every caller passes an explicit model resolved
 * from ai_model_routes; this is what runs if the routes table is unreachable,
 * and a hardcoded value is the point — a chat that fails because the database
 * is down is worse than one that runs on a sensible default.
 */
export const DEFAULT_CHAT_MODEL = "claude-sonnet-5"

export type ChatPart =
  /** `cache`: a prompt-cache breakpoint at the end of this block. */
  | { kind: "text"; text: string; cache?: boolean }
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "document"; mimeType: string; base64: string }

export interface ChatHistoryTurn {
  role: "user" | "assistant"
  content: string
}

function apiKey(): string {
  // CLAUDE_API_KEY first because that is what this deployment's .env uses;
  // ANTHROPIC_API_KEY is the name the SDK would pick up unaided.
  const key = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("CLAUDE_API_KEY is not configured.")
  return key
}

/** Claude's image media types. Anything else is rejected by the API. */
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

/**
 * Prompt caching. A breakpoint (`cache_control: {type: "ephemeral"}`, 5-minute
 * TTL) on a block caches the whole prefix up to and including it: tools,
 * system, then the messages in order. A later request whose prefix is
 * byte-identical up to a breakpoint written earlier reads it at 0.1x the input
 * rate; writing costs 1.25x. Each breakpoint also looks back up to 20 blocks
 * for an entry another request wrote. The API takes at most 4 breakpoints per
 * request; more is a 400, so it is refused here before any call.
 *
 * A prefix shorter than the model's minimum is simply not cached (no error,
 * cache_creation_input_tokens 0). The minimums (Anthropic's prompt caching
 * docs, as summarised in the claude-api skill's prompt-caching reference,
 * 2026-11): Claude Opus 5 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5 512 tokens;
 * Claude Sonnet 5, Opus 4.8, Sonnet 4.6 1024; Opus 4.7 2048; Opus 4.6 /
 * Haiku 4.5 4096. A cache entry is readable only once the response that wrote
 * it has started, so requests sent together all miss (see cache-warm-order.ts).
 */
export const MAX_CACHE_BREAKPOINTS = 4

const EPHEMERAL = { type: "ephemeral" as const }

function toContentBlock(part: ChatPart): Anthropic.ContentBlockParam {
  if (part.kind === "text") {
    return { type: "text" as const, text: part.text, ...(part.cache ? { cache_control: EPHEMERAL } : {}) }
  }
  if (part.kind === "document") {
    return {
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data: part.base64 },
    }
  }
  // Fall back rather than throw: an unexpected mime type from a teacher's
  // upload should not take the whole chat turn down, and jpeg is what a
  // mislabelled camera image almost always is.
  const mediaType = SUPPORTED_IMAGE_TYPES.has(part.mimeType) ? part.mimeType : "image/jpeg"
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: part.base64,
    },
  }
}

export interface ChatJsonResult<T> {
  /**
   * Null when the reply would not parse as JSON. Not an exception, because the
   * chat surfaces would rather show a model's prose than an error — that was
   * the behaviour of the Gemini implementation this replaces, and a migration
   * should not quietly change how failures look to a teacher.
   */
  data: T | null
  /** The model's reply verbatim, for the fallback path and for debugging. */
  raw: string
  durationMs: number
  model: string
  usage: ModelUsage | null
}

/**
 * Convert a Gemini response schema to the JSON Schema dialect Claude expects.
 *
 * Two incompatibilities, both silent if missed: Gemini spells its types in
 * upper case ("OBJECT", "STRING"), and Claude requires
 * `additionalProperties: false` on every object.
 *
 * `required` is deliberately left as the source schema had it. Most fields on a
 * proposal are genuinely optional — a video proposal has no `question` — and
 * marking them required would force the model to invent values for fields that
 * do not apply.
 */
export function toClaudeJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toClaudeJsonSchema)
  if (node === null || typeof node !== "object") return node

  const source = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    out[key] = key === "type" && typeof value === "string" ? value.toLowerCase() : toClaudeJsonSchema(value)
  }
  if (out.type === "object" && out.additionalProperties === undefined) {
    out.additionalProperties = false
  }
  return out
}

export interface ClaudeRequestParams {
  model?: string
  system?: string
  /** A cache breakpoint at the end of the system text. */
  cacheSystem?: boolean
  history?: ChatHistoryTurn[]
  userParts: ChatPart[]
  schema?: Record<string, unknown>
  maxTokens?: number
}

/**
 * The Messages API request body for one call, built without a network call:
 * the one place a request's shape is decided, so a Message Batches request
 * can be built from the same function. Throws when the request has more cache
 * breakpoints than the API takes.
 */
export function buildClaudeMessageParams(params: ClaudeRequestParams): Anthropic.MessageCreateParamsNonStreaming {
  const breakpoints = (params.cacheSystem && params.system ? 1 : 0) +
    params.userParts.filter((part) => part.kind === "text" && part.cache).length
  if (breakpoints > MAX_CACHE_BREAKPOINTS) {
    throw new Error(`A request may have at most ${MAX_CACHE_BREAKPOINTS} cache breakpoints; this one has ${breakpoints}.`)
  }
  const model = params.model ?? DEFAULT_CHAT_MODEL
  return {
    model,
    max_tokens: params.maxTokens ?? 8000,
    ...(params.system
      ? {
          system: params.cacheSystem
            ? [{ type: "text" as const, text: params.system, cache_control: EPHEMERAL }]
            : params.system,
        }
      : {}),
    messages: [
      ...(params.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: params.userParts.map(toContentBlock) },
    ],
    ...(params.schema
      ? {
          output_config: {
            format: {
              type: "json_schema" as const,
              schema: toClaudeJsonSchema(params.schema) as Record<string, unknown>,
            },
          },
        }
      : {}),
  }
}

/**
 * Send one request and return the model's raw text.
 *
 * The single place that talks to the API — `callClaudeChatJson` adds parsing on
 * top, and marking calls in through `model-client.ts` with a single user turn
 * and no history.
 *
 * Two deliberate omissions relative to the Gemini implementation this replaces:
 *
 * - No `temperature`. Sonnet 5 and Opus 5 reject non-default sampling
 *   parameters with a 400; steer with the system prompt instead.
 * - No `thinking` configuration. The model's default is right for these
 *   surfaces, and pinning it here would override a per-model default we would
 *   then have to maintain.
 */
export async function callClaudeRaw(params: ClaudeRequestParams & {
  timeoutMs?: number
}): Promise<{ raw: string; durationMs: number; model: string; usage: ModelUsage | null }> {
  const model = params.model ?? DEFAULT_CHAT_MODEL
  const body = buildClaudeMessageParams(params)
  const startedAt = performance.now()

  const client = anthropicClient()

  const options = params.timeoutMs ? { timeout: params.timeoutMs } : undefined
  // A caller waiting for the response to begin (cache-warm-order.ts) gets the
  // reply streamed, and is told at its first event: from then on, the prompt
  // cache entries this request writes are readable by the next request.
  let response: Anthropic.Message
  if (wantsModelStart()) {
    const stream = client.messages.stream(body, options)
    stream.on("streamEvent", () => modelResponseStarted())
    response = await stream.finalMessage()
  } else {
    response = await client.messages.create(body, options)
  }

  const durationMs = Math.round(performance.now() - startedAt)
  return { raw: claudeReplyText(response, model), durationMs, model, usage: anthropicUsage(response.usage) }
}

/**
 * The SDK client. maxRetries covers 429/5xx and connection errors with
 * backoff, which is what the hand-rolled retry loop in the Gemini
 * implementation was doing. Shared with the Message Batches calls
 * (message-batches.ts).
 */
export function anthropicClient(): Anthropic {
  return new Anthropic({ apiKey: apiKey(), maxRetries: 3 })
}

/**
 * The reply text of one Message, direct or from a Message Batch result:
 * throws for a refusal or a reply cut off at max_tokens, as a direct call
 * does.
 */
export function claudeReplyText(response: Anthropic.Message, model: string): string {
  // A refusal is a successful HTTP 200 with empty or partial content, so this
  // has to be checked before reading content or the caller's parse fails with a
  // misleading "unparseable JSON".
  if (response.stop_reason === "refusal") {
    throw new Error(`${model} declined the request (${response.stop_details?.category ?? "unknown"}).`)
  }

  // Running out of output tokens truncates the reply mid-token, so JSON.parse
  // fails and the caller falls back to showing the raw text — which is how a
  // teacher ended up reading half a megabyte of proposal JSON. Named here so
  // callers can say what actually happened.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `${model} ran out of room before finishing the reply. Ask for fewer items in one go.`,
    )
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
}

/** Send a chat turn and parse a JSON reply constrained by `schema`. */
export async function callClaudeChatJson<T>(params: {
  model?: string
  system: string
  history: ChatHistoryTurn[]
  userParts: ChatPart[]
  schema: Record<string, unknown>
  maxTokens?: number
}): Promise<ChatJsonResult<T>> {
  const { raw, durationMs, model, usage } = await callClaudeRaw(params)
  try {
    return { data: JSON.parse(raw || "{}") as T, raw, durationMs, model, usage }
  } catch {
    return { data: null, raw, durationMs, model, usage }
  }
}
