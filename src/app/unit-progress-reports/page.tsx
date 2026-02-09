import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getProgressMatrixAction } from "./actions"
import { ProgressMatrix } from "./progress-matrix"

export default async function ProgressReportsPage() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const data = await getProgressMatrixAction()

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Unit Progress Reports</h1>
        <p className="text-sm text-muted-foreground">
          Monitor class progress by units
        </p>
      </header>

      <ProgressMatrix data={data} />
    </main>
  )
}
