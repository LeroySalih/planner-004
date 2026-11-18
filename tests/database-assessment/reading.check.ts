import { createHash, randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { enqueueMarkingTasks } from '@/lib/ai/marking-queue'
import { DATABASE_MESSAGES } from '@/lib/accdb/errors'
import { readAccessDatabase } from '@/lib/accdb/read'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { setAssessmentQuestions } from '@/lib/assessment-paper/store'
import { readEvidenceDocument } from '@/lib/docx/evidence'
import { pdfPageCount, pdfText } from '@/lib/pdf/poppler'
import { inspectPptx } from '@/lib/pptx/inspect'
import { LESSONS_BUCKET, handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { DATABASE_READER_VERSION, type PowerPointReaders } from '@/lib/powerpoint-assessment/reading'
import { defaultDatabaseAssessmentBody } from '@/lib/practical-assessment/types'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The read of a database assessment (the ai_read job), with no model, run
// directly (the worker is not started): the Palm Grove Vets model answer and
// its EVIDENCE document handed in on an activity with the default slots, the
// blank EVIDENCE template and the starting database as activity files. One
// evidence row of kind database whose changes list the added APPOINTMENTS and
// OWNERS records; the screenshots stored under evidence/; database, screenshot
// and typed questions answered, a required query:NOPE blank with its reason
// and no mark job; B1's typed text as its transcription; a second read
// reusing the cache; a starting database that is not among the files re-read
// with a warning and no changes, nothing held; a damaged .accdb holding the
// whole submission; and no pupil file name or base64 on the job rows or in
// ai_marking_logs. Creates its own unit, lesson, activity, class and pupils,
// and removes them. Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/database-assessment/reading.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const tag = randomUUID().slice(0, 8)
const UNIT = `db-r-check-unit-${tag}`
const LESSON = `db-r-check-lesson-${tag}`
const ACT = randomUUID()
const GROUP = `db-r-check-group-${tag}`
const PUPIL = `db-r-check-pupil-${tag}`
const LATE = `db-r-check-late-${tag}`
const PUPILS = [PUPIL, LATE]

const TEMPLATE_FILE = 'EVIDENCE.docx'
const START_FILE = 'PALM GROVE VETS.accdb'
// Unique upload names, so the privacy checks can look for them.
const DB_NAME = `Pupil-Smith-db-${tag}.accdb`
const DOC_NAME = `Pupil-Smith-evidence-${tag}.docx`
const BROKEN_NAME = `Pupil-Jones-broken-${tag}.accdb`

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Bob', 'Bbb')", PUPILS)
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PUPILS])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database read unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database read check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'database-assessment', 'Database task', $3::jsonb, 0)",
    [ACT, LESSON, JSON.stringify({
      instructions: 'Complete the database tasks.',
      ...defaultDatabaseAssessmentBody(),
      evidenceTemplateFile: TEMPLATE_FILE,
      startingDatabaseFile: START_FILE,
    })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) select $1, unnest($2::text[])', [GROUP, PUPILS])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  for (const [bucket, prefix] of [[ASSESSMENT_SCRIPTS_BUCKET, ACT], [LESSONS_BUCKET, `${LESSON}/`]] as const) {
    const { rows } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [bucket, `${prefix}%`],
    )
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, ACT), { recursive: true, force: true })
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, LESSON), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PUPILS])
  await query('delete from submissions where user_id = any($1::text[])', [PUPILS])
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = any($1::text[])', [PUPILS])
  await query('delete from profiles where user_id = any($1::text[])', [PUPILS])
}

function countingReaders() {
  const counts = { database: 0, docx: 0, inspect: 0, pdf: 0 }
  const readers: PowerPointReaders = {
    inspectPptx: (...args) => { counts.inspect += 1; return inspectPptx(...args) },
    readEvidenceDocument: (...args) => { counts.docx += 1; return readEvidenceDocument(...args) },
    pdfPageCount: (...args) => { counts.pdf += 1; return pdfPageCount(...args) },
    pdfText: (...args) => pdfText(...args),
    readDatabase: (...args) => { counts.database += 1; return readAccessDatabase(...args) },
  }
  return { counts, readers }
}

async function latestSubmission(pupilId: string) {
  const { rows } = await query<{ submission_id: string; mark_status: string | null; mark_error: string | null }>(
    `select submission_id, mark_status, mark_error from submissions where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc limit 1`,
    [ACT, pupilId],
  )
  return rows[0]
}

