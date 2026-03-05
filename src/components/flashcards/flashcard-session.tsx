"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { FlashcardCard } from "@/components/flashcards/flashcard-card"
import { similarity, SIMILARITY_THRESHOLD } from "@/lib/flashcards/similarity"
import {
  startFlashcardSessionAction,
  recordFlashcardAttemptAction,
  completeFlashcardSessionAction,
} from "@/lib/server-updates"

type FlashCard = {
  sentence: string
  answer: string
  template: string
}

type Deck = {
  activityId: string
  activityTitle: string
  lessonTitle: string
  cards: FlashCard[]
}

type Phase = "ready" | "question" | "feedback" | "complete"

type FeedbackState = {
  isCorrect: boolean
  isExactMatch: boolean
  correctAnswer: string
  typedAnswer: string
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

type FlashcardSessionProps = {
  deck: Deck
  pupilId: string
}

export function FlashcardSession({ deck, pupilId }: FlashcardSessionProps) {
  const [pile, setPile] = useState<FlashCard[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>("ready")
  const [feedbackState, setFeedbackState] = useState<FeedbackState | null>(null)
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0)
  const [attemptCounts, setAttemptCounts] = useState<Map<string, number>>(
    new Map(),
  )
  const [totalCorrectAnswers, setTotalCorrectAnswers] = useState(0)
  const [totalAttempts, setTotalAttempts] = useState(0)
  const sessionStarted = useRef(false)

  const startSession = useCallback(async () => {
    if (sessionStarted.current) return
    sessionStarted.current = true

    const shuffled = shuffleArray(deck.cards)
    setPile(shuffled)
    setPhase("question")
    setConsecutiveCorrect(0)
    setAttemptCounts(new Map())
    setTotalCorrectAnswers(0)
    setTotalAttempts(0)
    setFeedbackState(null)

    const result = await startFlashcardSessionAction(
      deck.activityId,
      deck.cards.length,
      pupilId,
    )
    if (result.data) {
      setSessionId(result.data.sessionId)
    }
  }, [deck, pupilId])

  useEffect(() => {
    startSession()
  }, [startSession])

  const handleSubmit = useCallback(
    (typedAnswer: string) => {
      if (phase !== "question" || pile.length === 0) return

      const currentCard = pile[0]
      const score = similarity(typedAnswer, currentCard.answer)
      const isExactMatch = typedAnswer.trim().toLowerCase() === currentCard.answer.trim().toLowerCase()
      const isCorrect = score >= SIMILARITY_THRESHOLD
      setFeedbackState({
        isCorrect,
        isExactMatch,
        correctAnswer: currentCard.answer,
        typedAnswer,
      })
      setPhase("feedback")

      const termKey = currentCard.template
      const newAttemptCounts = new Map(attemptCounts)
      const currentCount = newAttemptCounts.get(termKey) ?? 0
      newAttemptCounts.set(termKey, currentCount + 1)
      setAttemptCounts(newAttemptCounts)

      const newTotalAttempts = totalAttempts + 1
      const newCorrectCount = totalCorrectAnswers + (isCorrect ? 1 : 0)
      const newWrongCount = newTotalAttempts - newCorrectCount
      const newConsecutiveForEmit = isCorrect ? consecutiveCorrect + 1 : 0

      setTotalAttempts(newTotalAttempts)
      if (isCorrect) {
        setTotalCorrectAnswers(newCorrectCount)
      }

      // Fire-and-forget
      if (sessionId) {
        void recordFlashcardAttemptAction({
          sessionId,
          term: currentCard.template,
          definition: currentCard.answer,
          chosenDefinition: typedAnswer,
          isCorrect,
          attemptNumber: currentCount + 1,
          progress: {
            pupilId,
            activityId: deck.activityId,
            consecutiveCorrect: newConsecutiveForEmit,
            totalCards: deck.cards.length,
            correctCount: newCorrectCount,
            wrongCount: newWrongCount,
          },
        })
      }

      // Both correct and incorrect wait for user to click "Next" (handled by handleNext)
    },
    [phase, pile, sessionId, consecutiveCorrect, attemptCounts, deck.activityId, totalCorrectAnswers, totalAttempts, pupilId],
  )

  const handleNext = useCallback(() => {
    if (phase !== "feedback" || pile.length === 0 || !feedbackState) return

    const currentCard = pile[0]
    const isCorrect = feedbackState.isCorrect

    if (isCorrect) {
      const newConsecutive = consecutiveCorrect + 1

      if (newConsecutive >= pile.length) {
        setConsecutiveCorrect(newConsecutive)
        setPhase("complete")
        if (sessionId) {
          completeFlashcardSessionAction(sessionId, totalCorrectAnswers, {
            pupilId,
            activityId: deck.activityId,
            totalCards: pile.length,
          })
        }
        return
      }

      const newPile = [...pile]
      newPile.splice(0, 1)
      newPile.push(currentCard)

      setPile(newPile)
      setConsecutiveCorrect(newConsecutive)
    } else {
      const newPile = [...pile]
      newPile.splice(0, 1)
      const insertPos = Math.min(2, newPile.length)
      newPile.splice(insertPos, 0, currentCard)

      setPile(newPile)
      setConsecutiveCorrect(0)
    }

    setFeedbackState(null)
    setPhase("question")
  }, [phase, pile, feedbackState, consecutiveCorrect, sessionId, totalCorrectAnswers, pupilId, deck.activityId])

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
              {deck.cards.length}/{deck.cards.length}
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
          <span>{deck.activityTitle}</span>
          <span>{Math.round(progressPercent)}% to clean pass</span>
        </div>
        <Progress value={progressPercent} />
      </div>

      {pile.length > 0 && (
        <FlashcardCard
          key={phase === "question" ? `q-${pile[0].template}` : `f-${pile[0].template}`}
          template={pile[0].template}
          feedbackState={feedbackState}
          onSubmit={handleSubmit}
          onNext={handleNext}
          totalCards={pile.length}
          consecutiveCorrect={consecutiveCorrect}
        />
      )}
    </div>
  )
}
