import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { readAssessmentQuestions, setAssessmentQuestions, type AssessmentQuestionInput } from '@/lib/assessment-paper/store'
import { questionSendsImages } from '@/lib/assessment-paper/question-model'
import { runAssessmentMarkJob } from '@/lib/assessment-paper/jobs'
import { readAssessmentPaperSetup } from '@/lib/assessment-paper/setup'
import { findOwnModelRoute, resolveModelRoute } from '@/lib/ai/model-routing'
import { ASSESSMENT_TEXT_ANSWER_SURFACE, POWERPOINT_TEXT_QUESTION_SURFACE } from '@/lib/assessment-paper/question-model-route'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import type { ModelRequest } from '@/lib/ai/model-client'
import { AssessmentActivityQuestionsInput, getAssessmentActivity, toAssessmentQuestionInputs } from '@/lib/mcp/assessment-activities'
import { runPowerPointMarkJob } from '@/lib/powerpoint-assessment/jobs'

// The marking model per question (activity_questions.marking_model,
// migration 148): which questions send pictures (questionSendsImages, per
// source kind and on a paper); a save takes Haiku on a text-only practical
// question and refuses it where the marker is sent pictures (slide_images,
// screenshots, a PDF, a paper), refuses an evidence change that would leave a
// picture question on Haiku, keeps the model when omitted and clears it on
// null, refuses an unknown model, with nothing written on a refusal. At mark
// time the question's model is used (the model call is stubbed and captures
// the model id; no real call), and a stored model that is no longer allowed
// (written directly in SQL) falls back to the activity's route with a warn
// log. MCP's input and get_assessment_activity report it too. Creates its own
// unit, lesson, activities, pupil, submissions and jobs, and removes them.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/assessment-paper/question-model.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refused(run: () => Promise<unknown>, pattern: RegExp): Promise<[boolean, string]> {
  try {
    await run()
    return [false, 'not refused']
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [pattern.test(message), message]
  }
}

const HAIKU = 'claude-haiku-4-5'
const SONNET = 'claude-sonnet-5'
const OPUS = 'claude-opus-5'

const tag = randomUUID().slice(0, 8)
const UNIT = `q-model-check-unit-${tag}`
const LESSON = `q-model-check-lesson-${tag}`
const PPT = randomUUID()
const PAPER = randomUUID()
const PUPIL = `q-model-check-pupil-${tag}`

