import { z } from "zod"
import {
  DEFAULT_PRESENTATION_SECTIONS,
  PRESENTATION_SECTION_KEYS,
  type PresentationSectionKey,
} from "@/lib/pptx/section-selectors"

import {
  DATABASE_SECTION_KEYS,
  DEFAULT_DATABASE_SECTIONS,
  databaseNameKey,
  formatDatabaseSection,
  parseDatabaseSection,
  type DatabaseSectionSelector,
} from "@/lib/accdb/section-selectors"
import {
  defaultPowerPointAssessmentBody,
  practicalTypeConfig,
  type PracticalAssessmentType,
} from "@/lib/practical-assessment/types"
import type { PracticalUploadSlot, PracticalUploadSlotKind } from "@/types"

// Where a practical assessment question's evidence comes from (PowerPoint or
// database): its activity_questions.evidence, a list of sources, each naming
// one of the activity's upload slots (or a teacher's reference file). The
// marker sees only what its question's sources name. Each type takes only its
// own sources (practicalTypeConfig(type).sources).
//
// Pure: no database, no server-only, so the lesson editor can check a
// question as the teacher types it, and setAssessmentQuestions checks it
// again before saving.

export { DEFAULT_PRESENTATION_SECTIONS, PRESENTATION_SECTION_KEYS, type PresentationSectionKey }

export interface PresentationSectionSelector {
  key: PresentationSectionKey
  /** Only with key 'slides': the slide numbers (1-based) asked for. */
  slides?: number[]
}

/**
 * Parse one section selector: a key from PRESENTATION_SECTION_KEYS, or
 * `slides:3,6`. Null when it is not one.
 */
export function parsePresentationSection(selector: string): PresentationSectionSelector | null {
  const text = selector.replace(/\s+/g, "").toLowerCase()
  const some = /^slides:(\d+(?:,\d+)*)$/.exec(text)
  if (some) {
    const slides = some[1].split(",").map(Number)
    if (slides.some((n) => n < 1) || new Set(slides).size !== slides.length) return null
    return { key: "slides", slides }
  }
  return (PRESENTATION_SECTION_KEYS as readonly string[]).includes(text)
    ? { key: text as PresentationSectionKey }
    : null
}

/** A selector as it is stored: what isPresentationSectionSelector (src/lib/pptx/describe.ts) accepts. */
export function formatPresentationSection(selector: PresentationSectionSelector): string {
  return selector.slides ? `slides:${selector.slides.join(",")}` : selector.key
}

export const EVIDENCE_WANTS = ["screenshots", "text", "both"] as const

const slot = z.string().trim().min(1, "choose an upload slot")

const PresentationSourceSchema = z
  .object({
    source: z.literal("presentation"),
    slot,
    sections: z.array(z.string()).min(1, "sections lists none; leave it out for the default").optional(),
    required: z.boolean().optional(),
  })
  .strict()

const SlideImagesSourceSchema = z
  .object({
    source: z.literal("slide_images"),
    slot,
    slides: z.array(z.number().int("slides must be whole slide numbers").min(1, "slides are numbered from 1")).min(1, "slides lists none; leave it out for every slide").optional(),
  })
  .strict()

const FileSourceSchema = z
  .object({
    source: z.literal("file"),
    slot,
    required: z.boolean().optional(),
  })
  .strict()

const EvidenceSectionSourceSchema = z
  .object({
    source: z.literal("evidence_section"),
    slot,
    /** The heading in the evidence document. Absent: the question's label. */
    heading: z.string().trim().min(1, "heading is empty; leave it out to use the question's label").optional(),
    want: z.enum(EVIDENCE_WANTS),
    required: z.boolean().optional(),
  })
  .strict()

const DatabaseSourceSchema = z
  .object({
    source: z.literal("database"),
    slot,
    sections: z.array(z.string()).min(1, "sections lists none; leave it out for the default").optional(),
    required: z.boolean().optional(),
  })
  .strict()

const ReferenceFileSourceSchema = z
  .object({
    source: z.literal("reference_file"),
    /** An ordinary activity file (the teacher's material, not the pupil's work). */
    fileName: z.string().trim().min(1, "name the reference file"),
  })
  .strict()

