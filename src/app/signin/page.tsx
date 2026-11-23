import type { Metadata } from "next"
import { readPublicLessonsAction } from "@/lib/server-updates"
import { passwordResetAvailable } from "@/lib/password-reset"
import { PublicLessonBrowser } from "@/components/public/PublicLessonBrowser"

export const metadata: Metadata = {
  title: "Sign in",
}

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; reset?: string }>
}) {
  const { returnTo, reset } = await searchParams
  const { data: lessons } = await readPublicLessonsAction()

  return (
    <PublicLessonBrowser
      lessons={lessons ?? []}
      returnTo={returnTo}
      showForgotPassword={passwordResetAvailable()}
      notice={reset === "done" ? "Your password is changed. Sign in with your new password." : undefined}
    />
  )
}
