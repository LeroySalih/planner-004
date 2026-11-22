import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { readAssessmentQuestions, setAssessmentQuestions, type AssessmentQuestionInput } from '@/lib/assessment-paper/store'
import { readAssessmentPaperSetup } from '@/lib/assessment-paper/setup'
import {
  ASSESSMENT_TEXT_ANSWER_SURFACE,
  DATABASE_TEXT_QUESTION_SURFACE,
  POWERPOINT_TEXT_QUESTION_SURFACE,
  chooseQuestionModel,
  resolveQuestionModelRoute,
  textAnswerRouteProblem,
  textRouteSurface,
} from '@/lib/assessment-paper/question-model-route'
import { MODEL_SURFACES, findOwnModelRoute, invalidateModelRouteCache, resolveModelRoute } from '@/lib/ai/model-routing'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import type { ModelRequest } from '@/lib/ai/model-client'
import { getAssessmentActivity } from '@/lib/mcp/assessment-activities'
import { runPowerPointMarkJob } from '@/lib/powerpoint-assessment/jobs'

// The text-question route on practical assessments (migration 150): with no
// question model, a question whose evidence sends no pictures
// (questionSendsImages false) is marked on its type's text surface,
// surface:powerpoint-mark-text (seeded Claude Haiku 4.5) or
// surface:database-mark-text (not seeded); a question with slide pictures, a
// PDF or screenshots on the activity route; a question's own model wins.
// Without an active row for the key (inactive or deleted) the activity route,
// with no warn; a row naming an unusable model, the activity route with a
// warn naming no pupil. Papers are unchanged: their text-answer route is not
// touched by the practical keys. The model call is stubbed (it captures the
// request and throws, no real call); the route is read from the job's
// "Marking" log line. Route rows changed here are restored exactly, and the
// in-process route cache is reset after every change. Creates its own unit,
// lesson, activities, pupil, submissions and jobs, and removes them.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/text-question-route.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const HAIKU = 'claude-haiku-4-5'
const OPUS = 'claude-opus-5'
const tag = randomUUID().slice(0, 8)
const UNIT = `text-q-route-unit-${tag}`
const LESSON = `text-q-route-lesson-${tag}`
const PPT = randomUUID()
const DB = randomUUID()
const PAPER = randomUUID()
const PUPIL = `text-q-route-pupil-${tag}`

const PPT_SLOTS = [
  { key: 'deck', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'printout', label: 'Printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: false },
]
const DB_SLOTS = [
  { key: 'database', label: 'Database', kind: 'accdb', required: true },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: false },
]

type RouteRow = {
  route_id: string
  activity_type: string
  sc_type: string | null
  provider: string
  model: string
  effort: string | null
  active: boolean
  updated_at: string
  updated_by: string | null
}

async function readRouteRow(key: string): Promise<RouteRow | null> {
  const { rows } = await query<RouteRow>(
    `select route_id::text, activity_type, sc_type, provider, model, effort, active, updated_at::text, updated_by
       from ai_model_routes where activity_type = $1 and sc_type is null`,
    [key],
  )
  return rows[0] ?? null
}

const originals = new Map<string, RouteRow | null>()

/** Put a surface's row back exactly as it was at the start (none if it had none). */
async function restoreRoute(key: string) {
  if (!originals.has(key)) return
  const original = originals.get(key)!
  await query('delete from ai_model_routes where activity_type = $1 and sc_type is null', [key])
  if (original) {
    await query(
      `insert into ai_model_routes (route_id, activity_type, sc_type, provider, model, effort, active, updated_at, updated_by)
       values ($1::uuid, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)`,
      [original.route_id, original.activity_type, original.sc_type, original.provider, original.model, original.effort,
        original.active, original.updated_at, original.updated_by],
    )
  }
  invalidateModelRouteCache()
}

async function restoreAll() {
  for (const key of originals.keys()) await restoreRoute(key)
}

