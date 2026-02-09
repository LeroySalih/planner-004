import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getPupilUnitLessonsAction } from "../../../actions"
import { PupilLessonList } from "./pupil-lesson-list"
import Link from "next/link"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string; pupilId: string }>
}

export default async function PupilUnitLessonsPage({ params }: PageProps) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const { groupId, unitId, pupilId } = await params
  const result = await getPupilUnitLessonsAction(groupId, unitId, pupilId)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/unit-progress-reports" className="hover:text-foreground hover:underline">
            Unit Progress Reports
          </Link>
          <span>/</span>
          <Link
            href={`/unit-progress-reports/${encodeURIComponent(groupId)}`}
            className="hover:text-foreground hover:underline"
          >
            {result.groupId}
          </Link>
          <span>/</span>
          <span>{result.unitTitle}</span>
          <span>/</span>
          <span>{result.pupilName}</span>
        </div>
        <h1 className="text-3xl font-bold text-foreground">
          {result.pupilName} - {result.unitTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          {result.groupId} - {result.groupSubject}
        </p>
      </header>

      <PupilLessonList lessons={result.lessons} />
    </main>
  )
}
