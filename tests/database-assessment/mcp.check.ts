import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { NextRequest } from 'next/server'

import { query } from '@/lib/db'
import { POST as redeemUploadLink } from '@/app/api/MCP/upload/[token]/route'
import { readAccessDatabase } from '@/lib/accdb/read'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { readAssessmentQuestions, setAssessmentQuestions } from '@/lib/assessment-paper/store'
import { readEvidenceDocument } from '@/lib/docx/evidence'
import { createActivity } from '@/lib/mcp/activities'
import {
  AssessmentActivityQuestionsInput,
  getAssessmentActivity,
  getAssessmentActivityResult,
  getPracticalAssessmentEvidence,
  handInPowerPointAssessmentForPupil,
  toAssessmentQuestionInputs,
} from '@/lib/mcp/assessment-activities'
import type { McpCaller } from '@/lib/mcp/auth'
import { createScriptDownloadLink } from '@/lib/mcp/download-links'
import { createUploadLink } from '@/lib/mcp/upload-links'
import { pdfPageCount, pdfText } from '@/lib/pdf/poppler'
import { inspectPptx } from '@/lib/pptx/inspect'
import { LESSONS_BUCKET, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { readPowerPointSubmission, type PowerPointReaders } from '@/lib/powerpoint-assessment/reading'
import { defaultDatabaseAssessmentBody } from '@/lib/practical-assessment/types'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The MCP side of a database assessment: create_activity through the lib
// (a database body; one with no accdb slot refused); database evidence through
// set_assessment_activity_questions' input (a PowerPoint-only source refused);
// the upload links (practical_file for the accdb slot made and redeemed through
// the upload route, an .mdb refused and the link given back; supplied_image and
// script refused); get_practical_assessment_evidence's database summary and
// description (no base64, no record values but the changes', sections narrow
// it, unknown selectors refused); get_assessment_activity (kind, slots,
// starting_database_file, no supplied images); get_assessment_activity_result
// (powerpoint.files and evidence_texts); the script download link refused with
// the database wording; and a teacher's hand-in. No model is called: the read
// is run directly, and the hand-in is on teacher-only questions (its queued
// read is removed at once). Creates its own unit, lesson, activity, class and
// pupils, and removes them. Never prints names.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/database-assessment/mcp.check.ts

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

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const tag = randomUUID().slice(0, 8)
const UNIT = `db-m-check-unit-${tag}`
const LESSON = `db-m-check-lesson-${tag}`
const GROUP = `db-m-check-group-${tag}`
const PUPIL = `db-m-check-pupil-${tag}`
const EMPTY = `db-m-check-empty-${tag}`
const TEACHER = `db-m-check-teacher-${tag}`
const PEOPLE = [PUPIL, EMPTY, TEACHER]
const TEMPLATE_FILE = 'EVIDENCE.docx'
const START_FILE = 'PALM GROVE VETS.accdb'
let ACT = ''

const caller: McpCaller = { method: 'service_key', userId: null, clientId: null }

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Eve', 'Eee'), ($3, 'Tia', 'Ttt')", PEOPLE)
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil'), ($2, 'pupil'), ($3, 'teacher')", PEOPLE)
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database MCP unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database MCP check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) values ($1, $2), ($1, $3)', [GROUP, PUPIL, EMPTY])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  const prefixes: [string, string][] = [[LESSONS_BUCKET, `lessons/${LESSON}/`], [LESSONS_BUCKET, `${LESSON}/`]]
  if (ACT) prefixes.push([ASSESSMENT_SCRIPTS_BUCKET, ACT])
  for (const [bucket, prefix] of prefixes) {
    const { rows } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [bucket, `${prefix}%`],
    )
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  if (ACT) await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, ACT), { recursive: true, force: true })
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, 'lessons', LESSON), { recursive: true, force: true })
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, LESSON), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
  await query('delete from mcp_upload_links where lesson_id = $1', [LESSON])
  await query('delete from mcp_download_links where lesson_id = $1', [LESSON])
  if (ACT) await query('delete from mcp_audit_log where arguments::text like $1', [`%${ACT}%`])
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
  readDatabase: readAccessDatabase,
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)
  const modelDb = await readFile(path.join(FIXTURES, 'palm-grove-model-answer.accdb'))
  const startDb = await readFile(path.join(FIXTURES, 'palm-grove-start.accdb'))
  const evidenceDoc = await readFile(path.join(FIXTURES, 'palm-grove-evidence-model-answer.docx'))
  const template = await readFile(path.join(FIXTURES, 'palm-grove-evidence-template.docx'))

  await setUp()
  try {
    // --- create_activity -----------------------------------------------------------
    let [ok, detail] = await refused(
      () => createActivity(LESSON, 'database-assessment', 'No database', {
        uploadSlots: [{ key: 'evidence', label: 'Evidence document', kind: 'docx', required: true }],
      }),
      /INVALID_BODY_DATA.*accdb.*"kind": "accdb" \| "pdf" \| "docx".*exactly one required accdb slot/,
    )
    check('create_activity refuses a database body with no accdb slot, with the database example', ok, detail)
    ;[ok, detail] = await refused(
      () => createActivity(LESSON, 'database-assessment', 'A pptx slot', {
        uploadSlots: [{ key: 'presentation', label: 'Presentation', kind: 'pptx', required: true }],
      }),
      /INVALID_BODY_DATA/,
    )
    check('create_activity refuses a pptx slot on a database assessment', ok, detail)
    const created = await createActivity(LESSON, 'database-assessment', `Database MCP task ${tag}`, {
      instructions: 'Complete the database tasks.',
      ...defaultDatabaseAssessmentBody(),
      evidenceTemplateFile: TEMPLATE_FILE,
      startingDatabaseFile: START_FILE,
    })
    ACT = created.activity_id
    check('create_activity makes a database assessment', created.type === 'database-assessment', JSON.stringify(created))

    // Teacher materials, as ordinary activity files.
    const lessons = createLocalStorageClient(LESSONS_BUCKET)
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${TEMPLATE_FILE}`, template, { contentType: 'application/octet-stream' })
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${START_FILE}`, startDb, { contentType: 'application/octet-stream' })

    // --- set_assessment_activity_questions with database evidence -------------------
    const evidenceD1 = [{ source: 'database', slot: 'database', sections: ['changes'] }]
    const toolInput = JSON.stringify([
      { label: 'D1', max_marks: 1, mark_scheme: 'One mark for the added records.', evidence: evidenceD1, criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      {
        label: '1', max_marks: 1, mark_scheme: 'One mark for the screenshot.',
        evidence: JSON.stringify([
          { source: 'database', slot: 'database', sections: ['query:MICROCHIP REMINDER'], required: true },
          { source: 'evidence_section', slot: 'evidence', want: 'screenshots' },
        ]),
        criteria: [{ success_criteria_id: B, max_marks: 1 }],
      },
    ])
    await setAssessmentQuestions(ACT, toAssessmentQuestionInputs(AssessmentActivityQuestionsInput.parse(toolInput)))
    let overview = await getAssessmentActivity(ACT)
    const d1 = overview.questions.find((q) => q.label === 'D1')
    const q1 = overview.questions.find((q) => q.label === '1')
    check('database evidence round-trips through the tool input',
      canonical(d1?.evidence) === canonical(evidenceD1) && q1?.evidence?.length === 2
        && (q1.evidence[0] as { source: string }).source === 'database',
      JSON.stringify([d1?.evidence, q1?.evidence]))
    ;[ok, detail] = await refused(() => setAssessmentQuestions(ACT, toAssessmentQuestionInputs(AssessmentActivityQuestionsInput.parse([
      { label: 'D1', max_marks: 1, evidence: [{ source: 'presentation', slot: 'database' }], criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      { label: '1', max_marks: 1, criteria: [{ success_criteria_id: B, max_marks: 1 }] },
    ]))), /presentation/)
    check('a PowerPoint-only source on a database assessment is refused', ok, detail)
    ;[ok, detail] = await refused(() => setAssessmentQuestions(ACT, toAssessmentQuestionInputs(AssessmentActivityQuestionsInput.parse([
      { label: 'D1', max_marks: 1, evidence: [{ source: 'database', slot: 'database', sections: ['masters'] }], criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      { label: '1', max_marks: 1, criteria: [{ success_criteria_id: B, max_marks: 1 }] },
    ]))), /masters/)
    check('an unknown database section is refused', ok, detail)

    // --- Upload links ------------------------------------------------------------------
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: ACT, uploadKind: 'supplied_image', fileName: 'Logo' }), /kind "supplied_image" is for PowerPoint assessments/)
    check('a supplied image link on a database assessment is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: ACT, uploadKind: 'script', pupilId: PUPIL, fileName: null }), /database assessment, which has no scripts/)
    check('a script link on a database assessment is refused', ok, detail)
    ;[ok, detail] = await refused(() => link({ assessmentActivityId: ACT, uploadKind: 'practical_file', pupilId: PUPIL, slotKey: 'presentation', fileName: null }), /No upload slot "presentation".*database \(accdb\)/)
    check('a pupil file link for a slot the activity lacks is refused, listing its slots', ok, detail)
    const dbUrl = await link({ assessmentActivityId: ACT, uploadKind: 'practical_file', pupilId: PUPIL, slotKey: 'database', fileName: null })
    const { rows: [shape] } = await query<{ upload_kind: string; pupil_id: string | null; slot_key: string | null; file_name: string | null }>(
      "select upload_kind, pupil_id, slot_key, file_name from mcp_upload_links where activity_id = $1 and used_at is null", [ACT])
    check('a practical_file link for the accdb slot is made with its pupil and slot',
      shape?.upload_kind === 'practical_file' && shape.pupil_id === PUPIL && shape.slot_key === 'database' && shape.file_name === null,
      JSON.stringify(shape))
    const mdb = await redeem(dbUrl, modelDb, 'database.mdb')
    check('an .mdb is refused as the file\'s fault, the link given back', mdb.status === 422 && /\.accdb/.test(mdb.json.error ?? ''), JSON.stringify(mdb))
    const uploaded = await redeem(dbUrl, modelDb, 'My database.accdb')
    const { rows: [afterUpload] } = await query<{ submission_status: string | null }>(
      'select submission_status from submissions where activity_id = $1 and user_id = $2', [ACT, PUPIL])
    check('the .accdb is stored in its slot through the upload route and not handed in',
      uploaded.status === 200 && uploaded.json.file?.slot_key === 'database' && uploaded.json.file?.file_name === 'My database.accdb'
        && afterUpload?.submission_status === 'inprogress',
      JSON.stringify({ uploaded, afterUpload }))
    const { rows: [stored] } = await query<{ storage_path: string }>(
      "select scope_path || '/' || file_name as storage_path from stored_files where bucket = $1 and scope_path like $2 and file_name like 'original.%'",
      [ASSESSMENT_SCRIPTS_BUCKET, `${ACT}/practical/%`])
    check('the stored file is original.accdb', Boolean(stored?.storage_path.endsWith('/original.accdb')), String(stored?.storage_path))

    await storePracticalFile({ activityId: ACT, pupilId: PUPIL, slotKey: 'evidence', bytes: evidenceDoc, originalName: 'EVIDENCE.docx', uploadedBy: PUPIL })
    const submissionId = String(uploaded.json.file?.submission_id)

    // --- get_practical_assessment_evidence ---------------------------------------------
    await readPowerPointSubmission({ submissionId }, readers)
    const evidence = await getPracticalAssessmentEvidence({ activityId: ACT, pupilId: PUPIL })
    const dbRead = evidence.slots.find((s) => s.slot_key === 'database')?.read as Record<string, any> | null
    const summary = dbRead?.summary
    check('the database: status ok, kind database, no error',
      dbRead?.status === 'ok' && dbRead.kind === 'database' && dbRead.error === null, JSON.stringify(dbRead && { status: dbRead.status, kind: dbRead.kind }))
    check('the summary: version, tables with fields and a record count',
      typeof summary?.version === 'string' && summary.tables.length > 0
        && summary.tables.every((t: any) => typeof t.name === 'string' && Array.isArray(t.fields) && t.fields.length > 0 && typeof t.rows === 'number')
        && summary.tables.some((t: any) => t.name === 'OWNERS' && t.rows > 0),
      JSON.stringify(summary?.tables?.map((t: any) => [t.name, t.fields?.length, t.rows])))
    check('the summary: saved query designs, forms, reports and relationships',
      summary?.queries.some((q: any) => q.name === 'MICROCHIP REMINDER' && Array.isArray(q.outputs))
        && Array.isArray(summary.forms) && Array.isArray(summary.reports) && Array.isArray(summary.relationships),
      JSON.stringify(summary?.queries?.map((q: any) => q.name)))
    const ownerChanges = summary?.changes?.records?.find((r: any) => r.table === 'OWNERS')
    check('the summary: changes from the starting database',
      summary?.starting_database?.file_name === START_FILE && ownerChanges?.added.length === 1 && ownerChanges.truncated === false,
      JSON.stringify(summary?.changes?.records?.map((r: any) => [r.table, r.added.length])))
    const owners = summary?.tables?.find((t: any) => t.name === 'OWNERS')
    check('no record values in the tables, only counts', owners && !('records' in owners) && typeof owners.rows === 'number', JSON.stringify(owners && Object.keys(owners)))
    check('the description is the whole report',
      typeof dbRead?.description === 'string' && dbRead.description.startsWith('TABLES') && /RECORDS IN OWNERS/.test(dbRead.description)
        && /MICROCHIP REMINDER/.test(dbRead.description),
      String(dbRead?.description).slice(0, 120))
    const serialised = JSON.stringify(evidence)
    const keys = keysOf(evidence)
    check('no picture data, paths or fingerprints are returned',
      !LONG_BASE64.test(serialised) && !/base64|data:image/i.test(serialised)
        && !keys.has('path') && !keys.has('fingerprint') && !keys.has('storage_path') && !keys.has('data'),
      [...keys].filter((k) => ['path', 'fingerprint', 'storage_path', 'data'].includes(k)).join(','))
    const narrowed = await getPracticalAssessmentEvidence({ activityId: ACT, pupilId: PUPIL, slot: 'database', sections: ['query:microchip reminder'] })
    const narrowRead = narrowed.slots[0]?.read as Record<string, any> | null
    check('a slot and database sections narrow the description',
      narrowed.slots.length === 1 && /MICROCHIP REMINDER/.test(narrowRead?.description ?? '') && !/^TABLES/.test(narrowRead?.description ?? '')
        && !/RECORDS IN/.test(narrowRead?.description ?? ''),
      String(narrowRead?.description).slice(0, 120))
    ;[ok, detail] = await refused(() => getPracticalAssessmentEvidence({ activityId: ACT, pupilId: PUPIL, sections: ['tables', 'master'] }), /Unknown database section: "master"\. Use tables, fields, .*records:TABLE or query:NAME/)
    check('presentation sections are refused on a database assessment, listing the valid ones', ok, detail)

    // --- get_assessment_activity -----------------------------------------------------------
    overview = await getAssessmentActivity(ACT)
    const me = overview.pupils.find((pp) => pp.pupil_id === PUPIL) as Record<string, any> | undefined
    const empty = overview.pupils.find((pp) => pp.pupil_id === EMPTY) as Record<string, any> | undefined
    check('the overview is a database assessment with its slots and starting database',
      overview.kind === 'database-assessment' && 'upload_slots' in overview.body
        && overview.body.upload_slots.map((s) => `${s.key}:${s.kind}`).join(',') === 'database:accdb,evidence:docx'
        && (overview.body as Record<string, unknown>).starting_database_file === START_FILE
        && overview.supplied_images.length === 0 && !('scripts_count' in overview),
      JSON.stringify(overview.body))
    check('a pupil: files per slot with the reader\'s status',
      me?.handed_in === false && me.files.length === 2 && me.files.every((f: any) => f.file?.reader_status === 'ok') && me.missing_required.length === 0,
      JSON.stringify(me?.files))
    check('a pupil with nothing uploaded: both required slots listed',
      JSON.stringify(empty?.missing_required) === JSON.stringify(['Database', 'Evidence document']), JSON.stringify(empty?.missing_required))

    // --- get_assessment_activity_result --------------------------------------------------
    const result = await getAssessmentActivityResult(ACT, PUPIL)
    const r1 = result.questions.find((q) => q.label === 'D1') as Record<string, any>
    const r2 = result.questions.find((q) => q.label === '1') as Record<string, any>
    check('the result has the files in the powerpoint object, no script',
      result.script === null && result.powerpoint?.handed_in === false && result.powerpoint.files.length === 2
        && result.powerpoint.files.every((f) => f.reader_status === 'ok' && f.file_name),
      JSON.stringify(result.powerpoint))
    check('each question has evidence_texts: the database sections the marker is given',
      r1.evidence_sources?.length === 1 && r1.evidence_texts?.length === 1
        && /Database report/.test(r1.evidence_texts[0].title) && /CHANGES/.test(r1.evidence_texts[0].text)
        && r2.evidence_texts?.length === 1 && /MICROCHIP REMINDER/.test(r2.evidence_texts[0].text),
      JSON.stringify([r1.evidence_texts?.map((t: any) => t.title), r2.evidence_texts?.map((t: any) => t.title)]))

    // --- Script download link refused ----------------------------------------------------
    ;[ok, detail] = await refused(() => createScriptDownloadLink(caller, { activityId: ACT, pupilId: PUPIL }), /^Database assessments have no scripts; use get_practical_assessment_evidence or the results page\.$/)
    check('a script download link is refused with the database wording', ok, detail)

    // --- Hand in for a pupil ---------------------------------------------------------------
    ;[ok, detail] = await refused(() => handInPowerPointAssessmentForPupil({ activityId: ACT, pupilId: EMPTY, teacherId: TEACHER }), /Upload your files before handing in/)
    check('hand-in with no files is refused', ok, detail)
    // Teacher-only questions, so the queued read sends nothing to a model.
    const questions = await readAssessmentQuestions(ACT)
    await setAssessmentQuestions(ACT, questions.map((q) => ({
      label: q.label,
      maxMarks: q.maxMarks,
      markScheme: q.markScheme,
      marking: 'teacher' as const,
      criteria: q.criteria.map((c) => ({ successCriteriaId: c.successCriteriaId, maxMarks: c.maxMarks })),
    })))
    const handIn = await handInPowerPointAssessmentForPupil({ activityId: ACT, pupilId: PUPIL, teacherId: TEACHER })
    await query("delete from external_jobs where payload->>'submissionId' = $1 and status = 'pending'", [submissionId])
    check('a teacher hands in for the pupil', handIn.already_handed_in === false && handIn.handed_in === true && handIn.submission_id === submissionId, JSON.stringify(handIn))
    const handedOverview = await getAssessmentActivity(ACT)
    check('the overview counts the hand-in', handedOverview.kind === 'database-assessment' && handedOverview.handed_in_count === 1)
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
