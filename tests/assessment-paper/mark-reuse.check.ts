import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { runAssessmentMarkJob } from '@/lib/assessment-paper/jobs'
import { MARK_REUSE_VERSION, markRequestHash } from '@/lib/assessment-paper/mark-reuse'
import { ASSESSMENT_TEXT_ANSWER_SURFACE } from '@/lib/assessment-paper/question-model-route'
import { remarkAssessmentActivity } from '@/lib/assessment-paper/remark-activity'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import { readSubmissionAnswers, recordQuestionCriterionMarks, setAssessmentQuestions } from '@/lib/assessment-paper/store'
import { invalidateModelRouteCache } from '@/lib/ai/model-routing'
import { restoreBatchSwitch, turnBatchSwitchOff } from '../ai/batch-switch'
import type { ModelRequest } from '@/lib/ai/model-client'
import { handInPowerPointAssessment, reopenPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointMarkJob, runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// Mark reuse (migration 151, mark-reuse.ts): a question's mark request that
// is identical to the last one answered for the same submission and question
// applies the stored answer and does not call the model.
//
// Assessment paper: the first mark calls the stub; remark_assessment_activity
// (questions) with nothing changed does not, and puts back the same marks,
// comments and ai_awarded, the job row saying reused; a teacher's row stays
// (reused or fresh); a changed mark scheme, a changed text-answer route, a
// changed page image, a changed earlier (depends_on) answer and force: true
// each call; a new attempt calls; an invalid reply stores nothing, so the next
// run calls again. PowerPoint assessment: hand-in, read (no model) and mark;
// a full remark_assessment_activity re-reads and reuses every question (a
// hold comes back as a hold, the marker's note too); Undo hand in and hand in
// again reuses; a question model change calls; force calls; a changed
// presentation (different report text) calls.
// The model is always a stub; a real call is never made. The text-answer
// route row is restored exactly and the route cache reset. Creates its own
// unit, lesson, activities, group, pupils and files, and removes them. Never
// prints names. Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/assessment-paper/mark-reuse.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURE_A = path.join(process.cwd(), 'tests', 'fixtures', 'pptx', 'reader-2', 'unknown-colour.pptx')
const FIXTURE_B = path.join(process.cwd(), 'tests', 'fixtures', 'pptx', 'reader-2', 'title-default.pptx')
const OPUS = 'claude-opus-5'
const tag = randomUUID().slice(0, 8)
const UNIT = `reuse-check-unit-${tag}`
const LESSON = `reuse-check-lesson-${tag}`
const PAPER = randomUUID()
const PPT = randomUUID()
const GROUP = `reuse-check-group-${tag}`
const PUPIL = `reuse-check-pupil-${tag}`
const PPUPIL = `reuse-check-ppupil-${tag}`
const PEOPLE = [PUPIL, PPUPIL]
const SLOTS = [{ key: 'deck', label: 'Presentation', kind: 'pptx', required: true }]
const HOLD = 'The colour of the text box on slide 1 is UNKNOWN in the report.'
// Two 1x1 PNGs with different pixels.
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

type RouteRow = Record<string, unknown>
let originalTextRoute: RouteRow | null = null

async function readTextRouteRow(): Promise<RouteRow | null> {
  const { rows } = await query<RouteRow>(
    `select route_id::text, activity_type, sc_type, provider, model, effort, active, use_batch, updated_at::text, updated_by
       from ai_model_routes where activity_type = $1 and sc_type is null`,
    [ASSESSMENT_TEXT_ANSWER_SURFACE],
  )
  return rows[0] ?? null
}

async function restoreTextRoute() {
  if (!originalTextRoute) return
  const o = originalTextRoute
  await query('delete from ai_model_routes where activity_type = $1 and sc_type is null', [ASSESSMENT_TEXT_ANSWER_SURFACE])
  await query(
    `insert into ai_model_routes (route_id, activity_type, sc_type, provider, model, effort, active, use_batch, updated_at, updated_by)
     values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10)`,
    [o.route_id, o.activity_type, o.sc_type, o.provider, o.model, o.effort, o.active, o.use_batch, o.updated_at, o.updated_by],
  )
  invalidateModelRouteCache()
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) select unnest($1::text[]), 'Test', 'Pupil'", [PEOPLE])
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Reuse unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Reuse check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'assessment-paper', 'A paper', '{}'::jsonb, 0),
       ($2, $3, 'powerpoint-assessment', 'Presentation task', $4::jsonb, 1)`,
    [PAPER, PPT, LESSON, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) values ($1, $2)', [GROUP, PPUPIL])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  const { rows } = await query<{ submission_id: string }>('select submission_id from submissions where user_id = any($1::text[])', [PEOPLE])
  const ids = rows.map((r) => r.submission_id)
  await query("delete from external_jobs where payload->>'submissionId' = any($1::text[])", [ids])
  for (const id of ids) await query('delete from ai_marking_logs where message like $1', [`%${id}%`])
  for (const activity of [PAPER, PPT]) {
    const { rows: files } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [ASSESSMENT_SCRIPTS_BUCKET, `${activity}%`],
    )
    const paths = files.map((f) => `${f.scope_path}/${f.file_name}`.replace(/^\/+/, ''))
    if (paths.length > 0) await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [ASSESSMENT_SCRIPTS_BUCKET, `${activity}%`])
    await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, activity), { recursive: true, force: true })
  }
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

/** Claim a submission's pending jobs of one type as the worker does (ignores process_after). */
async function claim(submissionId: string, jobType: 'ai_read' | 'ai_mark') {
  const { rows } = await query<{ job_id: string; assignment_id: string; question_id: string | null }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = $2 and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id, payload->>'questionId' as question_id`,
    [submissionId, jobType],
  )
  return rows.map((r) => ({ jobId: r.job_id, submissionId, assignmentId: r.assignment_id, questionId: r.question_id ?? '' }))
}

