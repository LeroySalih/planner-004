import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { NextRequest } from 'next/server'
import PDFDocument from 'pdfkit'

import { query } from '@/lib/db'
import { POST as redeemUploadLink } from '@/app/api/MCP/upload/[token]/route'
import { ASSESSMENT_SCRIPTS_BUCKET, storePaperFile } from '@/lib/assessment-paper/files'
import { recordQuestionCriterionMarks, setAssessmentQuestions } from '@/lib/assessment-paper/store'
import type { McpCaller } from '@/lib/mcp/auth'
import { createUploadLink, uploadLinkMaxBytes } from '@/lib/mcp/upload-links'
import { RemarkQuestionsInput } from '@/lib/mcp/assessment-activities'
import { LESSONS_BUCKET, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// create_assessment_activity_file_upload_link: the kinds added in migration
// 147 and the re-mark options. Checks: evidence_template / starting_database
// / reference_file refused on the wrong type, without a name, with a wrong
// extension or naming a pupil; bad remark_questions (unknown, teacher-only,
// no mark scheme) refused when the link is made, and on a script and with
// remark false; the constraint refusing a reference file with no name and
// questions with remark false; the size caps. Redeemed through the upload
// route: the template and the starting database are stored as activity files
// and set in body_data (a damaged template refused before storing); a
// reference file replaced keeps the old copy as a past version. Re-marks: a
// whole-activity upload with remark omitted queues nothing; remark true
// queues a read for the handed-in pupil only; remark_questions scopes the
// read's questionIds (practical) and the mark jobs (paper, named questions
// only). A pupil's practical file: by default cleared and re-queued as before;
// remark false clears the AI rows, keeps the teacher's and queues nothing;
// remark_questions clears only those questions and queues a scoped read; a
// script with remark false is stored and cleared, not sent. No model is
// called (run with MARKING_QUEUE_SECRET blank): it asserts on external_jobs
// rows and deletes them. Creates its own unit, lesson, activities, class and
// pupils, and removes them. Never prints names.
// Run with DATABASE_URL set:
//   npx tsx tests/powerpoint-assessment/upload-link-kinds.check.ts

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

const PPTX_FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const DB_FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const tag = randomUUID().slice(0, 8)
const UNIT = `upk-check-unit-${tag}`
const LESSON = `upk-check-lesson-${tag}`
const PPT = randomUUID()
const DB = randomUUID()
const PAPER = randomUUID()
const GROUP = `upk-check-group-${tag}`
const P1 = `upk-check-p1-${tag}` // PowerPoint: handed in, AI and teacher marks
const P2 = `upk-check-p2-${tag}` // PowerPoint: not handed in
const P3 = `upk-check-p3-${tag}` // paper: passed script, answers
const P4 = `upk-check-p4-${tag}` // paper: script uploaded with remark false
const PEOPLE = [P1, P2, P3, P4]

const PPT_SLOTS = [
  { key: 'presentation', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: false },
]
const DB_SLOTS = [
  { key: 'database', label: 'Database', kind: 'accdb', required: true },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: false },
]

