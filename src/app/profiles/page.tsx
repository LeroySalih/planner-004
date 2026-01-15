import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { requireAuthenticatedProfile } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Profile",
}

export default async function ProfilesPage() {
  const profile = await requireAuthenticatedProfile()
  redirect(`/profiles/${profile.userId}`)
}
