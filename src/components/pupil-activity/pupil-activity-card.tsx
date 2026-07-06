"use client"

import { useId, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { pupilActivityFontClass } from "./fonts"

export type PupilActivityStatus = "released" | "in_progress"

export interface PupilActivityMcqOption {
  /** Key glyph shown in the square: a letter (A/B/C) or a check for the correct one. */
  key: string
  label: string
  /** Released: this is the pupil's (correct) answer — highlighted. */
  correct?: boolean
}

export type PupilActivityBody =
  | { kind: "short_answer"; answer?: string; placeholder?: string }
  | { kind: "mcq"; options: PupilActivityMcqOption[] }
  | {
      kind: "file_upload"
      file?: { name: string; size: string; thumbnailUrl?: string }
    }

export interface PupilActivityCardProps {
  question: string
  activityIndex: number
  activityTotal: number
  status: PupilActivityStatus
  body: PupilActivityBody
  // Released-state data
  teacher?: { name: string; initials: string }
  releasedAt?: string
  score?: { mark: string; word: string }
  feedbackParagraphs?: ReactNode[]
  lockedNote?: string
  // In-progress-state data
  progressRatio?: number
  helperText?: string
  awaitingLabel?: string
  saveLabel?: string
  defaultFeedbackOpen?: boolean
  className?: string
}

const TYPE_PILL: Record<PupilActivityBody["kind"], { glyph: string; label: string }> = {
  short_answer: { glyph: "✎", label: "Short answer" },
  mcq: { glyph: "◉", label: "Multiple choice" },
  file_upload: { glyph: "⬆", label: "File upload" },
}

export function PupilActivityCard({
  question,
  activityIndex,
  activityTotal,
  status,
  body,
  teacher,
  releasedAt,
  score,
  feedbackParagraphs,
  lockedNote,
  progressRatio = 0,
  helperText,
  awaitingLabel = "Feedback not yet released",
  saveLabel = "Save answer",
  defaultFeedbackOpen = true,
  className,
}: PupilActivityCardProps) {
  const released = status === "released"
  const type = TYPE_PILL[body.kind]

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
        <h1 className="m-0 max-w-[330px] font-[family-name:var(--font-pa-head)] text-[23px] font-semibold leading-[1.24] text-pretty text-pa-ink">
          {question}
        </h1>
        <div className="flex flex-none items-center gap-2.5 rounded-full border border-pa-card-border bg-white py-[5px] pl-3 pr-1.5">
          <span className="whitespace-nowrap text-xs font-semibold text-pa-muted-1">
            Activity {activityIndex} / {activityTotal}
          </span>
          {released ? (
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
                background: `conic-gradient(var(--color-pa-green) 0turn ${progressRatio}turn, #E1E7DC ${progressRatio}turn 1turn)`,
              }}
            >
              <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-white font-[family-name:var(--font-pa-num)] text-[10px] font-bold text-pa-green">
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
            <span aria-hidden>{type.glyph}</span> {type.label}
          </Pill>
          {released ? (
            <Pill className="bg-pa-green-tint text-[11.5px] text-[#3A7D53]">
              <span aria-hidden>●</span> Feedback released
            </Pill>
          ) : (
            <Pill className="bg-pa-amber-tint text-[11.5px] text-pa-amber">
              <span aria-hidden>●</span> In progress
            </Pill>
          )}
        </div>

        <ActivityBody body={body} released={released} />

        {released ? (
          <>
            <FeedbackToggle
              teacher={teacher}
              releasedAt={releasedAt}
              score={score}
              paragraphs={feedbackParagraphs ?? []}
              defaultOpen={defaultFeedbackOpen}
            />
            {lockedNote ? (
              <p className="mt-3 text-center text-xs text-pa-muted-3">{lockedNote}</p>
            ) : null}
          </>
        ) : (
          <InProgressFooter
            saveLabel={saveLabel}
            helperText={helperText}
            awaitingLabel={awaitingLabel}
          />
        )}
      </div>
    </section>
  )
}

