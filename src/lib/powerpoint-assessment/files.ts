import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { query, withDbClient } from "@/lib/db"
import { isPowerPointAssessmentType } from "@/dino.config"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import {
  ASSESSMENT_SCRIPTS_BUCKET,
  assertPupilSitsAssessment,
  markingAssignmentIdFor,
} from "@/lib/assessment-paper/files"
import { recomputeAssessmentSubmission } from "@/lib/assessment-paper/store"
import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import { OfficeFileError } from "@/lib/pptx/errors"
import {
  DOCX_MESSAGES,
  PPTX_MESSAGES,
  checkDocxFileType,
  checkFileType,
  openDocxPackage,
  openPackage,
} from "@/lib/pptx/package"
import {
  MATCH_THRESHOLD_PERCENT,
  compareFingerprints,
  fingerprintImage,
  type KnownImage,
} from "@/lib/pptx/known-images"
import { isLessonLockedForUser } from "@/lib/lesson-lock"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { joinLabels } from "@/lib/utils"
import {
  PowerPointAssessmentActivityBodySchema,
  type PowerPointAssessmentActivityBody,
  type PowerPointUploadSlot,
  type PowerPointUploadSlotKind,
} from "@/types"

// The files of a PowerPoint assessment.
//
// A pupil's files, one per upload slot, in the assessment-scripts bucket
// (never `lessons`, where any signed-in user can read any path):
//
//   {activityId}/practical/{fileId}/original.{pptx|pdf|docx}   teacher; the pupil who handed it in
//   {activityId}/practical/{fileId}/evidence/...               teacher only (what the reader extracted)
//
// The images the task supplies, in the lessons bucket so every pupil can
// download them, fingerprinted so the presentation reader can recognise them
// in a pupil's slides:
//
//   lessons/{lessonId}/activities/{activityId}/images/{uuid}.{ext}
//
// (a generated name; the teacher's file name is kept only in the row).
//
// A file is checked from its bytes, not its declared type: a presentation
// slot takes a .pptx, a pdf slot a PDF, a docx slot a .docx. Old binary
// files (.ppt, .doc) and password-protected ones are refused with the Office
// reader's own message, written for the pupil.
//
// Marking starts when the pupil hands in. After that a pupil cannot change
// their files; a teacher can, which clears what was marked from the old file
// (the teacher's own marks are kept) and sends the submission again, after a
// short pause so several changes in a row are read once.

export const PRACTICAL_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
/** Supplied images arrive through a server action, whose body is capped at 12 MB. */
export const SUPPLIED_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** What a pupil is told when they try to change a file after handing in. */
export const HANDED_IN_MESSAGE = "You have handed this in. Ask your teacher if you need to change a file."
/** Recorded on the submission when it could not be sent again after a change. */
export const RESEND_FAILED_MESSAGE = "Could not send for marking; ask your teacher to resend it."
export const LESSONS_BUCKET = "lessons"

/** Seconds a re-queue after a replacement waits, so several replacements in a row are read once. */
export const REPLACEMENT_REQUEUE_DELAY_SECONDS = 120

const EXTENSIONS: Record<PowerPointUploadSlotKind, string> = { pptx: "pptx", pdf: "pdf", docx: "docx" }
const MIME_TYPES: Record<PowerPointUploadSlotKind, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

type SuppliedImageKind = "png" | "jpeg" | "gif" | "webp"
const IMAGE_MIME_TYPES: Record<SuppliedImageKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

/** A refusal written for the pupil or teacher who uploaded the file. */
export class PracticalFileRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PracticalFileRefusal"
  }
}

function assertUploadSize(bytes: Buffer) {
  if (bytes.byteLength === 0) throw new PracticalFileRefusal("The file is empty.")
  if (bytes.byteLength > PRACTICAL_UPLOAD_MAX_BYTES) {
    throw new PracticalFileRefusal("The file is larger than the 25 MB limit.")
  }
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex")
}

function extensionOf(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const dot = base.lastIndexOf(".")
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase()
}

type PowerPointActivity = {
  activityId: string
  lessonId: string
  body: PowerPointAssessmentActivityBody | null
}

