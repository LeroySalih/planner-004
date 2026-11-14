import "server-only"

import { randomUUID } from "node:crypto"
import sharp from "sharp"

import { query, withDbClient } from "@/lib/db"
import { pdfPageCount, pdfToPngPages } from "@/lib/pdf/poppler"
import { isAssessmentPaperType, isPowerPointAssessmentType, isQuestionMarkedActivityType } from "@/dino.config"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { recomputeAssessmentSubmission } from "@/lib/assessment-paper/store"
import { NO_FRONT_SHEET_MESSAGE, checkFrontSheet } from "@/lib/assessment-paper/front-sheet"
import { isLessonLockedForUser } from "@/lib/lesson-lock"
import { readFeedbackVisibility } from "@/lib/mcp/pupil-feedback"
import { pupilMembershipSql } from "@/lib/roles/pupil-membership"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { AssessmentPaperActivityBodySchema } from "@/types"

// Files of an assessment-paper activity, in their own bucket:
//
//   {activityId}/paper/question-paper.pdf                    teacher; the pupil once they have sat it
//   {activityId}/paper/mark-scheme.pdf                       teacher only
//   {activityId}/scripts/{scriptId}/original.{pdf|jpg|png}   teacher; the pupil once feedback is visible
//   {activityId}/scripts/{scriptId}/page-{n}.png              teacher only; n = 2.., what a model sees
//
// Never the `lessons` bucket: any signed-in user can read any path there.
//
// Every paper starts with a front sheet, the only place a pupil writes their
// name. When a script arrives every page is rasterised (pdftoppm) and page 1
// is checked against the question paper's page 1, the blank front sheet
// (front-sheet.ts). Only if it passes are pages 2..n stored, as plain PNGs (no
// text layer or metadata survives). Page 1 is never stored as a page, and
// readMarkablePages is the only loader a model call may use.

export const ASSESSMENT_SCRIPTS_BUCKET = "assessment-scripts"
export const ASSESSMENT_PAPER_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
export const MAX_SCRIPT_PAGES = 30

const RENDER_DPI = 150
// A page is never rendered larger than this on its long side, so a PDF with
// an outsized page box cannot produce a huge image.
const MAX_PAGE_PIXELS = 3000

export type PaperFileKind = "question_paper" | "mark_scheme"
type FileKind = "pdf" | "jpeg" | "png"

const EXTENSIONS: Record<FileKind, string> = { pdf: "pdf", jpeg: "jpg", png: "png" }
const MIME_TYPES: Record<FileKind, string> = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png" }
const PAPER_FILE_NAMES: Record<PaperFileKind, string> = {
  question_paper: "question-paper",
  mark_scheme: "mark-scheme",
}
const PAPER_BODY_KEYS: Record<PaperFileKind, "questionPaperPath" | "markSchemePath"> = {
  question_paper: "questionPaperPath",
  mark_scheme: "markSchemePath",
}
const PAPER_LABELS: Record<PaperFileKind, string> = {
  question_paper: "question paper",
  mark_scheme: "mark scheme",
}

/** What the bytes are, from their signature: a declared type or extension is not trusted. */
function sniffFileKind(bytes: Buffer): FileKind | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  return null
}

function assertUploadSize(bytes: Buffer) {
  if (bytes.byteLength === 0) throw new Error("The file is empty.")
  if (bytes.byteLength > ASSESSMENT_PAPER_UPLOAD_MAX_BYTES) {
    throw new Error(`The file exceeds the 25 MB limit (${bytes.byteLength} bytes).`)
  }
}

/**
 * A question-marked activity, for what every such type shares (its paper
 * files, who sits it). `scripts` narrows it to an assessment paper, for
 * anything that stores or reads a scanned script.
 */
