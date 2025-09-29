import { redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { loadPupilLessonsSummaries } from "@/lib/pupil-lessons-data"

import { PupilLessonsView } from "./pupil-lessons-view"

export default async function PupilLessonsPage() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect(`/pupil-lessons/${encodeURIComponent(profile.userId)}`)
  }

  const pupils = await loadPupilLessonsSummaries()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-white">Pupil Lessons</h1>
          <p className="text-sm text-slate-200">
            Review every lesson assigned to pupils across their groups, organised by start date and group. Use the filter to find individual pupils or specific groups.
          </p>
        </div>
      </header>

      {pupils.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pupil lesson assignments available.</p>
      ) : (
        <PupilLessonsView pupils={pupils} showFilter linkNames />
      )}
    </main>
  )
}
