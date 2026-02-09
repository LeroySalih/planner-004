import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getClassLOMatrixAction } from "../actions"
import { LOPupilMatrix } from "./lo-pupil-matrix"
import Link from "next/link"

type PageProps = {
  params: Promise<{ groupId: string }>
}

export default async function ClassLOProgressPage({ params }: PageProps) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const { groupId } = await params
  const result = await getClassLOMatrixAction(groupId)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/lo-progress-reports" className="hover:text-foreground hover:underline">
            LO Progress Reports
          </Link>
          <span>/</span>
          <span>{result.groupId}</span>
        </div>
        <h1 className="text-3xl font-bold text-foreground">
          {result.groupId} - {result.groupSubject}
        </h1>
        <p className="text-sm text-muted-foreground">
          Individual pupil progress by learning objectives
        </p>
      </header>

      <LOPupilMatrix groupId={result.groupId} data={result.data} />
    </main>
  )
}
