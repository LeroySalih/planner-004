import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import { NextRequest } from 'next/server'
import PDFDocument from 'pdfkit'

import { query } from '@/lib/db'
import { POST as redeemUploadLink } from '@/app/api/MCP/upload/[token]/route'
import { ASSESSMENT_SCRIPTS_BUCKET, storePaperFile } from '@/lib/assessment-paper/files'
import { renderClassFeedbackPdf } from '@/lib/assessment-paper/class-feedback-pdf'
import { readAssessmentQuestions, setAssessmentQuestions } from '@/lib/assessment-paper/store'
import { updateActivity } from '@/lib/mcp/activities'
import {
  AssessmentActivityQuestionsInput,
  getAssessmentActivity,
  getAssessmentActivityResult,
  getPracticalAssessmentEvidence,
  handInPowerPointAssessmentForPupil,
  resolveClassFeedbackTarget,
  toAssessmentQuestionInputs,
} from '@/lib/mcp/assessment-activities'
import type { McpCaller } from '@/lib/mcp/auth'
import { createClassFeedbackDownloadLink, createScriptDownloadLink } from '@/lib/mcp/download-links'
import { getPupilLessonFeedback } from '@/lib/mcp/pupil-feedback'
import { createUploadLink, uploadLinkMaxBytes } from '@/lib/mcp/upload-links'
import { inspectPptx } from '@/lib/pptx/inspect'
import { readEvidenceDocument } from '@/lib/docx/evidence'
import { pdfPageCount, pdfText } from '@/lib/pdf/poppler'
import { LESSONS_BUCKET, listSuppliedImages, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { readPowerPointSubmission, type PowerPointReaders } from '@/lib/powerpoint-assessment/reading'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The MCP side of a PowerPoint assessment: evidence sources round-tripped
// through set_assessment_activity_questions' input (JSON strings included,
// kept when omitted, refused on a bad slot and on an assessment paper); the
// upload links for a supplied image and a pupil's file (refusals when made,
// the row shapes the migration 143 constraint allows and refuses, the size
// caps) and redeeming both through the upload route; what the reader stored,
// as get_practical_assessment_evidence reports it (no picture data); the
// overview and one pupil's result for this type; the script link refused;
// a teacher's hand-in; the class feedback PDF; and update_activity keeping the
// paper-owned body keys. No model is called: the read is run directly with
// the slide renderer stubbed, and the hand-in is on teacher-only questions
// (its queued read is removed at once). Creates its own unit, lesson,
// activities, class and pupils, and removes them. Never prints names.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/mcp.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refused(run: () => Promise<unknown> | unknown, pattern: RegExp): Promise<[boolean, string]> {
  try {
    await run()
    return [false, 'not refused']
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [pattern.test(message), message]
  }
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-m-check-unit-${tag}`
const LESSON = `ppt-m-check-lesson-${tag}`
const PPT = randomUUID()
const PAPER = randomUUID()
const GROUP = `ppt-m-check-group-${tag}`
const PUPIL = `ppt-m-check-pupil-${tag}`
const EMPTY = `ppt-m-check-empty-${tag}`
const OUTSIDER = `ppt-m-check-outsider-${tag}`
const TEACHER = `ppt-m-check-teacher-${tag}`
const PEOPLE = [PUPIL, EMPTY, OUTSIDER, TEACHER]
const PPT_TITLE = `PowerPoint MCP task ${tag}`

const SLOTS = [
  { key: 'presentation', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'handouts', label: 'Handouts printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true },
]

const caller: McpCaller = { method: 'service_key', userId: null, clientId: null }

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    `insert into profiles (user_id, first_name, last_name) values
       ($1, 'Ann', 'Aaa'), ($2, 'Eve', 'Eee'), ($3, 'Oli', 'Ooo'), ($4, 'Tia', 'Ttt')`,
    PEOPLE,
  )
  await query(
    "insert into user_roles (user_id, role_id) values ($1, 'pupil'), ($2, 'pupil'), ($3, 'pupil'), ($4, 'teacher')",
    PEOPLE,
  )
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint MCP unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint MCP check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'powerpoint-assessment', $4, $5::jsonb, 0),
       ($2, $3, 'assessment-paper', 'A paper', '{}'::jsonb, 1)`,
    [PPT, PAPER, LESSON, PPT_TITLE, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) values ($1, $2), ($1, $3)', [GROUP, PUPIL, EMPTY])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  for (const [bucket, prefix] of [[ASSESSMENT_SCRIPTS_BUCKET, PPT], [ASSESSMENT_SCRIPTS_BUCKET, PAPER], [LESSONS_BUCKET, `lessons/${LESSON}/`], [LESSONS_BUCKET, `${LESSON}/`]] as const) {
    const { rows } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [bucket, `${prefix}%`],
    )
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  for (const folder of [PPT, PAPER]) {
    await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, folder), { recursive: true, force: true })
  }
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, 'lessons', LESSON), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
  await query('delete from mcp_upload_links where lesson_id = $1', [LESSON])
  await query('delete from mcp_download_links where lesson_id = $1', [LESSON])
  await query('delete from mcp_audit_log where arguments::text like $1', [`%${PPT}%`])
  await query('delete from submissions where user_id = any($1::text[])', [PEOPLE])
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = any($1::text[])', [PEOPLE])
  await query('delete from profiles where user_id = any($1::text[])', [PEOPLE])
}

function pdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    pages.forEach((text, i) => {
      if (i > 0) doc.addPage()
      doc.fontSize(18).text(text)
    })
    doc.end()
  })
}

const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 })
const p = (text: string) => new Paragraph({ children: [new TextRun(text)] })
const pic = (data: Buffer) =>
  new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: 120, height: 80 } })] })

async function docx(children: Paragraph[]) {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })))
}

/** Redeem an upload link through the route, as curl would with raw bytes. */
async function redeem(uploadUrl: string, bytes: Buffer, fileName: string) {
  const token = uploadUrl.split('/').pop()!
  const request = new NextRequest(`http://localhost/api/MCP/upload/${token}?file_name=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    body: new Uint8Array(bytes),
    headers: { 'content-type': 'application/octet-stream' },
  })
  const response = await redeemUploadLink(request, { params: Promise.resolve({ token }) })
  return { status: response.status, json: (await response.json()) as { success: boolean; error?: string; file?: Record<string, unknown> } }
}

async function link(target: Parameters<typeof createUploadLink>[1]) {
  const { token } = await createUploadLink(caller, target)
  return `http://localhost/api/MCP/upload/${token}`
}

/** Every key anywhere in a value. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, out))
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.add(key)
      keysOf(inner, out)
    }
  }
  return out
}

/** JSON with object keys sorted, as jsonb does not keep their order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner)
}

const LONG_BASE64 = /[A-Za-z0-9+/]{400,}={0,2}/

const readers: PowerPointReaders = {
  inspectPptx,
  readEvidenceDocument,
  pdfPageCount,
  pdfText,
  renderPresentation: async () => ({ pdf: null, error: 'renderer stubbed in the check' }),
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const camel = await readFile(path.join(FIXTURES, 'pearl-images', 'CAMEL.jpg'))
  const logo = await readFile(path.join(FIXTURES, 'pearl-images', 'LOGO.png'))

  await setUp()
  try {
    // --- Evidence through set_assessment_activity_questions' input ----------------
    const evidenceT1 = [
      { source: 'presentation', slot: 'presentation', sections: ['master', 'slides:1'] },
      { source: 'evidence_section', slot: 'evidence', heading: 'T1', want: 'screenshots', required: true },
    ]
    const toolInput = JSON.stringify([
      { label: 'T1', max_marks: 1, mark_scheme: 'One mark for the screenshot.', evidence: evidenceT1, criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      // Evidence as a JSON string inside the question, as some clients send it.
      { label: 'T2', max_marks: 1, mark_scheme: 'One mark for the slides.', evidence: JSON.stringify([{ source: 'slide_images', slot: 'presentation', slides: [1] }, { source: 'file', slot: 'handouts' }]), criteria: [{ success_criteria_id: B, max_marks: 1 }] },
    ])
    const parsed = AssessmentActivityQuestionsInput.parse(toolInput)
    await setAssessmentQuestions(PPT, toAssessmentQuestionInputs(parsed))
    let overview = await getAssessmentActivity(PPT)
    const t1 = overview.questions.find((q) => q.label === 'T1')
    const t2 = overview.questions.find((q) => q.label === 'T2')
    check('evidence round-trips through the tool input',
      canonical(t1?.evidence) === canonical(evidenceT1) && t2?.evidence?.length === 2,
      JSON.stringify([t1?.evidence, t2?.evidence]))

    // Omitted: kept.
    await setAssessmentQuestions(PPT, toAssessmentQuestionInputs(AssessmentActivityQuestionsInput.parse([
      { label: 'T1', max_marks: 1, mark_scheme: 'One mark for the screenshot.', criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      { label: 'T2', max_marks: 1, mark_scheme: 'One mark for the slides.', criteria: [{ success_criteria_id: B, max_marks: 1 }] },
    ])))
    const kept = await readAssessmentQuestions(PPT)
    check('evidence omitted is kept', kept.find((q) => q.label === 'T1')?.evidence.length === 2 && kept.find((q) => q.label === 'T2')?.evidence.length === 2)

    let [ok, detail] = await refused(() => setAssessmentQuestions(PPT, toAssessmentQuestionInputs(AssessmentActivityQuestionsInput.parse([
      { label: 'T1', max_marks: 1, evidence: [{ source: 'file', slot: 'nope' }], criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      { label: 'T2', max_marks: 1, criteria: [{ success_criteria_id: B, max_marks: 1 }] },
    ]))), /nope/)
    check('evidence naming an unknown slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => setAssessmentQuestions(PAPER, toAssessmentQuestionInputs(AssessmentActivityQuestionsInput.parse([
      { label: 'Q1', max_marks: 1, evidence: [{ source: 'file', slot: 'handouts' }], criteria: [{ success_criteria_id: A, max_marks: 1 }] },
    ]))), /take no evidence sources/)
    check('evidence on an assessment paper is refused', ok, detail)

    // --- Upload links: refusals when made ------------------------------------------
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'script', pupilId: PUPIL, fileName: null }), /PowerPoint assessment, which has no scripts/)
    check('a script link on a PowerPoint assessment is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PAPER, uploadKind: 'supplied_image', fileName: 'Camel' }), /not a PowerPoint assessment/)
    check('a supplied image link on an assessment paper is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'supplied_image', pupilId: PUPIL, fileName: 'Camel' }), /only for kind "practical_file"/)
    check('a supplied image link naming a pupil is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'supplied_image', fileName: 'a/b' }), /may not contain/)
    check('a supplied image name with a slash is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: PUPIL, fileName: null }), /slot is required/)
    check('a pupil file link without a slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'practical_file', slotKey: 'presentation', fileName: null }), /pupil_id is required/)
    check('a pupil file link without a pupil is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: PUPIL, slotKey: 'nope', fileName: null }), /No upload slot "nope"/)
    check('a pupil file link for an unknown slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: OUTSIDER, slotKey: 'presentation', fileName: null }), /not a pupil in a class/)
    check('a pupil file link for a pupil not set the lesson is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'mark_scheme', slotKey: 'presentation', fileName: null }), /only for kind "practical_file"/)
    check('a mark scheme link naming a slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: PUPIL, slotKey: 'presentation', fileName: 'Deck' }), /image_name is only for kind "supplied_image"/)
    check('an image name on a pupil file link is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: PPT, uploadKind: 'mark_scheme', fileName: 'Scheme' }), /image_name is only for kind "supplied_image"/)
    check('an image name on a mark scheme link is refused', ok, detail)

    // --- Upload links: the stored shapes ----------------------------------------------
    const imageUrl = await link({ assessmentActivityId: PPT, uploadKind: 'supplied_image', fileName: 'Camel picture' })
    const fileUrl = await link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: PUPIL, slotKey: 'presentation', fileName: null })
    const { rows: shapes } = await query<{ upload_kind: string; pupil_id: string | null; slot_key: string | null; file_name: string | null; target: string }>(
      "select upload_kind, pupil_id, slot_key, file_name, target from mcp_upload_links where activity_id = $1 and used_at is null order by upload_kind",
      [PPT],
    )
    const practicalRow = shapes.find((r) => r.upload_kind === 'practical_file')
    const imageRow = shapes.find((r) => r.upload_kind === 'supplied_image')
    check('a pupil file link stores its pupil and slot, no name',
      practicalRow?.pupil_id === PUPIL && practicalRow.slot_key === 'presentation' && practicalRow.file_name === null && practicalRow.target === 'assessment-activity',
      JSON.stringify(practicalRow))
    check('a supplied image link stores its name, no pupil or slot',
      imageRow?.pupil_id === null && imageRow.slot_key === null && imageRow.file_name === 'Camel picture', JSON.stringify(imageRow))

    const badShape = (uploadKind: string, pupilId: string | null, slotKey: string | null) =>
      refused(() => query(
        `insert into mcp_upload_links (token_hash, target, lesson_id, activity_id, pupil_id, upload_kind, slot_key, auth_method, expires_at)
         values ($1, 'assessment-activity', $2, $3, $4, $5, $6, 'service_key', now() + interval '1 minute')`,
        [`check-${randomUUID()}`, LESSON, PPT, pupilId, uploadKind, slotKey],
      ), /mcp_upload_links_target_shape/)
    ;[ok, detail] = await badShape('supplied_image', PUPIL, null)
    check('the constraint refuses a supplied image naming a pupil', ok, detail)
    ;[ok, detail] = await badShape('practical_file', PUPIL, null)
    check('the constraint refuses a pupil file with no slot', ok, detail)
    ;[ok, detail] = await badShape('practical_file', null, 'presentation')
    check('the constraint refuses a pupil file with no pupil', ok, detail)
    ;[ok, detail] = await badShape('script', PUPIL, 'presentation')
    check('the constraint refuses a script naming a slot', ok, detail)

    check('the size caps: supplied image 10 MB, pupil file 25 MB',
      uploadLinkMaxBytes({ target: 'assessment-activity', assessment_id: null, upload_kind: 'supplied_image' }) === 10 * 1024 * 1024
        && uploadLinkMaxBytes({ target: 'assessment-activity', assessment_id: null, upload_kind: 'practical_file' }) === 25 * 1024 * 1024)

    // --- Redeeming the links --------------------------------------------------------
    const imageUpload = await redeem(imageUrl, camel, 'CAMEL.jpg')
    const images = await listSuppliedImages(PPT)
    check('a supplied image link stores the image under its name',
      imageUpload.status === 200 && imageUpload.json.file?.name === 'Camel picture' && imageUpload.json.file?.file_name === 'CAMEL.jpg'
        && Array.isArray(imageUpload.json.file?.warnings) && images.length === 1 && images[0].name === 'Camel picture',
      JSON.stringify(imageUpload))
    const again = await redeem(imageUrl, camel, 'CAMEL.jpg')
    check('a used link is refused', again.status === 401, String(again.status))
    const logoUpload = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'supplied_image', fileName: null }), logo, 'LOGO.png')
    check('a supplied image link without a name names it after its file', logoUpload.json.file?.name === 'LOGO', JSON.stringify(logoUpload.json))
    const notImage = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'supplied_image', fileName: 'Bad' }), Buffer.from('not an image'), 'bad.png')
    check('a supplied image that is not an image is refused as the file\'s fault', notImage.status === 422 && /PNG, JPEG, GIF or WebP/.test(notImage.json.error ?? ''), JSON.stringify(notImage))

    const evidenceDoc = await docx([h1('T1'), p('My screenshot:'), pic(logo), h1('Other'), p('Not read.')])
    const wrong = await redeem(fileUrl, evidenceDoc, 'deck.docx')
    check('a pupil file of the wrong kind is refused, the link given back', wrong.status === 422, JSON.stringify(wrong))
    const deck = await redeem(fileUrl, pptx, 'My deck.pptx')
    const { rows: [afterDeck] } = await query<{ submission_status: string | null; mark_status: string | null }>(
      'select submission_status, mark_status from submissions where activity_id = $1 and user_id = $2', [PPT, PUPIL])
    check('a pupil file link stores the file in its slot and does not hand in',
      deck.status === 200 && deck.json.file?.slot_key === 'presentation' && deck.json.file?.requeued === false
        && afterDeck?.submission_status === 'inprogress',
      JSON.stringify({ deck, afterDeck }))
    const { rows: [{ n: jobsAfterUpload }] } = await query<{ n: number }>(
      "select count(*)::int as n from external_jobs where payload->>'submissionId' = $1", [deck.json.file?.submission_id])
    check('nothing is queued by the upload', jobsAfterUpload === 0, String(jobsAfterUpload))
    const { rows: audit } = await query<{ arguments: Record<string, unknown> }>(
      "select arguments from mcp_audit_log where tool = 'file_upload:link' and arguments->>'activity_id' = $1 and arguments->>'upload_kind' = 'practical_file'",
      [PPT],
    )
    check('the audit log has the pupil file\'s type, not its name',
      audit.length > 0 && audit.every((row) => !('file_name' in row.arguments) && row.arguments.file_ext !== undefined),
      JSON.stringify(audit.map((row) => Object.keys(row.arguments))))

    const store = (slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey, bytes, originalName, uploadedBy: PUPIL })
    await store('handouts', await pdf(['Handout one', 'Handout two']), 'Handouts.pdf')
    await store('evidence', evidenceDoc, 'EVIDENCE.docx')
    const submissionId = String(deck.json.file?.submission_id)

    // --- What the reader stored -------------------------------------------------------
    const unread = await getPracticalAssessmentEvidence({ activityId: PPT, pupilId: PUPIL })
    check('before the read, each file is listed with read null', unread.slots.length === 3 && unread.slots.every((s) => s.file && s.read === null), JSON.stringify(unread.slots.map((s) => s.read)))
    await readPowerPointSubmission({ submissionId }, readers)
    const evidence = await getPracticalAssessmentEvidence({ activityId: PPT, pupilId: PUPIL })
    const bySlot = new Map(evidence.slots.map((s) => [s.slot_key, s]))
    const presentation = bySlot.get('presentation')?.read as Record<string, any> | null
    const handouts = bySlot.get('handouts')?.read as Record<string, any> | null
    const evidenceRead = bySlot.get('evidence')?.read as Record<string, any> | null
    check('the presentation: sections with key, title and text',
      presentation?.status === 'ok' && presentation.kind === 'presentation' && presentation.slide_count > 0
        && Array.isArray(presentation.sections) && presentation.sections.length > 0
        && presentation.sections.every((s: any) => typeof s.key === 'string' && typeof s.title === 'string' && typeof s.text === 'string')
        && presentation.sections[0].key === 'presentation',
      JSON.stringify(presentation?.sections?.map((s: any) => s.key)))
    check('the presentation: slides not drawn, with the reason',
      presentation?.slide_images?.status === 'unavailable' && /stubbed/.test(presentation.slide_images.reason)
        && presentation.warnings.some((w: string) => /stubbed/.test(w)),
      JSON.stringify(presentation?.slide_images))
    check('the PDF: page count and text length, no text',
      handouts?.status === 'ok' && handouts.page_count === 2 && handouts.text_chars > 0 && handouts.text_truncated === false && !('text' in handouts),
      JSON.stringify(handouts))
    const t1Section = evidenceRead?.sections?.find((s: any) => s.label === 'T1')
    check('the evidence document: the heading read, its text and picture count',
      evidenceRead?.status === 'ok' && t1Section?.images === 1 && /My screenshot/.test(t1Section.text) && Array.isArray(evidenceRead.missing_headings),
      JSON.stringify(evidenceRead))
    const serialised = JSON.stringify(evidence)
    const keys = keysOf(evidence)
    check('no picture data, paths or fingerprints are returned',
      !LONG_BASE64.test(serialised) && !/base64|data:image/i.test(serialised)
        && !keys.has('path') && !keys.has('fingerprint') && !keys.has('storage_path') && !keys.has('data'),
      [...keys].filter((k) => ['path', 'fingerprint', 'storage_path', 'data'].includes(k)).join(','))
    const one = await getPracticalAssessmentEvidence({ activityId: PPT, pupilId: PUPIL, slot: 'presentation', sections: ['slides:1'] })
    const oneSections = (one.slots[0]?.read as Record<string, any> | null)?.sections ?? []
    check('a slot and sections narrow it', one.slots.length === 1 && oneSections.length > 0 && oneSections.every((s: any) => s.key === 'slide:1'),
      JSON.stringify(oneSections.map((s: any) => s.key)))
    ;[ok, detail] = await refused(() => getPracticalAssessmentEvidence({ activityId: PPT, pupilId: PUPIL, slot: 'nope' }), /No upload slot "nope"/)
    check('an unknown slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => getPracticalAssessmentEvidence({ activityId: PPT, pupilId: PUPIL, sections: ['slides', 'slide:1', 'masters'] }), /Unknown presentation sections: "slide:1", "masters"\. Use presentation, master, .*slides:N/)
    check('unknown presentation sections are refused, listing the valid ones', ok, detail)
    ;[ok, detail] = await refused(() => getPracticalAssessmentEvidence({ activityId: PAPER, pupilId: PUPIL }), /not a PowerPoint assessment/)
    check('the evidence of an assessment paper is refused', ok, detail)

    // --- get_assessment_activity for this type ----------------------------------------------
    overview = await getAssessmentActivity(PPT)
    const me = overview.pupils.find((pp) => pp.pupil_id === PUPIL) as Record<string, any> | undefined
    const empty = overview.pupils.find((pp) => pp.pupil_id === EMPTY) as Record<string, any> | undefined
    check('the overview is a PowerPoint assessment with its slots and images',
      overview.kind === 'powerpoint-assessment' && overview.body.has_mark_scheme === false
        && 'upload_slots' in overview.body && overview.body.upload_slots.length === 3
        && overview.supplied_images.length === 2 && !('scripts_count' in overview),
      JSON.stringify(overview.body))
    const imageKeys = keysOf(overview.kind === 'powerpoint-assessment' ? overview.supplied_images : [])
    check('supplied images carry no fingerprint, hash or path',
      !imageKeys.has('fingerprint') && !imageKeys.has('sha256') && !imageKeys.has('storage_path') && imageKeys.has('file_name'),
      [...imageKeys].join(','))
    check('a pupil: handed in, files per slot with the reader\'s status, no script fields',
      me?.handed_in === false && me.files.length === 3 && me.files.every((f: any) => f.file?.reader_status === 'ok')
        && me.missing_required.length === 0 && !('script_uploaded' in me) && !('front_sheet_check' in me),
      JSON.stringify(me))
    check('a pupil with nothing uploaded: empty slots, required ones listed',
      empty?.submission_id === null && empty.files.every((f: any) => f.file === null)
        && JSON.stringify(empty.missing_required) === JSON.stringify(['Presentation', 'Evidence document']),
      JSON.stringify(empty))
    const paperOverview = await getAssessmentActivity(PAPER)
    check('an assessment paper\'s overview is unchanged', paperOverview.kind === 'assessment-paper' && 'scripts_count' in paperOverview && 'front_sheet_checks' in paperOverview)

    // --- get_assessment_activity_result for this type -----------------------------------------
    const questions = await readAssessmentQuestions(PPT)
    const t1Id = questions.find((q) => q.label === 'T1')!.questionId
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance, marker_evidence)
       values ($1, $2, 'mixed', 'One screenshot under T1.', '{}', 'answered', 'ai', 'The screenshot shows the slide master.')`,
      [submissionId, t1Id],
    )
    await query(
      `insert into submission_question_criterion_marks (submission_id, question_id, success_criteria_id, awarded, available, provenance, ai_awarded)
       values ($1, $2, $3, 1, 1, 'ai', 1)`,
      [submissionId, t1Id, A],
    )
    const result = await getAssessmentActivityResult(PPT, PUPIL)
    const r1 = result.questions.find((q) => q.label === 'T1') as Record<string, any>
    check('the result has the files in place of a script',
      result.script === null && result.powerpoint?.handed_in === false && result.powerpoint.files.length === 3
        && result.powerpoint.files.every((f) => f.reader_status === 'ok' && f.file_name),
      JSON.stringify(result.powerpoint))
    check('each question has its evidence sources, the marker\'s note and ai_awarded',
      r1.evidence_sources?.length === 2 && r1.marker_evidence === 'The screenshot shows the slide master.'
        && r1.criteria[0].ai_awarded === 1 && r1.answer?.kind === 'mixed',
      JSON.stringify(r1))
    const paperResult = await getAssessmentActivityResult(PAPER, PUPIL)
    check('an assessment paper\'s result has no PowerPoint fields',
      paperResult.powerpoint === null && paperResult.questions.every((q) => !('marker_evidence' in q)))

    // --- Script link refused ------------------------------------------------------------
    ;[ok, detail] = await refused(() => createScriptDownloadLink(caller, { activityId: PPT, pupilId: PUPIL }), /PowerPoint assessments have no scripts; use get_practical_assessment_evidence or the results page/)
    check('a script download link is refused for a PowerPoint assessment', ok, detail)

    // --- update_activity keeps the paper-owned keys ---------------------------------------
    await storePaperFile(PPT, 'mark_scheme', await pdf(['Mark scheme']))
    await updateActivity(PPT, { bodyData: { instructions: 'Changed.', uploadSlots: SLOTS, markSchemePath: 'somewhere/else.pdf' } })
    const { rows: [{ body_data: savedBody }] } = await query<{ body_data: Record<string, unknown> }>('select body_data from activities where activity_id = $1', [PPT])
    check('update_activity keeps the stored mark scheme path, whatever is sent',
      savedBody.instructions === 'Changed.' && savedBody.markSchemePath === `${PPT}/paper/mark-scheme.pdf`, JSON.stringify(savedBody))

    // --- Hand in for a pupil -------------------------------------------------------------
    ;[ok, detail] = await refused(() => handInPowerPointAssessmentForPupil({ activityId: PPT, pupilId: EMPTY, teacherId: TEACHER }), /Upload your files before handing in/)
    check('hand-in with no files is refused', ok, detail)
    // Teacher-only questions, so the queued read sends nothing to a model.
    await setAssessmentQuestions(PPT, questions.map((q) => ({
      label: q.label,
      maxMarks: q.maxMarks,
      markScheme: q.markScheme,
      marking: 'teacher' as const,
      criteria: q.criteria.map((c) => ({ successCriteriaId: c.successCriteriaId, maxMarks: c.maxMarks })),
    })))
    const handIn = await handInPowerPointAssessmentForPupil({ activityId: PPT, pupilId: PUPIL, teacherId: TEACHER })
    await query("delete from external_jobs where payload->>'submissionId' = $1 and status = 'pending'", [submissionId])
    check('a teacher hands in for the pupil', handIn.already_handed_in === false && handIn.handed_in === true && handIn.submission_id === submissionId, JSON.stringify(handIn))
    const handInAgain = await handInPowerPointAssessmentForPupil({ activityId: PPT, pupilId: PUPIL, teacherId: TEACHER })
    check('handing in again does nothing', handInAgain.already_handed_in === true, JSON.stringify(handInAgain))
    ;[ok, detail] = await refused(() => handInPowerPointAssessmentForPupil({ activityId: PAPER, pupilId: PUPIL, teacherId: TEACHER }), /not a PowerPoint assessment/)
    check('hand-in on an assessment paper is refused', ok, detail)
    const handedOverview = await getAssessmentActivity(PPT)
    check('the overview counts the hand-in', handedOverview.kind === 'powerpoint-assessment' && handedOverview.handed_in_count === 1)

    // --- Pupil feedback and the class feedback PDF -------------------------------------------
    const feedback = await getPupilLessonFeedback(PUPIL, LESSON, PPT)
    const entry = feedback.activities.find((a: { activity_id?: string }) => a.activity_id === PPT) as Record<string, any> | undefined
    check('get_pupil_lesson_feedback says handed in, not script uploaded',
      entry?.assessment_paper?.handed_in === true && !('script_uploaded' in entry.assessment_paper),
      JSON.stringify(entry?.assessment_paper))
    const target = await resolveClassFeedbackTarget({ class: GROUP, unit: UNIT, activity: PPT_TITLE })
    check('the class feedback target resolves a PowerPoint assessment by title', target.activityId === PPT && target.groupId === GROUP)
    const { token: feedbackToken } = await createClassFeedbackDownloadLink(caller, { class: GROUP, unit: UNIT, activity: PPT })
    const rendered = await renderClassFeedbackPdf(PPT, GROUP)
    check('the class feedback link is made and its PDF builds',
      feedbackToken.length > 20 && rendered.buffer.subarray(0, 5).toString('latin1') === '%PDF-',
      String(rendered.buffer.length))
    check('the cover lists the class as a PowerPoint assessment: one handed in, one not',
      rendered.data.powerPoint === true && rendered.data.roster.length === 2
        && rendered.data.roster.filter((row) => row.status === 'not sat').length === 1 && rendered.data.pupils.length === 1,
      JSON.stringify(rendered.data.roster.map((row) => row.status)))
  } finally {
    await tearDown()
  }
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed')
  process.exit(failed ? 1 : 0)
}

main().catch(async (error) => {
  console.error(error)
  await tearDown().catch(() => null)
  process.exit(1)
})
