import Link from "next/link"
import { MarkAllButton } from "@/components/teacher-dashboard/mark-all-button"
import { readMarkingQueueAction } from "@/lib/server-updates"

export async function MarkingQueuePanel() {
  const { data: items, error } = await readMarkingQueueAction()

  const queue = items ?? []
  const totalSubmissions = queue.reduce((sum, item) => sum + item.submissionCount, 0)

  return (
    <section className="flex-[2] border-r border-slate-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-amber-400">
            Needs Review
          </span>
          <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-400">
            {totalSubmissions}
          </span>
        </div>
        <span className="text-xs text-slate-500">Submitted · awaiting marking</span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : queue.length === 0 ? (
        <p className="text-xs text-slate-500">No lessons awaiting review.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {queue.map((item) => (
            <li
              key={`${item.lessonId}-${item.groupId}`}
              className="flex items-center justify-between rounded-md border-l-[3px] border-amber-400 bg-slate-800 px-3 py-2.5"
            >
              <div>
                <Link
                  href={`/results/assignments/${encodeURIComponent(`${item.groupId}__${item.lessonId}`)}`}
                  className="text-sm font-semibold text-amber-300 underline decoration-amber-400/50 underline-offset-2 hover:decoration-amber-400"
                >
                  {item.lessonTitle} ↗
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {item.groupName} · {item.unitTitle} · {item.groupId}
                </p>
              </div>
              <div className="ml-4 shrink-0 text-right">
                <p className="text-base font-bold text-amber-400">{item.submissionCount}</p>
                <p className="text-xs text-slate-500">activities</p>
                <MarkAllButton groupId={item.groupId} lessonId={item.lessonId} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
