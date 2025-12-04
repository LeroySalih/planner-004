import { TestSseObserver } from "@/components/test-sse/test-sse-observer"
import { requireTeacherProfile } from "@/lib/auth"
import { getTopicCounter } from "@/lib/sse/hub"
import { fetchLatestSseEvent } from "@/lib/sse/persistence"
import type { SseTopic } from "@/lib/sse/types"

export const dynamic = "force-dynamic"

export default async function TestSseObserverPage() {
  await requireTeacherProfile({ refreshSessionCookie: true })
  const topic: SseTopic = "test-sse"
  const latest = await fetchLatestSseEvent(topic)
  const persistedCounter =
    latest && typeof latest.payload?.value === "number" ? (latest.payload.value as number) : null
  const currentCounter = persistedCounter ?? getTopicCounter(topic)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Labs</p>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Test SSE Observer</h1>
          <p className="text-muted-foreground">
            This page only listens to the same server-sent event stream used by `/test-sse`. Open both
            routes and click “Send counter event” on `/test-sse` to see updates appear here instantly.
          </p>
        </div>
      </div>
      <TestSseObserver initialCounter={currentCounter} streamPath="/sse?topics=test-sse" />
    </div>
  )
}
