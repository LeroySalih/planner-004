"use client"

import { Plus, Trash2 } from "lucide-react"

import {
  DEFAULT_PRESENTATION_SECTIONS,
  EVIDENCE_WANTS,
  PRESENTATION_SECTION_KEYS,
  QUESTION_EVIDENCE_SOURCES,
  SOURCE_SLOT_KIND,
  parsePresentationSection,
  type PresentationSectionKey,
  type QuestionEvidence,
  type QuestionEvidenceSource,
} from "@/lib/powerpoint-assessment/evidence-spec"
import type { PowerPointUploadSlot } from "@/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

// One PowerPoint assessment question's evidence sources: where the marker's
// evidence for it comes from. The draft keeps every field of every source
// type so switching type does not lose what was typed; fromDraftSources
// turns it into what is stored (src/lib/powerpoint-assessment/evidence-spec.ts),
// which validateQuestionEvidence then checks.

export interface DraftEvidenceSource {
  id: string
  source: QuestionEvidenceSource
  slot: string
  /** presentation: the section keys ticked. */
  sections: PresentationSectionKey[]
  /** presentation: "3, 6" turns the Slides section into slides:3,6. */
  onlySlides: string
  /** slide_images: the slides to picture; empty for every slide. */
  slides: string
  heading: string
  want: (typeof EVIDENCE_WANTS)[number]
  required: boolean
  fileName: string
}

export const SOURCE_LABELS: Record<QuestionEvidenceSource, string> = {
  presentation: "Presentation report",
  slide_images: "Slide pictures",
  file: "Whole PDF",
  evidence_section: "Evidence document section",
  reference_file: "Teacher's reference file",
}

const SOURCE_HINTS: Record<QuestionEvidenceSource, string> = {
  presentation: "What the presentation's settings, masters and slides say, read from the pupil's .pptx.",
  slide_images: "Pictures of the pupil's slides as PowerPoint would show them, for visual judgements.",
  file: "The pupil's PDF printout, sent whole.",
  evidence_section: "What the pupil put under a heading in their evidence document.",
  reference_file: "The text of one of this activity's files (your material, not the pupil's work).",
}

const SECTION_LABELS: Record<PresentationSectionKey, string> = {
  presentation: "Presentation settings",
  master: "Slide masters",
  layouts: "Layout masters",
  slides: "Slides",
  "action-buttons": "Action buttons",
  notes: "Notes and handout masters",
  "supplied-images": "Supplied images",
  media: "Media",
  warnings: "Warnings",
}

const WANT_LABELS: Record<(typeof EVIDENCE_WANTS)[number], string> = {
  screenshots: "Screenshots",
  text: "Typed text",
  both: "Screenshots and text",
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `e-${Math.random().toString(36).slice(2, 10)}`
}

function compatibleSlots(source: QuestionEvidenceSource, slots: PowerPointUploadSlot[]) {
  if (source === "reference_file") return []
  return slots.filter((slot) => slot.kind === SOURCE_SLOT_KIND[source])
}

export function newDraftSource(
  source: QuestionEvidenceSource,
  slots: PowerPointUploadSlot[],
  referenceFiles: string[] = [],
): DraftEvidenceSource {
  return {
    id: newId(),
    source,
    slot: compatibleSlots(source, slots)[0]?.key ?? "",
    sections: [...DEFAULT_PRESENTATION_SECTIONS],
    onlySlides: "",
    slides: "",
    heading: "",
    want: "screenshots",
    required: false,
    fileName: referenceFiles[0] ?? "",
  }
}

export function toDraftSources(evidence: QuestionEvidence[]): DraftEvidenceSource[] {
  return evidence.map((stored) => {
    const draft = newDraftSource(stored.source, [])
    if (stored.source === "reference_file") return { ...draft, fileName: stored.fileName }
    draft.slot = stored.slot
    if (stored.source === "presentation") {
      if (stored.sections) {
        // The store keeps one slides list per source, but an older row may
        // hold several: their slides are joined into one list, and a plain
        // "slides" (every slide) covers them all, so nothing asked for is lost.
        const sections: PresentationSectionKey[] = []
        const onlySlides: number[] = []
        let everySlide = false
        for (const selector of stored.sections) {
          const parsed = parsePresentationSection(selector)
          if (!parsed) continue
          if (!sections.includes(parsed.key)) sections.push(parsed.key)
          if (parsed.key !== "slides") continue
          if (!parsed.slides) everySlide = true
          else for (const slide of parsed.slides) if (!onlySlides.includes(slide)) onlySlides.push(slide)
        }
        draft.sections = sections
        draft.onlySlides = everySlide ? "" : onlySlides.sort((a, b) => a - b).join(", ")
      }
      draft.required = stored.required === true
    } else if (stored.source === "slide_images") {
      draft.slides = stored.slides?.join(", ") ?? ""
    } else if (stored.source === "file") {
      draft.required = stored.required === true
    } else if (stored.source === "evidence_section") {
      draft.heading = stored.heading ?? ""
      draft.want = stored.want
      draft.required = stored.required === true
    }
    return draft
  })
}