const caller: McpCaller = { method: 'service_key', userId: null, clientId: null }

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) select unnest($1::text[]), 'Up', 'Kind'", [PEOPLE])
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Upload kinds unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Upload kinds check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $4, 'powerpoint-assessment', 'Presentation task', $5::jsonb, 0),
       ($2, $4, 'database-assessment', 'Database task', $6::jsonb, 1),
       ($3, $4, 'assessment-paper', 'Paper', '{}'::jsonb, 2)`,
    [PPT, DB, PAPER, LESSON, JSON.stringify({ instructions: 'Build it.', uploadSlots: PPT_SLOTS }), JSON.stringify({ instructions: 'Build it.', uploadSlots: DB_SLOTS })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) select $1, unnest($2::text[])', [GROUP, PEOPLE])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  for (const [bucket, prefix] of [[ASSESSMENT_SCRIPTS_BUCKET, PPT], [ASSESSMENT_SCRIPTS_BUCKET, DB], [ASSESSMENT_SCRIPTS_BUCKET, PAPER], [LESSONS_BUCKET, `lessons/${LESSON}/`], [LESSONS_BUCKET, `${LESSON}/`]] as const) {
    const { rows } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [bucket, `${prefix}%`],
    )
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  for (const folder of [PPT, DB, PAPER]) {
    await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, folder), { recursive: true, force: true })
  }
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, 'lessons', LESSON), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
  await query('delete from mcp_upload_links where lesson_id = $1', [LESSON])
  await query('delete from mcp_audit_log where arguments::text like any($1::text[])', [[`%${PPT}%`, `%${DB}%`, `%${PAPER}%`]])
  await query('delete from assessment_scripts where pupil_id = any($1::text[])', [PEOPLE])
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

type Reply = { success: boolean; error?: string; file?: Record<string, unknown>; remark?: Record<string, unknown>; remark_error?: string }

async function redeem(uploadUrl: string, bytes: Buffer, fileName: string) {
  const token = uploadUrl.split('/').pop()!
  const request = new NextRequest(`http://localhost/api/MCP/upload/${token}?file_name=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    body: new Uint8Array(bytes),
    headers: { 'content-type': 'application/octet-stream' },
  })
  const response = await redeemUploadLink(request, { params: Promise.resolve({ token }) })
  return { status: response.status, json: (await response.json()) as Reply }
}

async function link(target: Parameters<typeof createUploadLink>[1]) {
  const { token } = await createUploadLink(caller, target)
  return `http://localhost/api/MCP/upload/${token}`
}

async function bodyOf(activityId: string) {
  const { rows } = await query<{ body_data: Record<string, unknown> }>('select body_data from activities where activity_id = $1', [activityId])
  return rows[0]?.body_data ?? {}
}

async function activityFiles(activityId: string) {
  const { rows } = await query<{ file_name: string }>(
    "select file_name from stored_files where bucket = 'lessons' and scope_path = $1 order by file_name",
    [`${LESSON}/activities/${activityId}`],
  )
  return rows.map((row) => row.file_name)
}

/** Open jobs of a submission as "type[:label,label]" (labels from payload questionIds or questionId). */
async function openJobs(submissionId: string) {
  const { rows } = await query<{ job: string }>(
    `select j.job_type || coalesce(':' || (
              select string_agg(q.label, ',' order by q.label) from activity_questions q
               where q.question_id::text = j.payload->>'questionId'
                  or q.question_id::text in (select jsonb_array_elements_text(coalesce(j.payload->'questionIds', '[]'::jsonb)))), '') as job
       from external_jobs j
      where j.payload->>'submissionId' = $1 and j.status in ('pending', 'processing')
      order by 1`,
    [submissionId],
  )
  return rows.map((row) => row.job).join(' ')
}

async function dropJobs() {
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
}

/** Criterion rows as "label/provenance" sorted. */
async function rowsOf(submissionId: string) {
  const { rows } = await query<{ r: string }>(
    `select q.label || '/' || m.provenance as r from submission_question_criterion_marks m
       join activity_questions q on q.question_id = m.question_id
      where m.submission_id = $1 order by 1`,
    [submissionId],
  )
  return rows.map((row) => row.r).join(' ')
}

