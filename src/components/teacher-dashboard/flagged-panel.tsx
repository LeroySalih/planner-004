import Link from "next/link"
import { readFlaggedSubmissionsAction } from "@/lib/server-updates"

export async function FlaggedPanel({ groupId }: { groupId?: string }) {
  const { data: items, error } = await readFlaggedSubmissionsAction(groupId)

  const flagged = items ?? []

  // Group by userId+groupId so each pupil-class pair links correctly
  const byPupilGroup = new Map<string, { userId: string; pupilName: string; groupId: string; lessonId: string; count: number }>()
  for (const item of flagged) {
    const key = `${item.userId}__${item.groupId}`
    const existing = byPupilGroup.get(key)
    if (existing) {
      existing.count += 1
    } else {
      byPupilGroup.set(key, {
        userId: item.userId,
        pupilName: item.pupilName,
        groupId: item.groupId,
        lessonId: item.lessonId,
        count: 1,
      })
    }
  }

  const top5 = Array.from(byPupilGroup.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Flagged</span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600 dark:bg-red-400/10 dark:text-red-400">
          {flagged.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : top5.length === 0 ? (
        <p className="text-xs text-muted-foreground">No flagged submissions.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {top5.map((pupil) => (
            <Link
              key={`${pupil.userId}__${pupil.groupId}`}
              href={`/feedback/groups/${encodeURIComponent(pupil.groupId)}/lessons/${encodeURIComponent(pupil.lessonId)}`}
              className="flex flex-col rounded-md border border-red-200 bg-red-50 px-2.5 py-2 hover:border-red-400 dark:border-red-900 dark:bg-red-950/40 dark:hover:border-red-700"
            >
              <span className="text-xs font-semibold text-red-700 dark:text-red-300">{pupil.pupilName}</span>
              <span className="text-xs text-muted-foreground">{pupil.groupId}</span>
              <span className="mt-1 self-start rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-600 dark:bg-red-400/10 dark:text-red-400">
                {pupil.count} flag{pupil.count !== 1 ? "s" : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