/** "3, 6" as slide numbers; the raw tokens when any is not a whole number, so the check names the problem. */
function slideList(text: string): Array<number | string> {
  const tokens = text.split(/[\s,]+/).filter(Boolean)
  return tokens.every((token) => /^\d+$/.test(token)) ? tokens.map(Number) : tokens
}

/** The sources as they are stored. Defaults are left out, as the store does. */
export function fromDraftSources(drafts: DraftEvidenceSource[], questionLabel: string): unknown[] {
  return drafts.map((draft) => {
    switch (draft.source) {
      case "presentation": {
        const only = draft.onlySlides.trim()
        const sections = PRESENTATION_SECTION_KEYS.filter((key) => draft.sections.includes(key)).map((key) =>
          key === "slides" && only ? `slides:${only.replace(/\s+/g, "")}` : key,
        )
        if (only && !draft.sections.includes("slides")) sections.push(`slides:${only.replace(/\s+/g, "")}`)
        const isDefault =
          !only &&
          sections.length === DEFAULT_PRESENTATION_SECTIONS.length &&
          DEFAULT_PRESENTATION_SECTIONS.every((key) => sections.includes(key))
        return {
          source: "presentation",
          slot: draft.slot,
          ...(isDefault ? {} : { sections }),
          ...(draft.required ? { required: true } : {}),
        }
      }
      case "slide_images": {
        const slides = draft.slides.trim() ? slideList(draft.slides) : null
        return { source: "slide_images", slot: draft.slot, ...(slides ? { slides } : {}) }
      }
      case "file":
        return { source: "file", slot: draft.slot, ...(draft.required ? { required: true } : {}) }
      case "evidence_section": {
        const heading = draft.heading.trim()
        return {
          source: "evidence_section",
          slot: draft.slot,
          ...(heading && heading !== questionLabel.trim() ? { heading } : {}),
          want: draft.want,
          ...(draft.required ? { required: true } : {}),
        }
      }
      case "reference_file":
        return { source: "reference_file", fileName: draft.fileName }
    }
  })
}

interface QuestionEvidenceEditorProps {
  questionKey: string
  questionLabel: string
  sources: DraftEvidenceSource[]
  slots: PowerPointUploadSlot[]
  /** The activity's own files, for reference_file. */
  referenceFiles: string[]
  disabled: boolean
  onChange: (sources: DraftEvidenceSource[]) => void
}

