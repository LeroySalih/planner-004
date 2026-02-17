"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { FlashcardCard } from "@/components/flashcards/flashcard-card"
import {
  startFlashcardSessionAction,
  recordFlashcardAttemptAction,
  completeFlashcardSessionAction,
} from "@/lib/server-updates"

type KeyTerm = {
  term: string
  definition: string
}

type Deck = {
  lessonId: string
  lessonTitle: string
  terms: KeyTerm[]
}

type Phase = "ready" | "question" | "feedback" | "complete"

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function generateOptions(
  currentTerm: KeyTerm,
  allTerms: KeyTerm[],
): string[] {
  const otherDefinitions = allTerms
    .filter((t) => t.term !== currentTerm.term)
    .map((t) => t.definition)

  const shuffledOthers = shuffleArray(otherDefinitions)
  const wrongOptions = shuffledOthers.slice(0, 3)
  return shuffleArray([currentTerm.definition, ...wrongOptions])
}

type FlashcardSessionProps = {
  deck: Deck
  pupilId: string
}

export function FlashcardSession({ deck, pupilId }: FlashcardSessionProps) {
  const [pile, setPile] = useState<KeyTerm[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>("ready")
  const [options, setOptions] = useState<string[]>([])
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0)
  const [attemptCounts, setAttemptCounts] = useState<Map<string, number>>(
    new Map(),
  )
  const [totalCorrectAnswers, setTotalCorrectAnswers] = useState(0)
  const sessionStarted = useRef(false)

  const startSession = useCallback(async () => {
    if (sessionStarted.current) return
    sessionStarted.current = true

    const shuffled = shuffleArray(deck.terms)
    setPile(shuffled)
    setOptions(generateOptions(shuffled[0], deck.terms))
    setPhase("question")
    setConsecutiveCorrect(0)
    setAttemptCounts(new Map())
    setTotalCorrectAnswers(0)
    setSelectedOption(null)

    const result = await startFlashcardSessionAction(
      deck.lessonId,
      deck.terms.length,
      pupilId,
    )
    if (result.data) {
      setSessionId(result.data.sessionId)
    }
  }, [deck, pupilId])

  useEffect(() => {
    startSession()
  }, [startSession])

  const handleSelect = useCallback(
    (option: string) => {
      if (phase !== "question" || pile.length === 0) return

      const currentCard = pile[0]
      const isCorrect = option === currentCard.definition
      setSelectedOption(option)
      setPhase("feedback")

      const termKey = currentCard.term
      const newAttemptCounts = new Map(attemptCounts)
      const currentCount = newAttemptCounts.get(termKey) ?? 0
      newAttemptCounts.set(termKey, currentCount + 1)
      setAttemptCounts(newAttemptCounts)

      if (isCorrect) {
        setTotalCorrectAnswers((prev) => prev + 1)
      }

      // Fire-and-forget
      if (sessionId) {
        recordFlashcardAttemptAction({
          sessionId,
          term: currentCard.term,
          definition: currentCard.definition,
          chosenDefinition: option,
          isCorrect,
          attemptNumber: currentCount + 1,
        })
      }

      // Advance after feedback delay
      setTimeout(() => {
        const newConsecutive = isCorrect ? consecutiveCorrect + 1 : 0

        if (isCorrect && newConsecutive >= pile.length) {
          // Clean pass complete
          setConsecutiveCorrect(newConsecutive)
          setPhase("complete")
          if (sessionId) {
            completeFlashcardSessionAction(sessionId, totalCorrectAnswers + 1)
          }
          return
        }

        // Rearrange pile
        const newPile = [...pile]
        newPile.splice(0, 1) // Remove current card

        if (isCorrect) {
          newPile.push(currentCard) // Back of pile
        } else {
          const insertPos = Math.min(2, newPile.length)
          newPile.splice(insertPos, 0, currentCard) // 2 positions down
        }

        setPile(newPile)
        setConsecutiveCorrect(newConsecutive)
        setOptions(generateOptions(newPile[0], deck.terms))
        setSelectedOption(null)
        setPhase("question")
      }, 1200)
    },
    [phase, pile, sessionId, consecutiveCorrect, attemptCounts, deck.terms, totalCorrectAnswers],
  )

  const handleRestart = useCallback(() => {
    sessionStarted.current = false
    setSessionId(null)
    startSession()
  }, [startSession])

  if (phase === "ready") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading flashcards...</p>
      </div>
    )
  }

  if (phase === "complete") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Session Complete</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 py-8">
          <div className="text-center">
            <p className="text-4xl font-bold text-emerald-600">
              {deck.terms.length}/{deck.terms.length}
            </p>
            <p className="mt-2 text-muted-foreground">
              All cards correct in a row — clean pass!
            </p>
          </div>
          <Button onClick={handleRestart} size="lg">
            Practice Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  const progressPercent =
    pile.length > 0
      ? Math.round((consecutiveCorrect / pile.length) * 100)
      : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{deck.lessonTitle}</span>
          <span>{Math.round(progressPercent)}% to clean pass</span>
        </div>
        <Progress value={progressPercent} />
      </div>

      {pile.length > 0 && (
        <FlashcardCard
          term={pile[0].term}
          options={options}
          selectedOption={selectedOption}
          correctDefinition={pile[0].definition}
          isAnswered={phase === "feedback"}
          onSelect={handleSelect}
          currentIndex={0}
          totalCards={pile.length}
          consecutiveCorrect={consecutiveCorrect}
        />
      )}
    </div>
  )
}