export const QuestionEvidenceSchema = z.discriminatedUnion("source", [
  PresentationSourceSchema,
  SlideImagesSourceSchema,
  FileSourceSchema,
  EvidenceSectionSourceSchema,
  ReferenceFileSourceSchema,
  DatabaseSourceSchema,
])

export type QuestionEvidence = z.infer<typeof QuestionEvidenceSchema>
export type QuestionEvidenceSource = QuestionEvidence["source"]

/**
 * Every source any practical type takes, for parsing only: what a type
 * allows is practicalTypeConfig(type).sources, and every message lists that.
 */
export const QUESTION_EVIDENCE_SOURCES: readonly QuestionEvidenceSource[] = Object.freeze([
  "presentation",
  "slide_images",
  "file",
  "evidence_section",
  "reference_file",
  "database",
])

/** The slot kind each pupil-file source reads. */
export const SOURCE_SLOT_KIND: Readonly<Record<Exclude<QuestionEvidenceSource, "reference_file">, PracticalUploadSlotKind>> =
  Object.freeze({
    presentation: "pptx",
    slide_images: "pptx",
    file: "pdf",
    evidence_section: "docx",
    database: "accdb",
  })

const KIND_NAMES: Record<PracticalUploadSlotKind, string> = {
  pptx: "the presentation (pptx)",
  pdf: "a PDF",
  docx: "an evidence document (docx)",
  accdb: "the database (.accdb)",
}

/** The heading an evidence_section source looks for. */
export function evidenceHeading(source: { heading?: string }, questionLabel: string): string {
  return source.heading?.trim() || questionLabel.trim()
}

/** The sections a presentation source asks for, defaults applied. */
export function presentationSections(source: { sections?: string[] }): PresentationSectionSelector[] {
  if (!source.sections) return DEFAULT_PRESENTATION_SECTIONS.map((key) => ({ key }))
  return source.sections.flatMap((selector) => parsePresentationSection(selector) ?? [])
}

/** The sections a database source asks for, defaults applied (every part but the records and single queries). */
export function databaseSections(source: { sections?: string[] }): DatabaseSectionSelector[] {
  if (!source.sections) return DEFAULT_DATABASE_SECTIONS.map((key) => ({ key, name: null }))
  return source.sections.flatMap((selector) => parseDatabaseSection(selector) ?? [])
}

export interface QuestionEvidenceCheck {
  label: string
  /** 'teacher' questions are never sent, so they may have no sources. */
  marking?: string | null
  evidence: unknown
}

export interface QuestionEvidenceValidation {
  /** Readable sentences, one per problem. Empty when every question is valid. */
  errors: string[]
  /** Per question, in order: its sources as they are stored (canonical selectors). */
  evidence: QuestionEvidence[][]
}

/** Each source's fields, for "did you mean" on a misspelt one. */
const SOURCE_FIELDS: Record<QuestionEvidenceSource, readonly string[]> = {
  presentation: ["source", "slot", "sections", "required"],
  slide_images: ["source", "slot", "slides"],
  file: ["source", "slot", "required"],
  evidence_section: ["source", "slot", "heading", "want", "required"],
  reference_file: ["source", "fileName"],
  database: ["source", "slot", "sections", "required"],
}

const MISSING_FIELD: Record<string, string> = {
  slot: "choose an upload slot",
  want: "choose what to read: screenshots, text or both",
  fileName: "name the reference file",
}

const EXPECTED_FIELD: Record<string, string> = {
  slot: "slot must be the key of an upload slot",
  sections: "sections must be a list of sections",
  slides: "slides must be a list of slide numbers",
  required: "required must be true or false",
  heading: "heading must be text",
  want: "want must be screenshots, text or both",
  fileName: "fileName must be a file name",
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

function unknownField(key: string, fields: readonly string[]): string {
  const near = fields
    .map((field) => ({ field, distance: editDistance(key.toLowerCase(), field.toLowerCase()) }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance)[0]
  return near ? `unknown field '${key}' (did you mean '${near.field}'?)` : `unknown field '${key}'`
}

/** A source's first problem, in words a teacher can act on. */
function sourceIssueText(error: z.ZodError, raw: Record<string, unknown>, source: QuestionEvidenceSource): string {
  const issue = error.issues[0]
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => unknownField(key, SOURCE_FIELDS[source])).join("; ")
  }
  const field = String(issue.path[0] ?? "")
  if (field && raw[field] === undefined && MISSING_FIELD[field]) return MISSING_FIELD[field]
  if (issue.code === "invalid_type" || issue.code === "invalid_value") {
    return EXPECTED_FIELD[field] ?? `${field} is not valid`
  }
  return issue.message
}

