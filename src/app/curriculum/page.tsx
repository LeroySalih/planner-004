export const dynamic = "force-dynamic"

import { createCurriculumAction, readCurriculaAction, readSubjectsAction } from "@/lib/server-updates"
import { CurriculumPageClient } from "./curriculum-page-client"

async function handleCreateCurriculum(formData: FormData) {
  "use server"

  const title = String(formData.get("title") ?? "")
  const subject = formData.get("subject")
  const description = formData.get("description")

  const result = await createCurriculumAction({
    title,
    subject: subject ? String(subject) : null,
    description: description ? String(description) : null,
  })

  if (result.error) {
    throw new Error(result.error)
  }
}

export default async function CurriculumIndexPage() {
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
      createAction={handleCreateCurriculum}
    />
  )
}
