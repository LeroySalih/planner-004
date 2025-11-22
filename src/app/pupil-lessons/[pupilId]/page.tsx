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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-6 py-6 text-white shadow-lg sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">Pupil Lessons</h1>
          <p className="text-sm text-slate-100 sm:text-base">
            Every lesson issued to {summary ? summary.name : "this pupil"} grouped by week, subject, and learning goals.
          </p>
        </div>
      </header>

      <PupilLessonsDetailClient detail={detail} pupilId={pupilId} />
    </main>
  )
}
