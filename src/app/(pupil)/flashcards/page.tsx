import { redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { readFlashcardsBootstrapAction, readFlashcardDeckAction } from "@/lib/server-updates"
import { FlashcardsShell } from "@/components/flashcards/flashcards-shell"

export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string; lessonId?: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  if (!profile) redirect("/signin")

  const params = await searchParams
  const selectedUnitId = params.unitId ?? null
  const selectedLessonId = params.lessonId ?? null

  const bootstrapResult = await readFlashcardsBootstrapAction(profile.userId)

  if (bootstrapResult.error || !bootstrapResult.data) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <p className="text-muted-foreground">Unable to load flashcard data.</p>
      </main>
    )
  }

  const { subjects, lessonsWithKeyTerms } = bootstrapResult.data

  let deck: { lessonId: string; lessonTitle: string; terms: { term: string; definition: string }[] } | null = null
  if (selectedLessonId) {
    const deckResult = await readFlashcardDeckAction(selectedLessonId)
    if (deckResult.data) {
      deck = deckResult.data
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <FlashcardsShell
        subjects={subjects}
        lessonsWithKeyTerms={lessonsWithKeyTerms}
        selectedUnitId={selectedUnitId}
        selectedLessonId={selectedLessonId}
        deck={deck}
        pupilId={profile.userId}
      />
    </main>
  )
}
