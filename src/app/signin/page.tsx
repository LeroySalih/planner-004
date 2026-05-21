import type { Metadata } from "next"
import { readPublicLessonsAction } from "@/lib/server-updates"
import { PublicLessonBrowser } from "@/components/public/PublicLessonBrowser"

export const metadata: Metadata = {
  title: "Sign in",
}

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { returnTo } = await searchParams
  const { data: lessons } = await readPublicLessonsAction()

  return (
    <PublicLessonBrowser lessons={lessons ?? []} returnTo={returnTo} />
  )
}
