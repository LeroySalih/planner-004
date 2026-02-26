export type FlashCard = {
  sentence: string
  answer: string
  template: string
}

export function parseFlashcardLines(input: string): FlashCard[] {
  if (!input || typeof input !== "string") return []

  const lines = input.split("\n")
  const cards: FlashCard[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = trimmed.match(/\*\*(.+?)\*\*/)
    if (!match) continue

    const answer = match[1].trim()
    if (!answer) continue

    const template = trimmed.replace(/\*\*(.+?)\*\*/, "[...]")
    cards.push({ sentence: trimmed, answer, template })
  }

  return cards
}