async function readPowerPointActivity(activityId: string): Promise<PowerPointActivity> {
  const { rows } = await query<{ activity_id: string; lesson_id: string; type: string | null; body_data: unknown }>(
    "select activity_id, lesson_id, type, body_data from activities where activity_id = $1",
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Activity ${activityId} not found.`)
  if (!isPowerPointAssessmentType(row.type)) throw new Error(`Activity ${activityId} is not a PowerPoint assessment.`)
  const parsed = PowerPointAssessmentActivityBodySchema.safeParse(row.body_data ?? {})
  return { activityId: row.activity_id, lessonId: row.lesson_id, body: parsed.success ? parsed.data : null }
}

function slotsOf(activity: PowerPointActivity): PowerPointUploadSlot[] {
  if (!activity.body) {
    throw new PracticalFileRefusal("This PowerPoint assessment has no upload slots set up; ask your teacher.")
  }
  return activity.body.uploadSlots
}

function findSlot(activity: PowerPointActivity, slotKey: string): PowerPointUploadSlot {
  const slot = slotsOf(activity).find((s) => s.key === slotKey)
  if (!slot) throw new PracticalFileRefusal(`This assessment has no upload slot "${slotKey}".`)
  return slot
}

/**
 * Whether the bytes are a file this slot takes, refusing with the reader's
 * message (for the pupil) when not. A presentation and an evidence document
 * are opened, lightly, so a damaged file is refused at upload rather than
 * at marking.
 */
export async function checkSlotFile(kind: PowerPointUploadSlotKind, bytes: Buffer, originalName: string): Promise<void> {
  try {
    if (kind === "pdf") {
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PracticalFileRefusal("This is not a PDF file.")
      return
    }
    if (kind === "pptx") {
      checkFileType(bytes)
      const pkg = await openPackage(bytes)
      await pkg.readXml(pkg.mainPart)
      if (extensionOf(originalName) !== "pptx") throw new PracticalFileRefusal(PPTX_MESSAGES.notThisType)
      return
    }
    checkDocxFileType(bytes)
    const pkg = await openDocxPackage(bytes)
    await pkg.readXml(pkg.mainPart)
    if (extensionOf(originalName) !== "docx") throw new PracticalFileRefusal(DOCX_MESSAGES.notThisType)
  } catch (error) {
    if (error instanceof OfficeFileError) throw new PracticalFileRefusal(error.message)
    throw error
  }
}

async function upload(bucket: string, storagePath: string, bytes: Buffer, contentType: string, uploadedBy: string | null) {
  const { error } = await createLocalStorageClient(bucket).upload(storagePath, bytes, {
    contentType,
    uploadedBy,
    originalPath: storagePath,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

async function removeStored(bucket: string, paths: string[]) {
  if (paths.length === 0) return
  const { error } = await createLocalStorageClient(bucket).remove(paths)
  if (error) console.error("[powerpoint-assessment] failed to remove stored files", { paths, error })
}

/** Every stored file under a pupil file's folder: its original and whatever the reader extracted. */
async function storedPathsUnder(folder: string): Promise<string[]> {
  const { rows } = await query<{ path: string }>(
    `select scope_path || '/' || file_name as path
       from stored_files
      where bucket = $1 and (scope_path = $2 or scope_path like $3)`,
    [ASSESSMENT_SCRIPTS_BUCKET, folder, `${folder.replace(/[\\%_]/g, "\\$&")}/%`],
  )
  return rows.map((row) => row.path)
}

async function removePupilFileFolders(activityId: string, fileIds: string[]) {
  // The new file is already stored; a leftover old file must not fail the request.
  for (const fileId of fileIds) {
    try {
      await removeStored(ASSESSMENT_SCRIPTS_BUCKET, await storedPathsUnder(`${activityId}/practical/${fileId}`))
    } catch (error) {
      console.error("[powerpoint-assessment] failed to remove a replaced file's folder", { activityId, fileId, error })
    }
  }
}

async function readStoredFile(bucket: string, storagePath: string): Promise<Buffer> {
  const { stream, error } = await createLocalStorageClient(bucket).getFileStream(storagePath)
  if (error || !stream) throw new Error(`Stored file ${storagePath} not found.`)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/**
 * What was marked from the old files goes: the marker's (and legacy)
 * criterion rows, question totals and the reader's answers. A teacher's own
 * rows, and rows carrying a teacher's comment, are kept, as a re-scan keeps
 * them for an assessment paper.
 */
async function clearMarkedWork(client: Queryable, submissionId: string) {
  await client.query(
    `delete from submission_question_criterion_marks
      where submission_id = $1 and provenance <> 'teacher' and teacher_feedback is null`,
    [submissionId],
  )
  await client.query("delete from submission_question_marks where submission_id = $1", [submissionId])
  await client.query("delete from submission_question_answers where submission_id = $1", [submissionId])
  // Not marked any more: if sending it again then fails, it must not read as marked.
  await client.query("update submissions set mark_status = null, mark_error = null where submission_id = $1", [submissionId])
  await recomputeAssessmentSubmission(client, submissionId)
}

/**
 * The marking assignment id: the client's, when it names this activity's
 * lesson and a class the pupil is in, otherwise the pupil's own class (or
 * "self__{lessonId}").
 */
export async function practicalAssignmentIdFor(
  activityId: string,
  pupilId: string,
  groupAssignmentId?: string | null,
): Promise<string> {
  const { lessonId } = await readPowerPointActivity(activityId)
  const [groupId, assignmentLessonId] = groupAssignmentId?.split("__") ?? []
  if (groupId && assignmentLessonId === lessonId) {
    const { rows } = await query("select 1 from group_membership where group_id = $1 and user_id = $2 limit 1", [
      groupId,
      pupilId,
    ])
    if (rows.length > 0) return groupAssignmentId as string
  }
  return markingAssignmentIdFor(activityId, pupilId)
}

async function sendForMarking(submissionId: string, assignmentId: string, processAfterSeconds?: number) {
  // Queues the read (or holds the submission when a required file is missing).
  await enqueueMarkingTasks(assignmentId, [{ submissionId }], processAfterSeconds ? { processAfterSeconds } : undefined)
  const { rows } = await query<{ mark_status: string | null }>(
    "select mark_status from submissions where submission_id = $1",
    [submissionId],
  )
  if (rows[0]?.mark_status === "waiting") void triggerQueueProcessor()
}

/**
 * Send a submission for marking after its files changed or it was handed in.
 * A failure is recorded on the submission for the teacher rather than thrown:
 * the change itself is already saved.
 */
async function resendForMarking(
  submissionId: string,
  activityId: string,
  pupilId: string,
  groupAssignmentId: string | null | undefined,
  processAfterSeconds?: number,
): Promise<boolean> {
  try {
    await sendForMarking(submissionId, await practicalAssignmentIdFor(activityId, pupilId, groupAssignmentId), processAfterSeconds)
    return true
  } catch (error) {
    console.error("[powerpoint-assessment] failed to send for marking", { submissionId, error })
    await query("update submissions set mark_status = null, mark_error = $2 where submission_id = $1", [
      submissionId,
      RESEND_FAILED_MESSAGE,
    ]).catch((recordError) => console.error("[powerpoint-assessment] failed to record the send failure", recordError))
    return false
  }
}

export type StoredPracticalFile = {
  file_id: string
  submission_id: string
  slot_key: string
  original_name: string
  storage_path: string
  bytes: number
  /** The file this one replaced, if any. */
  replaced_file_id: string | null
  /** Whether the submission had been handed in, so its marking was cleared and sent again. */
  requeued: boolean
}

/**
 * Store one pupil's file in an upload slot. The file must be what the slot
 * takes (checkSlotFile). It belongs to the pupil's latest submission (attempt
 * 1 is created, not handed in, when they have none). A slot holds one file:
 * the one it replaces is deleted with everything read from it. Once handed
 * in, only a teacher (`byTeacher`) may change a file: what was marked is
 * cleared (teacher rows kept) and it is sent for marking again after
 * REPLACEMENT_REQUEUE_DELAY_SECONDS. A pupil is refused (HANDED_IN_MESSAGE).
 */
export async function storePracticalFile(input: {
  activityId: string
  pupilId: string
  slotKey: string
  bytes: Buffer
  originalName: string
  uploadedBy?: string | null
  /** A teacher acting for the pupil: may change files after hand-in. */
  byTeacher?: boolean
  groupAssignmentId?: string | null
}): Promise<StoredPracticalFile> {
  const { activityId, pupilId, slotKey, bytes } = input
  const originalName = (input.originalName.split(/[\\/]/).pop() ?? "").trim() || "file"
  assertUploadSize(bytes)
  const activity = await readPowerPointActivity(activityId)
  const slot = findSlot(activity, slotKey)
  await checkSlotFile(slot.kind, bytes, originalName)
  await assertPupilSitsAssessment(activityId, pupilId)

  const fileId = randomUUID()
  const storagePath = `${activityId}/practical/${fileId}/original.${EXTENSIONS[slot.kind]}`
  const uploadedBy = input.uploadedBy ?? null
  await upload(ASSESSMENT_SCRIPTS_BUCKET, storagePath, bytes, MIME_TYPES[slot.kind], uploadedBy)

  let result: { submissionId: string; replacedFileId: string | null; handedIn: boolean }
  try {
    result = await withDbClient(async (client) => {
      await client.query("BEGIN")
      try {
        const latest = await lockLatestSubmission(client, activityId, pupilId, { create: true })
        const submissionId = latest!.submission_id
        const handedIn = latest!.submission_status === "submitted"
        if (handedIn && !input.byTeacher) throw new PracticalFileRefusal(HANDED_IN_MESSAGE)

        const { rows: old } = await client.query<{ file_id: string }>(
          `delete from practical_submission_files
            where submission_id = $1 and slot_key = $2
            returning file_id::text as file_id`,
          [submissionId, slotKey],
        )
        await client.query(
          `insert into practical_submission_files
             (file_id, activity_id, pupil_id, submission_id, slot_key, original_name, storage_path, bytes, sha256, uploaded_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [fileId, activityId, pupilId, submissionId, slotKey, originalName, storagePath, bytes.byteLength, sha256(bytes), uploadedBy],
        )
        if (handedIn) await clearMarkedWork(client, submissionId)
        await client.query("COMMIT")
        return { submissionId, replacedFileId: old[0]?.file_id ?? null, handedIn }
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
  } catch (error) {
    await removeStored(ASSESSMENT_SCRIPTS_BUCKET, [storagePath])
    throw error
  }

  if (result.handedIn) {
    await resendForMarking(result.submissionId, activityId, pupilId, input.groupAssignmentId, REPLACEMENT_REQUEUE_DELAY_SECONDS)
  }
  if (result.replacedFileId) await removePupilFileFolders(activityId, [result.replacedFileId])

  return {
    file_id: fileId,
    submission_id: result.submissionId,
    slot_key: slotKey,
    original_name: originalName,
    storage_path: storagePath,
    bytes: bytes.byteLength,
    replaced_file_id: result.replacedFileId,
    requeued: result.handedIn,
  }
}

