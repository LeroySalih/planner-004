import Link from "next/link"
import { redirect } from "next/navigation"

import { requireAuthenticatedProfile, hasRole } from "@/lib/auth"
import { readActivityByIdAction } from "@/lib/server-updates"

export default async function GoActivityPage({
  params,
}: {
  params: Promise<{ activityId: string }>
}) {
  const { activityId } = await params
  const profile = await requireAuthenticatedProfile()

  const result = await readActivityByIdAction(activityId)

  if (result.error || !result.data || result.data.active === false) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-2xl font-semibold text-foreground">
          Activity not available
        </h1>
        <p className="text-sm text-muted-foreground">
          This activity is no longer available. It may have been removed or deactivated.
        </p>
        {hasRole(profile, "teacher") ? (
          <Link
            href="/lessons"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to Lessons
          </Link>
        ) : (
          <Link
            href={`/pupil-lessons/${encodeURIComponent(profile.userId)}`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to My Lessons
          </Link>
        )}
      </main>
    )
  }

  const { lesson_id: lessonId } = result.data

  if (hasRole(profile, "teacher")) {
    redirect(
      `/lessons/${encodeURIComponent(lessonId)}/activities/activity/${encodeURIComponent(activityId)}`,
    )
  }

  redirect(
    `/pupil-lessons/${encodeURIComponent(profile.userId)}/lessons/${encodeURIComponent(lessonId)}#activity-${activityId}`,
  )
}
