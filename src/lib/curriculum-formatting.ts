export function stripLearningObjectiveFromDescription(
  description: string | null | undefined,
  learningObjectiveTitle: string | null | undefined,
): string {
  const trimmedDescription = description?.trim() ?? ""

  if (trimmedDescription.length === 0) {
    return ""
  }

  const trimmedTitle = learningObjectiveTitle?.trim()

  if (!trimmedTitle) {
    return trimmedDescription
  }

  const titlePattern = escapeRegExp(trimmedTitle).replace(/\s+/g, "\\s+")
  const enDash = String.fromCharCode(0x2013)
  const emDash = String.fromCharCode(0x2014)
  const dashGroup = `(?:-|:|${escapeRegExp(enDash)}|${escapeRegExp(emDash)})`
  const prefixPattern = new RegExp(
    `^\\s*(?:LO\\s*\\d+(?:\\.\\d+)?\\s*${dashGroup}\\s*)?(?:Learning\\s+Objective\\s*${dashGroup}\\s*)?${titlePattern}\\s*(?:${dashGroup})*\\s*`,
    "i",
  )

  const cleaned = trimmedDescription.replace(prefixPattern, "").trim()

  if (cleaned.length > 0) {
    return cleaned
  }

  return trimmedDescription
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
