"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type FeedbackState = {
  isCorrect: boolean
  isExactMatch: boolean
  correctAnswer: string
  typedAnswer: string
}

type FlashcardCardProps = {
  template: string
  feedbackState: FeedbackState | null
  onSubmit: (typed: string) => void
  onNext: () => void
  totalCards: number
  consecutiveCorrect: number
}

export function FlashcardCard({
  template,
  feedbackState,
  onSubmit,
  onNext,
  totalCards,
  consecutiveCorrect,
}: FlashcardCardProps) {
  const [typed, setTyped] = useState("")

  const handleSubmit = () => {
    const trimmed = typed.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg leading-relaxed">
            {template.split("[...]").map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && (
                  <span className="mx-1 inline-block min-w-[4rem] border-b-2 border-primary px-1 text-center">
                    {feedbackState ? feedbackState.typedAnswer : "..."}
                  </span>
                )}
              </span>
            ))}
          </CardTitle>
          <span className="text-sm text-muted-foreground whitespace-nowrap ml-4">
            {consecutiveCorrect}/{totalCards} correct in a row
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {!feedbackState ? (
          <div className="flex gap-3">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type the missing word..."
              autoFocus
              className="flex-1"
            />
            <Button onClick={handleSubmit} disabled={typed.trim().length === 0}>
              Submit
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              className={cn(
                "rounded-md p-4 text-sm font-medium",
                feedbackState.isCorrect
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-400",
              )}
            >
              {feedbackState.isCorrect && feedbackState.isExactMatch && (
                <span>Correct!</span>
              )}
              {feedbackState.isCorrect && !feedbackState.isExactMatch && (
                <span>Close enough! Check spelling: <strong>{feedbackState.correctAnswer}</strong></span>
              )}
              {!feedbackState.isCorrect && (
                <span>Incorrect. The answer is: <strong>{feedbackState.correctAnswer}</strong></span>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button onClick={onNext} autoFocus>
                Next
              </Button>
              <span className="text-xs text-muted-foreground">Press Enter to continue</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
