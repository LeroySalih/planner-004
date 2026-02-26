import { redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { readFlashcardsBootstrapAction, readFlashcardDeckAction } from "@/lib/server-updates"
import { FlashcardsShell } from "@/components/flashcards/flashcards-shell"

export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string; activityId?: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  if (!profile) redirect("/signin")

  const params = await searchParams
  const selectedUnitId = params.unitId ?? null
  const selectedActivityId = params.activityId ?? null

  const bootstrapResult = await readFlashcardsBootstrapAction(profile.userId)

  if (bootstrapResult.error || !bootstrapResult.data) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <p className="text-muted-foreground">Unable to load flashcard data.</p>
      </main>
    )
  }

  const { subjects, flashcardActivities } = bootstrapResult.data

  let deck: { activityId: string; activityTitle: string; lessonTitle: string; cards: { sentence: string; answer: string; template: string }[] } | null = null
  if (selectedActivityId) {
    const deckResult = await readFlashcardDeckAction(selectedActivityId)
    if (deckResult.data) {
      deck = deckResult.data
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <FlashcardsShell
        subjects={subjects}
        flashcardActivities={flashcardActivities}
        selectedUnitId={selectedUnitId}
        selectedActivityId={selectedActivityId}
        deck={deck}
        pupilId={profile.userId}
      />
    </main>
  )
}
