import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getPupilLOSuccessCriteriaAction } from "../../../actions"
import { PupilSCList } from "./pupil-sc-list"
import Link from "next/link"

type PageProps = {
  params: Promise<{ groupId: string; loId: string; pupilId: string }>
}

export default async function PupilLOSuccessCriteriaPage({ params }: PageProps) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const { groupId, loId, pupilId } = await params
  const result = await getPupilLOSuccessCriteriaAction(groupId, loId, pupilId)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/lo-progress-reports" className="hover:text-foreground hover:underline">
            LO Progress Reports
          </Link>
          <span>/</span>
          <Link
            href={`/lo-progress-reports/${encodeURIComponent(groupId)}`}
            className="hover:text-foreground hover:underline"
          >
            {result.groupId}
          </Link>
          <span>/</span>
          <span>{result.loTitle}</span>
          <span>/</span>
          <span>{result.pupilName}</span>
        </div>
        <div className="text-xs text-muted-foreground">{result.aoTitle}</div>
        <h1 className="text-3xl font-bold text-foreground">
          {result.pupilName} - {result.loTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          {result.groupId} - {result.groupSubject}
        </p>
      </header>

      <PupilSCList successCriteria={result.successCriteria} />
    </main>
  )
}