/**
 * The pupil's latest submission for the activity, locked for update (highest
 * attempt, then newest). An advisory lock on (activity, pupil) first, so two
 * uploads to different slots at once cannot both create attempt 1.
 */
async function lockLatestSubmission(
  client: Queryable,
  activityId: string,
  pupilId: string,
  options: { create: boolean },
): Promise<{ submission_id: string; submission_status: string | null } | null> {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`practical:${activityId}:${pupilId}`])
  const { rows } = await client.query<{ submission_id: string; submission_status: string | null }>(
    `select submission_id, submission_status from submissions
      where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc
      limit 1
      for update`,
    [activityId, pupilId],
  )
  if (rows[0] || !options.create) return rows[0] ?? null
  const { rows: created } = await client.query<{ submission_id: string; submission_status: string | null }>(
    `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
     values ($1, $2, 1, '{}'::json, now(), 'inprogress')
     returning submission_id, submission_status`,
    [activityId, pupilId],
  )
  return created[0]
}

/**
 * Remove the file in a slot of the pupil's latest submission. After hand-in
 * the marking is cleared and sent again, as for a replacement (the queue
 * holds a submission whose required files are missing). After hand-in only
 * a teacher (`byTeacher`) may; a pupil is refused (HANDED_IN_MESSAGE).
 * Whether the actor is that pupil or a teacher is the caller's check.
 */
