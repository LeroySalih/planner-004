import Link from "next/link"
import { readFlaggedSubmissionsAction } from "@/lib/server-updates"

export async function FlaggedPanel() {
  const { data: items, error } = await readFlaggedSubmissionsAction()

  const flagged = items ?? []

  // Group by pupil name, accumulate flag count and lesson links
  const byPupil = new Map<string, { pupilName: string; groupId: string; groupName: string; lessonId: string; count: number }>()
  for (const item of flagged) {
    const existing = byPupil.get(item.pupilName)
    if (existing) {
      existing.count += 1
    } else {
      byPupil.set(item.pupilName, {
        pupilName: item.pupilName,
        groupId: item.groupId,
        groupName: item.groupName,
        lessonId: item.lessonId,
        count: 1,
      })
    }
  }

  const top5 = Array.from(byPupil.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-red-400">Flagged</span>
        <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-bold text-red-400">
          {flagged.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : top5.length === 0 ? (
        <p className="text-xs text-slate-500">No flagged submissions.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {top5.map((pupil) => (
            <Link
              key={pupil.pupilName}
              href={`/feedback/groups/${encodeURIComponent(pupil.groupId)}/lessons/${encodeURIComponent(pupil.lessonId)}`}
              className="flex flex-col rounded-md border border-red-900 bg-red-950/40 px-2.5 py-2 hover:border-red-700"
            >
              <span className="text-xs font-semibold text-red-300">{pupil.pupilName}</span>
              <span className="text-xs text-slate-500">{pupil.groupName}</span>
              <span className="mt-1 self-start rounded-full bg-red-400/10 px-1.5 py-0.5 text-xs font-bold text-red-400">
                {pupil.count} flag{pupil.count !== 1 ? "s" : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
