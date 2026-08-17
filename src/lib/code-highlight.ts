import hljs from "highlight.js/lib/core"
import python from "highlight.js/lib/languages/python"
import javascript from "highlight.js/lib/languages/javascript"
import sql from "highlight.js/lib/languages/sql"
import { marked } from "marked"

// Only the languages actually taught are registered — importing the full
// highlight.js bundle would add ~1MB for no benefit.
hljs.registerLanguage("python", python)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("sql", sql)

const SUPPORTED = new Set(["python", "javascript", "sql"])

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Highlight a block of source and return HTML.
 *
 * Runs server-side (highlight.js is pure JS), so pages ship highlighted markup
 * rather than a highlighter — which matters here because the CSP is
 * `script-src 'self'`.
 *
 * Unknown languages fall back to escaped plain text rather than guessing:
 * auto-detection on a short snippet is unreliable and mislabels more than it
 * helps.
 */
export function highlightCode(source: string, language = "python"): string {
  const lang = language.toLowerCase().trim()
  if (!SUPPORTED.has(lang)) {
    return escapeHtml(source)
  }
  try {
    return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(source)
  }
}

export function isSupportedLanguage(language: string): boolean {
  return SUPPORTED.has(language.toLowerCase().trim())
}

/**
 * Render markdown where fenced code blocks are syntax highlighted — used for
 * a teacher's task description, which routinely contains sample code.
 *
 * Kept separate from renderFeedbackMarkup (markdown-latex.ts), which is about
 * maths in AI feedback. A task wants code; feedback wants KaTeX.
 */
export function renderTaskMarkup(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const renderer = new marked.Renderer()
  renderer.code = ({ text: code, lang }) => {
    const language = (lang ?? "").trim() || "python"
    const highlighted = highlightCode(code, language)
    return `<pre class="hljs"><code class="language-${escapeHtml(language)}">${highlighted}</code></pre>`
  }

  return marked.parse(trimmed, { renderer, async: false }) as string
}
