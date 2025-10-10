type ExportBasenameOptions = {
  suffix?: string | null | undefined
}

export function createExportBasename(title: string, fallbackId: string, options?: ExportBasenameOptions): string {
  const primary = truncate(sanitizeSegment(title), 80)
  const fallback = truncate(`curriculum-${sanitizeSegment(fallbackId) || "export"}`, 80)
  const base = primary.length > 0 ? primary : fallback

  const suffix = truncate(sanitizeSegment(options?.suffix ?? ""), 40)

  if (suffix.length > 0) {
    return `${base}-${suffix}`
  }

  return base
}

function sanitizeSegment(input: string | null | undefined) {
  return (input ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function truncate(value: string, max: number) {
  if (value.length <= max) {
    return value
  }
  return value.slice(0, max)
}
