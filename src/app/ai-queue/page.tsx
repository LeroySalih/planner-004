import { requireTeacherProfile } from "@/lib/auth"
import AiQueueClient from "./ai-queue-client"

export const dynamic = "force-dynamic"

export default async function AiQueuePage() {
  await requireTeacherProfile()

  return <AiQueueClient />
}
