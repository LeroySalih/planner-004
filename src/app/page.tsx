export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { requireTeacherProfile } from "@/lib/auth"

export default async function RootPage() {
  await requireTeacherProfile()
  redirect("/teacher-planner")
}
