"use client"

import { getRichTextMarkup } from "./utils"

/**
 * Inline rich-text + LaTeX renderer for short activity content (matcher terms,
 * group items, sequence steps, MCQ options, etc.). Renders markdown and KaTeX
 * maths (\( … \), $$ … $$) via getRichTextMarkup, with paragraph wrapping
 * flattened so it sits inline inside cards/tokens. Falls back to the raw text.
 */
export function RichInline({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={["prose prose-sm max-w-none [&_p]:my-0 [&_p]:inline", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: getRichTextMarkup(text) ?? text }}
    />
  )
}