async function marksOf(submissionId: string, questionId: string) {
  const { rows } = await query<{
    success_criteria_id: string
    awarded: number
    provenance: string
    ai_awarded: number | null
    why: string | null
    how: string | null
  }>(
    `select success_criteria_id, awarded::int as awarded, provenance, ai_awarded::int as ai_awarded,
            why_not_awarded as why, how_to_improve as how
       from submission_question_criterion_marks where submission_id = $1 and question_id = $2 order by success_criteria_id`,
    [submissionId, questionId],
  )
  return rows
}

async function storedRequest(submissionId: string, questionId: string) {
  const { rows } = await query<{ request_hash: string; model: string; result: any }>(
    'select request_hash, model, result from submission_question_mark_requests where submission_id = $1 and question_id = $2',
    [submissionId, questionId],
  )
  return rows[0] ?? null
}

async function lastJob(submissionId: string, questionId: string) {
  const { rows } = await query<{ status: string; request: any; response: any; duration_ms: number | null }>(
    `select status, model_request as request, model_response as response, duration_ms
       from external_jobs where job_type = 'ai_mark' and payload->>'submissionId' = $1 and payload->>'questionId' = $2
      order by updated_at desc limit 1`,
    [submissionId, questionId],
  )
  return rows[0] ?? null
}

