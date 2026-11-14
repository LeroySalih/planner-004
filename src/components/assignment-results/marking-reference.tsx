/**
 * Pieces shared by the teacher's per-criterion marking cards (question-marked
 * activities and short-text questions): what the answer is marked against,
 * a compact label per mark when there are several, and the marker's reason
 * for a mark short of full. Teacher views only.
 */

/**
 * What the answer is marked against, first that exists: the mark scheme, the
 * model answer, then the success criteria.
 */
export function MarkedAgainst({
  markScheme,
  modelAnswer,
  criteria,
}: {
  markScheme: string | null
  modelAnswer?: string | null
  criteria: string[]
}) {
  const scheme = markScheme?.trim()
  const model = modelAnswer?.trim()
  const listed = criteria.map((c) => c.trim()).filter(Boolean)
  const [label, body] = scheme
    ? ["Mark scheme", <p key="s" className="whitespace-pre-line text-xs text-foreground">{scheme}</p>]
    : model
      ? ["Model answer", <p key="m" className="whitespace-pre-line text-xs text-foreground">{model}</p>]
      : listed.length > 0
        ? [
            "Success criteria",
            <ul key="c" className="list-disc space-y-0.5 pl-4 text-xs text-foreground">
              {listed.map((text, index) => (
                <li key={index} className="whitespace-pre-line">{text}</li>
              ))}
            </ul>,
          ]
        : ["Mark scheme", <p key="n" className="text-xs text-muted-foreground">No mark scheme</p>]
  return (
    <div className="mt-2 rounded border border-border/60 bg-muted/30 px-2 py-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {body}
    </div>
  )
}

/** "Mark 1 of 2 (0–1)", with the criterion in a tooltip; no label for a single mark. */
export function MarkRowLabel({
  index,
  count,
  max,
  description,
}: {
  index: number
  count: number
  max: number
  description: string | null
}) {
  // A spacer keeps the row's mark at the right.
  if (count <= 1) return <span className="flex-1" />
  return (
    <p className="flex-1 text-xs text-muted-foreground" title={description?.trim() || undefined}>
      Mark {index + 1} of {count} (0–{max})
    </p>
  )
}

/** The marker's reason for a mark short of full, set out to be read. */
export function MarkerReason({
  whyNotAwarded,
  howToImprove,
}: {
  whyNotAwarded: string | null
  howToImprove?: string | null
}) {
  if (!whyNotAwarded && !howToImprove) return null
  return (
    <div className="mt-1 space-y-1 rounded border border-border/60 bg-muted/40 px-2 py-1 text-xs text-foreground">
      {whyNotAwarded ? (
        <p className="whitespace-pre-line">
          <span className="font-semibold">Why not awarded:</span> {whyNotAwarded}
        </p>
      ) : null}
      {howToImprove ? (
        <p className="whitespace-pre-line">
          <span className="font-semibold">To improve:</span> {howToImprove}
        </p>
      ) : null}
    </div>
  )
}
