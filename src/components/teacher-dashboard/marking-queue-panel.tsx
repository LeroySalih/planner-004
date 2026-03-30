import Link from "next/link"
import { MarkAllButton } from "@/components/teacher-dashboard/mark-all-button"
import { readMarkingQueueAction } from "@/lib/server-updates"

export async function MarkingQueuePanel({ groupId }: { groupId?: string }) {
  const { data: items, error } = await readMarkingQueueAction(groupId)

  const queue = items ?? []
  const totalSubmissions = queue.reduce((sum, item) => sum + item.submissionCount, 0)

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Needs Review</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-600 dark:bg-amber-400/10 dark:text-amber-400">
          {totalSubmissions}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : queue.length === 0 ? (
        <p className="text-xs text-muted-foreground">No lessons awaiting review.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {queue.map((item) => (
            <div
              key={`${item.lessonId}-${item.groupId}`}
              className="flex flex-col rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 dark:border-amber-900 dark:bg-amber-950/40"
            >
              <Link
                href={`/results/assignments/${encodeURIComponent(`${item.groupId}__${item.lessonId}`)}`}
                className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-300"
              >
                {item.lessonTitle} ↗
              </Link>
              <span className="text-xs text-muted-foreground">{item.groupId}</span>
              <span className="mt-1 self-start rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-600 dark:bg-amber-400/10 dark:text-amber-400">
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
