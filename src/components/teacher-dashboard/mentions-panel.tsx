import Link from "next/link"
import { readMentionsAction } from "@/lib/server-updates"

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export async function MentionsPanel({ groupId }: { groupId?: string }) {
  const { data: items, error } = await readMentionsAction(groupId)

  const mentions = items ?? []

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">Mentions</span>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-600 dark:bg-blue-400/10 dark:text-blue-400">
          {mentions.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : mentions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pupil mentions.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {mentions.map((item) => (
            <Link
              key={item.commentId}
              href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
              className="flex flex-col rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 hover:border-blue-400 dark:border-blue-900 dark:bg-blue-950/40 dark:hover:border-blue-700"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{item.pupilName}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
              </div>
              <p className="mt-1 max-w-[160px] truncate text-xs italic text-muted-foreground">
                &ldquo;{item.comment}&rdquo;
              </p>
              <span className="text-xs text-muted-foreground">{item.groupId}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
