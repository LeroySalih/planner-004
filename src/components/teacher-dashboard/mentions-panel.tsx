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

export async function MentionsPanel() {
  const { data: items, error } = await readMentionsAction()

  const mentions = items ?? []

  return (
    <section className="flex-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-blue-400">Mentions</span>
        <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-xs font-bold text-blue-400">
          {mentions.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : mentions.length === 0 ? (
        <p className="text-xs text-slate-500">No pupil mentions.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {mentions.map((item) => (
            <li
              key={item.commentId}
              className="rounded-md border-l-2 border-blue-400 bg-slate-800 px-3 py-2"
            >
              <Link
                href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
                className="block"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-300 hover:underline">
                    {item.pupilName}
                  </p>
                  <p className="text-xs text-slate-500">{timeAgo(item.createdAt)}</p>
                </div>
                <p className="mt-1 text-xs italic text-slate-400 line-clamp-2">
                  &ldquo;{item.comment}&rdquo;
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{item.groupName}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
