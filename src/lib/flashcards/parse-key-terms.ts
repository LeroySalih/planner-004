export type KeyTerm = {
  term: string
  definition: string
}

const HEADER_PATTERNS = [
  /^term$/i,
  /^key\s*term$/i,
  /^word$/i,
]

function isHeaderRow(cells: string[]): boolean {
  if (cells.length < 2) return false
  return HEADER_PATTERNS.some((pattern) => pattern.test(cells[0].trim()))
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s\-:|]+\|[\s\-:|]+\|?\s*$/.test(line)
}

export function parseKeyTermsMarkdown(markdown: string): KeyTerm[] {
  if (!markdown || typeof markdown !== "string") return []

  const lines = markdown.split("\n")
  const terms: KeyTerm[] = []
  let skippedHeader = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes("|")) continue
    if (isSeparatorRow(trimmed)) continue

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())

    if (cells.length < 2) continue

    if (!skippedHeader && isHeaderRow(cells)) {
      skippedHeader = true
      continue
    }

    const term = cells[0]
    const definition = cells[1]
    if (term && definition) {
      terms.push({ term, definition })
    }
  }

  return terms
}