export async function removePracticalFile(input: {
  activityId: string
  pupilId: string
  slotKey: string
  byTeacher?: boolean
  groupAssignmentId?: string | null
}): Promise<{ removed: boolean; requeued: boolean }> {
  const { activityId, pupilId, slotKey } = input
  const activity = await readPowerPointActivity(activityId)
  findSlot(activity, slotKey)

  const result = await withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      const latest = await lockLatestSubmission(client, activityId, pupilId, { create: false })
      if (!latest) {
        await client.query("COMMIT")
        return { submissionId: null, fileId: null, handedIn: false }
      }
      if (latest.submission_status === "submitted" && !input.byTeacher) throw new PracticalFileRefusal(HANDED_IN_MESSAGE)
      const { rows } = await client.query<{ file_id: string }>(
        `delete from practical_submission_files where submission_id = $1 and slot_key = $2
         returning file_id::text as file_id`,
        [latest.submission_id, slotKey],
      )
      const handedIn = latest.submission_status === "submitted" && rows.length > 0
      if (handedIn) await clearMarkedWork(client, latest.submission_id)
      await client.query("COMMIT")
      return { submissionId: latest.submission_id, fileId: rows[0]?.file_id ?? null, handedIn }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })

  if (result.handedIn && result.submissionId) {
    await resendForMarking(result.submissionId, activityId, pupilId, input.groupAssignmentId, REPLACEMENT_REQUEUE_DELAY_SECONDS)
  }
  if (result.fileId) await removePupilFileFolders(activityId, [result.fileId])
  return { removed: Boolean(result.fileId), requeued: result.handedIn }
}