function Pill({ className, children }: { className?: string; children: ReactNode }) {
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

function ActivityBody({ body, released }: { body: PupilActivityBody; released: boolean }) {
  if (body.kind === "short_answer") {
    if (released) {
      return (
        <div className="rounded-pa-box border-[1.5px] border-pa-field-border bg-pa-field px-4 py-3.5">
          <div className="mb-[5px] text-[11px] font-bold uppercase tracking-[0.06em] text-pa-muted-3">
            Your answer
          </div>
          <div className="text-[15px] text-pa-ink">{body.answer}</div>
        </div>
      )
    }
    return (
      <>
        <textarea
          defaultValue={body.answer}
          placeholder={body.placeholder ?? "Type your short answer…"}
          className="min-h-[96px] w-full resize-none rounded-pa-box border-[1.5px] border-pa-field-border bg-pa-field px-4 py-3.5 font-[family-name:var(--font-pa-body)] text-[15px] text-pa-ink outline-none placeholder:text-pa-muted-3 focus-visible:border-pa-green"
        />
      </>
    )
  }

  if (body.kind === "mcq") {
    return <McqOptions options={body.options} released={released} />
  }

  // file_upload
  if (released) {
    return <FileChip file={body.file} />
  }
  return (
    <div className="space-y-3">
      <div className="rounded-pa-box border-2 border-dashed border-pa-field-border bg-pa-field p-6 text-center">
        <div className="text-2xl leading-none text-pa-muted-3" aria-hidden>
          ⬆
        </div>
        <p className="mt-2 text-sm font-semibold text-pa-ink">Drag a file here or browse</p>
        <p className="mt-1 text-xs text-pa-muted-3">PNG, JPG or PDF · up to 10 MB</p>
      </div>
      {body.file ? <FileChip file={body.file} /> : null}
    </div>
  )
}

function McqOptions({
  options,
  released,
}: {
  options: PupilActivityMcqOption[]
  released: boolean
}) {
  // In-progress MCQs are selectable (review-only, no persistence).
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-[11px]" role={released ? "list" : "radiogroup"}>
      {options.map((option, index) => {
        const isCorrect = released && option.correct
        const isSelected = !released && selected === index
        const common =
          "flex items-center gap-[13px] rounded-pa-opt border-[1.5px] px-4 py-[15px] text-left"

        const inner = (
          <>
            <span
              aria-hidden
              className={cn(
                "grid h-6 w-6 flex-none place-items-center rounded-lg text-xs font-bold",
                isCorrect
                  ? "border-none bg-pa-green text-sm text-white"
                  : isSelected
                    ? "border-2 border-pa-green text-pa-green"
                    : "border-2 border-pa-key-border text-pa-key-text",
              )}
            >
              {option.key}
            </span>
            <span
              className={cn(
                "text-[15.5px] text-pa-ink",
                (isCorrect || isSelected) && "font-semibold",
              )}
            >
              {option.label}
            </span>
            {isCorrect ? (
              <span className="ml-auto text-[11.5px] font-bold text-pa-green">
                Your answer · correct
              </span>
            ) : null}
          </>
        )

        if (released) {
          return (
            <div
              key={option.key + index}
              role="listitem"
              className={cn(
                common,
                isCorrect
                  ? "border-2 border-pa-green bg-pa-green-tint"
                  : "border-pa-field-border bg-pa-field",
              )}
            >
              {inner}
            </div>
          )
        }

        return (
          <button
            key={option.key + index}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => setSelected(index)}
            className={cn(
              common,
              "cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pa-green",
              isSelected
                ? "border-2 border-pa-green bg-pa-green-tint"
                : "border-pa-field-border bg-pa-field hover:border-pa-green/50",
            )}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}

function FileChip({ file }: { file?: { name: string; size: string; thumbnailUrl?: string } }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-pa-field-border bg-pa-field px-[13px] py-[11px]">
      {file?.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.thumbnailUrl}
          alt=""
          className="h-[46px] w-[46px] flex-none rounded-[9px] border border-[#DCE2D6] object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="h-[46px] w-[46px] flex-none rounded-[9px] border border-[#DCE2D6]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg,#E4EADF 0,#E4EADF 6px,#EEF2EA 6px,#EEF2EA 12px)",
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-pa-ink">
          {file?.name ?? "No file submitted"}
        </div>
        {file ? (
          <div className="text-xs text-pa-muted-3">Submitted · {file.size}</div>
        ) : null}
      </div>
      {file ? (
        <button
          type="button"
          className="flex-none font-[family-name:var(--font-pa-body)] text-xs font-semibold text-pa-green"
        >
          View
        </button>
      ) : null}
    </div>
  )
}

function FeedbackToggle({
  teacher,
  releasedAt,
  score,
  paragraphs,
  defaultOpen,
}: {
  teacher?: { name: string; initials: string }
  releasedAt?: string
  score?: { mark: string; word: string }
  paragraphs: ReactNode[]
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
            <span className="mt-0.5 block text-[11px] text-pa-muted-2">{score.word}</span>
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
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="mb-[11px] last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}
    </>
  )
}

function InProgressFooter({
  saveLabel,
  helperText,
  awaitingLabel,
}: {
  saveLabel: string
  helperText?: string
  awaitingLabel: string
}) {
  return (
    <>
      {helperText ? <p className="mt-2 text-xs text-pa-muted-3">{helperText}</p> : null}
      <Button className="mt-4 h-auto w-full rounded-[14px] bg-pa-green py-3.5 text-[15px] font-bold text-white hover:bg-pa-green/90">
        {saveLabel}
      </Button>
      <div className="mt-3 flex items-center gap-2 rounded-pa-box border border-pa-amber-tint bg-pa-amber-tint px-4 py-3 text-[13px] font-semibold text-pa-amber">
        <span aria-hidden className="h-2 w-2 flex-none rounded-full bg-pa-amber-dot" />
        {awaitingLabel}
      </div>
    </>
  )
}