/** Claim the pending read job of a submission as the worker would, and return it. */
async function claimRead(submissionId: string) {
  const { rows } = await query<{ job_id: string; assignment_id: string }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = 'ai_read' and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id`,
    [submissionId],
  )
  return rows[0] ? { jobId: rows[0].job_id, submissionId, assignmentId: rows[0].assignment_id } : null
}

async function jobRow(jobId: string) {
  const { rows } = await query<{ status: string; last_error: string | null; model_request: unknown; model_response: unknown }>(
    'select status, last_error, model_request, model_response from external_jobs where job_id = $1',
    [jobId],
  )
  return rows[0]
}

async function evidenceRows(submissionId: string) {
  const { rows } = await query<{
    slot_key: string; kind: string; status: string; error: string | null; cache_key: string
    description: string | null; image_paths: string[]; report: any; file_id: string
  }>(
    `select slot_key, kind, status, error, cache_key, description, image_paths, report, file_id::text as file_id
       from practical_submission_evidence where submission_id = $1 order by slot_key`,
    [submissionId],
  )
  return rows
}

/** Send the submission again, as the queue does, and claim the read. */
async function resend(submissionId: string) {
  await enqueueMarkingTasks('self__x', [{ submissionId }])
  const job = await claimRead(submissionId)
  if (!job) throw new Error('no read job after resending')
  return job
}

function hasBase64(value: unknown) {
  const text = JSON.stringify(value ?? null)
  return /base64|data:image|[A-Za-z0-9+/]{400,}/.test(text)
}

async function main() {
  const startedAt = new Date()
  const modelDb = await readFile(path.join(FIXTURES, 'palm-grove-model-answer.accdb'))
  const startDb = await readFile(path.join(FIXTURES, 'palm-grove-start.accdb'))
  const evidenceDoc = await readFile(path.join(FIXTURES, 'palm-grove-evidence-model-answer.docx'))
  const template = await readFile(path.join(FIXTURES, 'palm-grove-evidence-template.docx'))
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 1`,
  )
  const A = scs[0].success_criteria_id

  await setUp()
  try {
    // Teacher materials: the blank EVIDENCE template and the starting database.
    const lessons = createLocalStorageClient(LESSONS_BUCKET)
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${TEMPLATE_FILE}`, template, { contentType: 'application/octet-stream' })
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${START_FILE}`, startDb, { contentType: 'application/octet-stream' })

    const q = (label: string, evidence: unknown[], extra: Record<string, unknown> = {}) => ({
      label, maxMarks: 1, markScheme: `Mark scheme for ${label}.`, evidence,
      criteria: [{ successCriteriaId: A, maxMarks: 1 }], ...extra,
    })
    const db = (sections: string[], extra: Record<string, unknown> = {}) => ({ source: 'database', slot: 'database', sections, ...extra })
    const saved = await setAssessmentQuestions(ACT, [
      q('D1', [db(['changes'])]),
      q('D2', [db(['queries'])]),
      q('D3', [db(['query:MICROCHIP REMINDER'])]),
      q('D4', [db(['query:NOPE'], { required: true })]),
      q('D5', [db(['table-sort', 'records:OWNERS'])]),
      q('1', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true }]),
      q('6', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true }]),
      q('B1', [{ source: 'evidence_section', slot: 'evidence', want: 'text' }]),
      q('B3', [{ source: 'evidence_section', slot: 'evidence', want: 'text' }]),
      // Headings 2–5 and 7–9 are named by no question: the template's own
      // lines for them end sections 1 and 6.
      // Teacher-only, and one with no mark scheme: neither is sent.
      q('M1', [{ source: 'database', slot: 'database' }], { marking: 'teacher' }),
      q('N1', [{ source: 'database', slot: 'database' }], { markScheme: null }),
    ])
    const id = (label: string) => saved.find((s) => s.label === label)!.questionId

    const store = (pupilId: string, slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: ACT, pupilId, slotKey, bytes, originalName, uploadedBy: pupilId })
    await store(PUPIL, 'database', modelDb, DB_NAME)
    await store(PUPIL, 'evidence', evidenceDoc, DOC_NAME)
    await handInPowerPointAssessment(ACT, PUPIL, { userId: PUPIL, isTeacher: false })
    const sub = await latestSubmission(PUPIL)
    const job = await claimRead(sub.submission_id)
    check('hand-in queues one read', Boolean(job))
    if (!job) throw new Error('no read job')

    // --- The read ---------------------------------------------------------------
    const first = countingReaders()
    const outcome = await runPowerPointReadJob(job, first.readers)
    check('the read is not held', outcome.held === null, String(outcome.held))
    check('the database and the starting database are each read once, the document once',
      first.counts.database === 2 && first.counts.docx === 1 && first.counts.inspect === 0 && first.counts.pdf === 0,
      JSON.stringify(first.counts))

    const evidence = await evidenceRows(sub.submission_id)
    check('one evidence row per slot, the database of kind database',
      evidence.map((e) => `${e.slot_key}:${e.kind}:${e.status}`).join(',') === 'database:database:ok,evidence:evidence_doc:ok',
      JSON.stringify(evidence.map((e) => [e.slot_key, e.kind, e.status])))
    const dbRow = evidence.find((e) => e.slot_key === 'database')!
    const startSha = createHash('sha256').update(startDb).digest('hex')
    check('the database cache key is file:start:reader version',
      dbRow.cache_key.endsWith(`:${startSha}:${DATABASE_READER_VERSION}`), dbRow.cache_key)
    const records = (dbRow.report?.changes?.records ?? []) as any[]
    const added = (table: string) => records.find((r) => r.table === table)?.added.length ?? -1
    check('the changes list 1 APPOINTMENTS and 1 OWNERS record added',
      added('APPOINTMENTS') === 1 && added('OWNERS') === 1
        && records.every((r) => r.removed.length === 0 && r.changed.length === 0),
      JSON.stringify(records.map((r) => [r.table, r.added.length, r.removed.length, r.changed.length])))
    check('the report names the starting database', dbRow.report?.startingDatabase?.fileName === START_FILE
      && Array.isArray(dbRow.report?.startWarnings) && dbRow.report.startWarnings.length === 0, JSON.stringify(dbRow.report?.startingDatabase))
    check('the description is stored', Boolean(dbRow.description?.startsWith('TABLES'))
      && /MICROCHIP REMINDER/.test(dbRow.description ?? '') && /1 record added/.test(dbRow.description ?? ''),
      String(dbRow.description).slice(0, 200))

    const ev = evidence.find((e) => e.slot_key === 'evidence')!
    const s1 = ev.report.sections.find((s: any) => s.label === '1')
    check('the screenshots under a heading are stored under evidence/',
      s1?.images.length === 3 && s1.images.every((im: any) => im.path.startsWith(`${ACT}/practical/${ev.file_id}/evidence/1-`)),
      JSON.stringify(s1?.images.map((im: any) => im.path)))
    const s6 = ev.report.sections.find((s: any) => s.label === '6')
    check('a template heading no question names ends the section: 2 pictures under 6, 10 unplaced',
      s6?.images.length === 2 && ev.report.unplaced.images.length === 10,
      JSON.stringify({ six: s6?.images.length, unplaced: ev.report.unplaced.images.length }))
    check('the Name line is unplaced, never under a heading', /\bName\b/i.test(ev.report.unplaced.text)
      && ev.report.sections.every((s: any) => !/\bName\s*:/i.test(s.text)), JSON.stringify(ev.report.unplaced.text.slice(0, 120)))

    const { rows: answers } = await query<{ question_id: string; kind: string; status: string; transcription: string | null }>(
      'select question_id, kind, status, transcription from submission_question_answers where submission_id = $1',
      [sub.submission_id],
    )
    const answer = (label: string) => answers.find((a) => a.question_id === id(label))
    check('every question has an answer', answers.length === saved.length, String(answers.length))
    const answered = ['D1', 'D2', 'D3', 'D5', '1', '6', 'B1', 'B3', 'M1', 'N1']
    check('the database, screenshot and typed questions are answered',
      answered.every((label) => answer(label)?.status === 'answered'),
      JSON.stringify(answered.map((label) => [label, answer(label)?.status])))
    check('a database digest names the slot, never the file',
      answer('D3')?.transcription === 'Database (Database): query MICROCHIP REMINDER.'
        && answer('M1')?.transcription === 'Database (Database): every part but records.', JSON.stringify([answer('D3'), answer('M1')]))
    check('a required query:NOPE is blank', answer('D4')?.status === 'blank', JSON.stringify(answer('D4')))
    const b1 = ev.report.sections.find((s: any) => s.label === 'B1')
    check('B1\'s typed text is its transcription', answer('B1')?.kind === 'text' && Boolean(b1?.text.trim())
      && answer('B1')?.transcription === b1.text.trim(), JSON.stringify(answer('B1')))

    const { rows: marks } = await query<{ question_id: string; awarded: number; why_not_awarded: string | null }>(
      'select question_id, awarded, why_not_awarded from submission_question_criterion_marks where submission_id = $1',
      [sub.submission_id],
    )
    check('the blank one scores 0 with the reason',
      marks.length === 1 && marks[0].question_id === id('D4') && marks[0].awarded === 0
        && marks[0].why_not_awarded === 'There is no saved query called NOPE in your database.',
      JSON.stringify(marks))

    const { rows: markJobs } = await query<{ question_id: string }>(
      `select payload->>'questionId' as question_id from external_jobs
        where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1`,
      [sub.submission_id],
    )
    const queued = markJobs.map((j) => saved.find((s) => s.questionId === j.question_id)?.label).sort().join(',')
    check('mark jobs only for answered, non-teacher questions with a mark scheme', queued === '1,6,B1,B3,D1,D2,D3,D5', queued)

    const row = await jobRow(job.jobId)
    const request = row.model_request as any
    const response = row.model_response as any
    check('the read job is closed', row.status === 'done', row.status)
    check('the job row says a database reader read it', request?.reader === 'database'
      && request.databaseReaderVersion === DATABASE_READER_VERSION
      && request.files.length === 2 && request.files.every((f: any) => f.cached === false), JSON.stringify(request?.files))
    check('the job row has the database\'s counts only',
      ['tables:3', 'queries:2', 'forms:2', 'reports:2'].every((pair) => {
        const [key, n] = pair.split(':')
        return response?.slots?.find((s: any) => s.slot === 'database')?.database?.[key] === Number(n)
      }) && Object.keys(response.slots.find((s: any) => s.slot === 'database').database).length === 4,
      JSON.stringify(response?.slots))

    // --- Read again: the stored evidence is reused ------------------------------
    await query("update external_jobs set status = 'done' where job_type = 'ai_mark' and payload->>'submissionId' = $1", [sub.submission_id])
    const again = await resend(sub.submission_id)
    const second = countingReaders()
    const outcome2 = await runPowerPointReadJob(again, second.readers)
    check('an unchanged database is not read again', second.counts.database === 0 && second.counts.docx === 0, JSON.stringify(second.counts))
    check('the second read is not held', outcome2.held === null, String(outcome2.held))
    check('the job row says the files were cached', (await jobRow(again.jobId)).model_request
      && ((await jobRow(again.jobId)).model_request as any).files.every((f: any) => f.cached === true))

    // --- A starting database that is not among the activity's files -------------
    await query(
      "update activities set body_data = body_data || '{\"startingDatabaseFile\": \"GONE.accdb\"}'::jsonb where activity_id = $1",
      [ACT],
    )
    await query("update external_jobs set status = 'done' where job_type = 'ai_mark' and payload->>'submissionId' = $1", [sub.submission_id])
    const third = await resend(sub.submission_id)
    const counted3 = countingReaders()
    const outcome3 = await runPowerPointReadJob(third, counted3.readers)
    check('a new starting database name re-reads only the database', counted3.counts.database === 1 && counted3.counts.docx === 0,
      JSON.stringify(counted3.counts))
    check('…and holds nothing', outcome3.held === null && (await latestSubmission(PUPIL)).mark_error === null,
      JSON.stringify(await latestSubmission(PUPIL)))
    const missingRow = (await evidenceRows(sub.submission_id)).find((e) => e.slot_key === 'database')!
    const missingWarning = 'The starting database "GONE.accdb" is not among the activity\'s files, so changes are not listed.'
    check('…with no changes and the warning', missingRow.report?.changes === null
      && missingRow.report?.startWarnings?.[0] === missingWarning && missingRow.cache_key.includes(':missing:'),
      JSON.stringify({ changes: missingRow.report?.changes, warnings: missingRow.report?.startWarnings, key: missingRow.cache_key }))
    check('…on the job row too', ((await jobRow(third.jobId)).model_response as any)?.slots
      ?.find((s: any) => s.slot === 'database')?.warnings?.includes(missingWarning))

    // --- A damaged database holds the whole submission --------------------------
    // Stored as a good file, then its bytes replaced behind the upload check.
    await store(LATE, 'database', modelDb, BROKEN_NAME)
    await store(LATE, 'evidence', evidenceDoc, DOC_NAME)
    const { rows: [lateFile] } = await query<{ file_id: string; storage_path: string }>(
      `select f.file_id::text as file_id, f.storage_path from practical_submission_files f
         join submissions s on s.submission_id = f.submission_id
        where s.user_id = $1 and f.slot_key = 'database'`,
      [LATE],
    )
    const broken = modelDb.subarray(0, 4096)
    await writeFile(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, lateFile.storage_path), broken)
    await query('update practical_submission_files set bytes = $2, sha256 = $3 where file_id = $1::uuid',
      [lateFile.file_id, broken.byteLength, createHash('sha256').update(broken).digest('hex')])
    await handInPowerPointAssessment(ACT, LATE, { userId: LATE, isTeacher: false })
    const late = await latestSubmission(LATE)
    const lateJob = await claimRead(late.submission_id)
    if (!lateJob) throw new Error('no read job for the damaged database')
    const lateOutcome = await runPowerPointReadJob(lateJob)
    const lateAfter = await latestSubmission(LATE)
    const expected = `Not marked: Database (${BROKEN_NAME}) could not be read: ${DATABASE_MESSAGES.unopenable} Upload a working file again.`
    check('a damaged database holds the submission, naming the slot', lateOutcome.held === expected
      && lateAfter.mark_status === null && lateAfter.mark_error === expected, JSON.stringify(lateAfter))
    const lateEvidence = await evidenceRows(late.submission_id)
    check('its evidence row records the error', lateEvidence.find((e) => e.slot_key === 'database')?.status === 'error'
      && lateEvidence.find((e) => e.slot_key === 'database')?.error === DATABASE_MESSAGES.unopenable, JSON.stringify(lateEvidence.map((e) => [e.slot_key, e.status, e.error])))
    const { rows: [{ answers: lateAnswers, jobs: lateJobs }] } = await query<{ answers: number; jobs: number }>(
      `select (select count(*)::int from submission_question_answers where submission_id = $1) as answers,
              (select count(*)::int from external_jobs where payload->>'submissionId' = $1 and status in ('pending','processing')) as jobs`,
      [late.submission_id])
    check('nothing is answered and no job is open', lateAnswers === 0 && lateJobs === 0, JSON.stringify({ lateAnswers, lateJobs }))
    const lateRow = await jobRow(lateJob.jobId)
    check('the read job is closed with the reason, the file named by id', lateRow.status === 'error'
      && lateRow.last_error === expected.replace(BROKEN_NAME, `file ${lateFile.file_id}.accdb`), JSON.stringify(lateRow.last_error))

    // --- Privacy: no pupil file name or base64 on the job rows or in the log ----
    const { rows: jobs } = await query<{ payload: unknown; model_request: unknown; model_response: unknown; last_error: string | null }>(
      `select payload, model_request, model_response, last_error from external_jobs
        where payload->>'submissionId' in (select submission_id::text from submissions where user_id = any($1::text[]))`,
      [PUPILS],
    )
    const jobText = JSON.stringify(jobs)
    check('the job rows were found', jobs.length >= 4, String(jobs.length))
    check('no uploaded file name on any job row', ![DB_NAME, DOC_NAME, BROKEN_NAME, 'Pupil-Smith', 'Pupil-Jones'].some((n) => jobText.includes(n)))
    check('no base64 on any job row', jobs.every((j) => !hasBase64(j.model_request) && !hasBase64(j.model_response)))
    const { rows: logs } = await query<{ message: string; metadata: unknown }>(
      'select message, metadata from ai_marking_logs where created_at >= $1',
      [startedAt],
    )
    const logText = JSON.stringify(logs)
    check('ai_marking_logs name no uploaded file', ![DB_NAME, DOC_NAME, BROKEN_NAME].some((n) => logText.includes(n))
      && logs.some((l) => l.message.includes(sub.submission_id)), String(logs.length))
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1 or scope_path like $2)
          + (select count(*) from units where unit_id = $3)
          + (select count(*) from profiles where user_id = any($4::text[]))
          + (select count(*) from activities where activity_id = $5)
          + (select count(*) from groups where group_id = $6) as left`,
    [`${ACT}%`, `${LESSON}/%`, UNIT, PUPILS, ACT, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
