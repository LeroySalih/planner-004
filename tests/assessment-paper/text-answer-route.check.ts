import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { readAssessmentQuestions, setAssessmentQuestions, type AssessmentQuestionInput } from '@/lib/assessment-paper/store'
import { runAssessmentMarkJob } from '@/lib/assessment-paper/jobs'
import { readAssessmentPaperSetup } from '@/lib/assessment-paper/setup'
import {
  ASSESSMENT_TEXT_ANSWER_SURFACE,
  POWERPOINT_TEXT_QUESTION_SURFACE,
  chooseQuestionModel,
  textAnswerRouteProblem,
} from '@/lib/assessment-paper/question-model-route'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { findOwnModelRoute, invalidateModelRouteCache, resolveModelRoute } from '@/lib/ai/model-routing'
import { restoreBatchSwitch, turnBatchSwitchOff } from '../ai/batch-switch'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import type { ModelRequest } from '@/lib/ai/model-client'
import { getAssessmentActivity } from '@/lib/mcp/assessment-activities'
import { runPowerPointMarkJob } from '@/lib/powerpoint-assessment/jobs'

// The text-answer route on assessment papers (migration 149): with no
// question model, an answer the reader stored as kind 'text', status
// 'answered' is marked on surface:assessment-mark-text; sketch, mixed,
// unreadable and continued answers on the paper route; a question's own
// model wins over both; an inactive or deleted text-route row falls back to
// the paper route (never DEFAULT_ROUTE); a text route naming an unknown or
// image model falls back with a warn; a depends_on answer does not decide;
// practical types do not use it (their own text route, migration 150, is
// tested in tests/powerpoint-assessment/text-question-route.check.ts). The model call is stubbed: it captures the
// request and throws, so no real call is made and nothing is marked.
// Route rows changed here are restored exactly, and the in-process route
// cache is reset after every change. Creates its own unit, lesson,
// activities, pupil, submissions, script page and jobs, and removes them.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/assessment-paper/text-answer-route.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const OPUS = 'claude-opus-5'
const tag = randomUUID().slice(0, 8)
const UNIT = `text-route-check-unit-${tag}`
const LESSON = `text-route-check-lesson-${tag}`
const PAPER = randomUUID()
const PPT = randomUUID()
const PUPIL = `text-route-check-pupil-${tag}`
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

type RouteRow = {
  route_id: string
  activity_type: string
  sc_type: string | null
  provider: string
  model: string
  effort: string | null
  active: boolean
  use_batch: boolean
  updated_at: string
  updated_by: string | null
}
let original: RouteRow | null = null

async function readTextRouteRow(): Promise<RouteRow | null> {
  const { rows } = await query<RouteRow>(
    `select route_id::text, activity_type, sc_type, provider, model, effort, active, use_batch, updated_at::text, updated_by
       from ai_model_routes where activity_type = $1 and sc_type is null`,
    [ASSESSMENT_TEXT_ANSWER_SURFACE],
  )
  return rows[0] ?? null
}

async function restoreTextRoute() {
  if (!original) return
  await query('delete from ai_model_routes where activity_type = $1 and sc_type is null', [ASSESSMENT_TEXT_ANSWER_SURFACE])
  await query(
    `insert into ai_model_routes (route_id, activity_type, sc_type, provider, model, effort, active, use_batch, updated_at, updated_by)
     values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10)`,
    [original.route_id, original.activity_type, original.sc_type, original.provider, original.model, original.effort,
      original.active, original.use_batch, original.updated_at, original.updated_by],
  )
  invalidateModelRouteCache()
}

