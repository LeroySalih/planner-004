"use client"

import { useEffect, useState } from "react"

type Objective = { id: string; title: string; criteria: Array<{ id: string; text: string }> }

/**
 * "By the end of this lesson": each learning objective with its success
 * criteria as checkboxes the pupil can tick for themselves. Ticks are a
 * personal checklist kept in this browser, not a mark.
 */
export function LessonObjectives({ storageKey, objectives }: { storageKey: string; objectives: Objective[] }) {
  const key = `lesson-checklist:${storageKey}`
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key)
      if (saved) setTicked(new Set(JSON.parse(saved) as string[]))
    } catch {
      // A blocked or corrupt store just starts unticked.
    }
  }, [key])

  const toggle = (id: string) =>
    setTicked((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        window.localStorage.setItem(key, JSON.stringify([...next]))
      } catch {
        // Not saved; the tick still shows for this visit.
      }
      return next
    })

  return (
    <section aria-labelledby="lesson-objectives-title" className="mt-10 rounded-xl border border-la-border bg-la-card p-6">
      <h2 id="lesson-objectives-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-la-muted">
        By the end of this lesson
      </h2>
      {/* Phones stack each row: the objective, then its criteria. */}
      <table className="mt-4 w-full border-collapse text-left max-sm:block">
        <thead className="max-sm:sr-only">
          <tr className="border-b border-la-border text-xs font-semibold uppercase tracking-[0.08em] text-la-muted">
            <th scope="col" className="w-[42%] pb-2 pr-6 font-semibold">Learning objective</th>
            <th scope="col" className="pb-2 font-semibold">Success criteria</th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {objectives.map((objective) => (
            <tr key={objective.id} className="border-b border-la-border last:border-b-0 max-sm:block max-sm:py-3">
              <th
                scope="row"
                className="py-3 pr-6 align-top font-semibold leading-snug text-la-ink max-sm:block max-sm:py-0"
              >
                {objective.title}
              </th>
              <td className="py-1.5 align-top max-sm:block max-sm:pt-1">
                {objective.criteria.length > 0 ? (
                  <ul>
                    {objective.criteria.map((criterion) => (
                      <li key={criterion.id}>
                        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-[15px] text-la-ink">
                          <input
                            type="checkbox"
                            checked={ticked.has(criterion.id)}
                            onChange={() => toggle(criterion.id)}
                            className="mt-0.5 h-5 w-5 flex-none cursor-pointer rounded border-la-input accent-[var(--la-green)]"
                          />
                          <span>{criterion.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-1.5 text-[15px] text-la-muted">No success criteria set.</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
