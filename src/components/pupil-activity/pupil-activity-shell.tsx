"use client"

import { useId, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { pupilActivityFontClass } from "./fonts"

export interface PupilActivityShellProps {
  question: string
  activityIndex: number
  activityTotal: number
  /** Type pill label, e.g. "Short answer". */
  typeLabel: string
  /** Optional glyph before the type label, e.g. "✎". */
  typeGlyph?: string
  /** Marked + feedback released → shows the 2A feedback bar; otherwise the amber awaiting row. */
  released: boolean
  /** Ring fill (0–1) for the in-progress progress badge. Defaults to index/total. */
  progressRatio?: number
  /** Display-only activities (text/image/video/section): no marking chrome at all. */
  hideMarking?: boolean

  // Released-state (2A feedback) data
  teacher?: { name: string; initials: string }
  releasedAt?: string
  score?: { mark: string; word?: string } | null
  feedback?: ReactNode
  lockedNote?: string
  defaultFeedbackOpen?: boolean

  // In-progress-state data
  awaitingLabel?: string

  className?: string
  children: ReactNode
}

/**
 * Warm Study card shell shared by every pupil activity type and by the teacher
 * preview. Renders the card, header (question + progress pill), type/status
 * pills, the 2A feedback bar (released) or amber awaiting row (in progress),
 * and the locked note. The type-specific body is passed as children.
 */
export function PupilActivityShell({
  question,
  activityIndex,
  activityTotal,
  typeLabel,
  typeGlyph,
  released,
  progressRatio,
  hideMarking = false,
  teacher,
  releasedAt,
  score,
  feedback,
  lockedNote,
  defaultFeedbackOpen = true,
  awaitingLabel = "Feedback not yet released",
  className,
  children,
}: PupilActivityShellProps) {
  const ratio =
    progressRatio ??
    (activityTotal > 0 ? Math.min(1, Math.max(0, activityIndex / activityTotal)) : 0)

  return (
    <section
      aria-label={`Activity ${activityIndex} of ${activityTotal}`}
      className={cn(
        pupilActivityFontClass,
        "font-[family-name:var(--font-pa-body)] w-full max-w-[540px]",
        "rounded-pa-card border border-pa-card-border bg-pa-card p-5",
        "shadow-[0_12px_40px_-28px_rgba(20,35,27,0.45)]",
        className,
      )}
    >
      {/* Header: question leads (left), progress pill on the right */}
      <div className="flex items-start justify-between gap-[18px] px-1.5 pt-0.5 pb-[18px]">
        {question ? (
          <h1 className="m-0 max-w-[330px] font-[family-name:var(--font-pa-head)] text-[23px] font-semibold leading-[1.24] text-pretty text-pa-ink">
            {question}
          </h1>
        ) : (
          <span />
        )}
        <div className="flex flex-none items-center gap-2.5 rounded-full border border-pa-card-border bg-pa-panel py-[5px] pl-3 pr-1.5">
          <span className="whitespace-nowrap text-xs font-semibold text-pa-muted-1">
            Activity {activityIndex} / {activityTotal}
          </span>
          {hideMarking ? null : released ? (
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-full bg-pa-green text-[13px] font-bold text-white"
            >
              ✓
            </span>
          ) : (
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-full"
              style={{
                background: `conic-gradient(var(--color-pa-green) 0turn ${ratio}turn, var(--color-pa-ring-track) ${ratio}turn 1turn)`,
              }}
            >
              <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-pa-panel font-[family-name:var(--font-pa-num)] text-[10px] font-bold text-pa-green">
                {activityIndex}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* White panel */}
      <div className="rounded-pa-panel bg-pa-panel p-6">
        <div className="mb-4 flex items-center justify-between gap-2.5">
          <Pill className="bg-pa-green-tint text-pa-green">
            {typeGlyph ? <span aria-hidden>{typeGlyph}</span> : null} {typeLabel}
          </Pill>
          {hideMarking ? null : released ? (
            <Pill className="bg-pa-green-tint text-[11.5px] text-pa-green-released">
              <span aria-hidden>●</span> Feedback released
            </Pill>
          ) : (
            <Pill className="bg-pa-amber-tint text-[11.5px] text-pa-amber">
              <span aria-hidden>●</span> In progress
            </Pill>
          )}
        </div>

        {children}

        {hideMarking ? null : released ? (
          <>
            <FeedbackToggle
              teacher={teacher}
              releasedAt={releasedAt}
              score={score}
              feedback={feedback}
              defaultOpen={defaultFeedbackOpen}
            />
            {lockedNote ? (
              <p className="mt-3 text-center text-xs text-pa-muted-3">{lockedNote}</p>
            ) : null}
          </>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-pa-box border border-pa-amber-tint bg-pa-amber-tint px-4 py-3 text-[13px] font-semibold text-pa-amber">
            <span aria-hidden className="h-2 w-2 flex-none rounded-full bg-pa-amber-dot" />
            {awaitingLabel}
          </div>
        )}
      </div>
    </section>
  )
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-[5px] text-[11px] font-bold uppercase tracking-[0.04em]",
        className,
      )}
    >
      {children}
    </span>
  )
}

function FeedbackToggle({
  teacher,
  releasedAt,
  score,
  feedback,
  defaultOpen,
}: {
  teacher?: { name: string; initials: string }
  releasedAt?: string
  score?: { mark: string; word?: string } | null
  feedback?: ReactNode
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="mt-4 flex w-full items-center gap-[11px] rounded-pa-box border border-pa-green-border bg-pa-green-panel px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pa-green"
      >
        <span
          aria-hidden
          className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-pa-green text-[13px] font-bold text-white"
        >
          {teacher?.initials ?? "MS"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-pa-ink">
            Feedback from {teacher?.name ?? "your teacher"}
          </span>
          {releasedAt ? (
            <span className="block text-xs text-pa-muted-2">{releasedAt}</span>
          ) : null}
        </span>
        {score ? (
          <span className="flex-none text-right">
            <span className="block font-[family-name:var(--font-pa-num)] text-[18px] font-bold leading-none text-pa-green">
              {score.mark}
            </span>
            {score.word ? (
              <span className="mt-0.5 block text-[11px] text-pa-muted-2">{score.word}</span>
            ) : null}
          </span>
        ) : null}
        <span className="flex-none whitespace-nowrap text-[11px] font-bold text-pa-green">
          {open ? "Hide feedback ▲" : "Show feedback ▼"}
        </span>
      </button>

      {open ? (
        <div
          id={bodyId}
          role="region"
          className="mt-2.5 rounded-pa-box border border-pa-green-border bg-pa-green-panel p-4 text-sm leading-[1.65] text-pa-prose [&_strong]:font-semibold [&_strong]:text-pa-ink"
        >
          {feedback ?? (
            <p className="text-pa-muted-2">No written feedback yet.</p>
          )}
        </div>
      ) : null}
    </>
  )
}
