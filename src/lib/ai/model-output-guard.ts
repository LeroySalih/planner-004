/**
 * Detect text a model mangled while emitting JSON.
 *
 * Pure string handling with no server dependencies, deliberately not marked
 * `server-only`, so it can be exercised directly against captured model output.
 *
 * Observed on Claude Opus 5 with structured output (`output_config.format`) in
 * August 2026: non-ASCII characters were emitted as broken escape sequences, so
 * "mm²" arrived as "mm" + a literal newline + "s", and a "²" escape arrived
 * as "\nu00b2". Sonnet 5, Haiku 4.5 and Gemini Flash did not reproduce it.
 *
 * The reason this needs catching rather than fixing at the parse layer: the
 * damaged output is still *valid JSON*. `\n` is a legal escape, so JSON.parse
 * succeeds, no error is raised anywhere, and the corrupted sentence is written
 * to the pupil's feedback as if it were fine. Silent wrong output is worse than
 * a failed job — a failed job retries and, if it keeps failing, surfaces as
 * marking-error for a teacher to see.
 *
 * Detection is deliberately conservative. Marking feedback is two or three
 * sentences of prose, so the signatures below do not occur in healthy output,
 * while anything more aggressive (bare backslashes, say) would false-positive on
 * upload-code feedback that quotes a pupil's own escape sequences.
 */

export interface Corruption {
  /** Which signature matched, for the log. */
  kind:
    | "literal-unicode-escape"
    | "replacement-char"
    | "stray-backslash"
    | "lone-linebreak"
    | "stray-quote"
  /** A short window around the damage, to make the log actionable. */
  excerpt: string
}

/**
 * Signatures, most specific first so the error names the clearest cause.
 *
 * These are measured, not guessed. Across 24 healthy replies (Gemini Flash,
 * Sonnet 5, Haiku 4.5 — including upload-code feedback that quotes pupils'
 * source) every counter below was zero, while six damaged Opus 5 replies each
 * tripped at least one. Marking feedback is two or three sentences of prose:
 * it has no reason to contain a backslash, a lone line break, or a bare quote.
 *
 * Known trade-off: upload-code feedback *could* legitimately quote a pupil's
 * own "\n", which would trip stray-backslash. None of the sampled code feedback
 * did. That costs a retry and, at worst, one submission surfacing as
 * marking-error for a teacher — cheaper than sending a pupil mangled text.
 */
/** A "\uXXXX" that survived as literal characters instead of being decoded. */
const LITERAL_UNICODE_ESCAPE = /\\u[0-9a-fA-F]{4}/
/** U+FFFD — what a decoder emits when it gives up on a byte sequence. */
const REPLACEMENT_CHAR = /�/
/** Any backslash at all: prose feedback has no use for one. */
const STRAY_BACKSLASH = /\\/
/** A single line break inside prose (a real paragraph break would be doubled). */
const LONE_LINEBREAK = /(?<!\n)\n(?!\n)/
/** An isolated double-quote surrounded by whitespace, seen replacing an em dash. */
const STRAY_QUOTE = /\s"\s/

function excerptAround(text: string, index: number): string {
  return text.slice(Math.max(0, index - 40), index + 40).replace(/[\r\n]/g, "⏎")
}

/**
 * Returns the first corruption found, or null when the text looks intact.
 * Pure and synchronous so it can guard any provider's reply.
 */
/**
 * How aggressively to check.
 *
 * `strict` applies every signature and suits short prose whose shape is known:
 * marking feedback is two or three sentences with no line breaks, backslashes
 * or bare quotes, which is what made those signatures safe. It was measured on
 * exactly that corpus.
 *
 * `lenient` applies only the two signatures that are unambiguous in any text —
 * a literal "\uXXXX" and U+FFFD never occur in healthy output of any shape.
 * Use it for long-form or structured text: a chat reply legitimately contains
 * headings, line breaks, quoted phrases and code fragments with backslashes,
 * and OCR transcription is multi-line by definition. Applying the strict set
 * there rejects perfectly good replies.
 *
 * The asymmetry is deliberate. A false positive on marking costs a retry; a
 * false negative sends a pupil mangled feedback. A false positive on chat
 * breaks the feature outright, while a false negative shows a teacher some
 * garbled text they can see and retry. So marking is strict and chat is not.
 */
export type GuardMode = "strict" | "lenient"

export function findTextCorruption(
  text: string | null | undefined,
  options: { mode?: GuardMode } = {},
): Corruption | null {
  if (!text) return null

  const strict = (options.mode ?? "strict") === "strict"
  const signatures = [
    ["literal-unicode-escape", LITERAL_UNICODE_ESCAPE],
    ["replacement-char", REPLACEMENT_CHAR],
    ...(strict
      ? ([
          ["stray-backslash", STRAY_BACKSLASH],
          ["lone-linebreak", LONE_LINEBREAK],
          ["stray-quote", STRAY_QUOTE],
        ] as const)
      : []),
  ] as const

  for (const [kind, pattern] of signatures) {
    const match = pattern.exec(text)
    if (match) {
      return { kind, excerpt: excerptAround(text, match.index) }
    }
  }
  return null
}

/**
 * Throw if the model's text is damaged.
 *
 * Callers are marking paths, so throwing is the correct response: the queue's
 * existing attempts / process_after backoff retries the job, and a retry
 * usually re-rolls clean output. Only a persistently corrupt reply reaches
 * marking-error, which is exactly where a human should look at it.
 */
export function assertUncorruptedModelText(
  text: string | null | undefined,
  context: { model: string; field: string; mode?: GuardMode },
): void {
  const corruption = findTextCorruption(text, { mode: context.mode })
  if (!corruption) return

  throw new Error(
    `Model ${context.model} returned corrupted ${context.field} ` +
      `(${corruption.kind}): …${corruption.excerpt}…`,
  )
}
