import { redirect } from "next/navigation"
import { requireAuthenticatedProfile, hasRole } from "@/lib/auth"

export default async function GoLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>
}) {
  const { lessonId } = await params
  const profile = await requireAuthenticatedProfile()

  if (hasRole(profile, "teacher")) {
    redirect(`/lessons/${encodeURIComponent(lessonId)}/activities`)
  }

  redirect(
    `/pupil-lessons/${encodeURIComponent(profile.userId)}/lessons/${encodeURIComponent(lessonId)}`
  )
}