function issueText(error: z.ZodError): string {
  const issue = error.issues[0]
  const field = issue.path.map(String).join(".")
  return field ? `${field} ${issue.message}` : issue.message
}

/** What a database source's selectors may be, for a message. */
const DATABASE_SECTION_LIST = `${DATABASE_SECTION_KEYS.filter((key) => key !== "query").join(", ")}, records:TABLE or query:NAME`

/**
 * Check every question's evidence against the activity's body (its upload
 * slots) and its practical type (the sources it takes). All questions are
 * checked together, so a problem anywhere is found before anything is saved.
 */
export function validateQuestionEvidence(
  questions: QuestionEvidenceCheck[],
  body: unknown,
  type: PracticalAssessmentType = "powerpoint-assessment",
): QuestionEvidenceValidation {
  const errors: string[] = []
  const evidence: QuestionEvidence[][] = []
  const config = practicalTypeConfig(type)
  const allowed = config.sources as readonly string[]
  const allowedList = config.sources.join(", ")

  const parsedBody = config.bodySchema.safeParse(body ?? {})
  const slots: PracticalUploadSlot[] = parsedBody.success ? (parsedBody.data as { uploadSlots: PracticalUploadSlot[] }).uploadSlots : []
  if (!parsedBody.success) {
    errors.push(`The activity's upload slots are not set up: ${issueText(parsedBody.error)}.`)
  }
  const slotByKey = new Map(slots.map((s) => [s.key, s]))
  const slotList = slots.map((s) => s.key).join(", ") || "none"

  for (const question of questions) {
    const label = question.label.trim()
    const sources: QuestionEvidence[] = []
    evidence.push(sources)

    if (!Array.isArray(question.evidence)) {
      errors.push(`Question "${label}": evidence must be a list of sources.`)
      continue
    }

    const headings = new Set<string>()
    question.evidence.forEach((raw, index) => {
      const where = `Question "${label}", evidence source ${index + 1}`
      const sourceName = raw && typeof raw === "object" ? (raw as { source?: unknown }).source : undefined
      if (typeof sourceName !== "string" || !allowed.includes(sourceName)) {
        // A source another practical type takes is named as such, except on
        // a PowerPoint assessment, whose messages predate the other types.
        const otherType = typeof sourceName === "string" && config.type !== "powerpoint-assessment"
          && (QUESTION_EVIDENCE_SOURCES as readonly string[]).includes(sourceName)
        errors.push(
          sourceName === undefined || sourceName === null
            ? `${where} has no source; choose one of ${allowedList}.`
            : otherType
              ? `${where} has the source ${JSON.stringify(sourceName)}, which a ${config.labelLower} does not take; use one of ${allowedList}.`
              : `${where} has an unknown source ${JSON.stringify(sourceName)}; use one of ${allowedList}.`,
        )
        return
      }
      const parsed = QuestionEvidenceSchema.safeParse(raw)
      if (!parsed.success) {
        errors.push(
          `${where} (${sourceName}): ${sourceIssueText(parsed.error, raw as Record<string, unknown>, sourceName as QuestionEvidenceSource)}.`,
        )
        return
      }
      const source = parsed.data

      if (source.source !== "reference_file") {
        const target = slotByKey.get(source.slot)
        if (!target) {
          errors.push(`${where} names the slot "${source.slot}", which is not one of this activity's upload slots (${slotList}).`)
          return
        }
        const kind = SOURCE_SLOT_KIND[source.source]
        if (target.kind !== kind) {
          errors.push(
            `${where} reads the slot "${source.slot}" as ${KIND_NAMES[kind]}, but that slot takes ${KIND_NAMES[target.kind]}.`,
          )
          return
        }
      }

      if (source.source === "presentation" && source.sections) {
        const canonical: string[] = []
        let slidesSelectors = 0
        for (const selector of source.sections) {
          const section = parsePresentationSection(selector)
          if (!section) {
            errors.push(
              `${where} asks for the section ${JSON.stringify(selector)}, which is not one; use ${PRESENTATION_SECTION_KEYS.join(", ")} or slides:N,N.`,
            )
            return
          }
          const text = formatPresentationSection(section)
          // One slides list per source, so the lesson editor (one box) shows it all.
          if (section.key === "slides" && ++slidesSelectors > 1) {
            errors.push(`${where} asks for slides more than once; use one slides list, e.g. slides:3,6.`)
            return
          }
          if (canonical.includes(text)) {
            errors.push(`${where} asks for the section "${text}" twice.`)
            return
          }
          canonical.push(text)
        }
        sources.push({ ...source, sections: canonical })
        return
      }

      if (source.source === "database" && source.sections) {
        const canonical: string[] = []
        const seen = new Set<string>()
        for (const selector of source.sections) {
          const section = parseDatabaseSection(selector)
          if (!section) {
            errors.push(
              `${where} asks for the section ${JSON.stringify(selector)}, which is not one; use ${DATABASE_SECTION_LIST}.`,
            )
            return
          }
          const text = formatDatabaseSection(section)
          // Access names ignore case, so records:OWNERS and records:owners are one table.
          const key = section.name === null ? section.key : `${section.key}:${databaseNameKey(section.name)}`
          if (seen.has(key)) {
            errors.push(`${where} asks for the section "${text}" twice.`)
            return
          }
          seen.add(key)
          canonical.push(text)
        }
        sources.push({ ...source, sections: canonical })
        return
      }

      if (source.source === "slide_images" && source.slides && new Set(source.slides).size !== source.slides.length) {
        errors.push(`${where} lists a slide twice.`)
        return
      }

      if (source.source === "evidence_section") {
        const heading = evidenceHeading(source, label)
        // As the evidence document reader matches headings (src/lib/docx/evidence.ts).
        const headingKey = heading.toLowerCase().replace(/[^a-z0-9]/g, "")
        if (!headingKey) {
          errors.push(`${where} (evidence_section): heading must contain a letter or digit.`)
          return
        }
        const key = `${source.slot}\u0000${headingKey}`
        if (headings.has(key)) {
          errors.push(`${where} reads the heading "${heading}" in the slot "${source.slot}" again; each heading is read once per question.`)
          return
        }
        headings.add(key)
      }

      sources.push(source)
    })

    if (question.marking !== "teacher" && !question.evidence.some((raw) => {
      const name = raw && typeof raw === "object" ? (raw as { source?: unknown }).source : undefined
      return typeof name === "string" && name !== "reference_file" && allowed.includes(name)
    })) {
      errors.push(
        `Question "${label}" has no evidence from the pupil's files, so the marker would see nothing to mark. Add a source, or mark it yourself.`,
      )
    }
  }

  return { errors, evidence }
}

