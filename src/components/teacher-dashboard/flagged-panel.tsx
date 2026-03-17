import Link from "next/link"
import { readFlaggedSubmissionsAction } from "@/lib/server-updates"

export async function FlaggedPanel() {
  const { data: items, error } = await readFlaggedSubmissionsAction()

  const flagged = items ?? []

  return (
    <section className="flex-1 border-b border-slate-800 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-red-400">Flagged</span>
        <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-bold text-red-400">
          {flagged.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : flagged.length === 0 ? (
        <p className="text-xs text-slate-500">No flagged submissions.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {flagged.map((item) => (
            <li
              key={item.submissionId}
              className="rounded-md border-l-2 border-red-400 bg-slate-800 px-3 py-2"
            >
              <Link
                href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
                className="block"
              >
                <p className="text-xs font-semibold text-red-300 hover:underline">
                  {item.pupilName}
                </p>
                <p className="text-xs text-slate-400">{item.activityTitle}</p>
                <p className="mt-0.5 text-xs text-slate-500">{item.groupName}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
