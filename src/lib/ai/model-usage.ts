// Token counts of one model call, as the provider reported them, in one shape
// for both providers. Stored on the job row as model_response.usage (ai_mark,
// ai_read, and chat log rows), so a run's cost can be added up exactly.
//
// Pure: no server-only, so the checks import it directly.

export interface ModelUsage {
  /** Input tokens billed at the full rate: not read from or written to the prompt cache. */
  inputTokens: number | null
  /** Output tokens, thinking included. */
  outputTokens: number | null
  /** Input tokens written to the prompt cache (Anthropic: 1.25x the input rate at the 5-minute TTL). */
  cacheCreationInputTokens: number | null
  /** Input tokens read from the prompt cache (Anthropic: 0.1x the input rate). */
  cacheReadInputTokens: number | null
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** An Anthropic Messages API `usage` object. */
export function anthropicUsage(usage: unknown): ModelUsage | null {
  if (!usage || typeof usage !== "object") return null
  const u = usage as Record<string, unknown>
  return {
    inputTokens: count(u.input_tokens),
    outputTokens: count(u.output_tokens),
    cacheCreationInputTokens: count(u.cache_creation_input_tokens),
    cacheReadInputTokens: count(u.cache_read_input_tokens),
  }
}

/**
 * A Gemini `usageMetadata` object. Gemini's prompt count includes the tokens
 * it served from its implicit cache, so they are taken out of inputTokens to
 * match Anthropic's meaning; it has no cache-write charge.
 */
export function geminiUsage(metadata: unknown): ModelUsage | null {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  const prompt = count(m.promptTokenCount)
  const cached = count(m.cachedContentTokenCount)
  const candidates = count(m.candidatesTokenCount)
  const thoughts = count(m.thoughtsTokenCount)
  return {
    inputTokens: prompt === null ? null : prompt - (cached ?? 0),
    outputTokens: candidates === null && thoughts === null ? null : (candidates ?? 0) + (thoughts ?? 0),
    cacheCreationInputTokens: null,
    cacheReadInputTokens: cached,
  }
}
