"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type FlashcardCardProps = {
  term: string
  options: string[]
  selectedOption: string | null
  correctDefinition: string
  isAnswered: boolean
  onSelect: (option: string) => void
  currentIndex: number
  totalCards: number
  consecutiveCorrect: number
}

export function FlashcardCard({
  term,
  options,
  selectedOption,
  correctDefinition,
  isAnswered,
  onSelect,
  currentIndex,
  totalCards,
  consecutiveCorrect,
}: FlashcardCardProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{term}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {consecutiveCorrect}/{totalCards} correct in a row
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {options.map((option, index) => {
            let variant: "outline" | "default" | "destructive" | "secondary" = "outline"
            let extraClasses = ""

            if (isAnswered) {
              if (option === correctDefinition) {
                variant = "default"
                extraClasses = "bg-emerald-600 hover:bg-emerald-600 border-emerald-600 text-white"
              } else if (option === selectedOption) {
                variant = "destructive"
              }
            }

            return (
              <Button
                key={index}
                variant={variant}
                className={cn(
                  "h-auto min-h-[60px] whitespace-normal text-left py-3 px-4",
                  extraClasses,
                )}
                onClick={() => !isAnswered && onSelect(option)}
                disabled={isAnswered}
              >
                {option}
              </Button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