async function changeRoute(key: string, sql: string, params: unknown[] = []) {
  await query(sql, [key, ...params])
  invalidateModelRouteCache()
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Test', 'Pupil')", [PUPIL])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Text question route unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Text question route check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $4, 'powerpoint-assessment', 'Presentation task', $5::jsonb, 0),
       ($2, $4, 'database-assessment', 'Database task', $6::jsonb, 1),
       ($3, $4, 'assessment-paper', 'A paper', '{}'::jsonb, 2)`,
    [PPT, DB, PAPER, LESSON, JSON.stringify({ uploadSlots: PPT_SLOTS }), JSON.stringify({ uploadSlots: DB_SLOTS })],
  )
}

async function tearDown() {
  const { rows } = await query<{ submission_id: string }>('select submission_id from submissions where user_id = $1', [PUPIL])
  const ids = rows.map((r) => r.submission_id)
  await query("delete from external_jobs where payload->>'submissionId' = any($1::text[])", [ids])
  for (const id of ids) await query('delete from ai_marking_logs where message like $1', [`%${id}%`])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

let attempt = 0

/** Run one mark job for a question on a fresh submission; the model it was sent to and the job's log lines. */
async function markWith(activityId: string, questionId: string) {
  const submissionId = randomUUID()
  attempt += 1
  await query(
    `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
     values ($1, $2, $3, '{}'::json, $4, 'submitted', 'marking', now())`,
    [submissionId, activityId, PUPIL, attempt],
  )
  const { rows: [{ job_id }] } = await query<{ job_id: string }>(
    `insert into external_jobs (job_type, status, payload)
     values ('ai_mark', 'processing', jsonb_build_object('submissionId', $1::text, 'assignmentId', 'self__study', 'questionId', $2::text))
     returning job_id`,
    [submissionId, questionId],
  )
  const captured: ModelRequest[] = []
  const stub: ModelJsonCall = async (request) => {
    captured.push(request)
    throw new Error('stub model: captured')
  }
  let error = ''
  try {
    await runPowerPointMarkJob({ jobId: job_id, submissionId, assignmentId: 'self__study', questionId }, stub)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const { rows: logs } = await query<{ level: string; message: string; metadata: Record<string, unknown> }>(
    'select level, message, metadata from ai_marking_logs where message like $1 order by created_at',
    [`%${submissionId}%`],
  )
  const marking = logs.find((l) => l.message.startsWith('Marking'))
  return {
    model: (marking?.metadata.model as string | undefined) ?? null,
    source: (marking?.metadata.modelSource as string | undefined) ?? null,
    called: captured[0]?.model ?? null,
    logs,
    error,
  }
}

async function main() {
  for (const key of [POWERPOINT_TEXT_QUESTION_SURFACE, DATABASE_TEXT_QUESTION_SURFACE, ASSESSMENT_TEXT_ANSWER_SURFACE]) {
    originals.set(key, await readRouteRow(key))
  }
  const pptOriginal = originals.get(POWERPOINT_TEXT_QUESTION_SURFACE)
  if (!pptOriginal || !pptOriginal.active) {
    console.log('FAIL the surface:powerpoint-mark-text route row is missing or inactive; apply migration 150 first')
    process.exit(1)
  }
  invalidateModelRouteCache()
  const pptRoute = await resolveModelRoute('powerpoint-assessment', null)
  const dbRoute = await resolveModelRoute('database-assessment', null)
  check('the seeded PowerPoint text route is Claude Haiku 4.5 on Anthropic, by migration 150',
    pptOriginal.provider === 'anthropic' && pptOriginal.model === HAIKU && pptOriginal.updated_by === 'migration-150',
    `${pptOriginal.provider}/${pptOriginal.model} ${pptOriginal.updated_by}`)
  check('the database text route is not seeded', originals.get(DATABASE_TEXT_QUESTION_SURFACE) === null
    || originals.get(DATABASE_TEXT_QUESTION_SURFACE)?.updated_by !== 'migration-150')
  check('the activity routes differ from Haiku (the checks below tell them apart)', pptRoute.model !== HAIKU && dbRoute.model !== HAIKU,
    `${pptRoute.model} ${dbRoute.model}`)
  check('both surfaces are listed for the admin screen, as text, with an unset label',
    [POWERPOINT_TEXT_QUESTION_SURFACE, DATABASE_TEXT_QUESTION_SURFACE].every((key) => {
      const surface = MODEL_SURFACES.find((s) => s.key === key)
      return surface?.kind === 'text' && Boolean(surface.description) && Boolean(surface.unsetLabel)
    }))

  // --- Pure ---------------------------------------------------------------------
  const haiku = { provider: 'anthropic' as const, model: HAIKU, effort: null }
  const q0 = { label: '1', markingModel: null, evidence: [{ source: 'presentation', slot: 'deck' }] }
  check('textRouteSurface: one key per question-marked type',
    textRouteSurface('assessment-paper') === ASSESSMENT_TEXT_ANSWER_SURFACE
      && textRouteSurface('powerpoint-assessment') === POWERPOINT_TEXT_QUESTION_SURFACE
      && textRouteSurface('database-assessment') === DATABASE_TEXT_QUESTION_SURFACE
      && textRouteSurface('short-text-question') === null)
  check('pure: a text-only practical question takes the text route as text-questions',
    chooseQuestionModel('powerpoint-assessment', q0, pptRoute, haiku).source === 'text-questions')
  check('pure: a slide_images question keeps the activity route',
    chooseQuestionModel('powerpoint-assessment', { ...q0, evidence: [{ source: 'slide_images', slot: 'deck' }] }, pptRoute, haiku).model === pptRoute.model)
  check('pure: a database text-only question takes the text route',
    chooseQuestionModel('database-assessment', { ...q0, evidence: [{ source: 'database', slot: 'database' }] }, dbRoute, haiku).model === HAIKU)
  check('pure: a question model wins', chooseQuestionModel('powerpoint-assessment', { ...q0, markingModel: OPUS }, pptRoute, haiku).model === OPUS)
  const bad = chooseQuestionModel('powerpoint-assessment', q0, pptRoute, { provider: 'anthropic', model: 'retired-x', effort: null })
  check('pure: an unusable text route is the activity route, reported with its surface',
    bad.model === pptRoute.model && bad.textRouteIgnored?.surface === POWERPOINT_TEXT_QUESTION_SURFACE
      && bad.textRouteIgnored.reason.startsWith(POWERPOINT_TEXT_QUESTION_SURFACE), JSON.stringify(bad))
  check('pure: textAnswerRouteProblem names the paper surface by default',
    textAnswerRouteProblem({ provider: 'anthropic', model: 'retired-x', effort: null })?.startsWith(ASSESSMENT_TEXT_ANSWER_SURFACE) === true)

  await setUp()
  try {
    const { rows: [{ success_criteria_id: A }] } = await query<{ success_criteria_id: string }>(
      'select success_criteria_id from success_criteria order by success_criteria_id limit 1',
    )
    const q = (label: string, evidence: unknown[] | undefined, extra: Partial<AssessmentQuestionInput> = {}): AssessmentQuestionInput => ({
      label,
      maxMarks: 1,
      markScheme: `Mark scheme for ${label}.`,
      ...(evidence === undefined ? {} : { evidence }),
      criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      ...extra,
    })
    await setAssessmentQuestions(PPT, [
      q('T', [{ source: 'presentation', slot: 'deck' }]),
      q('TY', [{ source: 'evidence_section', slot: 'evidence', heading: 'TY', want: 'text' }]),
      q('S', [{ source: 'slide_images', slot: 'deck' }]),
      q('F', [{ source: 'file', slot: 'printout' }]),
      q('SH', [{ source: 'evidence_section', slot: 'evidence', heading: 'SH', want: 'screenshots' }]),
      q('Q', [{ source: 'presentation', slot: 'deck' }], { markingModel: OPUS }),
    ])
    await setAssessmentQuestions(DB, [
      q('D', [{ source: 'database', slot: 'database' }]),
      q('DS', [{ source: 'evidence_section', slot: 'evidence', heading: 'DS', want: 'screenshots' }]),
    ])
    await setAssessmentQuestions(PAPER, [q('P', undefined)])
    const ppt = new Map((await readAssessmentQuestions(PPT)).map((x) => [x.label, x.questionId]))
    const db = new Map((await readAssessmentQuestions(DB)).map((x) => [x.label, x.questionId]))
    const paperQuestion = (await readAssessmentQuestions(PAPER))[0].questionId

    // --- PowerPoint, route as seeded ----------------------------------------------------
    for (const label of ['T', 'TY']) {
      const r = await markWith(PPT, ppt.get(label)!)
      check(`PowerPoint ${label} (text only) is marked by Haiku, logged as text-questions`, r.model === HAIKU && r.source === 'text-questions',
        JSON.stringify({ model: r.model, source: r.source, error: r.error }))
      if (r.called) check(`PowerPoint ${label}: the model call went to Haiku`, r.called === HAIKU, r.called)
    }
    for (const label of ['S', 'F', 'SH']) {
      const r = await markWith(PPT, ppt.get(label)!)
      check(`PowerPoint ${label} (sends pictures) keeps the activity route`, r.model === pptRoute.model && r.source === 'activity',
        JSON.stringify({ model: r.model, source: r.source, error: r.error }))
      check(`PowerPoint ${label}: no warn`, !r.logs.some((l) => l.level === 'warn'))
    }
    const own = await markWith(PPT, ppt.get('Q')!)
    check('a question model (Opus) wins over the text route', own.model === OPUS && own.source === 'question', JSON.stringify(own))

    const mcp = (await getAssessmentActivity(PPT)).questions as Array<Record<string, unknown> & { label: string; effective_marking_model: string }>
    const eff = (label: string) => mcp.find((x) => x.label === label)?.effective_marking_model
    check('get_assessment_activity: effective model per question shows the text route',
      eff('T') === HAIKU && eff('TY') === HAIKU && eff('S') === pptRoute.model && eff('SH') === pptRoute.model && eff('Q') === OPUS,
      JSON.stringify(mcp.map((x) => [x.label, x.effective_marking_model])))
    check('and no text_answer_marking_model on a practical type', !mcp.some((x) => 'text_answer_marking_model' in x))
    const pptSetup = await readAssessmentPaperSetup(PPT)
    check('the editor setup carries the text-question model and the activity route',
      pptSetup.textQuestionMarkingModel?.model === HAIKU && pptSetup.textQuestionMarkingModel.label === 'Claude Haiku 4.5'
        && pptSetup.defaultMarkingModel.model === pptRoute.model && pptSetup.textAnswerMarkingModel === null,
      JSON.stringify({ q: pptSetup.textQuestionMarkingModel, d: pptSetup.defaultMarkingModel }))

    // --- Database: no row, then a row added and removed ----------------------------------------
    try {
      await changeRoute(DATABASE_TEXT_QUESTION_SURFACE, 'delete from ai_model_routes where activity_type = $1 and sc_type is null')
      const none = await markWith(DB, db.get('D')!)
      check('database text-only question, no database route row: the activity route', none.model === dbRoute.model && none.source === 'activity',
        JSON.stringify({ model: none.model, source: none.source, error: none.error }))
      check('and no warn', !none.logs.some((l) => l.level === 'warn'))
      check('the editor setup shows no text-question model for the database', (await readAssessmentPaperSetup(DB)).textQuestionMarkingModel === null)
      const noneMcp = (await getAssessmentActivity(DB)).questions as Array<{ label: string; effective_marking_model: string }>
      check('MCP reports the activity route for it', noneMcp.find((x) => x.label === 'D')?.effective_marking_model === dbRoute.model)

      await changeRoute(DATABASE_TEXT_QUESTION_SURFACE,
        "insert into ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by) values ($1, null, 'anthropic', $2, null, 'text-question-route-check')",
        [HAIKU])
      const added = await markWith(DB, db.get('D')!)
      check('with a database route row: that model', added.model === HAIKU && added.source === 'text-questions',
        JSON.stringify({ model: added.model, source: added.source, error: added.error }))
      const shots = await markWith(DB, db.get('DS')!)
      check('a database screenshots question keeps the activity route', shots.model === dbRoute.model && shots.source === 'activity',
        JSON.stringify({ model: shots.model, source: shots.source }))
      const addedMcp = (await getAssessmentActivity(DB)).questions as Array<{ label: string; effective_marking_model: string }>
      check('MCP reports it per question',
        addedMcp.find((x) => x.label === 'D')?.effective_marking_model === HAIKU && addedMcp.find((x) => x.label === 'DS')?.effective_marking_model === dbRoute.model)
      check('the editor setup carries it', (await readAssessmentPaperSetup(DB)).textQuestionMarkingModel?.model === HAIKU)
    } finally {
      await restoreRoute(DATABASE_TEXT_QUESTION_SURFACE)
    }
    const back = await markWith(DB, db.get('D')!)
    const dbOriginal = originals.get(DATABASE_TEXT_QUESTION_SURFACE)
    const dbExpected = dbOriginal && dbOriginal.active ? dbOriginal.model : dbRoute.model
    check('with the row removed again, as at the start', back.model === dbExpected, JSON.stringify({ model: back.model, dbExpected }))

    // --- PowerPoint row inactive, deleted, or naming a bad model ---------------------------------
    try {
      await changeRoute(POWERPOINT_TEXT_QUESTION_SURFACE, 'update ai_model_routes set active = false where activity_type = $1 and sc_type is null')
      check('findOwnModelRoute: an inactive row is none', (await findOwnModelRoute(POWERPOINT_TEXT_QUESTION_SURFACE)) === null)
      const inactive = await markWith(PPT, ppt.get('T')!)
      check('PowerPoint route row inactive: the activity route, not DEFAULT_ROUTE', inactive.model === pptRoute.model && inactive.source === 'activity',
        JSON.stringify({ model: inactive.model, source: inactive.source }))
      check('and no warn (nothing was ignored)', !inactive.logs.some((l) => l.level === 'warn'))
      check('the editor setup then shows no text-question model', (await readAssessmentPaperSetup(PPT)).textQuestionMarkingModel === null)

      await changeRoute(POWERPOINT_TEXT_QUESTION_SURFACE, 'delete from ai_model_routes where activity_type = $1 and sc_type is null')
      const deleted = await markWith(PPT, ppt.get('T')!)
      check('PowerPoint route row deleted: the activity route', deleted.model === pptRoute.model && deleted.source === 'activity',
        JSON.stringify({ model: deleted.model, source: deleted.source }))
      check('and no warn', !deleted.logs.some((l) => l.level === 'warn'))
      const deletedMcp = (await getAssessmentActivity(PPT)).questions as Array<{ label: string; effective_marking_model: string }>
      check('MCP then reports the activity route for a text-only question', deletedMcp.find((x) => x.label === 'T')?.effective_marking_model === pptRoute.model)

      await restoreRoute(POWERPOINT_TEXT_QUESTION_SURFACE)
      await changeRoute(POWERPOINT_TEXT_QUESTION_SURFACE, "update ai_model_routes set model = 'retired-model-x' where activity_type = $1 and sc_type is null")
      const unknown = await markWith(PPT, ppt.get('T')!)
      check('PowerPoint route naming an unknown model: the activity route', unknown.model === pptRoute.model && unknown.source === 'activity',
        JSON.stringify({ model: unknown.model, source: unknown.source }))
      const warn = unknown.logs.find((l) => l.level === 'warn')
      check('with a warn naming the surface, the route model and the reason',
        Boolean(warn) && /text-question route was not used/.test(warn!.message)
          && warn!.metadata.textRouteSurface === POWERPOINT_TEXT_QUESTION_SURFACE
          && warn!.metadata.textRouteModel === 'retired-model-x'
          && /not a text model in the catalogue/.test(String(warn!.metadata.reason)), JSON.stringify(unknown.logs))
      check('the warn names no pupil', !JSON.stringify(unknown.logs).includes('Test Pupil') && !JSON.stringify(unknown.logs).includes(PUPIL))
      check('the editor setup shows no text-question model for an unusable route', (await readAssessmentPaperSetup(PPT)).textQuestionMarkingModel === null)

      await changeRoute(POWERPOINT_TEXT_QUESTION_SURFACE, "update ai_model_routes set provider = 'google', model = 'gemini-3.1-flash-image' where activity_type = $1 and sc_type is null")
      const image = await markWith(PPT, ppt.get('T')!)
      check('PowerPoint route naming an image model: the activity route with a warn',
        image.model === pptRoute.model && image.logs.some((l) => l.level === 'warn' && l.metadata.textRouteModel === 'gemini-3.1-flash-image'),
        JSON.stringify({ model: image.model, logs: image.logs }))
      const slides = await markWith(PPT, ppt.get('S')!)
      check('a slide_images question does not warn about the text route', !slides.logs.some((l) => l.level === 'warn'))

      // --- Papers unchanged: their text answers use their own route, never the practical key ---
      const paperSubmission = randomUUID()
      attempt += 1
      await query(
        `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
         values ($1, $2, $3, '{}'::json, $4, 'submitted', 'marking', now())`,
        [paperSubmission, PAPER, PUPIL, attempt],
      )
      await query(
        `insert into submission_question_answers (submission_id, question_id, kind, transcription, status, provenance)
         values ($1, $2, 'text', 'An answer.', 'answered', 'ai')`,
        [paperSubmission, paperQuestion],
      )
      const paperTextRoute = await findOwnModelRoute(ASSESSMENT_TEXT_ANSWER_SURFACE)
      const paperRoute = await resolveModelRoute('assessment-paper', null)
      const paperChosen = await resolveQuestionModelRoute('assessment-paper', paperQuestion, paperSubmission)
      check('a paper text answer still takes the paper text-answer route, untouched by a broken PowerPoint route',
        paperChosen.model === (paperTextRoute ?? paperRoute).model && paperChosen.source === (paperTextRoute ? 'text-answers' : 'activity')
          && paperChosen.textRouteIgnored === null,
        JSON.stringify(paperChosen))
      await query("update submission_question_answers set kind = 'sketch' where submission_id = $1", [paperSubmission])
      const paperSketch = await resolveQuestionModelRoute('assessment-paper', paperQuestion, paperSubmission)
      check('a paper sketch answer still takes the paper route', paperSketch.model === paperRoute.model && paperSketch.source === 'activity')
    } finally {
      await restoreRoute(POWERPOINT_TEXT_QUESTION_SURFACE)
    }
    for (const key of originals.keys()) {
      const after = await readRouteRow(key)
      check(`the ${key} row is as at the start`, JSON.stringify(after) === JSON.stringify(originals.get(key)), JSON.stringify({ after, original: originals.get(key) }))
    }
    const again = await markWith(PPT, ppt.get('T')!)
    check('and text-only PowerPoint questions use the seeded route again', again.model === HAIKU && again.source === 'text-questions')
  } finally {
    await restoreAll()
    await tearDown()
  }

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  try {
    await restoreAll()
    await tearDown()
  } catch {}
  process.exit(1)
})
