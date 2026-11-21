import "server-only"

import { query } from "@/lib/db"
import { isPracticalAssessmentType } from "@/dino.config"
import { updateActivity } from "@/lib/mcp/activities"
import {
  checkActivityEvidenceTemplate,
  checkActivityStartingDatabase,
  type EvidenceTemplateCheck,
  type StartingDatabaseCheck,
} from "@/lib/powerpoint-assessment/editor"
import { LESSONS_BUCKET, checkSlotFile } from "@/lib/powerpoint-assessment/files"
import { practicalTypeConfig } from "@/lib/practical-assessment/types"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

// A practical (PowerPoint or database) assessment's own activity files, sent
// through create_assessment_activity_file_upload_link: the blank evidence
// template, a database assessment's starting database, and a reference file a
// question's `reference_file` evidence names. Each is an ordinary activity file
// (lessons bucket, lessons/{lessonId}/activities/{activityId}/{name}), as the
// lesson editor stores it, so uploading over one of the same name keeps the
// old copy as a past version (uploadFile). The template and the starting
// database are then chosen in body_data through updateActivity, as the
// editor's choice is saved.

/** The file types a reference file may be: the ones the marker reads as text (powerpoint-assessment/marking.ts). */
export const REFERENCE_FILE_EXTENSIONS = ["pdf", "docx", "txt", "md", "csv"] as const

const CONTENT_TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  accdb: "application/msaccess",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
}

export type PracticalActivityFileKind = "evidence_template" | "starting_database" | "reference_file"

const extensionOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ""

/**
 * Why `fileName` cannot be stored as this kind's file, or null. Checked when
 * the link is made (with the name it is made with) and again on upload.
 */
export function practicalActivityFileNameProblem(kind: PracticalActivityFileKind, fileName: string): string | null {
  if (!fileName.trim()) return "file_name must not be empty"
  if (fileName.length > 200) return "file_name must be at most 200 characters"
  if (/[\u0000-\u001f\u007f\\/]/.test(fileName)) return "file_name may not contain control characters, / or \\"
  const ext = extensionOf(fileName)
  if (kind === "evidence_template" && ext !== "docx") return `The evidence template must be a .docx file; "${fileName}" is not one.`
  if (kind === "starting_database" && ext !== "accdb") return `The starting database must be an .accdb file; "${fileName}" is not one.`
  if (kind === "reference_file" && !(REFERENCE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return `A reference file must be ${REFERENCE_FILE_EXTENSIONS.map((e) => `.${e}`).join(", ")} (the marker reads it as text); "${fileName}" is not one.`
  }
  return null
}

/** Why the activity type does not take this kind of file, or null. */
export function practicalActivityFileTypeProblem(kind: PracticalActivityFileKind, activityId: string, type: string | null): string | null {
  if (!isPracticalAssessmentType(type)) {
    return `Activity ${activityId} is not a PowerPoint assessment or database assessment; kind "${kind}" is for practical assessments (an assessment paper's questions have no evidence files).`
  }
  if (kind === "starting_database" && !practicalTypeConfig(type).hasStartingDatabase) {
    return `Activity ${activityId} is a ${practicalTypeConfig(type).labelLower}, which has no starting database; kind "starting_database" is for database assessments.`
  }
  return null
}

export type StoredPracticalActivityFile = {
  kind: PracticalActivityFileKind
  file_name: string
  bytes: number
  /** Whether a file of the same name was there: it is kept as a past version. */
  replaced: boolean
  /** evidence_template / starting_database: the body_data key set to this file. */
  body_key: "evidenceTemplateFile" | "startingDatabaseFile" | null
  /** The body_data value before, when it named another file (or null). */
  previous: string | null
  /** reference_file: the labels of the questions whose reference_file evidence names it. */
  named_by_questions: string[]
  evidence_template_check?: EvidenceTemplateCheck
  starting_database_check?: StartingDatabaseCheck
  /** The check after storing failed; the file is stored and chosen all the same. */
  check_error?: string
}

/**
 * Store one of a practical assessment's own files (see the top of this file).
 * The template is checked as a .docx and the database as an Access file
 * before anything is stored (PracticalFileRefusal); a reference file is
 * stored as it is. After storing, the template is checked against the
 * questions' headings and the starting database read in full, as the editor
 * does: a failed check is reported, not thrown, since the file is saved.
 */
export async function storePracticalActivityFile(input: {
  activityId: string
  kind: PracticalActivityFileKind
  fileName: string
  bytes: Buffer
  uploadedBy?: string | null
}): Promise<StoredPracticalActivityFile> {
  const { activityId, kind, fileName, bytes } = input
  const { rows } = await query<{ lesson_id: string; type: string | null; body_data: Record<string, unknown> | null }>(
    "select lesson_id, type, body_data from activities where activity_id = $1",
    [activityId],
  )
  const activity = rows[0]
  if (!activity) throw new Error(`Activity ${activityId} not found`)
  const typeProblem = practicalActivityFileTypeProblem(kind, activityId, activity.type)
  if (typeProblem) throw new Error(typeProblem)
  const nameProblem = practicalActivityFileNameProblem(kind, fileName)
  if (nameProblem) throw new Error(nameProblem)
  if (kind === "evidence_template") await checkSlotFile("docx", bytes, fileName)
  if (kind === "starting_database") await checkSlotFile("accdb", bytes, fileName)

  const storage = createLocalStorageClient(LESSONS_BUCKET)
  const storagePath = `lessons/${activity.lesson_id}/activities/${activityId}/${fileName}`
  const replaced = Boolean(await storage.stat(storagePath))
  const { error } = await storage.upload(storagePath, bytes, {
    contentType: CONTENT_TYPES[extensionOf(fileName)] ?? "application/octet-stream",
    uploadedBy: input.uploadedBy ?? "mcp",
    originalPath: fileName,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const bodyKey = kind === "evidence_template" ? "evidenceTemplateFile" : kind === "starting_database" ? "startingDatabaseFile" : null
  const previousValue = bodyKey ? activity.body_data?.[bodyKey] : undefined
  const result: StoredPracticalActivityFile = {
    kind,
    file_name: fileName,
    bytes: bytes.byteLength,
    replaced,
    body_key: bodyKey,
    previous: typeof previousValue === "string" && previousValue !== fileName ? previousValue : null,
    named_by_questions: [],
  }
  if (bodyKey) await updateActivity(activityId, { bodyPatch: { [bodyKey]: fileName } })

  try {
    if (kind === "evidence_template") result.evidence_template_check = await checkActivityEvidenceTemplate(activityId, fileName)
    if (kind === "starting_database") result.starting_database_check = await checkActivityStartingDatabase(activityId, fileName)
  } catch (checkError) {
    result.check_error = checkError instanceof Error ? checkError.message : String(checkError)
  }
  if (kind === "reference_file") {
    const { rows: named } = await query<{ label: string }>(
      `select q.label from activity_questions q
        where q.activity_id = $1
          and exists (select 1 from jsonb_array_elements(q.evidence) e
                       where e->>'source' = 'reference_file' and e->>'fileName' = $2)
        order by q.position, q.label`,
      [activityId, fileName],
    )
    result.named_by_questions = named.map((row) => row.label)
  }
  return result
}