export type PracticalFileRow = {
  file_id: string
  activity_id: string
  pupil_id: string
  submission_id: string
  slot_key: string
  original_name: string
  storage_path: string
  bytes: number
  sha256: string
  uploaded_by: string | null
  uploaded_at: string
  evidence_status: "ok" | "error" | null
  evidence_error: string | null
}

/** The files on a submission, one per slot, with what the reader made of each. */
export async function listPracticalFiles(submissionId: string): Promise<PracticalFileRow[]> {
  const { rows } = await query<Omit<PracticalFileRow, "uploaded_at"> & { uploaded_at: Date | string }>(
    `select f.file_id::text as file_id, f.activity_id, f.pupil_id, f.submission_id, f.slot_key, f.original_name,
            f.storage_path, f.bytes, f.sha256, f.uploaded_by, f.uploaded_at,
            e.status as evidence_status, e.error as evidence_error
       from practical_submission_files f
       left join practical_submission_evidence e on e.file_id = f.file_id
      where f.submission_id = $1
      order by f.slot_key`,
    [submissionId],
  )
  return rows.map((row) => ({
    ...row,
    uploaded_at: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
  }))
}

/** A pupil file's bytes, for the reader. */
export async function readPracticalFileBytes(fileId: string): Promise<Buffer> {
  const { rows } = await query<{ storage_path: string; activity_id: string }>(
    "select storage_path, activity_id from practical_submission_files where file_id::text = $1",
    [fileId],
  )
  const row = rows[0]
  if (!row) throw new Error(`File ${fileId} not found.`)
  if (!row.storage_path.startsWith(`${row.activity_id}/practical/${fileId}/original.`)) {
    throw new Error(`File ${fileId} is not stored where a pupil's files are kept.`)
  }
  return readStoredFile(ASSESSMENT_SCRIPTS_BUCKET, row.storage_path)
}

export type PracticalSlotState = {
  key: string
  label: string
  kind: PowerPointUploadSlotKind
  required: boolean
  hint: string | null
  file: {
    fileId: string
    name: string
    bytes: number
    uploadedAt: string
    url: string
    evidenceStatus: "ok" | "error" | null
    evidenceError: string | null
  } | null
}

export type PracticalSlotsState = {
  activityId: string
  pupilId: string
  submissionId: string | null
  handedIn: boolean
  markStatus: string | null
  slots: PracticalSlotState[]
  /** Labels of required slots with no file. */
  missingRequired: string[]
}

function fileUrl(storagePath: string) {
  const parts = [ASSESSMENT_SCRIPTS_BUCKET, ...storagePath.split("/")].map(encodeURIComponent)
  return `/api/files/${parts.join("/")}`
}

/** Each upload slot and the pupil's file in it, on their latest submission. */
export async function readPracticalSlots(activityId: string, pupilId: string): Promise<PracticalSlotsState> {
  const activity = await readPowerPointActivity(activityId)
  const slots = slotsOf(activity)
  const { rows } = await query<{ submission_id: string; submission_status: string | null; mark_status: string | null }>(
    `select submission_id, submission_status, mark_status from submissions
      where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc
      limit 1`,
    [activityId, pupilId],
  )
  const latest = rows[0] ?? null
  const files = latest ? await listPracticalFiles(latest.submission_id) : []
  const bySlot = new Map(files.map((file) => [file.slot_key, file]))
  const states = slots.map((slot): PracticalSlotState => {
    const file = bySlot.get(slot.key)
    return {
      key: slot.key,
      label: slot.label,
      kind: slot.kind,
      required: slot.required,
      hint: slot.hint ?? null,
      file: file
        ? {
            fileId: file.file_id,
            name: file.original_name,
            bytes: file.bytes,
            uploadedAt: file.uploaded_at,
            url: fileUrl(file.storage_path),
            evidenceStatus: file.evidence_status,
            evidenceError: file.evidence_error,
          }
        : null,
    }
  })
  return {
    activityId,
    pupilId,
    submissionId: latest?.submission_id ?? null,
    handedIn: latest?.submission_status === "submitted",
    markStatus: latest?.mark_status ?? null,
    slots: states,
    missingRequired: states.filter((slot) => slot.required && !slot.file).map((slot) => slot.label),
  }
}