const SLOTS = [
  { key: 'deck', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'printout', label: 'Printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: false },
]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Test', 'Pupil')", [PUPIL])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Question model unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Question model check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'powerpoint-assessment', 'Presentation task', $4::jsonb, 0),
       ($2, $3, 'assessment-paper', 'A paper', '{}'::jsonb, 1)`,
    [PPT, PAPER, LESSON, JSON.stringify({ uploadSlots: SLOTS })],
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

async function storedModels(activityId: string) {
  const { rows } = await query<{ label: string; marking_model: string | null }>(
    'select label, marking_model from activity_questions where activity_id = $1 order by position',
    [activityId],
  )
  return Object.fromEntries(rows.map((r) => [r.label, r.marking_model]))
}

let attempt = 0

/** A submission with a read answer to every question, and one processing ai_mark job for `questionId`. */
async function submissionWithJob(activityId: string, questionId: string) {
  const submissionId = randomUUID()
  attempt += 1
  await query(
    `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
     values ($1, $2, $3, '{}'::json, $4, 'submitted', 'marking', now())`,
    [submissionId, activityId, PUPIL, attempt],
  )
  await query(
    `insert into submission_question_answers (submission_id, question_id, kind, transcription, status, provenance)
     select $1, question_id, 'text', 'An answer.', 'answered', 'ai' from activity_questions where activity_id = $2`,
    [submissionId, activityId],
  )
  const { rows } = await query<{ job_id: string }>(
    `insert into external_jobs (job_type, status, payload)
     values ('ai_mark', 'processing', jsonb_build_object('submissionId', $1::text, 'assignmentId', 'self__study', 'questionId', $2::text))
     returning job_id`,
    [submissionId, questionId],
  )
  return { jobId: rows[0].job_id, submissionId, assignmentId: 'self__study', questionId }
}

/** A stub model: captures the request and gives each criterion its full allocation. */
function stubModel(captured: ModelRequest[]): ModelJsonCall {
  return async (request) => {
    captured.push(request)
    const prompt = request.parts[0]?.text ?? ''
    const criteria = [...prompt.matchAll(/success_criteria_id "([^"]+)" \(topic: [^)]*\): holds 0 to (\d+)\./g)].map((m) => ({
      success_criteria_id: m[1],
      awarded: Number(m[2]),
      why_not_awarded: '',
      how_to_improve: '',
    }))
    const data = { criteria, evidence_note: 'Checked.' }
    return { data: data as never, raw: JSON.stringify(data), durationMs: 1, attempts: 1 }
  }
}

async function logs(submissionId: string) {
  const { rows } = await query<{ level: string; message: string; metadata: Record<string, unknown> }>(
    'select level, message, metadata from ai_marking_logs where message like $1 order by created_at',
    [`%${submissionId}%`],
  )
  return rows
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    'select success_criteria_id from success_criteria order by success_criteria_id limit 1',
  )
  const A = scs[0].success_criteria_id

  // --- questionSendsImages -------------------------------------------------------
  const ppt = 'powerpoint-assessment'
  check('a paper question always sends pictures', questionSendsImages('assessment-paper', []))
  check('presentation is text only', !questionSendsImages(ppt, [{ source: 'presentation', slot: 'deck' }]))
  check('database is text only', !questionSendsImages('database-assessment', [{ source: 'database', slot: 'db' }]))
  check('reference_file is text only', !questionSendsImages(ppt, [{ source: 'reference_file', fileName: 'BRIEF.docx' }]))
  check('evidence_section want text is text only', !questionSendsImages(ppt, [{ source: 'evidence_section', slot: 'evidence', want: 'text' }]))
  check('evidence_section want screenshots sends pictures', questionSendsImages(ppt, [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots' }]))
  check('evidence_section want both sends pictures', questionSendsImages(ppt, [{ source: 'evidence_section', slot: 'evidence', want: 'both' }]))
  check('evidence_section with no want sends pictures (the marker attaches them)', questionSendsImages(ppt, [{ source: 'evidence_section', slot: 'evidence' }]))
  check('slide_images sends pictures', questionSendsImages(ppt, [{ source: 'slide_images', slot: 'deck' }]))
  check('file (a PDF) sends pictures', questionSendsImages(ppt, [{ source: 'file', slot: 'printout' }]))
  check('one picture source among text ones sends pictures', questionSendsImages(ppt, [
    { source: 'presentation', slot: 'deck' },
    { source: 'slide_images', slot: 'deck', slides: [2] },
  ]))
  check('no evidence on a practical question is text only', !questionSendsImages(ppt, []))

  await setUp()
  try {
    const q = (label: string, evidence: unknown[] | undefined, markingModel?: string | null): AssessmentQuestionInput => ({
      label,
      maxMarks: 1,
      markScheme: `Mark scheme for ${label}.`,
      ...(evidence === undefined ? {} : { evidence }),
      ...(markingModel === undefined ? {} : { markingModel }),
      criteria: [{ successCriteriaId: A, maxMarks: 1 }],
    })
    const TEXT = [{ source: 'presentation', slot: 'deck' }]
    const SLIDES = [{ source: 'slide_images', slot: 'deck' }]
    const SHOTS = [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots' }]
    const PDF = [{ source: 'file', slot: 'printout' }]
    const TYPED = [{ source: 'evidence_section', slot: 'evidence', want: 'text' }]

    // --- Saving --------------------------------------------------------------------
    await setAssessmentQuestions(PPT, [q('1', TEXT, HAIKU), q('2', SLIDES, SONNET), q('3', TYPED, null), q('4', TEXT)])
    let models = await storedModels(PPT)
    check('Haiku is accepted on a text-only practical question', models['1'] === HAIKU, JSON.stringify(models))
    check('Sonnet is accepted on a slide_images question', models['2'] === SONNET)
    check('null and omitted on a new question are the activity default', models['3'] === null && models['4'] === null)
    const read = await readAssessmentQuestions(PPT)
    check('readAssessmentQuestions carries markingModel', read.find((x) => x.label === '1')?.markingModel === HAIKU)

    const base = [q('1', TEXT), q('2', SLIDES), q('3', TYPED), q('4', TEXT)]
    const swap = (label: string, next: AssessmentQuestionInput) => base.map((x) => (x.label === label ? next : x))
    for (const [name, evidence, reason] of [
      ['slide_images', SLIDES, 'uses slide pictures'],
      ['screenshots', SHOTS, 'uses screenshots'],
      ['PDF file', PDF, 'attaches a PDF'],
    ] as const) {
      const [ok, message] = await refused(() => setAssessmentQuestions(PPT, swap('4', q('4', [...evidence], HAIKU))), new RegExp(
        `Question "4" ${reason}, so it must be marked by a high-resolution vision model \\(Claude Sonnet 5 or Claude Opus 5\\)\\.`,
      ))
      check(`Haiku is refused on a ${name} question, naming the question`, ok, message)
    }
    const [evidenceOk, evidenceMessage] = await refused(() => setAssessmentQuestions(PPT, swap('1', q('1', SHOTS))), /Question "1" uses screenshots, so it must be marked by a high-resolution vision model/)
    check('an evidence change that would leave a picture question on Haiku is refused', evidenceOk, evidenceMessage)
    const [unknownOk, unknownMessage] = await refused(() => setAssessmentQuestions(PPT, swap('4', q('4', TEXT, 'gpt-imaginary'))), /Question "4" names an unknown marking model: "gpt-imaginary"/)
    check('an unknown model is refused', unknownOk, unknownMessage)
    const [imageOk, imageMessage] = await refused(() => setAssessmentQuestions(PPT, swap('4', q('4', TEXT, 'gemini-3.1-flash-image'))), /unknown marking model/)
    check('an image-generation model is refused', imageOk, imageMessage)
    const [twoOk, twoMessage] = await refused(
      () => setAssessmentQuestions(PPT, [q('1', SLIDES), q('2', SLIDES, HAIKU), q('3', TYPED), q('4', TEXT)]),
      /Question "1" uses slide pictures.*Question "2" uses slide pictures/,
    )
    check('every refusal is reported at once', twoOk, twoMessage)
    models = await storedModels(PPT)
    const evidenceAfter = (await readAssessmentQuestions(PPT)).find((x) => x.label === '1')?.evidence
    check('nothing is written on a refusal', models['1'] === HAIKU && models['2'] === SONNET && models['4'] === null
      && evidenceAfter?.length === 1 && evidenceAfter[0].source === 'presentation', JSON.stringify({ models, evidenceAfter }))

    await setAssessmentQuestions(PPT, base)
    models = await storedModels(PPT)
    check('omitting marking_model keeps it', models['1'] === HAIKU && models['2'] === SONNET, JSON.stringify(models))
    await setAssessmentQuestions(PPT, swap('1', q('1', SHOTS, SONNET)))
    models = await storedModels(PPT)
    check('evidence and model changed together are accepted', models['1'] === SONNET)
    await setAssessmentQuestions(PPT, swap('1', q('1', TEXT, null)))
    models = await storedModels(PPT)
    check('null clears it', models['1'] === null, JSON.stringify(models))
    await setAssessmentQuestions(PPT, swap('1', q('1', TEXT, HAIKU)))

    await setAssessmentQuestions(PAPER, [q('P1', undefined, OPUS), q('P2', undefined)])
    check('Opus is accepted on a paper question', (await storedModels(PAPER))['P1'] === OPUS)
    const [paperOk, paperMessage] = await refused(
      () => setAssessmentQuestions(PAPER, [q('P1', undefined), q('P2', undefined, HAIKU)]),
      /Question "P2" is marked from the pupil's script pages, so it must be marked by a high-resolution vision model/,
    )
    check('Haiku is refused on a paper question', paperOk, paperMessage)
    const [geminiOk] = await refused(() => setAssessmentQuestions(PAPER, [q('P1', undefined), q('P2', undefined, 'gemini-flash-latest')]), /high-resolution vision model/)
    check('Gemini Flash (standard tier) is refused on a paper question', geminiOk)

    // --- MCP and the editor's setup ---------------------------------------------------
    const mcpInput = AssessmentActivityQuestionsInput.parse(JSON.stringify([
      { label: 'X', max_marks: 1, marking_model: HAIKU, criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      { label: 'Y', max_marks: 1, marking_model: null, criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      { label: 'Z', max_marks: 1, criteria: [{ success_criteria_id: A, max_marks: 1 }] },
    ]))
    const inputs = toAssessmentQuestionInputs(mcpInput)
    check('MCP marking_model maps to markingModel (given, null, omitted)',
      inputs[0].markingModel === HAIKU && inputs[1].markingModel === null && !('markingModel' in inputs[2]))
    const pptRoute = await resolveModelRoute('powerpoint-assessment', null)
    // A text-only question with no model of its own takes the text-question
    // route (migration 150) when it has an active row, else the activity's.
    const pptDefault = (await findOwnModelRoute(POWERPOINT_TEXT_QUESTION_SURFACE)) ?? pptRoute
    const activity = await getAssessmentActivity(PPT)
    const reported = activity.questions as Array<{ label: string; marking_model: string | null; effective_marking_model: string }>
    check('get_assessment_activity reports marking_model and the effective model',
      reported.find((x) => x.label === '1')?.marking_model === HAIKU
        && reported.find((x) => x.label === '1')?.effective_marking_model === HAIKU
        && reported.find((x) => x.label === '4')?.marking_model === null
        && reported.find((x) => x.label === '4')?.effective_marking_model === pptDefault.model
        && reported.find((x) => x.label === '2')?.effective_marking_model === SONNET,
      JSON.stringify(reported.map((x) => [x.label, x.marking_model, x.effective_marking_model])))
    const setup = await readAssessmentPaperSetup(PPT)
    check('the editor setup lists the selectable text models and the default',
      setup.markingModels.some((m) => m.model === HAIKU) && setup.markingModels.every((m) => m.kind === 'text')
        && setup.defaultMarkingModel.model === pptRoute.model
        && setup.questions.find((x) => x.label === '1')?.markingModel === HAIKU)

    // --- Mark time: practical ----------------------------------------------------------
    const byLabel = new Map((await readAssessmentQuestions(PPT)).map((x) => [x.label, x.questionId]))
    let captured: ModelRequest[] = []
    const haikuJob = await submissionWithJob(PPT, byLabel.get('1')!)
    await runPowerPointMarkJob(haikuJob, stubModel(captured))
    check('a practical question is marked by its own model', captured.length === 1 && captured[0].model === HAIKU && captured[0].provider === 'anthropic',
      JSON.stringify(captured.map((c) => [c.provider, c.model])))
    const { rows: [jobRow] } = await query<{ model_request: { model?: string } }>('select model_request from external_jobs where job_id = $1', [haikuJob.jobId])
    check('the job row records the question model', jobRow?.model_request?.model === HAIKU)
    const haikuLogs = await logs(haikuJob.submissionId)
    check('the marking log names the question model', haikuLogs.some((l) => l.message.startsWith('Marking') && l.metadata.model === HAIKU && l.metadata.modelSource === 'question'))

    // A stored model no longer allowed: Haiku written straight onto a slide_images question.
    await query("update activity_questions set marking_model = $2 where question_id = $1", [byLabel.get('2'), HAIKU])
    captured = []
    const staleJob = await submissionWithJob(PPT, byLabel.get('2')!)
    await runPowerPointMarkJob(staleJob, stubModel(captured))
    check('a stored Haiku on a picture question falls back to the activity route', captured.length === 1 && captured[0].model === pptRoute.model,
      JSON.stringify(captured.map((c) => c.model)))
    const staleLogs = await logs(staleJob.submissionId)
    const warn = staleLogs.find((l) => l.level === 'warn')
    check('the fallback is logged as a warning with the reason', Boolean(warn) && warn!.metadata.storedModel === HAIKU
      && /high-resolution vision model/.test(String(warn!.metadata.reason)), JSON.stringify(staleLogs))
    check('the warning names no pupil', !JSON.stringify(staleLogs).includes('Test Pupil') && !JSON.stringify(staleLogs).includes(PUPIL))

    await query("update activity_questions set marking_model = 'retired-model-x' where question_id = $1", [byLabel.get('4')])
    captured = []
    const retiredJob = await submissionWithJob(PPT, byLabel.get('4')!)
    await runPowerPointMarkJob(retiredJob, stubModel(captured))
    check('a stored model that left the catalogue falls back (text-only question: the text-question route, else the activity route)', captured[0]?.model === pptDefault.model)
    check('and is logged', (await logs(retiredJob.submissionId)).some((l) => l.level === 'warn' && l.metadata.storedModel === 'retired-model-x'))
    const [storedOk, storedMessage] = await refused(() => setAssessmentQuestions(PPT, base), /Question "2" uses slide pictures/)
    check('a save keeping a stored Haiku on a picture question is refused', storedOk, storedMessage)
    await query('update activity_questions set marking_model = $2 where question_id = $1', [byLabel.get('2'), SONNET])
    await setAssessmentQuestions(PPT, base)
    check('a save that omits a stale stored model is not blocked by it', (await storedModels(PPT))['4'] === 'retired-model-x')

    // --- Mark time: paper (stops before any page is loaded: no script, permanent error) ---
    const paperRoute = await resolveModelRoute('assessment-paper', null)
    const paperIds = new Map((await readAssessmentQuestions(PAPER)).map((x) => [x.label, x.questionId]))
    let paperCalled = false
    const noCall: ModelJsonCall = async () => {
      paperCalled = true
      throw new Error('no model call expected')
    }
    const opusJob = await submissionWithJob(PAPER, paperIds.get('P1')!)
    await refused(() => runAssessmentMarkJob(opusJob, noCall), /No script/)
    check('runAssessmentMarkJob resolves a paper question to its own model',
      (await logs(opusJob.submissionId)).some((l) => l.message.startsWith('Marking') && l.metadata.model === OPUS && l.metadata.modelSource === 'question'))
    await query('update activity_questions set marking_model = $2 where question_id = $1', [paperIds.get('P2'), HAIKU])
    const paperStale = await submissionWithJob(PAPER, paperIds.get('P2')!)
    await refused(() => runAssessmentMarkJob(paperStale, noCall), /No script/)
    const paperLogs = await logs(paperStale.submissionId)
    // The answer was read as text, so the fallback is the text-answer route
    // (migration 149) when it has an active row, else the paper's route.
    const textRoute = await findOwnModelRoute(ASSESSMENT_TEXT_ANSWER_SURFACE)
    check('runAssessmentMarkJob falls back from a stored Haiku on a paper question',
      paperLogs.some((l) => l.message.startsWith('Marking')
        && l.metadata.model === (textRoute ?? paperRoute).model
        && l.metadata.modelSource === (textRoute ? 'text-answers' : 'activity'))
        && paperLogs.some((l) => l.level === 'warn' && l.metadata.storedModel === HAIKU), JSON.stringify(paperLogs))
    check('no model was called for the paper', !paperCalled)
  } finally {
    await tearDown()
  }

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  try {
    await tearDown()
  } catch {}
  process.exit(1)
})
