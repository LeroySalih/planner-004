import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { runAssessmentMarkJob, runAssessmentReadJob } from '@/lib/assessment-paper/jobs'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import { chooseQuestionModel, resolveQuestionModelRoute } from '@/lib/assessment-paper/question-model-route'
import { setAssessmentQuestions } from '@/lib/assessment-paper/store'
import { BATCH_ROUTE_KEYS, batchSwitchProblem, invalidateModelRouteCache, resolveModelRoute } from '@/lib/ai/model-routing'
import { recoverStuckItems, runBatchTick } from '@/lib/ai/marking-queue'
import { getAssessmentActivity } from '@/lib/mcp/assessment-activities'
import { LESSONS_BUCKET, handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointMarkJob, runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { POWERPOINT_MARK_SYSTEM } from '@/lib/powerpoint-assessment/marking'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// Message Batches for question marking (migration 152, message-batches.ts),
// with no real model or batch call: the Batches API is a local stand-in, and
// direct calls are stubs. Checks: switch off → direct as before; switch on →
// the job is parked (still 'processing', skipped by recoverStuckItems), the
// resolved route decides (a text answer on a paper goes by the text route's
// switch); one tick submits every parked item as one batch, custom_id the job
// id, bodies with the cache flags; a batch is polled at most once a minute;
// once ended, results go through the same handling as a direct reply (marks,
// a hold, the mark-reuse row, usage and the batch on the job row, a read that
// queues the marks); errored and expired go back to the direct path (and are
// then called directly, never parked again); a superseded job's result is
// dropped; an item unsent for 30 minutes goes directly; a reused mark is
// never parked; a google route, an out-of-scope key and a bad admin key
// ignore or refuse the switch; MCP shows the batch status. Route rows are
// restored exactly. Never prints names. Run with DATABASE_URL set (and
// MARKING_QUEUE_SECRET empty):
//   npx tsx tests/assessment-paper/batch-marking.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'pptx', 'pearl-kiosk-model-answer.pptx')
const SONNET = 'claude-sonnet-5'
const HAIKU = 'claude-haiku-4-5'
const tag = randomUUID().slice(0, 8)
const UNIT = `batch-check-unit-${tag}`
const LESSON = `batch-check-lesson-${tag}`
const PAPER = randomUUID()
const PPT = randomUUID()
const GROUP = `batch-check-group-${tag}`
const PUPIL = `batch-check-pupil-${tag}`
const READER = `batch-check-reader-${tag}`
const PPUPIL = `batch-check-ppupil-${tag}`
const PEOPLE = [PUPIL, READER, PPUPIL]
const SLOTS = [{ key: 'deck', label: 'Presentation', kind: 'pptx', required: true }]
const USAGE = { input_tokens: 300, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 }
const HOLD = 'The colour of the title on slide 1 is UNKNOWN in the report.'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
const ROUTE_KEYS = [...BATCH_ROUTE_KEYS, 'short-text-question']

type RouteRow = Record<string, unknown>
let savedRoutes: RouteRow[] | null = null

async function snapshotRoutes() {
  const { rows } = await query<RouteRow>(
    `select route_id::text, activity_type, sc_type, provider, model, effort, active, use_batch, updated_at::text, updated_by
       from ai_model_routes where activity_type = any($1::text[]) order by route_id`,
    [ROUTE_KEYS],
  )
  return rows
}

async function restoreRoutes() {
  if (!savedRoutes) return
  await query('delete from ai_model_routes where activity_type = any($1::text[])', [ROUTE_KEYS])
  for (const o of savedRoutes) {
    await query(
      `insert into ai_model_routes (route_id, activity_type, sc_type, provider, model, effort, active, use_batch, updated_at, updated_by)
       values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10)`,
      [o.route_id, o.activity_type, o.sc_type, o.provider, o.model, o.effort, o.active, o.use_batch, o.updated_at, o.updated_by],
    )
  }
  invalidateModelRouteCache()
}

/** Set a key's activity-wide row (straight in the table, as the admin screen would leave it). */
async function setRoute(key: string, provider: string, model: string, useBatch: boolean) {
  await query('delete from ai_model_routes where activity_type = $1 and sc_type is null', [key])
  await query(
    "insert into ai_model_routes (activity_type, sc_type, provider, model, effort, active, use_batch) values ($1, null, $2, $3, null, true, $4)",
    [key, provider, model, useBatch],
  )
  invalidateModelRouteCache()
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) select unnest($1::text[]), 'Test', 'Pupil'", [PEOPLE])
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Batch unit ${tag}`, subject])
  await query("insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Batch check', 0, 'standard')", [LESSON, UNIT])
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

const batchIds: string[] = []

async function tearDown() {
  const { rows } = await query<{ submission_id: string }>('select submission_id from submissions where user_id = any($1::text[])', [PEOPLE])
  const ids = rows.map((r) => r.submission_id)
  await query("delete from external_jobs where payload->>'submissionId' = any($1::text[])", [ids])
  await query('delete from model_batch_items where submission_id = any($1::text[])', [ids])
  await query('delete from model_batches where batch_id = any($1::text[])', [batchIds])
  for (const id of [...ids, ...batchIds]) await query('delete from ai_marking_logs where message like $1', [`%${id}%`])
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
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, LESSON), { recursive: true, force: true })
  await query('delete from assessment_scripts where pupil_id = any($1::text[])', [PEOPLE])
  await query('delete from pupil_activity_feedback where pupil_id = any($1::text[])', [PEOPLE]).catch(() => undefined)
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

/** A local stand-in for the Message Batches API. Results come from `reply(customId, params)`. */
async function fakeBatchesApi(reply: (customId: string, params: any) => unknown) {
  const state = {
    creates: [] as any[],
    retrieves: 0,
    ended: new Set<string>(),
    other: [] as string[],
  }
  const message = (text: string) => ({
    id: `msg_${randomUUID().slice(0, 8)}`, type: 'message', role: 'assistant', model: SONNET,
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: USAGE,
  })
  let url = ''
  const batchOf = (id: string) => ({
    id, type: 'message_batch', archived_at: null, cancel_initiated_at: null, created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    ended_at: state.ended.has(id) ? new Date().toISOString() : null,
    processing_status: state.ended.has(id) ? 'ended' : 'in_progress',
    request_counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    results_url: state.ended.has(id) ? `${url}/results/${id}` : null,
  })
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const send = (body: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method === 'POST' && req.url === '/v1/messages/batches') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const id = `msgbatch_test_${tag}_${state.creates.length}`
        state.creates.push({ id, body })
        send(batchOf(id))
        return
      }
      const got = /^\/v1\/messages\/batches\/([^/?]+)$/.exec(req.url ?? '')
      if (req.method === 'GET' && got) {
        state.retrieves += 1
        send(batchOf(got[1]))
        return
      }
      const results = /^\/results\/([^/?]+)$/.exec(req.url ?? '')
      if (req.method === 'GET' && results) {
        const created = state.creates.find((c) => c.id === results[1])
        const lines = (created?.body.requests ?? []).map((r: any) => {
          const out = reply(r.custom_id, r.params) as any
          const result = out?.type ? out : { type: 'succeeded', message: message(JSON.stringify(out)) }
          return JSON.stringify({ custom_id: r.custom_id, result })
        })
        res.writeHead(200, { 'content-type': 'application/binary' })
        res.end(lines.join('\n') + '\n')
        return
      }
      state.other.push(`${req.method} ${req.url}`)
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not here' } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { state, url, close: () => server.close() }
}

async function marksOf(submissionId: string, questionId: string) {
  const { rows } = await query<{ success_criteria_id: string; awarded: number; provenance: string; ai_awarded: number | null }>(
    `select success_criteria_id, awarded::int as awarded, provenance, ai_awarded::int as ai_awarded
       from submission_question_criterion_marks where submission_id = $1 and question_id = $2 order by success_criteria_id`,
    [submissionId, questionId],
  )
  return rows
}

async function jobRow(jobId: string) {
  const { rows } = await query<{ status: string; attempts: number; payload: any; request: any; response: any; last_error: string | null }>(
    `select status, attempts, payload, model_request as request, model_response as response, last_error
       from external_jobs where job_id = $1`,
    [jobId],
  )
  return rows[0] ?? null
}

async function itemOf(jobId: string) {
  const { rows } = await query<{ kind: string; batch_id: string | null; request_hash: string; body: any }>(
    'select kind, batch_id, request_hash, body from model_batch_items where job_id = $1',
    [jobId],
  )
  return rows[0] ?? null
}

async function main() {
  // --- Pure: the switch's scope ----------------------------------------------------
  check('admin: a key out of scope is refused', /cannot be marked by batch/.test(batchSwitchProblem('short-text-question', 'anthropic') ?? ''))
  check('admin: chat and OCR surfaces are refused', ['surface:lesson-chat', 'surface:worksheet-ocr', 'surface:assessment-mark-scheme', 'upload-file']
    .every((key) => batchSwitchProblem(key, 'anthropic') !== null))
  check('admin: a google route is refused', /Only Claude/.test(batchSwitchProblem('assessment-paper', 'google') ?? ''))
  check('admin: every batch key on anthropic is allowed', BATCH_ROUTE_KEYS.every((key) => batchSwitchProblem(key, 'anthropic') === null))
  const q0 = { label: '1', markingModel: 'claude-opus-5', evidence: null }
  check("a question's own model takes the activity route's switch",
    chooseQuestionModel('assessment-paper', q0, { provider: 'anthropic', model: SONNET, effort: null, useBatch: true }).useBatch === true
      && chooseQuestionModel('assessment-paper', q0, { provider: 'anthropic', model: SONNET, effort: null, useBatch: false }).useBatch === false)

  const { rows: scs } = await query<{ success_criteria_id: string }>('select success_criteria_id from success_criteria order by success_criteria_id limit 1')
  const A = scs[0].success_criteria_id

  savedRoutes = await snapshotRoutes()
  const saved = { base: process.env.ANTHROPIC_BASE_URL, claude: process.env.CLAUDE_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY }

  // Job ids by role, filled as the jobs are parked; the stand-in replies by them.
  const role = new Map<string, string>()
  const replies: Record<string, unknown> = {}
  const api = await fakeBatchesApi((customId) => replies[role.get(customId) ?? ''] ?? { type: 'errored', error: { type: 'error', error: { type: 'api_error', message: 'unknown' } } })
  process.env.ANTHROPIC_BASE_URL = api.url
  process.env.CLAUDE_API_KEY = 'test-key-not-real'
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real'

  await setUp()
  try {
    // --- Routes: Sonnet everywhere, batch off ------------------------------------------
    await setRoute('assessment-paper', 'anthropic', SONNET, false)
    await setRoute('surface:assessment-read', 'anthropic', SONNET, false)
    await setRoute('surface:assessment-mark-text', 'anthropic', HAIKU, false)
    await setRoute('powerpoint-assessment', 'anthropic', SONNET, false)
    await setRoute('surface:powerpoint-mark-text', 'anthropic', HAIKU, false)

    const labels = ['1', '2', '3', '4', '5', '6']
    const savedQs = await setAssessmentQuestions(PAPER, labels.map((label) => ({
      label, maxMarks: 1, markScheme: `One mark for ${label}.`, criteria: [{ successCriteriaId: A, maxMarks: 1 }],
    })))
    const qid = (label: string) => savedQs.find((s) => s.label === label)!.questionId
    const fullMarks = (label: string) => ({ criteria: [{ success_criteria_id: A, awarded: 1, why_not_awarded: '', how_to_improve: '' }], _label: label })

    const stubCalls: string[] = []
    const stub: ModelJsonCall = async (request) => {
      const label = /^QUESTION (\S+) /.exec(request.parts[0]?.text ?? '')?.[1] ?? 'read'
      stubCalls.push(label)
      const data = label === 'read'
        ? { answers: labels.map((l) => ({ label: l, kind: 'text', transcription: `Answer ${l}.`, pages: [2], status: 'answered' })) }
        : fullMarks(label)
      return { data, raw: JSON.stringify(data), durationMs: 3, attempts: 1 }
    }

    async function addScript(submissionId: string, pupil: string) {
      const scriptId = randomUUID()
      const pagePath = `${PAPER}/scripts/${scriptId}/page-2.png`
      const up = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).upload(pagePath, PNG, { contentType: 'image/png', uploadedBy: null, originalPath: pagePath })
      if (up.error) throw new Error(`page upload failed: ${JSON.stringify(up.error)}`)
      await query(
        `insert into assessment_scripts (script_id, activity_id, pupil_id, submission_id, original_path, page_count, page_paths, front_sheet_check, uploaded_at)
         values ($1, $2, $3, $4, 'x/original.pdf', 2, $5, 'passed', now())`,
        [scriptId, PAPER, pupil, submissionId, [pagePath]],
      )
    }
    async function paperSubmission(pupil: string, attempt: number, answerKind: (label: string) => string | null) {
      const submissionId = randomUUID()
      await query(
        `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
         values ($1, $2, $3, '{}'::json, $4::int, 'submitted', 'marking', now() + make_interval(secs => $4::int))`,
        [submissionId, PAPER, pupil, attempt],
      )
      await addScript(submissionId, pupil)
      for (const label of labels) {
        const kind = answerKind(label)
        if (!kind) continue
        await query(
          `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance)
           values ($1, $2, $3, $4, '{2}', 'answered', 'ai')`,
          [submissionId, qid(label), kind, `Answer to ${label}.`],
        )
      }
      return submissionId
    }
    async function newJob(submissionId: string, type: 'ai_mark' | 'ai_read', questionId: string | null) {
      const { rows: [{ job_id }] } = await query<{ job_id: string }>(
        `insert into external_jobs (job_type, status, payload)
         values ($1, 'processing', jsonb_build_object('submissionId', $2::text, 'assignmentId', 'self__study')
                   || case when $3::text is null then '{}'::jsonb else jsonb_build_object('questionId', $3::text) end)
         returning job_id`,
        [type, submissionId, questionId],
      )
      return job_id
    }
    const markJob = (jobId: string, submissionId: string, label: string) =>
      runAssessmentMarkJob({ jobId, submissionId, assignmentId: 'self__study', questionId: qid(label) }, stub)

    // =================================================================================
    // Switch off: direct, as before
    // =================================================================================
    const sub0 = await paperSubmission(PUPIL, 1, () => 'sketch')
    const j0 = await newJob(sub0, 'ai_mark', qid('1'))
    const r0 = await markJob(j0, sub0, '1')
    check('switch off: the model is called directly and nothing is parked',
      stubCalls.join() === '1' && !(await itemOf(j0)) && !r0.parked && (await jobRow(j0))?.status === 'done', stubCalls.join())

    // =================================================================================
    // Switch on
    // =================================================================================
    await setRoute('assessment-paper', 'anthropic', SONNET, true)
    await setRoute('surface:assessment-read', 'anthropic', SONNET, true)
    await setRoute('surface:powerpoint-mark-text', 'anthropic', HAIKU, true)
    stubCalls.length = 0

    // Attempt 2 of PUPIL: question 2 is a text answer (text route, switch off), the rest sketches.
    const sub1 = await paperSubmission(PUPIL, 2, (label) => (label === '2' ? 'text' : 'sketch'))
    const jobs: Record<string, string> = {}
    for (const label of ['1', '2', '3', '4', '5']) {
      jobs[label] = await newJob(sub1, 'ai_mark', qid(label))
      const r = await markJob(jobs[label], sub1, label)
      if (r.parked) role.set(jobs[label], `paper-${label}`)
    }
    check('switch on: sketch answers are parked, the model is not called', ['1', '3', '4', '5'].every((l) => role.get(jobs[l]) === `paper-${l}`), [...role.values()].join())
    check('the resolved route decides: a text answer goes by the text route, whose switch is off', stubCalls.join() === '2' && !(await itemOf(jobs['2'])), stubCalls.join())
    const parked1 = await jobRow(jobs['1'])
    const item1 = await itemOf(jobs['1'])
    check('a parked job stays processing, with the batch named but not sent',
      parked1?.status === 'processing' && parked1.request?.batch?.id === null && item1?.kind === 'assessment-mark' && item1.batch_id === null, JSON.stringify(parked1?.request))
    const { rows: [subRow] } = await query<{ mark_status: string }>('select mark_status from submissions where submission_id = $1', [sub1])
    check('the submission stays in its marking state', subRow.mark_status === 'marking', subRow.mark_status)

    await query("update external_jobs set updated_at = now() - interval '11 minutes' where job_id = $1", [jobs['1']])
    await recoverStuckItems()
    check('recoverStuckItems skips a parked job', (await jobRow(jobs['1']))?.status === 'processing')

    // The read of another pupil's script.
    const sub2 = await paperSubmission(READER, 1, () => null)
    const readJob = await newJob(sub2, 'ai_read', null)
    const read = await runAssessmentReadJob({ jobId: readJob, submissionId: sub2, assignmentId: 'self__study' }, stub)
    if (read.parked) role.set(readJob, 'read')
    check('switch on: the paper read is parked', read.parked === true && (await itemOf(readJob))?.kind === 'assessment-read' && !stubCalls.includes('read'))

    // A practical hand-in: text-only questions go by surface:powerpoint-mark-text.
    const pptQs = await setAssessmentQuestions(PPT, ['P1', 'P2'].map((label) => ({
      label, maxMarks: 1, markScheme: `Mark scheme for ${label}.`,
      evidence: [{ source: 'presentation', slot: 'deck', sections: ['slides'] }],
      criteria: [{ successCriteriaId: A, maxMarks: 1 }],
    })))
    const pqid = (label: string) => pptQs.find((s) => s.label === label)!.questionId
    await storePracticalFile({ activityId: PPT, pupilId: PPUPIL, slotKey: 'deck', bytes: await readFile(FIXTURE), originalName: 'Deck.pptx', uploadedBy: PPUPIL })
    await handInPowerPointAssessment(PPT, PPUPIL, { userId: PPUPIL, isTeacher: false })
    const { rows: [psub] } = await query<{ submission_id: string }>('select submission_id from submissions where activity_id = $1 and user_id = $2', [PPT, PPUPIL])
    const { rows: [pread] } = await query<{ job_id: string; assignment_id: string }>(
      `update external_jobs set status = 'processing' where job_type = 'ai_read' and payload->>'submissionId' = $1
        returning job_id, payload->>'assignmentId' as assignment_id`, [psub.submission_id])
    await runPowerPointReadJob({ jobId: pread.job_id, submissionId: psub.submission_id, assignmentId: pread.assignment_id })
    const { rows: pjobs } = await query<{ job_id: string; assignment_id: string; question_id: string }>(
      `update external_jobs set status = 'processing' where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1
        returning job_id, payload->>'assignmentId' as assignment_id, payload->>'questionId' as question_id`, [psub.submission_id])
    for (const job of pjobs) {
      const label = job.question_id === pqid('P1') ? 'P1' : 'P2'
      const r = await runPowerPointMarkJob({ jobId: job.job_id, submissionId: psub.submission_id, assignmentId: job.assignment_id, questionId: job.question_id }, stub)
      if (r.parked) role.set(job.job_id, `ppt-${label}`)
    }
    const pjob = (label: string) => [...role.entries()].find(([, r]) => r === `ppt-${label}`)?.[0] ?? ''
    check('switch on: the practical questions are parked', pjobs.length === 2 && Boolean(pjob('P1')) && Boolean(pjob('P2')) && stubCalls.join() === '2', stubCalls.join())

    const mcp = await getAssessmentActivity(PAPER)
    const mcpPupil = (mcp as any).pupils?.find((p: any) => p.submission_id === sub1) ?? (mcp as any).assessment_activity?.pupils?.find((p: any) => p.submission_id === sub1)
    check('MCP: the pupil shows marking waiting on a batch, not yet sent',
      mcpPupil?.progress?.batch?.jobs === 4 && mcpPupil.progress.batch.status === 'to_send', JSON.stringify(mcpPupil?.progress))

    // --- Tick 1: one batch with every parked item ---------------------------------------
    const tick1 = await runBatchTick()
    const created = api.state.creates
    batchIds.push(...created.map((c) => c.id))
    const requests: any[] = created[0]?.body.requests ?? []
    const parkedIds = [...role.keys()]
    check('tick: every parked item goes in one batch, custom_id the job id',
      created.length === 1 && tick1.submitted === parkedIds.length && requests.length === parkedIds.length
        && parkedIds.every((id) => requests.some((r) => r.custom_id === id)), JSON.stringify({ creates: created.length, tick1, n: requests.length }))
    const bodyOf = (jobId: string) => requests.find((r) => r.custom_id === jobId)?.params
    const p1 = bodyOf(pjob('P1'))
    check('a practical body keeps the cache flags (system and report parts) and its route model',
      p1?.model === HAIKU && Array.isArray(p1.system) && p1.system[0].cache_control?.type === 'ephemeral' && p1.system[0].text === POWERPOINT_MARK_SYSTEM
        && p1.messages[0].content.some((b: any) => b.cache_control?.type === 'ephemeral') && p1.output_config?.format?.type === 'json_schema' && p1.max_tokens === 16000,
      JSON.stringify(p1)?.slice(0, 300))
    const q1 = bodyOf(jobs['1'])
    check('a paper body carries the page image and the prompt, with no pupil name',
      q1?.model === SONNET && q1.messages[0].content.some((b: any) => b.type === 'image' && b.source?.data === PNG.toString('base64'))
        && /^QUESTION 1 /.test(q1.messages[0].content[0].text) && !JSON.stringify(requests).includes('Test Pupil') && !JSON.stringify(requests).includes('Deck.pptx'))
    const sent1 = await jobRow(jobs['1'])
    check('the job row records the batch id and when it was sent',
      sent1?.request?.batch?.id === created[0]?.id && !Number.isNaN(Date.parse(sent1?.request?.batch?.submittedAt)), JSON.stringify(sent1?.request?.batch))
    check('tick: an in-progress batch is polled once and nothing is applied', api.state.retrieves === 1 && tick1.handled === 0 && (await jobRow(jobs['1']))?.status === 'processing',
      String(api.state.retrieves))
    const mcp2 = await getAssessmentActivity(PAPER)
    const mcpPupil2 = (mcp2 as any).pupils?.find((p: any) => p.submission_id === sub1) ?? (mcp2 as any).assessment_activity?.pupils?.find((p: any) => p.submission_id === sub1)
    check('MCP: …then sent', mcpPupil2?.progress?.batch?.status === 'sent', JSON.stringify(mcpPupil2?.progress?.batch))
    await runBatchTick()
    check('tick: a batch is not polled again within the minute', api.state.retrieves === 1, String(api.state.retrieves))

    // A job parked after the batch went, never sent: after 30 minutes it goes directly.
    jobs['6'] = await newJob(sub1, 'ai_mark', qid('6'))
    check('a later job is parked', (await markJob(jobs['6'], sub1, '6')).parked === true)
    await query("update model_batch_items set created_at = now() - interval '31 minutes' where job_id = $1", [jobs['6']])

    // A re-mark replaces question 3's job while it waits: its result must be dropped.
    await query('delete from external_jobs where job_id = $1', [jobs['3']])

    // --- The batch ends -------------------------------------------------------------------
    replies['paper-1'] = { criteria: [{ success_criteria_id: A, awarded: 0, why_not_awarded: 'You did not show d.', how_to_improve: 'Show d next time.' }] }
    replies['paper-3'] = fullMarks('3')
    replies['paper-4'] = { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }
    replies['paper-5'] = { type: 'expired' }
    replies.read = { answers: labels.map((l) => ({ label: l, kind: 'text', transcription: `Read ${l}.`, pages: [2], status: 'answered' })) }
    replies['ppt-P1'] = { evidence_note: 'Slide 1 has a title.', criteria: [{ success_criteria_id: A, awarded: 1, why_not_awarded: '', how_to_improve: '' }] }
    replies['ppt-P2'] = { evidence_note: 'The title colour is not in the report.', criteria: [], hold_for_teacher: { reason: HOLD } }
    for (const c of created) api.state.ended.add(c.id)
    await query('update model_batches set last_polled_at = null where batch_id = any($1::text[])', [batchIds])
    const tick2 = await runBatchTick()

    const done1 = await jobRow(jobs['1'])
    const marks1 = await marksOf(sub1, qid('1'))
    check('succeeded: the marks are applied as a direct reply would be',
      done1?.status === 'done' && marks1.length === 1 && marks1[0].awarded === 0 && marks1[0].provenance === 'ai' && marks1[0].ai_awarded === 0, JSON.stringify({ status: done1?.status, marks1 }))
    check('succeeded: usage and the batch on the job row',
      done1?.response?.usage?.inputTokens === 300 && done1.response.usage.cacheReadInputTokens === 2000
        && done1.request?.batch?.id === created[0]?.id && done1.request?.requestHash === item1?.request_hash && done1.request?.label === '1',
      JSON.stringify({ usage: done1?.response?.usage, batch: done1?.request?.batch }))
    const { rows: stored1 } = await query<{ request_hash: string }>(
      'select request_hash from submission_question_mark_requests where submission_id = $1 and question_id = $2', [sub1, qid('1')])
    check('succeeded: the mark-reuse row is stored with the parked request hash', stored1[0]?.request_hash === item1?.request_hash, JSON.stringify(stored1))
    check('succeeded: the item is gone', !(await itemOf(jobs['1'])))

    check('superseded: the result for a replaced job is dropped', (await marksOf(sub1, qid('3'))).length === 0 && tick2.dropped >= 1, JSON.stringify(tick2))

    const err4 = await jobRow(jobs['4'])
    const exp5 = await jobRow(jobs['5'])
    check('errored: back to the direct path, attempts unchanged, never lost',
      err4?.status === 'pending' && err4.attempts === 0 && err4.payload?.directOnly === true && /errored: Overloaded/.test(err4.last_error ?? '') && !(await itemOf(jobs['4'])),
      JSON.stringify(err4))
    check('expired: back to the direct path', exp5?.status === 'pending' && exp5.payload?.directOnly === true && /expired/.test(exp5.last_error ?? ''), JSON.stringify(exp5))
    const late6 = await jobRow(jobs['6'])
    check('an item not sent in 30 minutes goes directly', late6?.status === 'pending' && late6.payload?.directOnly === true && !(await itemOf(jobs['6'])), JSON.stringify(late6))
    check('the tick asks for the queue to run', tick2.wake === true && tick2.released >= 3, JSON.stringify(tick2))

    // The direct retry: claimed again, it calls the model and is not parked again.
    stubCalls.length = 0
    await query("update external_jobs set status = 'processing' where job_id = $1", [jobs['4']])
    const retry4 = await markJob(jobs['4'], sub1, '4')
    check('the direct retry calls the model, not a batch', !retry4.parked && stubCalls.join() === '4' && !(await itemOf(jobs['4'])) && (await jobRow(jobs['4']))?.status === 'done', stubCalls.join())

    // The read.
    const readDone = await jobRow(readJob)
    const { rows: answers } = await query<{ n: number }>('select count(*)::int as n from submission_question_answers where submission_id = $1', [sub2])
    const { rows: queued } = await query<{ n: number }>(
      "select count(*)::int as n from external_jobs where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1", [sub2])
    check('read result: the answers are stored and the questions queued for marking',
      readDone?.status === 'done' && answers[0].n === 6 && queued[0].n === 6 && readDone.request?.batch?.id === created[0]?.id && readDone.response?.usage?.outputTokens === 40,
      JSON.stringify({ status: readDone?.status, answers: answers[0].n, queued: queued[0].n }))

    // The practical questions.
    const pm1 = await marksOf(psub.submission_id, pqid('P1'))
    check('practical result: marks applied', pm1.length === 1 && pm1[0].awarded === 1 && (await jobRow(pjob('P1')))?.status === 'done', JSON.stringify(pm1))
    const { rows: [held] } = await query<{ status: string; transcription: string | null; marker_evidence: string | null }>(
      'select status, transcription, marker_evidence from submission_question_answers where submission_id = $1 and question_id = $2', [psub.submission_id, pqid('P2')])
    const { rows: [pstat] } = await query<{ mark_status: string | null; mark_error: string | null }>(
      'select mark_status, mark_error from submissions where submission_id = $1', [psub.submission_id])
    check('practical result: a hold is held as a direct reply would be',
      (await marksOf(psub.submission_id, pqid('P2'))).length === 0 && held?.status === 'unreadable' && (held.transcription ?? '').includes('UNKNOWN')
        && held.marker_evidence === 'The title colour is not in the report.' && /P2/.test(pstat?.mark_error ?? ''),
      JSON.stringify({ held, pstat }))
    const { rows: [handled] } = await query<{ results_handled_at: string | null }>('select results_handled_at::text from model_batches where batch_id = $1', [created[0]?.id])
    check('the batch is closed once its results are handled', Boolean(handled?.results_handled_at))

    // --- A reused mark never goes to a batch ---------------------------------------------
    const jr = await newJob(sub1, 'ai_mark', qid('1'))
    stubCalls.length = 0
    const reused = await markJob(jr, sub1, '1')
    const reusedRow = await jobRow(jr)
    check('reuse: the stored mark is applied, no batch item, no call',
      !reused.parked && !(await itemOf(jr)) && stubCalls.length === 0 && reusedRow?.request?.reused === true && reusedRow.status === 'done', JSON.stringify(reusedRow?.request?.reused))

    // --- The switch is ignored off anthropic, and on keys out of scope --------------------
    await setRoute('assessment-paper', 'google', 'gemini-flash-latest', true)
    const googleRoute = await resolveQuestionModelRoute('assessment-paper', qid('5'), sub1)
    check('a google route with the switch on is not sent by batch', googleRoute.provider === 'google' && !googleRoute.useBatch, JSON.stringify(googleRoute))
    await query("update external_jobs set status = 'processing' where job_id = $1", [jobs['5']])
    await query("update external_jobs set payload = payload - 'directOnly' where job_id = $1", [jobs['5']])
    stubCalls.length = 0
    const g5 = await markJob(jobs['5'], sub1, '5')
    check('…the model is called directly', !g5.parked && stubCalls.join() === '5' && !(await itemOf(jobs['5'])), stubCalls.join())
    await setRoute('short-text-question', 'anthropic', SONNET, true)
    check('a key out of scope ignores the switch', (await resolveModelRoute('short-text-question', null)).useBatch === false)

    const { rows: [column] } = await query<{ column_default: string | null }>(
      "select column_default from information_schema.columns where table_name = 'ai_model_routes' and column_name = 'use_batch'",
    )
    check('the batch switch is on by default', column?.column_default === 'true', String(column?.column_default))

    check('no other API call was made', api.state.other.length === 0, api.state.other.join())
  } finally {
    api.close()
    for (const [key, value] of [['ANTHROPIC_BASE_URL', saved.base], ['CLAUDE_API_KEY', saved.claude], ['ANTHROPIC_API_KEY', saved.anthropic]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await tearDown()
    await restoreRoutes()
    const after = await snapshotRoutes()
    check('the route rows are restored exactly', JSON.stringify(after) === JSON.stringify(savedRoutes), JSON.stringify({ after, savedRoutes }))
  }
  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().then(restoreRoutes).finally(() => process.exit(1))
})