async function submissionState(submissionId: string) {
  const { rows } = await query<{ mark_status: string | null; submission_status: string | null }>(
    'select mark_status, submission_status from submissions where submission_id = $1',
    [submissionId],
  )
  return rows[0]
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 3 limit 1)
      order by sc.success_criteria_id limit 3`,
  )
  const [A, B, C] = scs.map((row) => row.success_criteria_id)
  const pptx = await readFile(path.join(PPTX_FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const template = await readFile(path.join(DB_FIXTURES, 'palm-grove-evidence-template.docx'))
  const startDb = await readFile(path.join(DB_FIXTURES, 'palm-grove-start.accdb'))

  check('remark_questions may be a JSON string', JSON.stringify(RemarkQuestionsInput.parse('["1a"]')) === '["1a"]')

  await setUp()
  try {
    const presentation = [{ source: 'presentation', slot: 'presentation' }]
    const [q1, q2] = await setAssessmentQuestions(PPT, [
      { label: '1a', maxMarks: 2, markScheme: 'Q1a.', evidence: presentation, criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }] },
      { label: '1b', maxMarks: 1, markScheme: 'Q1b.', evidence: [...presentation, { source: 'reference_file', fileName: 'brief.pdf' }], criteria: [{ successCriteriaId: C, maxMarks: 1 }] },
      { label: '1c', maxMarks: 1, markScheme: 'Q1c.', marking: 'teacher', evidence: presentation, criteria: [{ successCriteriaId: C, maxMarks: 1 }] },
      { label: '1d', maxMarks: 1, evidence: presentation, criteria: [{ successCriteriaId: C, maxMarks: 1 }] },
    ] as Parameters<typeof setAssessmentQuestions>[1])
    const [r1, r2] = await setAssessmentQuestions(PAPER, [
      { label: 'Q1', maxMarks: 1, markScheme: 'R1.', criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
      { label: 'Q2', maxMarks: 1, markScheme: 'R2.', criteria: [{ successCriteriaId: B, maxMarks: 1 }] },
    ])

    // --- Link refusals -------------------------------------------------------------
    const refusals: Array<[string, Parameters<typeof createUploadLink>[1], RegExp]> = [
      ['an evidence template on an assessment paper', { assessmentActivityId: PAPER, uploadKind: 'evidence_template', fileName: null }, /not a PowerPoint assessment or database assessment/],
      ['a starting database on a PowerPoint assessment', { assessmentActivityId: PPT, uploadKind: 'starting_database', fileName: null }, /no starting database/],
      ['a reference file on an assessment paper', { assessmentActivityId: PAPER, uploadKind: 'reference_file', fileName: 'brief.pdf' }, /not a PowerPoint assessment or database assessment/],
      ['a reference file without file_name', { assessmentActivityId: PPT, uploadKind: 'reference_file', fileName: null }, /file_name is required/],
      ['a reference file of a type the marker cannot read', { assessmentActivityId: PPT, uploadKind: 'reference_file', fileName: 'tool.exe' }, /reference file must be/],
      ['an evidence template that is not a .docx', { assessmentActivityId: DB, uploadKind: 'evidence_template', fileName: 'template.pdf' }, /must be a \.docx/],
      ['a starting database that is not an .accdb', { assessmentActivityId: DB, uploadKind: 'starting_database', fileName: 'start.mdb' }, /must be an \.accdb/],
      ['an evidence template naming a pupil', { assessmentActivityId: PPT, uploadKind: 'evidence_template', pupilId: P1, fileName: null }, /only for kind "practical_file"/],
      ['a file name on a mark scheme', { assessmentActivityId: PPT, uploadKind: 'mark_scheme', fileName: 'x.pdf' }, /image_name is only for kind "supplied_image"/],
      ['an unknown remark label', { assessmentActivityId: PPT, uploadKind: 'mark_scheme', fileName: null, remark: true, remarkQuestions: ['zz'] }, /No question "zz"/],
      ['a teacher-only remark label', { assessmentActivityId: PPT, uploadKind: 'mark_scheme', fileName: null, remarkQuestions: ['1c'] }, /marked by the teacher only/],
      ['a remark label with no mark scheme', { assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: P1, slotKey: 'presentation', fileName: null, remarkQuestions: ['1d'] }, /no mark scheme text/],
      ['remark_questions on a script', { assessmentActivityId: PAPER, uploadKind: 'script', pupilId: P3, fileName: null, remarkQuestions: ['Q1'] }, /not for a script/],
      ['remark_questions with remark false', { assessmentActivityId: PPT, uploadKind: 'mark_scheme', fileName: null, remark: false, remarkQuestions: ['1a'] }, /cannot go with remark: false/],
    ]
    for (const [name, target, pattern] of refusals) {
      const [ok, detail] = await refused(() => link(target), pattern)
      check(`refused when made: ${name}`, ok, detail)
    }

    const badShape = (uploadKind: string, fileName: string | null, remark: boolean | null, questions: string[] | null) =>
      refused(() => query(
        `insert into mcp_upload_links (token_hash, target, lesson_id, activity_id, upload_kind, file_name, remark, remark_questions, auth_method, expires_at)
         values ($1, 'assessment-activity', $2, $3, $4, $5, $6, $7, 'service_key', now() + interval '1 minute')`,
        [`check-${randomUUID()}`, LESSON, PPT, uploadKind, fileName, remark, questions],
      ), /mcp_upload_links_target_shape/)
    let [ok, detail] = await badShape('reference_file', null, null, null)
    check('the constraint refuses a reference file with no name', ok, detail)
    ;[ok, detail] = await badShape('mark_scheme', null, false, ['1a'])
    check('the constraint refuses remark_questions with remark false', ok, detail)
    ;[ok, detail] = await badShape('mark_scheme', null, null, [])
    check('the constraint refuses empty remark_questions', ok, detail)
    ;[ok, detail] = await refused(() => query(
      `insert into mcp_upload_links (token_hash, target, lesson_id, activity_id, remark, auth_method, expires_at)
       values ($1, 'activity', $2, $3, true, 'service_key', now() + interval '1 minute')`,
      [`check-${randomUUID()}`, LESSON, PPT],
    ), /mcp_upload_links_target_shape/)
    check('the constraint refuses a re-mark on an ordinary activity link', ok, detail)

    const cap = (kind: 'evidence_template' | 'starting_database' | 'reference_file') =>
      uploadLinkMaxBytes({ target: 'assessment-activity', assessment_id: null, upload_kind: kind })
    check('the size caps: template and starting database 25 MB, reference file 5 MB',
      cap('evidence_template') === 25 * 1024 * 1024 && cap('starting_database') === 25 * 1024 * 1024 && cap('reference_file') === 5 * 1024 * 1024)

    // --- Activity files ---------------------------------------------------------------
    const damaged = await redeem(await link({ assessmentActivityId: DB, uploadKind: 'evidence_template', fileName: null }), Buffer.from('not a docx'), 'Template.docx')
    check('a damaged evidence template is refused before anything is stored',
      damaged.status === 422 && !(await activityFiles(DB)).includes('Template.docx') && (await bodyOf(DB)).evidenceTemplateFile === undefined,
      JSON.stringify(damaged))

    const tpl = await redeem(await link({ assessmentActivityId: DB, uploadKind: 'evidence_template', fileName: 'Evidence template.docx' }), template, 'whatever.docx')
    check('the evidence template is stored under file_name and set in body_data',
      tpl.status === 200 && (await activityFiles(DB)).includes('Evidence template.docx')
        && (await bodyOf(DB)).evidenceTemplateFile === 'Evidence template.docx'
        && typeof tpl.json.file?.evidence_template_check === 'object',
      JSON.stringify(tpl.json))

    const start = await redeem(await link({ assessmentActivityId: DB, uploadKind: 'starting_database', fileName: null }), startDb, 'PALM GROVE VETS.accdb')
    const startCheck = start.json.file?.starting_database_check as { tables?: unknown[] } | undefined
    check('the starting database is stored under its name, set in body_data and read',
      start.status === 200 && (await activityFiles(DB)).includes('PALM GROVE VETS.accdb')
        && (await bodyOf(DB)).startingDatabaseFile === 'PALM GROVE VETS.accdb'
        && (startCheck?.tables?.length ?? 0) > 0,
      JSON.stringify({ status: start.status, error: start.json.error, check_error: start.json.file?.check_error }))
    const bodyNow = await bodyOf(DB)
    check('body_data keeps its slots', JSON.stringify((bodyNow.uploadSlots as unknown[])?.length) === '2')

    // --- PowerPoint pupils: P1 handed in with marks, P2 not handed in ----------------------
    const s1 = (await storePracticalFile({ activityId: PPT, pupilId: P1, slotKey: 'presentation', bytes: pptx, originalName: 'deck.pptx', byTeacher: true })).submission_id
    const s2 = (await storePracticalFile({ activityId: PPT, pupilId: P2, slotKey: 'presentation', bytes: pptx, originalName: 'deck.pptx', byTeacher: true })).submission_id
    const seedP1 = async () => {
      await dropJobs()
      await query("update submissions set submission_status = 'submitted', mark_status = 'marked' where submission_id = $1", [s1])
      await query('delete from submission_question_criterion_marks where submission_id = $1', [s1])
      await recordQuestionCriterionMarks(s1, [
        { questionId: q1.questionId, successCriteriaId: B, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
        { questionId: q2.questionId, successCriteriaId: C, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
      ], 'ai')
      await recordQuestionCriterionMarks(s1, [{ questionId: q1.questionId, successCriteriaId: A, awarded: 1 }], 'teacher')
    }
    await seedP1()
    const seeded = await rowsOf(s1)
    check('P1 seeded: 1a teacher and AI, 1b AI', seeded === '1a/ai 1a/teacher 1b/ai', seeded)

    const brief = await pdf(['The brief'])
    const ref1 = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'reference_file', fileName: 'brief.pdf' }), brief, 'local.pdf')
    check('a reference file is stored under file_name, naming the questions that read it',
      ref1.status === 200 && (await activityFiles(PPT)).includes('brief.pdf')
        && JSON.stringify(ref1.json.file?.named_by_questions) === '["1b"]' && ref1.json.file?.replaced === false,
      JSON.stringify(ref1.json))
    check('a whole-activity upload with remark omitted re-marks nothing',
      ref1.json.remark === undefined && (await openJobs(s1)) === '' && (await rowsOf(s1)) === seeded,
      await openJobs(s1))

    const ref2 = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'reference_file', fileName: 'brief.pdf', remark: true }), await pdf(['The brief, v2']), 'local.pdf')
    const files = await activityFiles(PPT)
    check('replacing a reference file keeps the old copy as a past version',
      ref2.json.file?.replaced === true && files.includes('brief.pdf') && files.some((name) => /^brief_\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}\.pdf$/.test(name)),
      files.join(', '))
    const ref2Remark = ref2.json.remark as { queued?: number; queued_pupil_ids?: string[]; skipped?: { not_handed_in?: string[] } } | undefined
    check('remark true re-marks the handed-in pupil only and reports it',
      ref2Remark?.queued === 1 && ref2Remark.queued_pupil_ids?.[0] === P1 && ref2Remark.skipped?.not_handed_in?.includes(P2) === true
        && (await openJobs(s1)) === 'ai_read' && (await openJobs(s2)) === '',
      JSON.stringify({ remark: ref2.json.remark, error: ref2.json.remark_error, s1: await openJobs(s1), s2: await openJobs(s2) }))
    check('the full re-mark cleared the AI rows and kept the teacher\'s', (await rowsOf(s1)) === '1a/teacher', await rowsOf(s1))

    await seedP1()
    const scheme = await pdf(['Mark scheme'])
    const scoped = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'mark_scheme', fileName: null, remarkQuestions: ['1A'] }), scheme, 'scheme.pdf')
    check('remark_questions on a whole-activity upload queues a read for those questions only',
      scoped.status === 200 && (scoped.json.remark as { questions?: string[] })?.questions?.join(',') === '1a' && (await openJobs(s1)) === 'ai_read:1a'
        && (await rowsOf(s1)) === '1a/teacher 1b/ai',
      JSON.stringify({ remark: scoped.json.remark, jobs: await openJobs(s1), rows: await rowsOf(s1) }))

    // --- A pupil's practical file ----------------------------------------------------------
    await seedP1()
    const byDefault = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: P1, slotKey: 'presentation', fileName: null }), pptx, 'deck.pptx')
    const { rows: delayed } = await query<{ later: boolean }>(
      "select process_after > now() + interval '60 seconds' as later from external_jobs where job_type = 'ai_read' and status = 'pending' and payload->>'submissionId' = $1",
      [s1],
    )
    check('a practical file by default clears and re-queues as before (after the delay)',
      byDefault.json.file?.requeued === true && byDefault.json.remark === undefined && (await openJobs(s1)) === 'ai_read'
        && delayed[0]?.later === true && (await rowsOf(s1)) === '1a/teacher',
      JSON.stringify({ file: byDefault.json.file, jobs: await openJobs(s1) }))

    await seedP1()
    await query("insert into external_jobs (job_type, payload) values ('ai_mark', jsonb_build_object('submissionId', $1::text, 'assignmentId', 'x', 'questionId', $2::text))", [s1, q2.questionId])
    const noRemark = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: P1, slotKey: 'presentation', fileName: null, remark: false }), pptx, 'deck.pptx')
    const state = await submissionState(s1)
    check('remark false on a practical file clears the AI rows, keeps the teacher\'s, queues nothing and drops open jobs',
      noRemark.status === 200 && noRemark.json.file?.requeued === false && noRemark.json.file?.cleared === true
        && (await openJobs(s1)) === '' && (await rowsOf(s1)) === '1a/teacher' && state.mark_status === null && state.submission_status === 'submitted',
      JSON.stringify({ file: noRemark.json.file, jobs: await openJobs(s1), rows: await rowsOf(s1), state }))

    const notHandedIn = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: P2, slotKey: 'presentation', fileName: null, remark: false }), pptx, 'deck.pptx')
    check('remark false on work not handed in stores the file, nothing to clear',
      notHandedIn.status === 200 && notHandedIn.json.file?.cleared === false && (await openJobs(s2)) === '',
      JSON.stringify(notHandedIn.json.file))

    await seedP1()
    const scopedPupil = await redeem(await link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: P1, slotKey: 'presentation', fileName: null, remarkQuestions: RemarkQuestionsInput.parse('["1a"]') }), pptx, 'deck.pptx')
    const sp = scopedPupil.json.remark as { queued?: number; queued_pupil_ids?: string[] } | undefined
    check('remark_questions on a practical file re-marks that pupil on those questions only (no full requeue)',
      scopedPupil.status === 200 && scopedPupil.json.file?.requeued === false && sp?.queued === 1 && sp.queued_pupil_ids?.join(',') === P1
        && (await openJobs(s1)) === 'ai_read:1a' && (await rowsOf(s1)) === '1a/teacher 1b/ai',
      JSON.stringify({ file: scopedPupil.json.file, remark: scopedPupil.json.remark, error: scopedPupil.json.remark_error, jobs: await openJobs(s1), rows: await rowsOf(s1) }))

    // A label made teacher-only after the link was made refuses the upload; nothing stored.
    await seedP1()
    const staleUrl = await link({ assessmentActivityId: PPT, uploadKind: 'practical_file', pupilId: P1, slotKey: 'presentation', fileName: null, remarkQuestions: ['1b'] })
    await query("update activity_questions set marking = 'teacher' where question_id = $1", [q2.questionId])
    const { rows: [before] } = await query<{ file_id: string }>("select file_id::text from practical_submission_files where submission_id = $1 and slot_key = 'presentation'", [s1])
    const stale = await redeem(staleUrl, pptx, 'deck.pptx')
    const { rows: [after] } = await query<{ file_id: string }>("select file_id::text from practical_submission_files where submission_id = $1 and slot_key = 'presentation'", [s1])
    check('labels checked again on upload: a stale label refuses it before storing',
      stale.status === 409 && /marked by the teacher only/.test(stale.json.error ?? '') && before.file_id === after.file_id && (await openJobs(s1)) === '',
      JSON.stringify(stale.json))
    await query("update activity_questions set marking = 'ai' where question_id = $1", [q2.questionId])
    await dropJobs()

    // --- Assessment paper ------------------------------------------------------------------
    const paperPdf = await pdf(['Front sheet', 'Question 1', 'Question 2'])
    await storePaperFile(PAPER, 'question_paper', paperPdf)
    const { rows: [{ submission_id: s3 }] } = await query<{ submission_id: string }>(
      `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
       values ($1, $2, 1, now(), '{}'::json, 'marked', 'submitted') returning submission_id`,
      [PAPER, P3],
    )
    await query(
      `insert into assessment_scripts (activity_id, pupil_id, submission_id, original_path, page_count, page_paths, front_sheet_check)
       values ($1, $2, $3, 'x/original.pdf', 3, '{x/page-2.png,x/page-3.png}', 'passed')`,
      [PAPER, P3, s3],
    )
    for (const q of [r1, r2]) {
      await query(
        `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance)
         values ($1, $2, 'text', 'answer', '{2}', 'answered', 'ai')`,
        [s3, q.questionId],
      )
    }
    await recordQuestionCriterionMarks(s3, [
      { questionId: r1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
      { questionId: r2.questionId, successCriteriaId: B, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
    ], 'ai')
    const paperScoped = await redeem(await link({ assessmentActivityId: PAPER, uploadKind: 'mark_scheme', fileName: null, remarkQuestions: ['Q1'] }), scheme, 'scheme.pdf')
    check('a paper\'s remark_questions marks only the named question again, from the stored answers',
      paperScoped.status === 200 && (paperScoped.json.remark as { question_marks_queued?: number })?.question_marks_queued === 1
        && (await openJobs(s3)) === 'ai_mark:Q1' && (await rowsOf(s3)) === 'Q2/ai',
      JSON.stringify({ remark: paperScoped.json.remark, error: paperScoped.json.remark_error, jobs: await openJobs(s3), rows: await rowsOf(s3) }))
    await dropJobs()

    const paperNone = await redeem(await link({ assessmentActivityId: PAPER, uploadKind: 'mark_scheme', fileName: null }), scheme, 'scheme.pdf')
    check('a paper\'s mark scheme with remark omitted queues nothing', paperNone.status === 200 && (await openJobs(s3)) === '', await openJobs(s3))

    const [scriptRefused, scriptDetail] = await refused(() => link({ assessmentActivityId: PAPER, uploadKind: 'script', pupilId: P4, fileName: null, remarkQuestions: ['Q1'] }), /not for a script/)
    check('refused when made: remark_questions on a script (question paper uploaded)', scriptRefused, scriptDetail)
    const script = await redeem(await link({ assessmentActivityId: PAPER, uploadKind: 'script', pupilId: P4, fileName: null, remark: false }), paperPdf, 'script.pdf')
    const { rows: [s4row] } = await query<{ submission_id: string; mark_status: string | null }>(
      'select submission_id, mark_status from submissions where activity_id = $1 and user_id = $2', [PAPER, P4],
    )
    check('a script with remark false is stored, passes the front sheet and is not sent',
      script.status === 200 && script.json.file?.front_sheet_check === 'passed' && script.json.file?.marking === 'not_sent'
        && s4row?.mark_status === null && (await openJobs(s4row.submission_id)) === '',
      JSON.stringify({ file: script.json.file, error: script.json.error, s4row }))
  } finally {
    await tearDown()
  }

  console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  process.exit(1)
})
