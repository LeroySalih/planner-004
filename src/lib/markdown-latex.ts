import { marked } from "marked"
import katex from "katex"

const BLOCK_MATH_PATTERN = /\$\$([^$]+?)\$\$/g
const INLINE_MATH_PATTERN = /\$([^$\n]+?)\$/g

function renderMath(expression: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expression, { displayMode, throwOnError: false })
  } catch {
    return displayMode ? `$$${expression}$$` : `$${expression}$`
  }
}

/**
 * Renders feedback text that mixes markdown formatting (headers, bold,
 * bullet lists) with inline/block LaTeX math ($...$ / $$...$$), as produced
 * by the AI marking flow. Math is extracted and rendered via KaTeX before
 * markdown parsing runs, so markdown special characters inside math
 * expressions (e.g. underscores in subscripts) aren't misinterpreted.
 */
export function renderFeedbackMarkup(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const placeholders: string[] = []
  const withPlaceholders = trimmed
    .replace(BLOCK_MATH_PATTERN, (_match, expr: string) => {
      placeholders.push(renderMath(expr.trim(), true))
      return `@@MATH_PLACEHOLDER_${placeholders.length - 1}@@`
    })
    .replace(INLINE_MATH_PATTERN, (_match, expr: string) => {
      placeholders.push(renderMath(expr.trim(), false))
      return `@@MATH_PLACEHOLDER_${placeholders.length - 1}@@`
    })

  let html: string
  try {
    html = marked.parse(withPlaceholders, { async: false, breaks: true }) as string
  } catch {
    html = withPlaceholders
  }

  return html.replace(/@@MATH_PLACEHOLDER_(\d+)@@/g, (_match, index: string) => placeholders[Number(index)] ?? "")
}