async function readAssessmentActivity(activityId: string, options?: { scripts?: boolean }) {
  const { rows } = await query<{ activity_id: string; lesson_id: string; type: string | null; body_data: unknown }>(
    "select activity_id, lesson_id, type, body_data from activities where activity_id = $1",
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Activity ${activityId} not found.`)
  const allowed = options?.scripts ? isAssessmentPaperType(row.type) : isQuestionMarkedActivityType(row.type)
  if (!allowed) throw new Error(`Activity ${activityId} is not an assessment paper.`)
  const parsed = AssessmentPaperActivityBodySchema.safeParse(row.body_data ?? {})
  return { activityId: row.activity_id, lessonId: row.lesson_id, body: parsed.success ? parsed.data : {} }
}

async function readStoredFile(storagePath: string): Promise<Buffer> {
  const { stream, error } = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).getFileStream(storagePath)
  if (error || !stream) throw new Error(`Stored file ${storagePath} not found.`)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function upload(storagePath: string, bytes: Buffer, contentType: string, uploadedBy: string | null) {
  const { error } = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).upload(storagePath, bytes, {
    contentType,
    uploadedBy,
    originalPath: storagePath,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

async function removeStored(paths: string[]) {
  if (paths.length === 0) return
  const { error } = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
  if (error) console.error("[assessment-paper] failed to remove stored files", { paths, error })
}

/**
 * Store the activity's question paper or mark scheme (PDF only) and record its
 * path in the activity body. A new upload replaces the old file outright.
 */
export async function storePaperFile(
  activityId: string,
  kind: PaperFileKind,
  bytes: Buffer,
  uploadedBy: string | null = null,
): Promise<{ path: string; size_bytes: number }> {
  assertUploadSize(bytes)
  if (sniffFileKind(bytes) !== "pdf") {
    throw new Error(`The ${PAPER_LABELS[kind]} must be a PDF.`)
  }
  await readAssessmentActivity(activityId)

  const storagePath = `${activityId}/paper/${PAPER_FILE_NAMES[kind]}.pdf`
  // Removed first, or the storage layer keeps the old file as a dated copy.
  await removeStored([storagePath])
  await upload(storagePath, bytes, MIME_TYPES.pdf, uploadedBy)
  await query(
    `update activities
        set body_data = coalesce(body_data, '{}'::jsonb) || jsonb_build_object($2::text, $3::text)
      where activity_id = $1`,
    [activityId, PAPER_BODY_KEYS[kind], storagePath],
  )
  return { path: storagePath, size_bytes: bytes.byteLength }
}

/**
 * The activity's mark scheme PDF, for the mark scheme split. A paper file,
 * never a pupil's: only a path under the activity's own paper folder is read.
 * Null when no mark scheme is attached.
 */
export async function readMarkSchemePdf(activityId: string): Promise<Buffer | null> {
  const { body } = await readAssessmentActivity(activityId)
  const storagePath = body.markSchemePath
  if (!storagePath) return null
  if (storagePath !== `${activityId}/paper/${PAPER_FILE_NAMES.mark_scheme}.pdf`) {
    throw new Error("The mark scheme is not stored where this paper's files are kept; upload it again.")
  }
  return readStoredFile(storagePath)
}

/** A rendered page made upright, flattened on white and capped in size. */
function normalisePage(page: Buffer): Promise<Buffer> {
  return sharp(page)
    .rotate()
    .resize({ width: MAX_PAGE_PIXELS, height: MAX_PAGE_PIXELS, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer()
}

/**
 * Pages of a PDF as PNGs, via poppler: every page, or only the first when
 * `firstPageOnly` (with the page count still read). Temp files are always
 * removed.
 */
async function rasterisePdf(
  bytes: Buffer,
  options: { firstPageOnly?: boolean } = {},
): Promise<{ pages: Buffer[]; pageCount: number }> {
  const pageCount = await pdfPageCount(bytes)
  if (pageCount === 0) throw new Error("The PDF has no pages.")
  if (!options.firstPageOnly && pageCount > MAX_SCRIPT_PAGES) {
    throw new Error(`The PDF has ${pageCount} pages; a script may have at most ${MAX_SCRIPT_PAGES}.`)
  }

  const range = options.firstPageOnly ? { firstPage: 1, lastPage: 1 } : {}
  const pages = await pdfToPngPages(bytes, { dpi: RENDER_DPI, ...range })
  if (pages.length !== (options.firstPageOnly ? 1 : pageCount)) throw new Error("Failed to convert every page of the PDF.")
  const rendered = await Promise.all(pages.map((page) => normalisePage(page)))
  return { pages: rendered, pageCount }
}

/**
 * The pupil must be a pupil (not staff) of a class the lesson is set to, or
 * the pupil an intervention lesson is written for. Returns the marking
 * assignment id, "{groupId}__{lessonId}", as the other marking paths use.
 */
export async function assertPupilSitsAssessment(activityId: string, pupilId: string): Promise<{ lessonId: string; assignmentId: string }> {
  const { lessonId } = await readAssessmentActivity(activityId)
  const { rows } = await query<{ group_id: string | null }>(
    `select la.group_id
       from lesson_assignments la
       join group_membership gm on gm.group_id = la.group_id and gm.user_id = $1
      where la.lesson_id = $2 and ${pupilMembershipSql("gm")}
     union all
     select ia.group_id
       from intervention_assignments ia
      where ia.pupil_id = $1 and ia.lesson_id = $2 and ia.active is not false
     limit 1`,
    [pupilId, lessonId],
  )
  if (!rows[0]) {
    throw new Error(`Pupil ${pupilId} is not a pupil in a class this lesson is set to.`)
  }
  return { lessonId, assignmentId: `${rows[0].group_id ?? "self"}__${lessonId}` }
}

/**
 * The marking assignment id to send a pupil's script with: their class's, or
 * "self__{lessonId}" when they no longer sit it (a pupil who has left the
 * class still gets marked).
 */
export async function markingAssignmentIdFor(activityId: string, pupilId: string): Promise<string> {
  return assertPupilSitsAssessment(activityId, pupilId)
    .then((sitting) => sitting.assignmentId)
    .catch(async () => `self__${(await readAssessmentActivity(activityId)).lessonId}`)
}

export type StoredScript = {
  script_id: string
  submission_id: string
  page_count: number
  replaced_scripts: number
  /** 'passed', or why the script is held (see front-sheet.ts). */
  front_sheet_check: string
  /** "held": stored, not sent; `message` says why. */
  marking: "queued" | "held"
  message: string
}

/**
 * The activity's front sheet (page 1 of its question paper) and the paper's
 * page count, or null when no question paper is uploaded.
 */
async function readQuestionPaperFrontSheet(
  activityId: string,
  questionPaperPath: string | undefined,
): Promise<{ firstPage: Buffer; pageCount: number } | null> {
  if (!questionPaperPath || !questionPaperPath.startsWith(`${activityId}/paper/`)) return null
  const { pages, pageCount } = await rasterisePdf(await readStoredFile(questionPaperPath), { firstPageOnly: true })
  return { firstPage: pages[0], pageCount }
}

/**
 * Store one pupil's script for an assessment paper, check its front sheet,
 * and send it for marking if the check passes.
 *
 * The script must be a PDF. The original is always stored. Page 1 is compared
 * with the question paper's page 1 and the page counts are compared (see
 * front-sheet.ts): if both pass, pages 2..n are stored as the markable pages;
 * if not, none are, front_sheet_check holds the reason, and the submission is
 * held (mark_status null, the reason in mark_error) with nothing sent.
 *
 * The script belongs to the pupil's latest submission (created if they have
 * none). A new upload replaces the script: earlier scripts on that submission
 * are deleted with their files, the marker's (and legacy) marks and the
 * reader's answers are cleared, and the teacher's own marks are kept, as a
 * re-mark keeps them elsewhere.
 */
export async function storeScript(input: {
  activityId: string
  pupilId: string
  bytes: Buffer
  uploadedBy?: string | null
}): Promise<StoredScript> {
  const { activityId, pupilId, bytes } = input
  assertUploadSize(bytes)
  if (sniffFileKind(bytes) !== "pdf") {
    throw new Error("A script must be a PDF: its page 1 (the front sheet) is checked against the question paper.")
  }

  const { body } = await readAssessmentActivity(activityId, { scripts: true })
  const { assignmentId } = await assertPupilSitsAssessment(activityId, pupilId)

  const { pages, pageCount } = await rasterisePdf(bytes)
  const frontSheet = await readQuestionPaperFrontSheet(activityId, body.questionPaperPath)
  const frontSheetCheck = frontSheet
    ? (await checkFrontSheet({
        scriptFirstPage: pages[0],
        scriptPageCount: pageCount,
        paperFirstPage: frontSheet.firstPage,
        paperPageCount: frontSheet.pageCount,
      })).result
    : NO_FRONT_SHEET_MESSAGE
  const passed = frontSheetCheck === "passed"

  const scriptId = randomUUID()
  const folder = `${activityId}/scripts/${scriptId}`
  const originalPath = `${folder}/original.pdf`
  // Page 1 is never stored as a page; a held script stores none, since its
  // page order is in doubt and the front sheet may be among them.
  const markable = passed ? pages.slice(1).map((page, index) => ({ page, path: `${folder}/page-${index + 2}.png` })) : []
  const uploadedBy = input.uploadedBy ?? null

  const stored: string[] = []
  let replaced: Array<{ original_path: string; page_paths: string[] }> = []
  let submissionId: string
  try {
    await upload(originalPath, bytes, MIME_TYPES.pdf, uploadedBy)
    stored.push(originalPath)
    for (const entry of markable) {
      await upload(entry.path, entry.page, "image/png", uploadedBy)
      stored.push(entry.path)
    }

    submissionId = await withDbClient(async (client) => {
      await client.query("BEGIN")
      try {
        const { rows: latest } = await client.query<{ submission_id: string }>(
          `select submission_id from submissions
            where activity_id = $1 and user_id = $2
            order by attempt_number desc, submitted_at desc nulls last, submission_id desc
            limit 1
            for update`,
          [activityId, pupilId],
        )
        let id = latest[0]?.submission_id
        if (!id) {
          const { rows: created } = await client.query<{ submission_id: string }>(
            `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status, mark_status)
             values ($1, $2, 1, '{}'::json, now(), 'submitted', 'waiting')
             returning submission_id`,
            [activityId, pupilId],
          )
          id = created[0].submission_id
        }

        const { rows: old } = await client.query<{ original_path: string; page_paths: string[] }>(
          `delete from assessment_scripts
            where activity_id = $1 and pupil_id = $2 and (submission_id = $3 or submission_id is null)
            returning original_path, page_paths`,
          [activityId, pupilId, id],
        )
        replaced = old

        // The old marks and answers were for the old script. Question rows
        // are rebuilt from the teacher's criterion rows by the recompute. Rows
        // with a teacher's comment stay until the new marking overwrites
        // their mark, so the comment survives a re-scan.
        await client.query(
          `delete from submission_question_criterion_marks
            where submission_id = $1 and provenance <> 'teacher' and teacher_feedback is null`,
          [id],
        )
        await client.query("delete from submission_question_marks where submission_id = $1", [id])
        await client.query("delete from submission_question_answers where submission_id = $1", [id])

        await client.query(
          `insert into assessment_scripts
             (script_id, activity_id, pupil_id, submission_id, original_path, page_paths, page_count, front_sheet_check)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [scriptId, activityId, pupilId, id, originalPath, markable.map((entry) => entry.path), pageCount, frontSheetCheck],
        )
        await client.query(
          `update submissions
              set submission_status = 'submitted', mark_status = $2, mark_error = $3
            where submission_id = $1`,
          [id, passed ? "waiting" : null, passed ? null : frontSheetCheck],
        )
        // Jobs queued for the old script must not run on a held one.
        if (!passed) {
          await client.query(
            `update external_jobs set status = 'error', last_error = $2, updated_at = now()
              where job_type in ('ai_mark', 'ai_read') and status in ('pending', 'processing')
                and payload ->> 'submissionId' = $1`,
            [id, frontSheetCheck],
          )
        }
        await recomputeAssessmentSubmission(client, id)
        await client.query("COMMIT")
        return id
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
  } catch (error) {
    await removeStored(stored)
    throw error
  }

  await removeStored(replaced.flatMap((script) => [script.original_path, ...script.page_paths]))

  const result = {
    script_id: scriptId,
    submission_id: submissionId,
    page_count: pageCount,
    replaced_scripts: replaced.length,
    front_sheet_check: frontSheetCheck,
  }
  if (!passed) return { ...result, marking: "held", message: `Stored, not sent. ${frontSheetCheck}` }

  await enqueueMarkingTasks(assignmentId, [{ submissionId }])
  // The queue may hold the submission too; report what it did.
  const { rows: status } = await query<{ mark_status: string | null; mark_error: string | null }>(
    "select mark_status, mark_error from submissions where submission_id = $1",
    [submissionId],
  )
  if (!status[0]?.mark_status) {
    return { ...result, marking: "held", message: `Stored, not sent. ${status[0]?.mark_error ?? ""}`.trim() }
  }
  void triggerQueueProcessor()
  return { ...result, marking: "queued", message: "Stored and sent for marking." }
}