/**
 * Hand in the pupil's files: marking starts now. Refused, naming them, while
 * a required slot is empty. Handing in again does nothing. A pupil may hand
 * in only their own work (the lock on the lesson is the caller's check).
 * The required slots are counted under the same locks an upload takes, so a
 * file removed at the same moment cannot slip past.
 */
export async function handInPowerPointAssessment(
  activityId: string,
  pupilId: string,
  actor: { userId: string; isTeacher: boolean },
  options?: { groupAssignmentId?: string | null },
): Promise<{ submissionId: string; alreadyHandedIn: boolean; state: PracticalSlotsState }> {
  if (!actor.isTeacher && actor.userId !== pupilId) {
    throw new Error("You can only hand in your own work.")
  }
  const slots = slotsOf(await readPowerPointActivity(activityId))

  const outcome = await withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      const latest = await lockLatestSubmission(client, activityId, pupilId, { create: false })
      if (!latest) throw new PracticalFileRefusal("Upload your files before handing in.")
      const { rows } = await client.query<{ slot_key: string }>(
        "select slot_key from practical_submission_files where submission_id = $1",
        [latest.submission_id],
      )
      const filled = new Set(rows.map((row) => row.slot_key))
      const missing = slots.filter((slot) => slot.required && !filled.has(slot.key)).map((slot) => slot.label)
      if (missing.length > 0) throw new PracticalFileRefusal(`Upload ${joinLabels(missing)} before handing in.`)
      const already = latest.submission_status === "submitted"
      if (!already) {
        await client.query(
          `update submissions set submission_status = 'submitted', submitted_at = now(), mark_status = null, mark_error = null
            where submission_id = $1`,
          [latest.submission_id],
        )
      }
      await client.query("COMMIT")
      return { submissionId: latest.submission_id, already }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })

  if (!outcome.already) {
    await resendForMarking(outcome.submissionId, activityId, pupilId, options?.groupAssignmentId)
  }
  return {
    submissionId: outcome.submissionId,
    alreadyHandedIn: outcome.already,
    state: await readPracticalSlots(activityId, pupilId),
  }
}

/** A teacher's "Mark with AI" on PowerPoint work the pupil has not handed in. */
export const NOT_HANDED_IN_FOR_MARKING_MESSAGE = "This pupil hasn't handed in yet."

/**
 * After a teacher asked for a submission to be marked (enqueueMarkingTasks):
 * why a PowerPoint assessment's work was not sent, or null when it is waiting
 * to be marked, and always null for any other activity type. Work not handed
 * in is never sent; held work (a required file missing, say) gives the
 * reason recorded on it.
 */
export async function powerPointNotQueuedReason(submissionId: string): Promise<string | null> {
  const { rows } = await query<{
    type: string | null
    submission_status: string | null
    mark_status: string | null
    mark_error: string | null
  }>(
    `select a.type, s.submission_status, s.mark_status, s.mark_error
       from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1`,
    [submissionId],
  )
  const row = rows[0]
  if (!row || !isPowerPointAssessmentType(row.type)) return null
  if (row.submission_status !== "submitted") return NOT_HANDED_IN_FOR_MARKING_MESSAGE
  if (row.mark_status === "waiting") return null
  return row.mark_error?.trim() || "Not sent for marking."
}

/**
 * Pupils' latest submissions that are handed in but have never been marked
 * and are not queued: no question, criterion or answer rows of any
 * provenance (so anything a teacher marked is left alone) and no open read
 * or mark job. Like an assessment paper's unmarked scripts, only work that
 * can be read: every required slot has a file and the reader refused none
 * (a refused file is replaced, which sends it again). Sending one queues its
 * read (enqueueMarkingTasks).
 */
export async function listUnmarkedPowerPointSubmissions(
  activityId: string,
): Promise<Array<{ submissionId: string; pupilId: string }>> {
  const { rows } = await query<{ submission_id: string; user_id: string }>(
    `with latest as (
       select distinct on (s.user_id) s.submission_id, s.user_id, s.submission_status
         from submissions s
        where s.activity_id = $1
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select l.submission_id, l.user_id
       from latest l
       join activities a on a.activity_id = $1 and a.type = 'powerpoint-assessment'
      where l.submission_status = 'submitted'
        and not exists (select 1 from jsonb_array_elements(coalesce(a.body_data::jsonb -> 'uploadSlots', '[]'::jsonb)) slot
                         where coalesce((slot ->> 'required')::boolean, false)
                           and not exists (select 1 from practical_submission_files f
                                            where f.submission_id = l.submission_id and f.slot_key = slot ->> 'key'))
        and not exists (select 1 from practical_submission_evidence e
                         where e.submission_id = l.submission_id and e.status = 'error')
        and not exists (select 1 from submission_question_marks m where m.submission_id = l.submission_id)
        and not exists (select 1 from submission_question_criterion_marks m where m.submission_id = l.submission_id)
        and not exists (select 1 from submission_question_answers m where m.submission_id = l.submission_id)
        and not exists (select 1 from external_jobs j
                         where j.job_type in ('ai_mark', 'ai_read') and j.status in ('pending', 'processing')
                           and j.payload ->> 'submissionId' = l.submission_id)
      order by l.user_id`,
    [activityId],
  )
  return rows.map((row) => ({ submissionId: row.submission_id, pupilId: row.user_id }))
}