async function main() {
  // --- Pure: the fingerprint -------------------------------------------------------
  const base: Parameters<typeof markRequestHash>[0] = {
    provider: 'anthropic' as const,
    model: 'm',
    effort: null,
    systemText: 'S',
    responseSchema: { type: 'object', properties: { a: { type: 'string' } } },
    maxTokens: 100,
    parts: [{ text: 'P' }, { inline_data: { mime_type: 'image/png', data: PNG_A.toString('base64') } }],
    criteria: [{ successCriteriaId: 'c1', allocation: 1 }],
  }
  const h = markRequestHash(base)
  check('fingerprint: stable', h === markRequestHash({ ...base, responseSchema: { properties: { a: { type: 'string' } }, type: 'object' } }))
  check('fingerprint: version is a number', typeof MARK_REUSE_VERSION === 'number')
  const variants: Array<[string, Partial<typeof base>]> = [
    ['model', { model: 'm2' }],
    ['provider', { provider: 'google' as never }],
    ['effort', { effort: 'high' as never }],
    ['system text', { systemText: 'S2' }],
    ['schema', { responseSchema: { type: 'object' } }],
    ['prompt text', { parts: [{ text: 'P2' }, base.parts[1]] }],
    ['image bytes', { parts: [base.parts[0], { inline_data: { mime_type: 'image/png', data: PNG_B.toString('base64') } }] }],
    ['image mime type', { parts: [base.parts[0], { inline_data: { mime_type: 'image/jpeg', data: PNG_A.toString('base64') } }] }],
    ['part order', { parts: [base.parts[1], base.parts[0]] }],
    ['allocation', { criteria: [{ successCriteriaId: 'c1', allocation: 2 }] }],
    ['criterion id', { criteria: [{ successCriteriaId: 'c2', allocation: 1 }] }],
  ]
  for (const [what, change] of variants) {
    check(`fingerprint: a changed ${what} changes it`, markRequestHash({ ...base, ...change }) !== h)
  }

  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((s) => s.success_criteria_id)

  await turnBatchSwitchOff()
  originalTextRoute = await readTextRouteRow()
  if (!originalTextRoute || originalTextRoute.active !== true) {
    console.log('FAIL the surface:assessment-mark-text route row is missing or inactive; apply migration 149 first')
    await restoreBatchSwitch()
    process.exit(1)
  }
  invalidateModelRouteCache()

  await setUp()
  try {
    // =================================================================================
    // Assessment paper
    // =================================================================================
    const saved = await setAssessmentQuestions(PAPER, [
      { label: '1', maxMarks: 2, markScheme: 'One mark for a, one for b.', criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }] },
      { label: '2', maxMarks: 1, markScheme: 'One mark for c, following from 1.', dependsOn: '1', criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
      { label: '3', maxMarks: 1, markScheme: 'One mark for d.', criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
    ])
    const qid = (label: string) => saved.find((s) => s.label === label)!.questionId

    const calls: ModelRequest[] = []
    let invalid = false
    const stub: ModelJsonCall = async (request) => {
      calls.push(request)
      const prompt = request.parts[0]?.text ?? ''
      const label = /^QUESTION (\S+) /.exec(prompt)?.[1] ?? '?'
      const data = invalid
        ? { criteria: [] }
        : label === '1'
          ? {
              criteria: [
                { success_criteria_id: A, awarded: 1, why_not_awarded: '', how_to_improve: '' },
                { success_criteria_id: B, awarded: 0, why_not_awarded: 'You did not give b.', how_to_improve: 'Give b next time.' },
              ],
            }
          : { criteria: [{ success_criteria_id: A, awarded: 1, why_not_awarded: '', how_to_improve: '' }] }
      return { data, raw: JSON.stringify(data), durationMs: 5, attempts: 1 }
    }

    async function paperSubmission(attempt: number) {
      const submissionId = randomUUID()
      await query(
        `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
         values ($1, $2, $3, '{}'::json, $4::int, 'submitted', 'marking', now() + make_interval(secs => $4::int))`,
        [submissionId, PAPER, PUPIL, attempt],
      )
      await addScript(submissionId, PNG_A)
      for (const label of ['1', '2', '3']) {
        await query(
          `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance)
           values ($1, $2, 'text', $3, '{2}', 'answered', 'ai')`,
          [submissionId, qid(label), `Answer to ${label}.`],
        )
      }
      return submissionId
    }

    async function addScript(submissionId: string, png: Buffer, offsetSeconds = 0) {
      const scriptId = randomUUID()
      const pagePath = `${PAPER}/scripts/${scriptId}/page-2.png`
      const up = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).upload(pagePath, png, { contentType: 'image/png', uploadedBy: null, originalPath: pagePath })
      if (up.error) throw new Error(`page upload failed: ${JSON.stringify(up.error)}`)
      await query(
        `insert into assessment_scripts (script_id, activity_id, pupil_id, submission_id, original_path, page_count, page_paths, front_sheet_check, uploaded_at)
         values ($1, $2, $3, $4, 'x/original.pdf', 2, $5, 'passed', now() + make_interval(secs => $6::int))`,
        [scriptId, PAPER, PUPIL, submissionId, [pagePath], offsetSeconds],
      )
    }

    /** Run one fresh mark job for a question (as the read would queue it). */
    async function markOnce(submissionId: string, label: string) {
      const { rows: [{ job_id }] } = await query<{ job_id: string }>(
        `insert into external_jobs (job_type, status, payload)
         values ('ai_mark', 'processing', jsonb_build_object('submissionId', $1::text, 'assignmentId', 'self__study', 'questionId', $2::text))
         returning job_id`,
        [submissionId, qid(label)],
      )
      let error = ''
      try {
        await runAssessmentMarkJob({ jobId: job_id, submissionId, assignmentId: 'self__study', questionId: qid(label) }, stub)
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
      return error
    }

    /** remark_assessment_activity on the named paper questions, then run the queued mark jobs. Returns stub calls made. */
    async function remarkPaper(submissionId: string, labels: string[], force = false) {
      const result = await remarkAssessmentActivity({ activityId: PAPER, questions: labels, force })
      const jobs = await claim(submissionId, 'ai_mark')
      const before = calls.length
      for (const job of jobs) await runAssessmentMarkJob(job, stub)
      return { result, jobs: jobs.length, called: calls.length - before }
    }

    const sub1 = await paperSubmission(1)
    for (const label of ['1', '2', '3']) await markOnce(sub1, label)
    check('paper: the first marks call the model once per question', calls.length === 3, String(calls.length))
    const first1 = await marksOf(sub1, qid('1'))
    check('paper: question 1 marked by the marker', first1.length === 2 && first1.every((r) => r.provenance === 'ai'), JSON.stringify(first1))
    const stored1 = await storedRequest(sub1, qid('1'))
    check('paper: the answered request is stored with its hash and model',
      Boolean(stored1?.request_hash) && stored1?.model === calls[0].model && stored1?.result?.rows?.length === 2 && stored1?.result?.evidenceNote === null,
      JSON.stringify(stored1))
    const job1 = await lastJob(sub1, qid('1'))
    check('paper: the job row carries the request hash, not reused', job1?.request?.requestHash === stored1?.request_hash && job1?.request?.reused === undefined,
      JSON.stringify(job1?.request?.requestHash))

    // Nothing changed: re-mark puts the same marks back with no call.
    await query('delete from ai_marking_logs where message like $1', [`%${sub1}%`])
    const r1 = await remarkPaper(sub1, ['1'])
    check('paper: remark queued the question', r1.jobs === 1 && r1.result.question_marks_queued === 1, JSON.stringify({ jobs: r1.jobs, q: r1.result.question_marks_queued }))
    check('paper: unchanged re-mark does NOT call the model', r1.called === 0, String(r1.called))
    const again1 = await marksOf(sub1, qid('1'))
    check('paper: the same marks, comments and ai_awarded come back', JSON.stringify(again1) === JSON.stringify(first1), JSON.stringify({ again1, first1 }))
    const reusedJob = await lastJob(sub1, qid('1'))
    check('paper: the job row records reused, the hash and the stored result',
      reusedJob?.status === 'done' && reusedJob.request?.reused === true && reusedJob.request?.requestHash === stored1?.request_hash
        && reusedJob.response?.reused === true && reusedJob.response?.criteria?.length === 2 && reusedJob.duration_ms === 0,
      JSON.stringify({ status: reusedJob?.status, req: reusedJob?.request?.reused, res: reusedJob?.response?.reused, ms: reusedJob?.duration_ms }))
    const { rows: logs } = await query<{ message: string; metadata: Record<string, unknown> }>(
      'select message, metadata from ai_marking_logs where message like $1', [`%${sub1}%`],
    )
    const reusedLog = logs.find((l) => l.message.startsWith('Reused'))
    check('paper: logged "Reused" with the question id, no pupil', Boolean(reusedLog) && reusedLog!.metadata.questionId === qid('1')
      && !JSON.stringify(logs).includes(PUPIL) && !JSON.stringify(logs).includes('Test Pupil'), JSON.stringify(logs.map((l) => l.message)))
    const { rows: [sub1State] } = await query<{ mark_status: string | null }>('select mark_status from submissions where submission_id = $1', [sub1])
    check('paper: the submission is marked after the reused mark', sub1State.mark_status === 'marked', String(sub1State.mark_status))

    // A teacher's row is kept, reused or fresh.
    await recordQuestionCriterionMarks(sub1, [{ questionId: qid('1'), successCriteriaId: B, awarded: 1, whyNotAwarded: null, howToImprove: null }], 'teacher')
    const r2 = await remarkPaper(sub1, ['1'])
    const withTeacher = await marksOf(sub1, qid('1'))
    const tRow = withTeacher.find((r) => r.success_criteria_id === B)
    check('paper: reused with a teacher row: no call', r2.called === 0, String(r2.called))
    check('paper: the teacher row stays (awarded 1, teacher), its ai_awarded the marker\'s 0',
      tRow?.provenance === 'teacher' && tRow.awarded === 1 && tRow.ai_awarded === 0, JSON.stringify(tRow))
    check('paper: the AI row comes back', withTeacher.find((r) => r.success_criteria_id === A)?.provenance === 'ai')

    // Changed mark scheme: a fresh call.
    await query("update activity_questions set mark_scheme = 'One mark for a, one for b (or B).' where question_id = $1", [qid('1')])
    const r3 = await remarkPaper(sub1, ['1'])
    check('paper: a changed mark scheme calls the model', r3.called === 1, String(r3.called))
    check('paper: and the teacher row is still kept after a fresh call',
      (await marksOf(sub1, qid('1'))).find((r) => r.success_criteria_id === B)?.provenance === 'teacher')
    const r3b = await remarkPaper(sub1, ['1'])
    check('paper: then unchanged again: reused', r3b.called === 0, String(r3b.called))

    // Changed route (the text-answer route's model): a fresh call.
    try {
      await query("update ai_model_routes set model = 'claude-sonnet-5' where activity_type = $1 and sc_type is null", [ASSESSMENT_TEXT_ANSWER_SURFACE])
      invalidateModelRouteCache()
      const r4 = await remarkPaper(sub1, ['1'])
      check('paper: a changed model route calls the model', r4.called === 1 && calls[calls.length - 1].model === 'claude-sonnet-5',
        JSON.stringify({ called: r4.called, model: calls[calls.length - 1]?.model }))
    } finally {
      await restoreTextRoute()
    }
    check('the text route row is restored exactly', JSON.stringify(await readTextRouteRow()) === JSON.stringify(originalTextRoute))
    const r4b = await remarkPaper(sub1, ['1'])
    check('paper: back on the old route: a fresh call (only the latest request is kept)', r4b.called === 1, String(r4b.called))

    // A per-question model: a fresh call.
    await query('update activity_questions set marking_model = $2 where question_id = $1', [qid('1'), OPUS])
    const r5 = await remarkPaper(sub1, ['1'])
    check('paper: a question model calls the model', r5.called === 1 && calls[calls.length - 1].model === OPUS, String(r5.called))
    await query('update activity_questions set marking_model = null where question_id = $1', [qid('1')])
    await remarkPaper(sub1, ['1'])

    // Changed page image (a newer script with different page bytes): a fresh call.
    await addScript(sub1, PNG_B, 5)
    const r6 = await remarkPaper(sub1, ['1'])
    check('paper: different page bytes call the model', r6.called === 1, String(r6.called))
    const r6b = await remarkPaper(sub1, ['1'])
    check('paper: then the same bytes again: reused', r6b.called === 0, String(r6b.called))

    // depends_on: the earlier answer changed.
    // (Question 2 was marked on the first script's page; the newer script changed it.)
    const r7a = await remarkPaper(sub1, ['2'])
    check('paper: question 2 on the newer script\'s page: a fresh call', r7a.called === 1, String(r7a.called))
    const r7 = await remarkPaper(sub1, ['2'])
    check('paper: question 2 unchanged: reused', r7.called === 0, String(r7.called))
    await query("update submission_question_answers set transcription = 'A different answer to 1.' where submission_id = $1 and question_id = $2", [sub1, qid('1')])
    const r8 = await remarkPaper(sub1, ['2'])
    check('paper: a changed earlier (depends_on) answer calls the model', r8.called === 1, String(r8.called))

    // force.
    const r9 = await remarkPaper(sub1, ['3'], true)
    check('paper: force calls the model', r9.called === 1, String(r9.called))
    check('paper: force reports the stored mark forgotten', r9.result.force === true && r9.result.stored_marks_forgotten === 1,
      JSON.stringify({ force: r9.result.force, n: r9.result.stored_marks_forgotten }))
    const dry = await remarkAssessmentActivity({ activityId: PAPER, questions: ['3'], force: true, dryRun: true })
    check('paper: a force dry run counts without forgetting', dry.stored_marks_forgotten === 1 && (await storedRequest(sub1, qid('3'))) !== null,
      String(dry.stored_marks_forgotten))

    // An invalid reply stores nothing; the next run calls again.
    await query('delete from submission_question_mark_requests where submission_id = $1 and question_id = $2', [sub1, qid('3')])
    invalid = true
    const before = calls.length
    const err = await markOnce(sub1, '3')
    invalid = false
    check('paper: an invalid reply throws', /leaves out criterion/.test(err), err)
    check('paper: and stores nothing', (await storedRequest(sub1, qid('3'))) === null)
    await query("delete from external_jobs where payload->>'submissionId' = $1 and status = 'processing'", [sub1])
    await markOnce(sub1, '3')
    check('paper: the next run calls the model', calls.length - before === 2, String(calls.length - before))

    // A new attempt is a new submission: nothing reused.
    const sub2 = await paperSubmission(2)
    const beforeAttempt = calls.length
    await markOnce(sub2, '3')
    check('paper: a new attempt calls the model', calls.length - beforeAttempt === 1, String(calls.length - beforeAttempt))

    // =================================================================================
    // PowerPoint assessment
    // =================================================================================
    const pq = (label: string) => ({
      label,
      maxMarks: 2,
      markScheme: `Mark scheme for ${label}: the text box is filled pale yellow.`,
      evidence: [{ source: 'presentation', slot: 'deck', sections: ['slides:1'] }],
      criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }],
    })
    const psaved = await setAssessmentQuestions(PPT, [pq('M1'), pq('H1')])
    const pid = (label: string) => psaved.find((s) => s.label === label)!.questionId

    const pcalls = new Map<string, number>()
    const pprompts: string[] = []
    const pstub: ModelJsonCall = async (request) => {
      const prompt = request.parts.find((part) => part.text?.startsWith('PART '))?.text ?? ''
      pprompts.push(request.parts.map((part) => part.text ?? '').join(''))
      const label = /^PART (\S+) /.exec(prompt)?.[1] ?? '?'
      pcalls.set(label, (pcalls.get(label) ?? 0) + 1)
      const criteria = [
        { success_criteria_id: A, awarded: 1, why_not_awarded: '', how_to_improve: '' },
        { success_criteria_id: B, awarded: 0, why_not_awarded: 'Slide 1 is not pale yellow.', how_to_improve: 'Fill it pale yellow.' },
      ]
      const data = label === 'H1'
        ? { evidence_note: 'The fill colour is UNKNOWN.', criteria, hold_for_teacher: { reason: HOLD } }
        : { evidence_note: 'Point 1 met on slide 1; point 2 not met.', criteria }
      return { data: data as never, raw: JSON.stringify(data), durationMs: 3, attempts: 1 }
    }
    const pTotal = () => [...pcalls.values()].reduce((a, b) => a + b, 0)

    async function psubmission() {
      const { rows } = await query<{ submission_id: string; mark_status: string | null }>(
        'select submission_id, mark_status from submissions where activity_id = $1 and user_id = $2 order by attempt_number desc limit 1',
        [PPT, PPUPIL],
      )
      return rows[0]
    }
    /** Run the pending read, then the pending marks; returns the stub calls made. */
    async function readAndMark(submissionId: string) {
      const before = pTotal()
      for (const read of await claim(submissionId, 'ai_read')) await runPowerPointReadJob(read)
      for (const job of await claim(submissionId, 'ai_mark')) await runPowerPointMarkJob(job, pstub)
      return pTotal() - before
    }

    await storePracticalFile({ activityId: PPT, pupilId: PPUPIL, slotKey: 'deck', bytes: await readFile(FIXTURE_A), originalName: 'deck.pptx', uploadedBy: PPUPIL })
    await handInPowerPointAssessment(PPT, PPUPIL, { userId: PPUPIL, isTeacher: false })
    const psub = (await psubmission()).submission_id
    const pFirst = await readAndMark(psub)
    check('practical: the first marks call the model once per question', pFirst === 2, String(pFirst))
    const m1First = await marksOf(psub, pid('M1'))
    const answersFirst = await readSubmissionAnswers(psub)
    check('practical: M1 marked', m1First.length === 2 && m1First.every((r) => r.provenance === 'ai'), JSON.stringify(m1First))
    check('practical: H1 held', (await marksOf(psub, pid('H1'))).length === 0 && answersFirst.get(pid('H1'))?.status === 'unreadable')
    const h1Stored = await storedRequest(psub, pid('H1'))
    check('practical: the hold is stored with its note', h1Stored?.result?.hold === HOLD && h1Stored?.result?.rows?.length === 0
      && h1Stored?.result?.evidenceNote === 'The fill colour is UNKNOWN.', JSON.stringify(h1Stored?.result))
    check('practical: the marked part is stored with its note', (await storedRequest(psub, pid('M1')))?.result?.evidenceNote === 'Point 1 met on slide 1; point 2 not met.')

    const noteOf = async (questionId: string) => {
      const { rows } = await query<{ marker_evidence: string | null }>(
        'select marker_evidence from submission_question_answers where submission_id = $1 and question_id = $2', [psub, questionId],
      )
      return rows[0]?.marker_evidence ?? null
    }

    // Full remark_assessment_activity: re-read (no model), marks reused.
    const pr1 = await remarkAssessmentActivity({ activityId: PPT })
    check('practical: remark queued the pupil', pr1.queued === 1, JSON.stringify(pr1.queued))
    const pAgain = await readAndMark(psub)
    check('practical: unchanged full re-mark does NOT call the model', pAgain === 0, String(pAgain))
    check('practical: the same marks and comments come back', JSON.stringify(await marksOf(psub, pid('M1'))) === JSON.stringify(m1First))
    check('practical: the marker\'s note comes back', (await noteOf(pid('M1'))) === 'Point 1 met on slide 1; point 2 not met.')
    const answersAgain = await readSubmissionAnswers(psub)
    check('practical: the hold is reused as a hold', (await marksOf(psub, pid('H1'))).length === 0
      && answersAgain.get(pid('H1'))?.status === 'unreadable' && answersAgain.get(pid('H1'))?.transcription === answersFirst.get(pid('H1'))?.transcription,
      JSON.stringify(answersAgain.get(pid('H1'))))
    check('practical: the held part\'s note comes back', (await noteOf(pid('H1'))) === 'The fill colour is UNKNOWN.')
    const h1Job = await lastJob(psub, pid('H1'))
    check('practical: the held job row says reused, with the hold', h1Job?.request?.reused === true && h1Job.response?.holdForTeacher === HOLD && h1Job.response?.reused === true,
      JSON.stringify(h1Job?.response))
    const pState = await psubmission()
    check('practical: the submission is marked', pState.mark_status === 'marked', String(pState.mark_status))

    // Undo hand in, hand in again: reused.
    await reopenPowerPointAssessment(PPT, PPUPIL)
    check('practical: Undo hand in keeps the stored answers', (await storedRequest(psub, pid('M1'))) !== null)
    await handInPowerPointAssessment(PPT, PPUPIL, { userId: PPUPIL, isTeacher: false })
    const pHandIn = await readAndMark(psub)
    check('practical: hand in again with the same file: no call', pHandIn === 0, String(pHandIn))
    check('practical: and M1 has its marks again', JSON.stringify(await marksOf(psub, pid('M1'))) === JSON.stringify(m1First))

    // A per-question model on M1: a fresh call for M1 only.
    await query('update activity_questions set marking_model = $2 where question_id = $1', [pid('M1'), OPUS])
    await remarkAssessmentActivity({ activityId: PPT, questions: ['M1'] })
    const beforeModel = pcalls.get('M1') ?? 0
    const pModel = await readAndMark(psub)
    check('practical: a question model change calls the model for that question', pModel === 1 && (pcalls.get('M1') ?? 0) === beforeModel + 1, String(pModel))
    await query('update activity_questions set marking_model = null where question_id = $1', [pid('M1')])

    // force: fresh calls for every question.
    const pf = await remarkAssessmentActivity({ activityId: PPT, force: true })
    const pForce = await readAndMark(psub)
    check('practical: force calls the model for every question', pForce === 2 && pf.stored_marks_forgotten === 2, JSON.stringify({ pForce, n: pf.stored_marks_forgotten }))

    // A different presentation (different report text): fresh calls.
    const promptBefore = pprompts.length
    await storePracticalFile({ activityId: PPT, pupilId: PPUPIL, slotKey: 'deck', bytes: await readFile(FIXTURE_B), originalName: 'deck.pptx', uploadedBy: null, byTeacher: true })
    const pChanged = await readAndMark(psub)
    check('practical: a changed presentation calls the model', pChanged === 2, String(pChanged))
    check('practical: its report text differs', pprompts.length > promptBefore && pprompts[pprompts.length - 1] !== pprompts[promptBefore - 1])
  } finally {
    await restoreTextRoute()
    await restoreBatchSwitch()
    await tearDown()
  }
  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  try {
    await restoreTextRoute()
    await restoreBatchSwitch()
    await tearDown()
  } catch {}
  process.exit(1)
})
