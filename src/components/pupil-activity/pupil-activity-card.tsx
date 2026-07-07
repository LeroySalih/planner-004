"use client"

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PupilActivityShell } from "./pupil-activity-shell"

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
  teacher?: { name: string; initials: string }
  releasedAt?: string
  score?: { mark: string; word: string }
  feedbackParagraphs?: ReactNode[]
  lockedNote?: string
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

/**
 * Presentational demo card used by the /tests/pupil-ui gallery. It maps a static
 * activity description to the shared PupilActivityShell, rendering the three
 * bespoke bodies (short answer / MCQ / file upload). The real pupil components
 * use PupilActivityShell directly with live data.
 */
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
  progressRatio,
  helperText,
  awaitingLabel,
  saveLabel = "Save answer",
  defaultFeedbackOpen = true,
  className,
}: PupilActivityCardProps) {
  const released = status === "released"
  const type = TYPE_PILL[body.kind]

  return (
    <PupilActivityShell
      question={question}
      activityIndex={activityIndex}
      activityTotal={activityTotal}
      typeLabel={type.label}
      typeGlyph={type.glyph}
      released={released}
      progressRatio={progressRatio}
      teacher={teacher}
      releasedAt={releasedAt}
      score={score}
      lockedNote={lockedNote}
      awaitingLabel={awaitingLabel}
      defaultFeedbackOpen={defaultFeedbackOpen}
      className={className}
      feedback={
        feedbackParagraphs && feedbackParagraphs.length > 0 ? (
          <>
            {feedbackParagraphs.map((paragraph, index) => (
              <p key={index} className="mb-[11px] last:mb-0">
                {paragraph}
              </p>
            ))}
          </>
        ) : undefined
      }
    >
      <ActivityBody body={body} released={released} helperText={helperText} saveLabel={saveLabel} />
    </PupilActivityShell>
  )
}

function ActivityBody({
  body,
  released,
  helperText,
  saveLabel,
}: {
  body: PupilActivityBody
  released: boolean
  helperText?: string
  saveLabel: string
}) {
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
        <InProgressActions helperText={helperText} saveLabel={saveLabel} />
      </>
    )
  }

  if (body.kind === "mcq") {
    return (
      <>
        <McqOptions options={body.options} released={released} />
        {released ? null : <InProgressActions helperText={helperText} saveLabel={saveLabel} />}
      </>
    )
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
      <InProgressActions helperText={helperText} saveLabel={saveLabel} />
    </div>
  )
}

function InProgressActions({ helperText, saveLabel }: { helperText?: string; saveLabel: string }) {
  return (
    <>
      {helperText ? <p className="mt-2 text-xs text-pa-muted-3">{helperText}</p> : null}
      <Button className="mt-4 h-auto w-full rounded-[14px] bg-pa-green py-3.5 text-[15px] font-bold text-white hover:bg-pa-green/90">
        {saveLabel}
      </Button>
    </>
  )
}

function McqOptions({
  options,
  released,
}: {
  options: PupilActivityMcqOption[]
  released: boolean
}) {
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
          className="h-[46px] w-[46px] flex-none rounded-[9px] border border-pa-thumb-border object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="h-[46px] w-[46px] flex-none rounded-[9px] border border-pa-thumb-border"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg,var(--color-pa-card-border) 0,var(--color-pa-card-border) 6px,var(--color-pa-field) 6px,var(--color-pa-field) 12px)",
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-pa-ink">
          {file?.name ?? "No file submitted"}
        </div>
        {file ? <div className="text-xs text-pa-muted-3">Submitted · {file.size}</div> : null}
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
