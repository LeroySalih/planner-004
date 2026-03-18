import Link from "next/link"
import { MarkAllButton } from "@/components/teacher-dashboard/mark-all-button"
import { readMarkingQueueAction } from "@/lib/server-updates"

export async function MarkingQueuePanel() {
  const { data: items, error } = await readMarkingQueueAction()

  const queue = items ?? []
  const totalSubmissions = queue.reduce((sum, item) => sum + item.submissionCount, 0)

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-amber-400">Needs Review</span>
        <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-400">
          {totalSubmissions}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : queue.length === 0 ? (
        <p className="text-xs text-slate-500">No lessons awaiting review.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {queue.map((item) => (
            <div
              key={`${item.lessonId}-${item.groupId}`}
              className="flex flex-col rounded-md border border-amber-900 bg-amber-950/40 px-2.5 py-2"
            >
              <Link
                href={`/results/assignments/${encodeURIComponent(`${item.groupId}__${item.lessonId}`)}`}
                className="text-xs font-semibold text-amber-300 hover:underline"
              >
                {item.lessonTitle} ↗
              </Link>
              <span className="text-xs text-slate-500">{item.groupName}</span>
              <span className="mt-1 self-start rounded-full bg-amber-400/10 px-1.5 py-0.5 text-xs font-bold text-amber-400">
                {item.submissionCount} activit{item.submissionCount !== 1 ? "ies" : "y"}
              </span>
              <div className="mt-1">
                <MarkAllButton groupId={item.groupId} lessonId={item.lessonId} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
