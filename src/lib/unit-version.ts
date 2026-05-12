const VERSION_SUFFIX_RE = /^(.*?)\.v(\d+)$/

export function incrementUnitTitle(title: string): string {
  const match = VERSION_SUFFIX_RE.exec(title.trimEnd())
  if (match) {
    const base = match[1]
    const n = parseInt(match[2], 10)
    return `${base}.v${n + 1}`
  }
  return `${title.trimEnd()}.v1`
}
