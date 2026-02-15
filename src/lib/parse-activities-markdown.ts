export interface ParsedActivity {
  title: string
  type: "multiple-choice-question" | "short-text-question"
  bodyData: McqBody | ShortTextBody
  loReference: string | null
  scReferences: string[]
}

interface McqBody {
  question: string
  options: { id: string; text: string }[]
  correctOptionId: string
}

interface ShortTextBody {
  question: string
  modelAnswer: string
}

export type ParseResult =
  | { success: true; activities: ParsedActivity[] }
  | { success: false; error: string }

export function parseActivitiesMarkdown(content: string): ParseResult {
  const activities: ParsedActivity[] = []
  const headingRegex = /^##\s+(MCQ|SHORT):\s*(.+)$/gm
  const matches: { type: "MCQ" | "SHORT"; title: string; start: number }[] = []

  let match: RegExpExecArray | null
  while ((match = headingRegex.exec(content)) !== null) {
    matches.push({
      type: match[1] as "MCQ" | "SHORT",
      title: match[2].trim(),
      start: match.index + match[0].length,
    })
  }

  if (matches.length === 0) {
    return { success: false, error: "No activities found in the uploaded file." }
  }

  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i]
    const blockEnd = i + 1 < matches.length ? matches[i + 1].start - matches[i + 1].title.length - "## MCQ: ".length : content.length
    const rawBlock = content.slice(heading.start, blockEnd)

    // Find the start of the next heading to get the block properly
    const nextHeadingMatch = rawBlock.match(/^##\s+(MCQ|SHORT):\s*.+$/m)
    const block = nextHeadingMatch ? rawBlock.slice(0, nextHeadingMatch.index) : rawBlock

    const lines = block.split("\n")

    // Extract LO: and SC: lines from the end
    let loReference: string | null = null
    const scReferences: string[] = []
    const contentLines: string[] = []

    for (const line of lines) {
      const loMatch = line.match(/^LO:\s*(.+)$/)
      const scMatch = line.match(/^SC:\s*(.+)$/)
      if (loMatch) {
        loReference = loMatch[1].trim()
      } else if (scMatch) {
        scReferences.push(scMatch[1].trim())
      } else {
        contentLines.push(line)
      }
    }

    if (heading.type === "MCQ") {
      const result = parseMcqBlock(contentLines, heading.title)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      activities.push({
        title: heading.title,
        type: "multiple-choice-question",
        bodyData: result.body,
        loReference,
        scReferences,
      })
    } else {
      const result = parseShortTextBlock(contentLines, heading.title)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      activities.push({
        title: heading.title,
        type: "short-text-question",
        bodyData: result.body,
        loReference,
        scReferences,
      })
    }
  }

  return { success: true, activities }
}

function parseMcqBlock(
  lines: string[],
  title: string,
): { success: true; body: McqBody } | { success: false; error: string } {
  const questionLines: string[] = []
  const options: { id: string; text: string; correct: boolean }[] = []

  for (const line of lines) {
    const correctMatch = line.match(/^-\s*\[x\]\s*(.+)$/i)
    const incorrectMatch = line.match(/^-\s*\[\s\]\s*(.+)$/)
    if (correctMatch) {
      const optionId = `opt-${options.length + 1}`
      options.push({ id: optionId, text: correctMatch[1].trim(), correct: true })
    } else if (incorrectMatch) {
      const optionId = `opt-${options.length + 1}`
      options.push({ id: optionId, text: incorrectMatch[1].trim(), correct: false })
    } else {
      questionLines.push(line)
    }
  }

  const question = questionLines.join("\n").trim()
  if (!question) {
    return { success: false, error: `Activity "${title}" has no question text.` }
  }

  if (options.length < 2 || options.length > 4) {
    return {
      success: false,
      error: `Activity "${title}" must have 2 to 4 options, but has ${options.length}.`,
    }
  }

  const correctOptions = options.filter((o) => o.correct)
  if (correctOptions.length === 0) {
    return {
      success: false,
      error: `Activity "${title}" has no correct answer marked. Use [x] to mark the correct option.`,
    }
  }
  if (correctOptions.length > 1) {
    return {
      success: false,
      error: `Activity "${title}" has ${correctOptions.length} correct answers marked. Exactly one [x] is required.`,
    }
  }

  return {
    success: true,
    body: {
      question,
      options: options.map((o) => ({ id: o.id, text: o.text })),
      correctOptionId: correctOptions[0].id,
    },
  }
}

function parseShortTextBlock(
  lines: string[],
  title: string,
): { success: true; body: ShortTextBody } | { success: false; error: string } {
  const questionLines: string[] = []
  let modelAnswer: string | null = null

  for (const line of lines) {
    const answerMatch = line.match(/^ANSWER:\s*(.+)$/)
    if (answerMatch) {
      modelAnswer = answerMatch[1].trim()
    } else {
      if (modelAnswer === null) {
        questionLines.push(line)
      }
    }
  }

  const question = questionLines.join("\n").trim()
  if (!question) {
    return { success: false, error: `Activity "${title}" has no question text.` }
  }

  if (!modelAnswer) {
    return {
      success: false,
      error: `Activity "${title}" is missing an ANSWER: line.`,
    }
  }

  return {
    success: true,
    body: { question, modelAnswer },
  }
}