async function changeTextRoute(sql: string, params: unknown[] = []) {
  await query(sql, [ASSESSMENT_TEXT_ANSWER_SURFACE, ...params])
  invalidateModelRouteCache()
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Test', 'Pupil')", [PUPIL])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Text route unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Text route check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'assessment-paper', 'A paper', '{}'::jsonb, 0),
       ($2, $3, 'powerpoint-assessment', 'Presentation task', $4::jsonb, 1)`,
    [PAPER, PPT, LESSON, JSON.stringify({ uploadSlots: [{ key: 'deck', label: 'Presentation', kind: 'pptx', required: true }] })],
  )
}

async function tearDown() {
  const { rows } = await query<{ submission_id: string }>('select submission_id from submissions where user_id = $1', [PUPIL])
  const ids = rows.map((r) => r.submission_id)
  await query("delete from external_jobs where payload->>'submissionId' = any($1::text[])", [ids])
  for (const id of ids) await query('delete from ai_marking_logs where message like $1', [`%${id}%`])
  const { rows: files } = await query<{ scope_path: string; file_name: string }>(
    'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
    [ASSESSMENT_SCRIPTS_BUCKET, `${PAPER}%`],
  )
  const paths = files.map((f) => `${f.scope_path}/${f.file_name}`.replace(/^\/+/, ''))
  if (paths.length > 0) await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
  await query('delete from stored_files where bucket = $1 and scope_path like $2', [ASSESSMENT_SCRIPTS_BUCKET, `${PAPER}%`])
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, PAPER), { recursive: true, force: true })
  await query('delete from assessment_scripts where pupil_id = $1', [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

/** Captures the request, then throws: no real call, nothing marked. */
function captureModel(captured: ModelRequest[]): ModelJsonCall {
  return async (request) => {
    captured.push(request)
    throw new Error('stub model: captured')
  }
}

async function main() {
  await turnBatchSwitchOff()
  original = await readTextRouteRow()
  if (!original || !original.active) {
    console.log('FAIL the surface:assessment-mark-text route row is missing or inactive; apply migration 149 first')
    await restoreBatchSwitch()
    process.exit(1)
  }
  const textModel = original.model
  invalidateModelRouteCache()
  const paperRoute = await resolveModelRoute('assessment-paper', null)
  const pptRoute = await resolveModelRoute('powerpoint-assessment', null)
  check('the seeded text route is Claude Haiku 4.5 on Anthropic', original.provider === 'anthropic' && textModel === 'claude-haiku-4-5', `${original.provider}/${textModel}`)
  check('the paper route differs from the text route (the checks below tell them apart)', paperRoute.model !== textModel, paperRoute.model)

  // --- Pure ---------------------------------------------------------------------
  const textRoute = { provider: 'anthropic' as const, model: textModel, effort: null }
  const q0 = { label: '1', markingModel: null, evidence: [] }
  check('pure: a paper text answer takes the text route', chooseQuestionModel('assessment-paper', q0, paperRoute, textRoute).source === 'text-answers')
  check('pure: no text route given is the activity route', chooseQuestionModel('assessment-paper', q0, paperRoute, null).model === paperRoute.model)
  check('pure: a practical question that sends pictures ignores a text route',
    chooseQuestionModel('powerpoint-assessment', { ...q0, evidence: [{ source: 'slide_images', slot: 'deck' }] }, pptRoute, textRoute).source === 'activity')
  check('pure: a question model wins over the text route',
    chooseQuestionModel('assessment-paper', { ...q0, markingModel: OPUS }, paperRoute, textRoute).model === OPUS)
  const staleQ = chooseQuestionModel('assessment-paper', { ...q0, markingModel: 'claude-haiku-4-5' }, paperRoute, textRoute)
  check('pure: a disallowed question model falls to the text route, reported as ignored', staleQ.source === 'text-answers' && Boolean(staleQ.ignored))
  check('pure: an unknown text-route model is a problem', textAnswerRouteProblem({ provider: 'anthropic', model: 'retired-x', effort: null }) !== null)
  check('pure: an image model is a problem', textAnswerRouteProblem({ provider: 'google', model: 'gemini-3.1-flash-image', effort: null }) !== null)
  check('pure: Haiku is fine', textAnswerRouteProblem(textRoute) === null)

  await setUp()
  try {
    const { rows: [{ success_criteria_id: A }] } = await query<{ success_criteria_id: string }>(
      'select success_criteria_id from success_criteria order by success_criteria_id limit 1',
    )
    const q = (label: string, extra: Partial<AssessmentQuestionInput> = {}): AssessmentQuestionInput => ({
      label,
      maxMarks: 1,
      markScheme: `Mark scheme for ${label}.`,
      criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      ...extra,
    })
    await setAssessmentQuestions(PAPER, [
      q('T'), q('S'), q('M'), q('U'), q('C'), q('O', { markingModel: OPUS }), q('D', { dependsOn: 'S' }),
    ])
    await setAssessmentQuestions(PPT, [q('P1', { evidence: [{ source: 'presentation', slot: 'deck' }] })])
    const ids = new Map((await readAssessmentQuestions(PAPER)).map((x) => [x.label, x.questionId]))
    const answerKinds: Record<string, [string, string]> = {
      T: ['text', 'answered'],
      S: ['sketch', 'answered'],
      M: ['mixed', 'answered'],
      U: ['text', 'unreadable'],
      C: ['text', 'continued'],
      O: ['text', 'answered'],
      D: ['text', 'answered'],
    }

    // One submission, one passed script with one markable page, a read answer per question.
    const submissionId = randomUUID()
    await query(
      `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
       values ($1, $2, $3, '{}'::json, 1, 'submitted', 'marking', now())`,
      [submissionId, PAPER, PUPIL],
    )
    const scriptId = randomUUID()
    const pagePath = `${PAPER}/scripts/${scriptId}/page-2.png`
    const uploaded = await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).upload(pagePath, PNG, { contentType: 'image/png', uploadedBy: null, originalPath: pagePath })
    check('the script page is stored', !uploaded.error, JSON.stringify(uploaded.error))
    await query(
      `insert into assessment_scripts (script_id, activity_id, pupil_id, submission_id, original_path, page_count, page_paths, front_sheet_check)
       values ($1, $2, $3, $4, 'x/original.pdf', 2, $5, 'passed')`,
      [scriptId, PAPER, PUPIL, submissionId, [pagePath]],
    )
    for (const [label, [kind, status]] of Object.entries(answerKinds)) {
      await query(
        `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance)
         values ($1, $2, $3, 'An answer.', '{2}', $4, 'ai')`,
        [submissionId, ids.get(label), kind, status],
      )
    }

    /** Run one mark job for a question; the model it was sent to, and the job's log lines. */
    async function markWith(label: string) {
      const questionId = ids.get(label)!
      const { rows: [{ job_id }] } = await query<{ job_id: string }>(
        `insert into external_jobs (job_type, status, payload)
         values ('ai_mark', 'processing', jsonb_build_object('submissionId', $1::text, 'assignmentId', 'self__study', 'questionId', $2::text))
         returning job_id`,
        [submissionId, questionId],
      )
      await query('delete from ai_marking_logs where message like $1', [`%${submissionId}%`])
      const captured: ModelRequest[] = []
      let error = ''
      try {
        await runAssessmentMarkJob({ jobId: job_id, submissionId, assignmentId: 'self__study', questionId }, captureModel(captured))
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
      await query('delete from external_jobs where job_id = $1', [job_id])
      const { rows: logs } = await query<{ level: string; message: string; metadata: Record<string, unknown> }>(
        'select level, message, metadata from ai_marking_logs where message like $1 order by created_at',
        [`%${submissionId}%`],
      )
      const marking = logs.find((l) => l.message.startsWith('Marking'))
      return {
        model: captured[0]?.model ?? null,
        provider: captured[0]?.provider ?? null,
        images: captured[0]?.parts.filter((p) => Boolean(p.inline_data)).length ?? 0,
        source: marking?.metadata.modelSource ?? null,
        logs,
        error,
      }
    }

    // --- Mark time, route as seeded -------------------------------------------------------
    const t = await markWith('T')
    check('text + answered is sent to the text-route model', t.model === textModel && t.provider === original.provider, JSON.stringify({ model: t.model, error: t.error }))
    check('and logged with modelSource text-answers', t.source === 'text-answers', String(t.source))
    check('the stub threw (no real call)', /stub model/.test(t.error), t.error)
    check('the page image is still sent on the text route', t.images >= 1, String(t.images))
    for (const label of ['S', 'M', 'U', 'C']) {
      const r = await markWith(label)
      check(`${answerKinds[label].join(' + ')} keeps the paper route`, r.model === paperRoute.model && r.source === 'activity', JSON.stringify({ model: r.model, source: r.source, error: r.error }))
    }
    const o = await markWith('O')
    check('a question model (Opus) wins over the text route', o.model === OPUS && o.source === 'question', JSON.stringify({ model: o.model, source: o.source }))
    const d = await markWith('D')
    check('a text answer whose depends_on answer is a sketch still takes the text route', d.model === textModel && d.source === 'text-answers', JSON.stringify({ model: d.model, source: d.source }))

    // --- MCP and the editor's setup ----------------------------------------------------------
    const activity = await getAssessmentActivity(PAPER)
    const reported = activity.questions as Array<{ label: string; effective_marking_model: string; text_answer_marking_model?: string }>
    const byLabel = (label: string) => reported.find((x) => x.label === label)
    check('get_assessment_activity reports text_answer_marking_model on a paper',
      byLabel('T')?.text_answer_marking_model === textModel && byLabel('T')?.effective_marking_model === paperRoute.model
        && byLabel('O')?.text_answer_marking_model === OPUS,
      JSON.stringify(reported.map((x) => [x.label, x.effective_marking_model, x.text_answer_marking_model])))
    const pptActivity = await getAssessmentActivity(PPT)
    check('and not on a practical type', !(pptActivity.questions as Array<Record<string, unknown>>).some((x) => 'text_answer_marking_model' in x))
    const setup = await readAssessmentPaperSetup(PAPER)
    check('the editor setup carries the text-answer model on a paper',
      setup.textAnswerMarkingModel?.model === textModel && setup.textAnswerMarkingModel?.label === 'Claude Haiku 4.5', JSON.stringify(setup.textAnswerMarkingModel))
    check('and null on a practical type', (await readAssessmentPaperSetup(PPT)).textAnswerMarkingModel === null)

    // --- Practical types unaffected --------------------------------------------------------------
    const pptQuestion = (await readAssessmentQuestions(PPT))[0]
    const pptSubmission = randomUUID()
    await query(
      `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
       values ($1, $2, $3, '{}'::json, 1, 'submitted', 'marking', now())`,
      [pptSubmission, PPT, PUPIL],
    )
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, status, provenance)
       values ($1, $2, 'text', 'An answer.', 'answered', 'ai')`,
      [pptSubmission, pptQuestion.questionId],
    )
    const { rows: [{ job_id: pptJob }] } = await query<{ job_id: string }>(
      `insert into external_jobs (job_type, status, payload)
       values ('ai_mark', 'processing', jsonb_build_object('submissionId', $1::text, 'assignmentId', 'self__study', 'questionId', $2::text))
       returning job_id`,
      [pptSubmission, pptQuestion.questionId],
    )
    const pptCaptured: ModelRequest[] = []
    try {
      await runPowerPointMarkJob({ jobId: pptJob, submissionId: pptSubmission, assignmentId: 'self__study', questionId: pptQuestion.questionId }, captureModel(pptCaptured))
    } catch {}
    // Its evidence (a presentation report) sends no pictures, so its own
    // text-question route (migration 150) applies when active, never the paper's.
    const pptTextRoute = await findOwnModelRoute(POWERPOINT_TEXT_QUESTION_SURFACE)
    check('a practical text-only question takes its type\'s text-question route, else its activity route', pptCaptured[0]?.model === (pptTextRoute ?? pptRoute).model,
      JSON.stringify(pptCaptured.map((c) => c.model)))

    // --- Route row inactive, deleted, or naming a bad model -----------------------------------------
    try {
      await changeTextRoute('update ai_model_routes set active = false where activity_type = $1 and sc_type is null')
      check('findOwnModelRoute: an inactive row is none', (await findOwnModelRoute(ASSESSMENT_TEXT_ANSWER_SURFACE)) === null)
      const inactive = await markWith('T')
      check('text route row inactive: the paper route, not DEFAULT_ROUTE', inactive.model === paperRoute.model && inactive.source === 'activity',
        JSON.stringify({ model: inactive.model, source: inactive.source }))
      check('and no warn (nothing was ignored)', !inactive.logs.some((l) => l.level === 'warn'))
      check('the editor setup then shows no text-answer model', (await readAssessmentPaperSetup(PAPER)).textAnswerMarkingModel === null)

      await changeTextRoute('delete from ai_model_routes where activity_type = $1 and sc_type is null')
      check('findOwnModelRoute: a missing row is none', (await findOwnModelRoute(ASSESSMENT_TEXT_ANSWER_SURFACE)) === null)
      const deleted = await markWith('T')
      check('text route row deleted: the paper route, not DEFAULT_ROUTE', deleted.model === paperRoute.model && deleted.source === 'activity',
        JSON.stringify({ model: deleted.model, source: deleted.source }))
      const mcpDeleted = (await getAssessmentActivity(PAPER)).questions as Array<{ label: string; text_answer_marking_model?: string }>
      check('MCP then reports the paper route for text answers', mcpDeleted.find((x) => x.label === 'T')?.text_answer_marking_model === paperRoute.model)

      await restoreTextRoute()
      await changeTextRoute("update ai_model_routes set model = 'retired-model-x' where activity_type = $1 and sc_type is null")
      const unknown = await markWith('T')
      check('text route naming an unknown model: the paper route', unknown.model === paperRoute.model && unknown.source === 'activity',
        JSON.stringify({ model: unknown.model, source: unknown.source }))
      const warn = unknown.logs.find((l) => l.level === 'warn')
      check('with a warn naming the route model and the reason', Boolean(warn) && warn!.metadata.textRouteModel === 'retired-model-x'
        && /not a text model in the catalogue/.test(String(warn!.metadata.reason)), JSON.stringify(unknown.logs))
      check('the warn names no pupil', !JSON.stringify(unknown.logs).includes('Test Pupil') && !JSON.stringify(unknown.logs).includes(PUPIL))

      await changeTextRoute("update ai_model_routes set provider = 'google', model = 'gemini-3.1-flash-image' where activity_type = $1 and sc_type is null")
      const image = await markWith('T')
      check('text route naming an image model: the paper route with a warn',
        image.model === paperRoute.model && image.logs.some((l) => l.level === 'warn' && l.metadata.textRouteModel === 'gemini-3.1-flash-image'),
        JSON.stringify({ model: image.model, logs: image.logs }))
      const sketch = await markWith('S')
      check('a sketch answer does not warn about the text route', !sketch.logs.some((l) => l.level === 'warn'))
    } finally {
      await restoreTextRoute()
    }
    const after = await readTextRouteRow()
    check('the text route row is restored exactly', JSON.stringify(after) === JSON.stringify(original), JSON.stringify({ after, original }))
    const back = await markWith('T')
    check('and text answers use it again', back.model === textModel)
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