/** How many pages a script has, without rendering it. */
async function countScriptPages(bytes: Buffer, kind: FileKind): Promise<number> {
  if (kind !== "pdf") return 1
  try {
    return await pdfPageCount(bytes)
  } catch {
    throw new Error("Could not read the PDF. Is it a valid PDF file?")
  }
}

/**
 * Attach an old script (from a paper folded in from the assessments module)
 * to an existing submission. Unlike storeScript, nothing is cleared, nothing
 * is checked and nothing is sent for marking: the submission keeps its old
 * marks. Only the original is stored; with no markable pages and no front
 * sheet check, readMarkablePages refuses it.
 */
export async function attachLegacyScript(input: {
  activityId: string
  pupilId: string
  submissionId: string
  fileName: string
  bytes: Buffer
  uploadedBy?: string | null
}): Promise<{ script_id: string; page_count: number }> {
  const { activityId, pupilId, submissionId, bytes } = input
  assertUploadSize(bytes)
  const kind = sniffFileKind(bytes)
  if (!kind) throw new Error(`${input.fileName}: a script must be a PDF, JPEG or PNG.`)

  await readAssessmentActivity(activityId, { scripts: true })
  const { rows: owner } = await query<{ submission_id: string }>(
    "select submission_id from submissions where submission_id = $1 and activity_id = $2 and user_id = $3",
    [submissionId, activityId, pupilId],
  )
  if (!owner[0]) throw new Error(`Submission ${submissionId} is not this pupil's submission for this activity.`)

  const pageCount = await countScriptPages(bytes, kind)
  const scriptId = randomUUID()
  const originalPath = `${activityId}/scripts/${scriptId}/original.${EXTENSIONS[kind]}`

  await upload(originalPath, bytes, MIME_TYPES[kind], input.uploadedBy ?? null)
  try {
    await query(
      `insert into assessment_scripts
         (script_id, activity_id, pupil_id, submission_id, original_path, page_count)
       values ($1, $2, $3, $4, $5, $6)`,
      [scriptId, activityId, pupilId, submissionId, originalPath, pageCount],
    )
  } catch (error) {
    await removeStored([originalPath])
    throw error
  }

  return { script_id: scriptId, page_count: pageCount }
}