export { defaultPowerPointAssessmentBody }

/** The upload slots a new activity of a practical type starts with. */
export function defaultPracticalBody(type: PracticalAssessmentType): { uploadSlots: PracticalUploadSlot[] } {
  return practicalTypeConfig(type).defaultBody()
}

/** A slot key from its label: lower-case letters, digits and hyphens. */
export function slotKeyFromLabel(label: string, taken: Iterable<string> = []): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "slot"
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n += 1) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`
  }
}

/** A PowerPoint assessment body's first problem as one sentence, or null when it parses. */
export function powerPointBodyProblem(body: unknown): string | null {
  return practicalBodyProblem(body, "powerpoint-assessment")
}

/** A practical assessment body's first problem as one sentence, or null when it parses. */
export function practicalBodyProblem(body: unknown, type: PracticalAssessmentType): string | null {
  const parsed = practicalTypeConfig(type).bodySchema.safeParse(body ?? {})
  if (parsed.success) return null
  const issue = parsed.error.issues[0]
  const [first, index, field] = issue.path
  if (first === "uploadSlots" && typeof index === "number") {
    const slot = (body as { uploadSlots?: Array<{ label?: unknown }> }).uploadSlots?.[index]
    const name = typeof slot?.label === "string" && slot.label.trim() ? `"${slot.label.trim()}"` : `${index + 1}`
    return `Upload slot ${name}${field ? ` (${String(field)})` : ""}: ${issue.message}.`
  }
  if (first === "uploadSlots") return `Upload slots: ${issue.message}.`
  return `${issue.path.map(String).join(".") || "Body"}: ${issue.message}.`
}
