import type { z } from "zod"

import type { QuestionEvidenceSource } from "@/lib/powerpoint-assessment/evidence-spec"
import { normalizeActivityType } from "@/dino.config"
import {
  DATABASE_UPLOAD_SLOT_KINDS,
  DatabaseAssessmentActivityBodySchema,
  POWERPOINT_UPLOAD_SLOT_KINDS,
  PowerPointAssessmentActivityBodySchema,
  type PowerPointUploadSlot,
  type PracticalUploadSlot,
  type PracticalUploadSlotKind,
} from "@/types"

// The practical assessment types and what differs between them. The files,
// slots, hand-in, reopen, read/mark jobs, results, pupil view, feedback and
// MCP code in src/lib/powerpoint-assessment/ serve every practical type and
// read their per-type data from here; the reader and marker branch on slot
// kind, not type. The marking texts are server-side, in marking.ts.
//
// Pure: no database, no server-only, so the lesson editor can use it.

/** One of PRACTICAL_ASSESSMENT_TYPES in src/dino.config.ts. */
export type PracticalAssessmentType = "powerpoint-assessment" | "database-assessment"

export interface PracticalTypeConfig {
  type: PracticalAssessmentType
  /** "PowerPoint assessment", as a sentence starts or a heading. */
  label: string
  /** "PowerPoint assessment", mid-sentence. */
  labelLower: string
  bodySchema: z.ZodTypeAny
  /** The slot kinds this type accepts. */
  slotKinds: readonly PracticalUploadSlotKind[]
  /** The main file's kind: exactly one slot has it, and it is required. */
  mainKind: PracticalUploadSlotKind
  /** The evidence sources a question of this type may use. */
  sources: readonly QuestionEvidenceSource[]
  /** The body a new activity of this type starts with. */
  defaultBody(): { uploadSlots: PracticalUploadSlot[] }
  /** Whether the task supplies images the reader recognises (practical_supplied_images). */
  hasSuppliedImages: boolean
  /** Whether a pupil's main file is compared with a starting database (body_data.startingDatabaseFile). */
  hasStartingDatabase: boolean
}

/**
 * The upload slots a new PowerPoint assessment starts with: the presentation
 * alone. Here rather than in the evidence spec (which re-exports it), so the
 * evidence spec can read this registry without an import cycle.
 */
export function defaultPowerPointAssessmentBody(): { uploadSlots: PowerPointUploadSlot[] } {
  return { uploadSlots: [{ key: "presentation", label: "Presentation", kind: "pptx", required: true }] }
}

/** The body a new database assessment starts with: the database and the evidence document. */
export function defaultDatabaseAssessmentBody(): { uploadSlots: PracticalUploadSlot[] } {
  return {
    uploadSlots: [
      { key: "database", label: "Database", kind: "accdb", required: true },
      { key: "evidence", label: "Evidence document", kind: "docx", required: true },
    ],
  }
}

export const PRACTICAL_TYPE_CONFIGS: Readonly<Record<PracticalAssessmentType, PracticalTypeConfig>> = Object.freeze({
  "powerpoint-assessment": {
    type: "powerpoint-assessment",
    label: "PowerPoint assessment",
    labelLower: "PowerPoint assessment",
    bodySchema: PowerPointAssessmentActivityBodySchema,
    slotKinds: POWERPOINT_UPLOAD_SLOT_KINDS,
    mainKind: "pptx",
    sources: Object.freeze(["presentation", "slide_images", "file", "evidence_section", "reference_file"] as const),
    defaultBody: defaultPowerPointAssessmentBody,
    hasSuppliedImages: true,
    hasStartingDatabase: false,
  },
  "database-assessment": {
    type: "database-assessment",
    label: "Database assessment",
    labelLower: "database assessment",
    bodySchema: DatabaseAssessmentActivityBodySchema,
    slotKinds: DATABASE_UPLOAD_SLOT_KINDS,
    mainKind: "accdb",
    sources: Object.freeze(["database", "evidence_section", "file", "reference_file"] as const),
    defaultBody: defaultDatabaseAssessmentBody,
    hasSuppliedImages: false,
    hasStartingDatabase: true,
  },
})

/** The configuration of a practical type. Throws for any other type. */
export function practicalTypeConfig(type: string | null | undefined): PracticalTypeConfig {
  const normalized = normalizeActivityType(type)
  const config = (PRACTICAL_TYPE_CONFIGS as Record<string, PracticalTypeConfig | undefined>)[normalized]
  if (!config) throw new Error(`"${type}" is not a practical assessment type`)
  return config
}

/** The body_data schema of a practical type. Throws for any other type. */
export function practicalBodySchema(type: string | null | undefined): z.ZodTypeAny {
  return practicalTypeConfig(type).bodySchema
}