// ------------------------------------------------------------ supplied images

function sniffImageKind(bytes: Buffer): SuppliedImageKind | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  const head = bytes.subarray(0, 6).toString("latin1")
  if (head === "GIF87a" || head === "GIF89a") return "gif"
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp"
  return null
}

export type SuppliedImage = {
  activity_id: string
  name: string
  file_name: string
  storage_path: string
  sha256: string
  width: number | null
  height: number | null
  uploaded_at: string
  url: string
}

const IMAGE_EXTENSIONS: Record<SuppliedImageKind, string> = { png: "png", jpeg: "jpg", gif: "gif", webp: "webp" }

/** A name shown to teachers and pupils: non-empty, at most 200 characters, no control characters or path separators. */
function displayName(value: string, what: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new PracticalFileRefusal(`The image needs a ${what}.`)
  if (trimmed.length > 200) throw new PracticalFileRefusal(`The image's ${what} must be at most 200 characters.`)
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new PracticalFileRefusal(`The image's ${what} has a control character in it.`)
  if (/[\\/]/.test(trimmed)) throw new PracticalFileRefusal(`The image's ${what} may not contain / or \\.`)
  return trimmed
}

function suppliedImageFolder(lessonId: string, activityId: string) {
  return `lessons/${lessonId}/activities/${activityId}/images`
}

/**
 * Store an image the task supplies (png, jpeg, gif or webp) and fingerprint
 * it for the presentation reader. Named after its file without the extension
 * unless a name is given; a name already in use is replaced. Warns when it
 * is so like another supplied image that the reader may confuse them.
 */
export async function storeSuppliedImage(input: {
  activityId: string
  fileName: string
  bytes: Buffer
  name?: string
  uploadedBy?: string | null
}): Promise<{ image: SuppliedImage; replaced: boolean; warnings: string[] }> {
  const { activityId, bytes } = input
  const fileName = displayName(input.fileName, "file name")
  if (bytes.byteLength === 0) throw new PracticalFileRefusal("The file is empty.")
  if (bytes.byteLength > SUPPLIED_IMAGE_MAX_BYTES) {
    throw new PracticalFileRefusal("A supplied image must be 10 MB or smaller.")
  }
  const kind = sniffImageKind(bytes)
  if (!kind) throw new PracticalFileRefusal(`${fileName}: a supplied image must be a PNG, JPEG, GIF or WebP.`)
  const name = displayName(input.name ?? fileName.replace(/\.[^.]+$/, ""), "name")

  const activity = await readPowerPointActivity(activityId)
  let print: Awaited<ReturnType<typeof fingerprintImage>>
  try {
    print = await fingerprintImage(bytes)
  } catch {
    throw new PracticalFileRefusal(`${fileName}: the image could not be read.`)
  }

  const existing = await listSuppliedImageRows(activityId)
  const previous = existing.find((image) => image.name === name) ?? null

  const warnings: string[] = []
  for (const other of existing) {
    if (other.name === name) continue
    if (other.sha256 === print.sha256) {
      warnings.push(`"${name}" is the same image as "${other.name}"; the reader cannot tell them apart.`)
      continue
    }
    const similarity = Math.max(
      compareFingerprints(print.fingerprint, other.fingerprint)?.similarityPercent ?? 0,
      compareFingerprints(other.fingerprint, print.fingerprint)?.similarityPercent ?? 0,
    )
    if (similarity >= MATCH_THRESHOLD_PERCENT) {
      warnings.push(
        `"${name}" looks very like "${other.name}" (${Math.round(similarity)}% similar); the reader may confuse them in a pupil's slides.`,
      )
    }
  }

  // A generated name, so the teacher's file name never reaches a storage path
  // and a replacement never collides with the file it replaces.
  const storagePath = `${suppliedImageFolder(activity.lessonId, activityId)}/${randomUUID()}.${IMAGE_EXTENSIONS[kind]}`
  await upload(LESSONS_BUCKET, storagePath, bytes, IMAGE_MIME_TYPES[kind], input.uploadedBy ?? null)
  try {
    await query(
      `insert into practical_supplied_images (activity_id, name, file_name, storage_path, sha256, fingerprint, width, height)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (activity_id, name) do update
         set file_name = excluded.file_name, storage_path = excluded.storage_path, sha256 = excluded.sha256,
             fingerprint = excluded.fingerprint, width = excluded.width, height = excluded.height,
             uploaded_at = timezone('utc', now())`,
      [activityId, name, fileName, storagePath, print.sha256, print.fingerprint, print.width, print.height],
    )
  } catch (error) {
    await removeStored(LESSONS_BUCKET, [storagePath])
    throw error
  }

  // The old file goes only once the new one is in place.
  if (previous && previous.storage_path !== storagePath) await removeStored(LESSONS_BUCKET, [previous.storage_path])

  const image = (await listSuppliedImages(activityId)).find((row) => row.name === name)
  if (!image) throw new Error(`Supplied image ${name} was not stored.`)
  return { image, replaced: Boolean(previous), warnings }
}

