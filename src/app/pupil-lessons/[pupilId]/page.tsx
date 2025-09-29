import { redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { loadPupilLessonsSummaries } from "@/lib/pupil-lessons-data"

import { PupilLessonsView } from "../pupil-lessons-view"

export default async function PupilLessonsDetailPage({
  params,
}: {
  params: Promise<{ pupilId: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const { pupilId } = await params

  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/pupil-lessons/${encodeURIComponent(profile.userId)}`)
  }

  const pupils = await loadPupilLessonsSummaries(pupilId)
  const summary = pupils[0]

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-white">Pupil Lessons</h1>
          <p className="text-sm text-slate-200">
            Lessons assigned to {summary ? summary.name : "this pupil"}, grouped by start date and group.
          </p>
        </div>
      </header>

      {summary ? (
        <PupilLessonsView pupils={pupils} showFilter={false} linkNames={false} />
      ) : (
        <p className="text-sm text-muted-foreground">We couldn&apos;t find any lessons for this pupil.</p>
      )}
    </main>
  )
}