export function QuestionEvidenceEditor({
  questionKey,
  questionLabel,
  sources,
  slots,
  referenceFiles,
  disabled,
  onChange,
}: QuestionEvidenceEditorProps) {
  const update = (id: string, patch: Partial<DraftEvidenceSource>) =>
    onChange(sources.map((source) => (source.id === id ? { ...source, ...patch } : source)))
  const remove = (id: string) => onChange(sources.filter((source) => source.id !== id))
  const add = () => onChange([...sources, newDraftSource("presentation", slots, referenceFiles)])
  const label = questionLabel.trim() || "this question"

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">Evidence the marker sees for {label}</Label>
        <Button type="button" size="sm" variant="ghost" onClick={add} disabled={disabled}>
          <Plus className="mr-1 h-4 w-4" /> Add source
        </Button>
      </div>
      {sources.length === 0 ? (
        <p className="text-xs text-muted-foreground">No evidence yet: the marker would see nothing for this question.</p>
      ) : null}
      <ul className="space-y-2">
        {sources.map((source, index) => {
          const id = `${questionKey}-${source.id}`
          const slotOptions = compatibleSlots(source.source, slots)
          const slotMissing = source.source !== "reference_file" && source.slot && !slotOptions.some((s) => s.key === source.slot)
          return (
            <li key={source.id} className="space-y-2 rounded-md border border-border bg-muted/10 p-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground" htmlFor={`${id}-source`}>
                    Source {index + 1}
                  </Label>
                  <Select
                    value={source.source}
                    onValueChange={(value) => {
                      const next = value as QuestionEvidenceSource
                      const options = compatibleSlots(next, slots)
                      update(source.id, {
                        source: next,
                        slot: options.some((s) => s.key === source.slot) ? source.slot : options[0]?.key ?? "",
                        fileName: source.fileName || referenceFiles[0] || "",
                      })
                    }}
                    disabled={disabled}
                  >
                    <SelectTrigger id={`${id}-source`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUESTION_EVIDENCE_SOURCES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {SOURCE_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {source.source === "reference_file" ? (
                  <div className="min-w-[12rem] flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground" htmlFor={`${id}-file`}>
                      File
                    </Label>
                    <Select
                      value={source.fileName || undefined}
                      onValueChange={(value) => update(source.id, { fileName: value })}
                      disabled={disabled}
                    >
                      <SelectTrigger id={`${id}-file`}>
                        <SelectValue placeholder={referenceFiles.length ? "Choose a file" : "Upload a file to the activity first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {referenceFiles.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                        {source.fileName && !referenceFiles.includes(source.fileName) ? (
                          <SelectItem value={source.fileName}>{source.fileName} (missing)</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="min-w-[12rem] flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground" htmlFor={`${id}-slot`}>
                      Upload slot
                    </Label>
                    <Select
                      value={source.slot || undefined}
                      onValueChange={(value) => update(source.id, { slot: value })}
                      disabled={disabled}
                    >
                      <SelectTrigger id={`${id}-slot`}>
                        <SelectValue
                          placeholder={slotOptions.length ? "Choose a slot" : `No ${SOURCE_SLOT_KIND[source.source]} slot`}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {slotOptions.map((slot) => (
                          <SelectItem key={slot.key} value={slot.key}>
                            {slot.label} ({slot.kind})
                          </SelectItem>
                        ))}
                        {slotMissing ? <SelectItem value={source.slot}>{source.slot} (not a slot of this kind)</SelectItem> : null}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove evidence source ${index + 1}`}
                  disabled={disabled}
                  onClick={() => remove(source.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{SOURCE_HINTS[source.source]}</p>

              {source.source === "presentation" ? (
                <div className="space-y-2">
                  <div className="grid gap-1 sm:grid-cols-2">
                    {PRESENTATION_SECTION_KEYS.map((key) => (
                      <label key={key} className="flex items-center gap-2 text-xs text-foreground">
                        <Checkbox
                          checked={source.sections.includes(key)}
                          onCheckedChange={(checked) =>
                            update(source.id, {
                              sections: checked
                                ? [...source.sections, key]
                                : source.sections.filter((section) => section !== key),
                            })
                          }
                          disabled={disabled}
                        />
                        {SECTION_LABELS[key]}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs text-muted-foreground" htmlFor={`${id}-only`}>
                      Only slides
                    </Label>
                    <Input
                      id={`${id}-only`}
                      className="h-8 w-40"
                      placeholder="e.g. 3, 6"
                      value={source.onlySlides}
                      onChange={(event) => update(source.id, { onlySlides: event.target.value })}
                      disabled={disabled}
                    />
                    <span className="text-xs text-muted-foreground">Leave empty for every slide.</span>
                  </div>
                </div>
              ) : null}

              {source.source === "slide_images" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs text-muted-foreground" htmlFor={`${id}-slides`}>
                    Slides
                  </Label>
                  <Input
                    id={`${id}-slides`}
                    className="h-8 w-40"
                    placeholder="e.g. 2, 5"
                    value={source.slides}
                    onChange={(event) => update(source.id, { slides: event.target.value })}
                    disabled={disabled}
                  />
                  <span className="text-xs text-muted-foreground">Leave empty for every slide.</span>
                </div>
              ) : null}

              {source.source === "evidence_section" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground" htmlFor={`${id}-heading`}>
                      Heading in the document
                    </Label>
                    <Input
                      id={`${id}-heading`}
                      className="h-8"
                      placeholder={questionLabel.trim() || "The question's label"}
                      value={source.heading}
                      onChange={(event) => update(source.id, { heading: event.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground" htmlFor={`${id}-want`}>
                      Read
                    </Label>
                    <Select
                      value={source.want}
                      onValueChange={(value) => update(source.id, { want: value as DraftEvidenceSource["want"] })}
                      disabled={disabled}
                    >
                      <SelectTrigger id={`${id}-want`} className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVIDENCE_WANTS.map((want) => (
                          <SelectItem key={want} value={want}>
                            {WANT_LABELS[want]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              {source.source === "presentation" || source.source === "file" || source.source === "evidence_section" ? (
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Switch
                    checked={source.required}
                    onCheckedChange={(checked) => update(source.id, { required: checked })}
                    disabled={disabled}
                  />
                  Required: with nothing here the question scores 0 (&ldquo;No answer submitted&rdquo;)
                </label>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
