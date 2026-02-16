export interface ParsedLO {
  title: string
  specRef: string | null
  successCriteria: { description: string; level: number }[]
}

export type ParseLoScResult =
  | { success: true; learningObjectives: ParsedLO[] }
  | { success: false; error: string }

const LO_HEADING_REGEX = /^##\s+LO:\s*(.+)$/
const SC_LINE_REGEX = /^-\s+(.+)$/
const LEVEL_REGEX = /\[L(\d)\]\s*$/
const SPEC_REF_REGEX = /\(Ref:\s*(.+?)\)\s*$/

export function parseLoScMarkdown(content: string): ParseLoScResult {
  const lines = content.split("\n")
  const learningObjectives: ParsedLO[] = []
  let currentLO: ParsedLO | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const lineNum = i + 1

    if (line === "") continue

    const loMatch = line.match(LO_HEADING_REGEX)
    if (loMatch) {
      if (currentLO) {
        if (currentLO.successCriteria.length === 0) {
          return {
            success: false,
            error: `Line ${lineNum}: LO "${currentLO.title}" has no success criteria. Each LO must have at least one SC.`,
          }
        }
        learningObjectives.push(currentLO)
      }

      let titlePart = loMatch[1].trim()
      let specRef: string | null = null

      const refMatch = titlePart.match(SPEC_REF_REGEX)
      if (refMatch) {
        specRef = refMatch[1].trim()
        titlePart = titlePart.slice(0, refMatch.index).trim()
      }

      if (titlePart.length === 0) {
        return { success: false, error: `Line ${lineNum}: LO title is empty.` }
      }

      currentLO = { title: titlePart, specRef, successCriteria: [] }
      continue
    }

    const scMatch = line.match(SC_LINE_REGEX)
    if (scMatch) {
      if (!currentLO) {
        return {
          success: false,
          error: `Line ${lineNum}: Success criterion found before any LO heading. Start with "## LO: <title>".`,
        }
      }

      let text = scMatch[1].trim()
      let level = 0

      const levelMatch = text.match(LEVEL_REGEX)
      if (levelMatch) {
        level = parseInt(levelMatch[1], 10)
        text = text.slice(0, levelMatch.index).trim()
      }

      if (text.length === 0) {
        return { success: false, error: `Line ${lineNum}: Success criterion description is empty.` }
      }

      currentLO.successCriteria.push({ description: text, level })
      continue
    }

    // Unrecognised lines are ignored
  }

  // Push the last LO
  if (currentLO) {
    if (currentLO.successCriteria.length === 0) {
      return {
        success: false,
        error: `LO "${currentLO.title}" has no success criteria. Each LO must have at least one SC.`,
      }
    }
    learningObjectives.push(currentLO)
  }

  if (learningObjectives.length === 0) {
    return {
      success: false,
      error: 'No learning objectives found. Use "## LO: <title>" to start a learning objective.',
    }
  }

  return { success: true, learningObjectives }
}