/** One markable page: its page number in the whole script (2..n) and its PNG. */
export type MarkablePage = { pageNumber: number; bytes: Buffer }

/**
 * The markable pages of a script, pages 2..n in order. The only loader a
 * model call may use: it never reads the original or page 1, and refuses a
 * script whose front sheet check has not passed.
 */
export async function readMarkablePages(scriptId: string): Promise<MarkablePage[]> {
  const { rows } = await query<{ activity_id: string; page_paths: string[] | null; front_sheet_check: string | null }>(
    "select activity_id, page_paths, front_sheet_check from assessment_scripts where script_id::text = $1",
    [scriptId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Script ${scriptId} not found.`)
  if (row.front_sheet_check !== "passed") {
    throw new Error(
      row.front_sheet_check
        ? `Script ${scriptId} failed the front sheet check; it cannot be read or marked. ${row.front_sheet_check}`
        : `Script ${scriptId} has not passed the front sheet check; it cannot be read or marked.`,
    )
  }
  const paths = row.page_paths ?? []
  if (paths.length === 0) throw new Error(`Script ${scriptId} has no markable pages.`)

  const expected = new RegExp(`^${escapeRegExp(`${row.activity_id}/scripts/${scriptId}/`)}page-(\\d+)\\.png$`)
  const pages = paths.map((p) => {
    const pageNumber = Number.parseInt(p.match(expected)?.[1] ?? "", 10)
    // Page 1 is the front sheet: never a markable page, whatever the row says.
    if (!Number.isFinite(pageNumber) || pageNumber < 2) {
      throw new Error(`Script ${scriptId} lists a page that is not a markable page: ${p}`)
    }
    return { pageNumber, path: p }
  })
  pages.sort((a, b) => a.pageNumber - b.pageNumber)

  return Promise.all(pages.map(async (page) => ({ pageNumber: page.pageNumber, bytes: await readStoredFile(page.path) })))
}

/** The script a model reads for a submission: its newest one that passed the front sheet check. */
export async function readMarkableScriptId(submissionId: string): Promise<string | null> {
  const { rows } = await query<{ script_id: string }>(
    `select script_id::text as script_id from assessment_scripts
      where submission_id = $1 and front_sheet_check = 'passed' and cardinality(page_paths) > 0
      order by uploaded_at desc, script_id desc
      limit 1`,
    [submissionId],
  )
  return rows[0]?.script_id ?? null
}

/**
 * Pupils' latest submissions whose script has never been marked and is not
 * queued: a script that passed the front sheet check, no question, criterion
 * or answer rows of any provenance (so anything a teacher marked is left
 * alone), no open read or mark job, and never a paper folded in from the old
 * assessments module.
 */
export async function listUnmarkedScriptSubmissions(
  activityId: string,
): Promise<Array<{ submissionId: string; pupilId: string }>> {
  const { rows } = await query<{ submission_id: string; user_id: string }>(
    `with latest as (
       select distinct on (s.user_id) s.submission_id, s.user_id
         from submissions s
        where s.activity_id = $1
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select l.submission_id, l.user_id
       from latest l
      where exists (select 1 from activities a
                     where a.activity_id = $1 and a.type = 'assessment-paper'
                       and not coalesce(a.body_data ? 'foldedFromAssessmentIds', false))
        and exists (select 1 from assessment_scripts sc
                     where sc.submission_id = l.submission_id and sc.front_sheet_check = 'passed'
                       and cardinality(sc.page_paths) > 0)
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

/** Each script's front sheet check on an activity: passed, held, or never checked (folded papers). */
export async function countFrontSheetChecks(
  activityId: string,
): Promise<{ passed: number; failed: number; unchecked: number }> {
  const { rows } = await query<{ passed: number; failed: number; unchecked: number }>(
    `select count(*) filter (where front_sheet_check = 'passed')::int as passed,
            count(*) filter (where front_sheet_check <> 'passed')::int as failed,
            count(*) filter (where front_sheet_check is null)::int as unchecked
       from assessment_scripts where activity_id = $1`,
    [activityId],
  )
  return rows[0] ?? { passed: 0, failed: 0, unchecked: 0 }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether the pupil has sat the paper: their own script is uploaded, or, on a
 * paper folded in from the old assessments module (marks, no scripts), they
 * have a result on it. Until then the question paper stays hidden from them.
 */
export async function pupilHasSatAssessment(activityId: string, pupilId: string): Promise<boolean> {
  const { rows } = await query<{ sat: boolean }>(
    `select exists (select 1 from assessment_scripts where activity_id = $1 and pupil_id = $2)
         or exists (select 1 from submissions s join activities a on a.activity_id = s.activity_id
                     where s.activity_id = $1 and s.user_id = $2 and a.body_data::jsonb ? 'foldedFromAssessmentIds')
         as sat`,
    [activityId, pupilId],
  )
  return rows[0]?.sat === true
}

/**
 * Whether a non-teacher may open a file in the assessment-scripts bucket: the
 * question paper once they have sat it (pupilHasSatAssessment), and the
 * original of their own script once the lesson's feedback is visible to them.
 * The mark scheme and the markable pages are for teachers. A PowerPoint
 * assessment's paper files follow pupilMayOpenPowerPointPaperFile; its pupils'
 * files ({activityId}/practical/...) are checked by pupilMayOpenPracticalFile
 * (src/lib/powerpoint-assessment/files.ts), never here.
 */
export async function pupilMayOpenAssessmentPaperFile(pupilId: string, segments: string[]): Promise<boolean> {
  const [activityId, folder] = segments
  if (!activityId) return false
  if (folder === "paper") {
    if (segments.length !== 3) return false
    const { rows } = await query<{ type: string | null; body_data: unknown }>(
      "select type, body_data from activities where activity_id = $1",
      [activityId],
    )
    if (!rows[0]) return false
    const body = AssessmentPaperActivityBodySchema.safeParse(rows[0].body_data ?? {})
    const path = segments.join("/")
    if (isPowerPointAssessmentType(rows[0].type)) {
      return pupilMayOpenPowerPointPaperFile(activityId, pupilId, path, body.success ? body.data : {})
    }
    if (!isAssessmentPaperType(rows[0].type)) return false
    const questionPaperPath = body.success ? body.data.questionPaperPath : undefined
    if (!questionPaperPath || questionPaperPath !== path) return false
    return pupilHasSatAssessment(activityId, pupilId)
  }
  return pupilMayOpenOwnScript(pupilId, segments)
}

/**
 * A PowerPoint assessment is done in class with its question paper open, so
 * a pupil the lesson is set to may open the question paper at any time, but
 * not while the lesson is locked for them (a locked lesson allows no
 * downloads). The mark scheme PDF is never served to a pupil, as for an
 * assessment paper; showMarkSchemeToPupils only decides whether the feedback
 * includes each question's mark scheme text.
 */
async function pupilMayOpenPowerPointPaperFile(
  activityId: string,
  pupilId: string,
  path: string,
  body: { questionPaperPath?: string },
): Promise<boolean> {
  if (!body.questionPaperPath || body.questionPaperPath !== path) return false
  const sits = await assertPupilSitsAssessment(activityId, pupilId).then(
    (sitting) => sitting,
    () => null,
  )
  if (!sits) return false
  return !(await isLessonLockedForUser(pupilId, sits.lessonId))
}

async function pupilMayOpenOwnScript(pupilId: string, segments: string[]): Promise<boolean> {
  const [activityId, folder, scriptId, fileName, ...rest] = segments
  if (rest.length > 0 || folder !== "scripts" || !UUID_RE.test(scriptId ?? "")) return false
  if (!/^original\.[a-z0-9]+$/.test(fileName ?? "")) return false

  const { rows } = await query<{ lesson_id: string }>(
    `select a.lesson_id
       from assessment_scripts s
       join activities a on a.activity_id = s.activity_id
      where s.script_id = $1::uuid and s.activity_id = $2 and s.pupil_id = $3 and s.original_path = $4`,
    [scriptId, activityId, pupilId, segments.join("/")],
  )
  if (!rows[0]) return false
  return (await readFeedbackVisibility(pupilId, rows[0].lesson_id)).visible_to_pupil
}
