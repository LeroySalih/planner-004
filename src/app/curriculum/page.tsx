export const dynamic = "force-dynamic"

import { readCurriculaAction, readSubjectsAction } from "@/lib/server-updates"
import { CurriculumPageClient } from "./curriculum-page-client"
import { requireTeacherProfile } from "@/lib/auth"
import { Suspense } from "react"

export default async function CurriculumIndexPage() {
  await requireTeacherProfile()
  const [curriculaResult, subjectsResult] = await Promise.all([
    readCurriculaAction(),
    readSubjectsAction(),
  ])

  return (
    <CurriculumPageClient
      curricula={curriculaResult.data ?? []}
      subjects={subjectsResult.data ?? []}
      error={curriculaResult.error ?? null}
      subjectsError={subjectsResult.error ?? null}
    />
    
  )
}
