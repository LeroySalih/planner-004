import "server-only"

import { query } from "@/lib/db"
import { isPowerPointAssessmentType } from "@/dino.config"
import { checkEvidenceTemplate } from "@/lib/docx/evidence"
import { OfficeFileError } from "@/lib/pptx/errors"
import { evidenceHeading } from "@/lib/powerpoint-assessment/evidence-spec"
import { readActivityFile } from "@/lib/powerpoint-assessment/reading"
import { PowerPointAssessmentActivityBodySchema } from "@/types"

// The lesson editor's PowerPoint assessment setup beyond the body and the
// questions: checking the evidence template against the questions' headings,
// and renaming a supplied image.

async function readActivity(activityId: string) {
  const { rows } = await query<{ lesson_id: string; type: string | null; body_data: unknown }>(
    "select lesson_id, type, body_data from activities where activity_id = $1",
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error("Activity not found.")
  if (!isPowerPointAssessmentType(row.type)) throw new Error("This activity is not a PowerPoint assessment.")
  return row
}

/** The headings the questions' evidence_section sources read, in question order, each once. */
export async function readEvidenceHeadings(activityId: string): Promise<string[]> {
  const { rows } = await query<{ label: string; evidence: unknown }>(
    "select label, evidence from activity_questions where activity_id = $1 order by position, label",
    [activityId],
  )
  const headings: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!Array.isArray(row.evidence)) continue
    for (const source of row.evidence as Array<{ source?: string; heading?: string }>) {
      if (source?.source !== "evidence_section") continue
      const heading = evidenceHeading(source, row.label)
      const key = heading.toLowerCase().replace(/[^a-z0-9]/g, "")
      if (!key || seen.has(key)) continue
      seen.add(key)
      headings.push(heading)
    }
  }
  return headings
}

export type EvidenceTemplateCheck = {
  fileName: string
  /** The headings the questions read. */
  headings: string[]
  /** Of those, the ones the template does not have: a pupil's copy of it would not have them either. */
  missingHeadings: string[]
}

/**
 * Check an activity file as the evidence template (the stored choice when no
 * name is given): read as a pupil's copy of it would be, which of the
 * questions' evidence headings it does not have.
 */
export async function checkActivityEvidenceTemplate(activityId: string, fileName?: string | null): Promise<EvidenceTemplateCheck> {
  const activity = await readActivity(activityId)
  const body = PowerPointAssessmentActivityBodySchema.safeParse(activity.body_data ?? {})
  const name = (fileName ?? (body.success ? body.data.evidenceTemplateFile : undefined) ?? "").trim()
  if (!name) throw new Error("Choose the evidence template first.")
  if (!/\.docx$/i.test(name) || /[\\/]/.test(name)) throw new Error("The evidence template must be one of this activity's .docx files.")
  const bytes = await readActivityFile(activity.lesson_id, activityId, name)
  if (!bytes) throw new Error(`This activity has no file called "${name}". Upload it to the activity's files first.`)
  const headings = await readEvidenceHeadings(activityId)
  try {
    const missingHeadings = headings.length > 0 ? await checkEvidenceTemplate(bytes, headings) : []
    return { fileName: name, headings, missingHeadings }
  } catch (error) {
    if (error instanceof OfficeFileError) throw new Error(`${name}: ${error.message}`)
    throw error
  }
}

/** A supplied image's name: as the upload takes it (non-empty, at most 200 characters, no control characters or slashes). */
function imageName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("The image needs a name.")
  if (trimmed.length > 200) throw new Error("The image's name must be at most 200 characters.")
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error("The image's name has a control character in it.")
  if (/[\\/]/.test(trimmed)) throw new Error("The image's name may not contain / or \\.")
  return trimmed
}

/**
 * Rename a supplied image. The reader names an image in a pupil's slides by
 * this name, so the new one must not be another image's. Its stored file
 * keeps its generated name.
 */
export async function renameSuppliedImage(activityId: string, from: string, to: string): Promise<void> {
  await readActivity(activityId)
  const next = imageName(to)
  if (next === from) return
  const { rows: clash } = await query("select 1 from practical_supplied_images where activity_id = $1 and name = $2", [
    activityId,
    next,
  ])
  if (clash.length > 0) throw new Error(`Another supplied image is already called "${next}".`)
  const { rowCount } = await query("update practical_supplied_images set name = $3 where activity_id = $1 and name = $2", [
    activityId,
    from,
    next,
  ])
  if (!rowCount) throw new Error(`No supplied image "${from}".`)
}