async function listSuppliedImageRows(activityId: string) {
  const { rows } = await query<{
    activity_id: string
    name: string
    file_name: string
    storage_path: string
    sha256: string
    fingerprint: string
    width: number | null
    height: number | null
    uploaded_at: Date | string
  }>(
    `select activity_id, name, file_name, storage_path, sha256, fingerprint, width, height, uploaded_at
       from practical_supplied_images where activity_id = $1 order by name`,
    [activityId],
  )
  return rows
}

/** The supplied images of an activity, with a download link each. */
export async function listSuppliedImages(activityId: string): Promise<SuppliedImage[]> {
  return (await listSuppliedImageRows(activityId)).map(({ fingerprint: _fingerprint, ...row }) => ({
    ...row,
    uploaded_at: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
    url: `/api/files/${[LESSONS_BUCKET, ...row.storage_path.split("/")].map(encodeURIComponent).join("/")}`,
  }))
}

/** Remove a supplied image and its stored file. */
export async function removeSuppliedImage(activityId: string, name: string): Promise<{ removed: boolean }> {
  await readPowerPointActivity(activityId)
  const { rows } = await query<{ storage_path: string }>(
    "delete from practical_supplied_images where activity_id = $1 and name = $2 returning storage_path",
    [activityId, name],
  )
  if (rows[0]) await removeStored(LESSONS_BUCKET, [rows[0].storage_path])
  return { removed: rows.length > 0 }
}

/** The supplied images as the presentation reader takes them, from their stored fingerprints. */
export async function readKnownImages(activityId: string): Promise<KnownImage[]> {
  return (await listSuppliedImageRows(activityId)).map((row) => ({
    name: row.name,
    sha256: row.sha256,
    fingerprint: row.fingerprint,
  }))
}

// -------------------------------------------------------------------- access

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether the signed-in user may open a path under a PowerPoint assessment's
 * pupil files ({activityId}/practical/...) in the assessment-scripts bucket.
 * Teachers may open everything. A pupil may open only the original of a file
 * they handed in themselves; what the reader extracted (evidence/*) is for
 * teachers. Nothing opens to a pupil while the lesson is locked for them.
 */
export async function pupilMayOpenPracticalFile(
  path: string | string[],
  profile: { userId: string; roles: string[] } | null,
): Promise<boolean> {
  if (!profile) return false
  if (profile.roles.includes("teacher")) return true
  const segments = Array.isArray(path) ? path : path.split("/")
  const [activityId, folder, fileId, fileName, ...rest] = segments
  if (!activityId || folder !== "practical" || rest.length > 0 || !UUID_RE.test(fileId ?? "")) return false
  if (!/^original\.(pptx|pdf|docx)$/.test(fileName ?? "")) return false
  const { rows } = await query<{ lesson_id: string }>(
    `select a.lesson_id from practical_submission_files f join activities a on a.activity_id = f.activity_id
      where f.file_id = $1::uuid and f.activity_id = $2 and f.pupil_id = $3 and f.storage_path = $4`,
    [fileId, activityId, profile.userId, segments.join("/")],
  )
  if (!rows[0]) return false
  return !(await isLessonLockedForUser(profile.userId, rows[0].lesson_id))
}
