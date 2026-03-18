"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { FlashcardSession } from "@/components/flashcards/flashcard-session"
import { readFlashcardDeckAction } from "@/lib/server-updates"
import type { LessonActivity } from "@/types"

interface PupilDoFlashcardsActivityProps {
  activity: LessonActivity
  pupilId: string
  initialScore: number | null  // 0-1 from latest submission, or null if none
}

function getFlashcardActivityId(activity: LessonActivity): string | null {
  const body = activity.body_data
  if (typeof body !== "object" || body === null) return null
  const id = (body as Record<string, unknown>).flashcardActivityId
  return typeof id === "string" && id.length > 0 ? id : null
}

export function PupilDoFlashcardsActivity({
  activity,
  pupilId,
  initialScore,
}: PupilDoFlashcardsActivityProps) {
  const flashcardActivityId = getFlashcardActivityId(activity)
  const [open, setOpen] = useState(false)
  const [deck, setDeck] = useState<{
    activityId: string
    activityTitle: string
    lessonTitle: string
    cards: Array<{ sentence: string; answer: string; template: string }>
  } | null>(null)
  const [deckError, setDeckError] = useState<string | null>(null)
  const [loadingDeck, setLoadingDeck] = useState(false)
  const [latestScore, setLatestScore] = useState<number | null>(initialScore)

  const handleOpen = useCallback(async () => {
    if (!flashcardActivityId) return
    if (deck) {
      setOpen(true)
      return
    }
    setLoadingDeck(true)
    const result = await readFlashcardDeckAction(flashcardActivityId)
    setLoadingDeck(false)
    if (result.error || !result.data) {
      setDeckError(result.error ?? "Could not load flashcard set.")
      return
    }
    if (result.data.cards.length === 0) {
      setDeckError("This flashcard set has no cards yet.")
      return
    }
    setDeck(result.data)
    setOpen(true)
  }, [flashcardActivityId, deck])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleScoreUpdate = useCallback((score: number) => {
    setLatestScore(score)
  }, [])

  if (!flashcardActivityId) {
    return (
      <p className="text-sm text-muted-foreground">Flashcard set unavailable.</p>
    )
  }

  const scoreDisplay =
    latestScore !== null ? `${Math.round(latestScore * 100)}%` : null

  return (
    <>
      <div className="flex items-center gap-3">
        {scoreDisplay && (
          <span className="text-sm font-medium text-foreground">{scoreDisplay}</span>
        )}
        <Button
          size="sm"
          onClick={handleOpen}
          disabled={loadingDeck}
        >
          {loadingDeck ? "Loading…" : "Start Flashcards"}
        </Button>
        {deckError && (
          <p className="text-sm text-destructive">{deckError}</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose() }}>
        <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <DialogTitle>{activity.title || "Flashcards"}</DialogTitle>
          {deck && (
            <FlashcardSession
              key={deck.activityId}
              deck={deck}
              pupilId={pupilId}
              doActivityId={activity.activity_id}
              onScoreUpdate={handleScoreUpdate}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
