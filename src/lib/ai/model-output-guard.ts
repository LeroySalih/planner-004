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
    | "trailing-digit"
    | "unmatched-quote"
    | "html-tag"
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
 *
 * trailing-digit, unmatched-quote and html-tag were added in November 2026
 * after Sonnet 5 marking let "…automatically.4", "…presentation.'" and a
 * "</br>" through. Run over every stored AI comment and marker note in the dev
 * database (9 843 texts, all activity types), they matched 24 pupil comments
 * and one note, every one of them damaged in the same ways, and nothing
 * healthy.
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
/**
 * A digit stuck straight onto the end of a sentence, as in "…automatically.4":
 * seen on Sonnet 5 marking (November 2026). The character before the stop must
 * not be a digit, so "version 2.4" and "7.5 cm" pass; it must be followed by
 * whitespace or the end, so a decimal like "x.5cm" mid-word is not a sentence.
 */
const TRAILING_DIGIT = /(?<=[A-Za-z)\]'"’”])[.!?]\d+(?=\s|$)/
/**
 * A closing quote at the very end with no quote opened before it, as in
 * "…presentation.'" (Sonnet 5, November 2026). Checked by `unmatchedEndQuote`.
 */
const END_QUOTE = /([.!?,;:]?)(['"’”])\s*$/
/**
 * Formatting tags a model leaks into prose, such as "</br>". Named elements
 * only, so "a < b", "<3", "->" and placeholder text such as "<your name>" pass.
 */
const HTML_TAG = /<\/?(?:br|p|b|i|u|em|strong|span|div|ul|ol|li|sup|sub|a|h[1-6]|hr|table|tr|td|th|code|pre)(?:\s+[a-z-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/i
/** `code spans` and one-line "string literals", which code feedback quotes. */
const QUOTED_CODE = /`[^`\n]*`|"[^"\n]*"/g

/**
 * The text ends in a closing quote that nothing opened. A double quote counts
 * as unmatched when the text has an odd number of them; a single (or curly)
 * quote when it follows sentence punctuation and no quote of its kind opens
 * earlier, at the start or after a space or bracket. A lone apostrophe ending a
 * word ("the pupils'") is left alone: it is not after punctuation.
 */
function unmatchedEndQuote(text: string): RegExpExecArray | null {
  const match = END_QUOTE.exec(text)
  if (!match) return null
  const [, punctuation, quote] = match
  const before = text.slice(0, match.index + punctuation.length)
  if (quote === '"') return (before.match(/"/g)?.length ?? 0) % 2 === 0 ? match : null
  if (quote === "”") return before.includes("“") ? null : match
  if (!punctuation) return null
  return /(?:^|[\s(\[])['‘](?=\S)/.test(before) ? null : match
}

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
 * `note` is `lenient` plus `trailing-digit` and `html-tag`, for teacher-facing prose that may run
 * to several sentences, lines and quoted slide text, such as a marker's
 * evidence note. The tag check is not part of `lenient` itself because the
 * other lenient surfaces may carry HTML honestly: a chat about a web-design
 * lesson, a transcription of a pupil's handwritten HTML, a mark scheme that
 * names tags (and a transcription can hold "P.78", which trailing-digit would
 * take for damage). A marker's note describes evidence in words; a "</br>" in
 * one is the model's formatting leaking, not content. Quote checks stay out of
 * `note`: a note quotes slide text freely. The damage is rejected, not
 * stripped, as everywhere in this guard: a reply that leaked markup was not
 * emitted cleanly, and a retry re-rolls it, where stripping would keep the rest
 * of a damaged reply and hide that it happened.
 *
 * The asymmetry is deliberate. A false positive on marking costs a retry; a
 * false negative sends a pupil mangled feedback. A false positive on chat
 * breaks the feature outright, while a false negative shows a teacher some
 * garbled text they can see and retry. So marking is strict and chat is not.
 */
export type GuardMode = "strict" | "lenient" | "note"

type Signature = [Corruption["kind"], (text: string) => RegExpExecArray | null]

const pattern = (re: RegExp) => (text: string) => re.exec(text)

export function findTextCorruption(
  text: string | null | undefined,
  options: { mode?: GuardMode; quotesCode?: boolean } = {},
): Corruption | null {
  if (!text) return null

  const mode = options.mode ?? "strict"
  // Feedback on a pupil's code quotes it: sep=" " is a whole string literal,
  // not a quote that replaced an em dash, and "<br>" in backticks names the
  // pupil's tag. Paired quotes are blanked (keeping offsets) so only what is
  // outside them is checked.
  const quoteChecked = options.quotesCode ? text.replace(QUOTED_CODE, (m) => " ".repeat(m.length)) : text
  const outsideQuotes = (re: RegExp) => () => re.exec(quoteChecked)

  const signatures: Signature[] = [
    ["literal-unicode-escape", pattern(LITERAL_UNICODE_ESCAPE)],
    ["replacement-char", pattern(REPLACEMENT_CHAR)],
  ]
  if (mode === "strict") {
    signatures.push(
      ["stray-backslash", pattern(STRAY_BACKSLASH)],
      ["lone-linebreak", pattern(LONE_LINEBREAK)],
      ["stray-quote", outsideQuotes(STRAY_QUOTE)],
      ["trailing-digit", pattern(TRAILING_DIGIT)],
      ["unmatched-quote", unmatchedEndQuote],
      ["html-tag", outsideQuotes(HTML_TAG)],
    )
  }
  if (mode === "note") {
    signatures.push(["trailing-digit", pattern(TRAILING_DIGIT)], ["html-tag", pattern(HTML_TAG)])
  }

  for (const [kind, find] of signatures) {
    const match = find(text)
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
  context: { model: string; field: string; mode?: GuardMode; quotesCode?: boolean },
): void {
  const corruption = findTextCorruption(text, { mode: context.mode, quotesCode: context.quotesCode })
  if (!corruption) return

  throw new Error(
    `Model ${context.model} returned corrupted ${context.field} ` +
      `(${corruption.kind}): …${corruption.excerpt}…`,
  )
}
