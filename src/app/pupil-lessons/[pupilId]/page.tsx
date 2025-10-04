import { redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { loadPupilLessonsDetail } from "@/lib/pupil-lessons-data"

import { PupilLessonsDetailClient } from "./pupil-lessons-detail-client"

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

  const detail = await loadPupilLessonsDetail(pupilId)
  const summary = detail.summary

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-white">Pupil Lessons</h1>
          <p className="text-sm text-slate-100">
            Review homework and previous lessons for {summary ? summary.name : "this pupil"}.
          </p>
        </div>
      </header>

      {summary || detail.homework.length > 0 || detail.weeks.length > 0 ? (
        <PupilLessonsDetailClient detail={detail} pupilId={pupilId} />
      ) : (
        <p className="text-sm text-muted-foreground">We couldn&apos;t find any lessons for this pupil yet.</p>
      )}
    </main>
  )
}
