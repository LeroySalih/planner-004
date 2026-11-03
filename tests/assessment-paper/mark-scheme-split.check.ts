import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET, storePaperFile, storeScript } from '@/lib/assessment-paper/files'
import {
  listHeldQuestionsToSend,
  queueHeldAssessmentQuestions,
  readAssessmentQuestions,
  setAssessmentQuestions,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import {
  ASSESSMENT_MARK_SCHEME_SURFACE,
  proposeMarkSchemeSplit,
  validateMarkSchemeSplitReply,
} from '@/lib/assessment-paper/mark-scheme-split'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import { runAssessmentMarkJob, runAssessmentReadJob } from '@/lib/assessment-paper/jobs'
import { AssessmentActivityQuestionsInput, getAssessmentActivity, getAssessmentActivityResult, toAssessmentQuestionInputs } from '@/lib/mcp/assessment-activities'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { pagesToPdf, syntheticFrontSheet, syntheticQuestionPage } from './synthetic-front-sheet'

// Marking v2 steps 6 and 8: the mark scheme split (validator, request, dry
// run), sending questions held for want of a mark scheme, and the MCP input
// for marking / depends_on, against a dev database and ./files with every
// model call stubbed. Creates its own unit, intervention lesson, pupil and
// assessment-paper activity, and removes them and every file it stored.
// Run as the files owner (1001:999), with DATABASE_URL set, where poppler and
// sharp are installed: npx tsx tests/assessment-paper/mark-scheme-split.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
function throwsWith(name: string, action: () => unknown, pattern: RegExp) {
  try {
    action()
    check(name, false, 'was accepted')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, pattern.test(message), message)
  }
}
async function rejects(name: string, action: () => Promise<unknown>, pattern?: RegExp) {
  try {
    await action()
    check(name, false, 'was accepted')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, !pattern || pattern.test(message), message)
  }
}

const tag = randomUUID().slice(0, 8)
const UNIT = `ms-check-unit-${tag}`
const LESSON = `ms-check-lesson-${tag}`
const PUPIL = `ms-check-pupil-${tag}`
const ACTIVITY = randomUUID()

type CapturedRequest = Parameters<ModelJsonCall>[0]
const captured: CapturedRequest[] = []
function stub(reply: unknown): ModelJsonCall {
  return async (request) => {
    captured.push(request)
    return { data: reply, raw: JSON.stringify(reply), durationMs: 1, attempts: 1 }
  }
}

async function openJobs(submissionId: string) {
  const { rows } = await query<{ job_id: string; job_type: string; question_id: string | null }>(
    `select job_id, job_type, payload->>'questionId' as question_id from external_jobs
      where payload->>'submissionId' = $1 and status in ('pending', 'processing') order by created_at`,
    [submissionId],
  )
  return rows
}
async function claim(jobId: string) {
  await query("update external_jobs set status = 'processing', updated_at = now() where job_id = $1", [jobId])
}
async function submission(submissionId: string) {
  const { rows } = await query<{ mark_status: string | null; mark_error: string | null; marks: number | null }>(
    "select mark_status, mark_error, (body::jsonb->>'marks')::int as marks from submissions where submission_id = $1",
    [submissionId],
  )
  return rows[0]
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Scheme', 'Check')", [PUPIL])
  await query("insert into units (unit_id, title, subject) values ($1, 'Mark scheme check', $2)", [UNIT, subject])
  await query("insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Mark scheme check', 0, 'intervention')", [LESSON, UNIT])
  await query("insert into intervention_assignments (lesson_id, pupil_id, reason) values ($1, $2, 'mark scheme check')", [LESSON, PUPIL])
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'assessment-paper', 'Mark scheme check', '{}'::jsonb, 0)",
    [ACTIVITY, LESSON],
  )
}

async function tearDown() {
  const { rows: files } = await query<{ scope_path: string; file_name: string }>(
    'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
    [ASSESSMENT_SCRIPTS_BUCKET, `${ACTIVITY}%`],
  )
  const paths = files.map((f) => `${f.scope_path}/${f.file_name}`.replace(/^\/+/, ''))
  if (paths.length > 0) await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
  await query('delete from stored_files where bucket = $1 and scope_path like $2', [ASSESSMENT_SCRIPTS_BUCKET, `${ACTIVITY}%`])
  // The folder this check created (a new id, so nothing else is in it).
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, ACTIVITY), { recursive: true, force: true })
  // The split's log line is written fire-and-forget; give it a moment to land.
  await new Promise((resolve) => setTimeout(resolve, 500))
  await query("delete from external_jobs where job_type = 'chat' and payload->>'activityId' = $1", [ACTIVITY])
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = $1)", [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

function validatorChecks() {
  const labels = ['1(a)', '1(b)', '2']
  const row = (label: unknown, text: unknown = 'Strong (1)') => ({ label, mark_scheme: text })
  const ok = validateMarkSchemeSplitReply({ questions: [row('2', ' Any two (2) '), row('1(a)'), row('1(b)', '')] }, labels)
  check('split: a good reply passes, in paper order, trimmed, empty allowed',
    ok.map((r) => r.label).join() === '1(a),1(b),2' && ok[2].markScheme === 'Any two (2)' && ok[1].markScheme === '')
  throwsWith('split: no questions list', () => validateMarkSchemeSplitReply({}, labels), /no questions list/)
  throwsWith('split: a missing label', () => validateMarkSchemeSplitReply({ questions: [row('1(a)'), row('2')] }, labels), /leaves out question 1\(b\)/)
  throwsWith('split: a repeated label', () => validateMarkSchemeSplitReply({ questions: [row('1(a)'), row('1(a)'), row('1(b)'), row('2')] }, labels), /more than once/)
  throwsWith('split: an unknown label', () => validateMarkSchemeSplitReply({ questions: [row('1(a)'), row('1(b)'), row('2'), row('3')] }, labels), /not on the paper/)
  throwsWith('split: text that is not a string', () => validateMarkSchemeSplitReply({ questions: [row('1(a)', 3), row('1(b)'), row('2')] }, labels), /no mark_scheme text/)
}

function mcpInputChecks(A: string, B: string) {
  // The MCP SDK sends parameters as strings: the list, and each nested list.
  const serialised = JSON.stringify([
    { label: '1', max_marks: '2', criteria: JSON.stringify([{ success_criteria_id: A, max_marks: '1' }, { success_criteria_id: B, max_marks: 1 }]) },
    { label: '2', max_marks: 2, marking: 'ai_check', depends_on: '1', criteria: [{ success_criteria_id: A, max_marks: 2 }] },
    { label: '3', max_marks: 1, marking: 'teacher', depends_on: '', criteria: [{ success_criteria_id: B, max_marks: 1 }] },
    { label: '4', max_marks: 1, depends_on: null, criteria: [{ success_criteria_id: B, max_marks: 1 }] },
  ])
  const parsed = toAssessmentQuestionInputs(AssessmentActivityQuestionsInput.parse(serialised))
  check('mcp: string-serialised questions and criteria parse', parsed.length === 4 && parsed[0].criteria.length === 2 && parsed[0].maxMarks === 2 && parsed[0].criteria[0].maxMarks === 1)
  check('mcp: marking and depends_on omitted stay omitted (kept on save)', !('marking' in parsed[0]) && !('dependsOn' in parsed[0]))
  check('mcp: marking and depends_on given are passed', parsed[1].marking === 'ai_check' && parsed[1].dependsOn === '1' && parsed[2].marking === 'teacher')
  check('mcp: depends_on "" or null clears it', parsed[2].dependsOn === null && parsed[3].dependsOn === null)
  throwsWith('mcp: an unknown marking is refused', () => AssessmentActivityQuestionsInput.parse(JSON.stringify([
    { label: '1', max_marks: 1, marking: 'robot', criteria: [{ success_criteria_id: A, max_marks: 1 }] },
  ])), /marking|Invalid/)
  return parsed
}

async function main() {
  validatorChecks()

  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)
  const mcpQuestions = mcpInputChecks(A, B)

  await setUp()
  try {
    // --- MCP input saved -------------------------------------------------------
    const saved = await setAssessmentQuestions(ACTIVITY, mcpQuestions)
    const id = Object.fromEntries(saved.map((q) => [q.label, q.questionId]))
    check('mcp: saved with marking and depends_on', saved[1].marking === 'ai_check' && saved[1].dependsOnQuestionId === id['1'] && saved[2].marking === 'teacher' && saved[0].marking === 'ai')
    await rejects('mcp: depends_on a later question is refused', () => setAssessmentQuestions(ACTIVITY, toAssessmentQuestionInputs(
      AssessmentActivityQuestionsInput.parse(JSON.stringify([
        { label: '1', max_marks: 1, depends_on: '2', criteria: [{ success_criteria_id: A, max_marks: 1 }] },
        { label: '2', max_marks: 1, criteria: [{ success_criteria_id: A, max_marks: 1 }] },
      ])),
    )), /not an earlier question/)
    const overview = await getAssessmentActivity(ACTIVITY)
    const q2 = overview.questions.find((q) => q.label === '2')!
    check('get_assessment_activity: marking, depends_on, has_mark_scheme', q2.marking === 'ai_check' && q2.depends_on === '1' && q2.has_mark_scheme === false)

    // --- Split -------------------------------------------------------------------
    await rejects('split: refused with no mark scheme uploaded', () => proposeMarkSchemeSplit(ACTIVITY, stub({ questions: [] })), /No mark scheme/)
    const blankFront = await syntheticFrontSheet(false, false)
    const paper = await pagesToPdf([blankFront, await syntheticQuestionPage(2, false, false)])
    await storePaperFile(ACTIVITY, 'question_paper', paper)
    const markSchemePdf = await pagesToPdf([await syntheticQuestionPage(2, false, false)])
    await storePaperFile(ACTIVITY, 'mark_scheme', markSchemePdf)

    await rejects('split: an invalid reply throws', () => proposeMarkSchemeSplit(ACTIVITY, stub({ questions: [{ label: '1', mark_scheme: 'x' }] })), /leaves out question/)
    const at = captured.length
    const split = await proposeMarkSchemeSplit(ACTIVITY, stub({
      questions: [
        { label: '1', mark_scheme: 'Strong (1)\nLight (1)' },
        { label: '2', mark_scheme: 'Uses answer to 1 (2)' },
        { label: '3', mark_scheme: 'Any (1)' },
        { label: '4', mark_scheme: '' },
      ],
    }))
    const request = captured[at]
    const documents = request.parts.filter((part) => part.inline_data?.mime_type === 'application/pdf')
    check('split request: the mark scheme PDF as one document, no images',
      documents.length === 1 && documents[0].inline_data!.data === markSchemePdf.toString('base64') &&
        request.parts.filter((part) => part.inline_data).length === 1)
    check('split request: lists every question', ['1', '2', '3', '4'].every((l) => request.parts[0].text!.includes(`- ${l} (`)))
    const { rows: [route] } = await query<{ provider: string; model: string }>(
      "select provider, model from ai_model_routes where activity_type = $1 and sc_type is null", [ASSESSMENT_MARK_SCHEME_SURFACE])
    check('split request: on the mark scheme surface route', request.model === route.model && request.provider === route.provider, JSON.stringify({ m: request.model, route }))
    check('split: proposals beside current text, in paper order',
      split.proposals.map((p) => p.label).join() === '1,2,3,4' && split.proposals[0].proposed === 'Strong (1)\nLight (1)' &&
        split.proposals[0].current === null && split.proposals[3].proposed === null)
    const afterSplit = await readAssessmentQuestions(ACTIVITY)
    check('split: saves nothing', afterSplit.every((q) => q.markScheme === null))

    // --- Held, then sent ---------------------------------------------------------
    // Q1 and Q4 get a mark scheme now; Q2 (ai_check, depends on 1) is held.
    const withSchemes = mcpQuestions.map((q) => (q.label === '1' || q.label === '4' ? { ...q, markScheme: `scheme ${q.label}` } : q))
    await setAssessmentQuestions(ACTIVITY, withSchemes)
    const stored = await storeScript({ activityId: ACTIVITY, pupilId: PUPIL, bytes: await pagesToPdf([await syntheticFrontSheet(true, true), await syntheticQuestionPage(2, true, true)]) })
    const sub = stored.submission_id
    let jobs = await openJobs(sub)
    if (jobs[0]) await claim(jobs[0].job_id)
    check('upload queues the read', stored.marking === 'queued' && jobs.length === 1 && jobs[0].job_type === 'ai_read', JSON.stringify(stored))
    check('nothing to send while the read is open', (await listHeldQuestionsToSend(ACTIVITY)).length === 0)
    const readJob = { jobId: jobs[0].job_id, submissionId: sub, assignmentId: `self__${LESSON}` }
    const read = await runAssessmentReadJob(readJob, stub({
      answers: ['1', '2', '3', '4'].map((label) => ({ label, kind: 'text', transcription: `answer ${label}`, pages: [2], status: 'answered' })),
    }))
    check('read: Q1, Q4 queued; Q2 held; Q3 teacher-only',
      read.queuedQuestionIds.join() === [id['1'], id['4']].join() && read.heldQuestionIds.join() === id['2'] && read.teacherQuestionIds.join() === id['3'],
      JSON.stringify(read))
    jobs = await openJobs(sub)
    for (const job of jobs) await claim(job.job_id)
    const reply = (scId: string, awarded: number) => ({ criteria: [{ success_criteria_id: scId, awarded, why_not_awarded: '', how_to_improve: '' }] })
    const replyQ1 = { criteria: [{ success_criteria_id: A, awarded: 1, why_not_awarded: '', how_to_improve: '' }, { success_criteria_id: B, awarded: 1, why_not_awarded: '', how_to_improve: '' }] }
    await runAssessmentMarkJob({ ...readJob, jobId: jobs.find((j) => j.question_id === id['1'])!.job_id, questionId: id['1'] }, stub(replyQ1))
    let outcome = await runAssessmentMarkJob({ ...readJob, jobId: jobs.find((j) => j.question_id === id['4'])!.job_id, questionId: id['4'] }, stub(reply(B, 1)))
    let state = await submission(sub)
    check('marked, with Q2 named as held', outcome.complete && state.mark_status === 'marked' && /question 2 has no mark scheme/.test(state.mark_error ?? ''), JSON.stringify(state))

    let pupil = (await getAssessmentActivity(ACTIVITY)).pupils.find((p) => p.pupil_id === PUPIL)!
    check('get_assessment_activity: progress while held',
      pupil.progress?.read_done === true && pupil.progress.questions_marked === 2 && pupil.progress.questions_to_mark === 0 &&
        pupil.progress.questions_held === 1 && pupil.progress.questions_awaiting_check === 0,
      JSON.stringify(pupil.progress))
    check('nothing to send while Q2 still has no mark scheme', (await listHeldQuestionsToSend(ACTIVITY)).length === 0)

    // The teacher adds Q2's mark scheme: it can now be sent; teacher-only Q3 never is.
    await setAssessmentQuestions(ACTIVITY, withSchemes.map((q) => (q.label === '2' || q.label === '3' ? { ...q, markScheme: `scheme ${q.label}` } : q)))
    let held = await listHeldQuestionsToSend(ACTIVITY)
    check('Q2 is listed to send, Q3 (teacher-only) is not', held.length === 1 && held[0].questionId === id['2'] && held[0].submissionId === sub, JSON.stringify(held))

    // A teacher row on the held question takes it off the list.
    await setTeacherQuestionCriterionMark(sub, id['2'], A, 1)
    check('a teacher-marked held question is not sent', (await listHeldQuestionsToSend(ACTIVITY)).length === 0)
    await query("delete from submission_question_criterion_marks where submission_id = $1 and question_id = $2", [sub, id['2']])
    await query("delete from submission_question_marks where submission_id = $1 and question_id = $2", [sub, id['2']])

    const queued = await queueHeldAssessmentQuestions({ activityId: ACTIVITY, submissionId: sub, assignmentId: readJob.assignmentId })
    jobs = await openJobs(sub)
    for (const job of jobs) await claim(job.job_id)
    state = await submission(sub)
    check('send held: one ai_mark job for Q2, the submission waits again',
      queued.join() === id['2'] && jobs.length === 1 && jobs[0].job_type === 'ai_mark' && jobs[0].question_id === id['2'] &&
        state.mark_status === 'waiting' && state.mark_error === null,
      JSON.stringify({ queued, jobs, state }))
    check('send held: not listed again while its job is open', (await listHeldQuestionsToSend(ACTIVITY)).length === 0)
    check('send held: a second send queues nothing', (await queueHeldAssessmentQuestions({ activityId: ACTIVITY, submissionId: sub, assignmentId: readJob.assignmentId })).length === 0)
    pupil = (await getAssessmentActivity(ACTIVITY)).pupils.find((p) => p.pupil_id === PUPIL)!
    check('get_assessment_activity: progress while queued', pupil.progress?.questions_to_mark === 1 && pupil.progress.questions_held === 0, JSON.stringify(pupil.progress))

    const at2 = captured.length
    outcome = await runAssessmentMarkJob({ ...readJob, jobId: jobs[0].job_id, questionId: id['2'] }, stub(reply(A, 2)))
    check('send held: the mark request carries the new mark scheme and the earlier answer',
      captured[at2].parts[0].text!.includes('scheme 2') && /EARLIER ANSWER \(question 1/.test(captured[at2].parts[0].text!))
    state = await submission(sub)
    check('send held: marking completes, nothing held', outcome.complete && state.mark_status === 'marked' && state.mark_error === null && state.marks === 5, JSON.stringify(state))

    pupil = (await getAssessmentActivity(ACTIVITY)).pupils.find((p) => p.pupil_id === PUPIL)!
    check('get_assessment_activity: progress once marked',
      pupil.progress?.questions_marked === 3 && pupil.progress.questions_held === 0 && pupil.progress.questions_awaiting_check === 1,
      JSON.stringify(pupil.progress))

    const result = await getAssessmentActivityResult(ACTIVITY, PUPIL)
    const r2 = result.questions.find((q) => q.label === '2')!
    check('get_assessment_activity_result: answer and criterion marks per question',
      r2.answer?.status === 'answered' && r2.answer.kind === 'text' && r2.answer.transcription === 'answer 2' && r2.answer.pages.join() === '2' &&
        r2.marking === 'ai_check' && r2.depends_on === '1' && r2.has_mark_scheme && r2.criteria[0].awarded === 2 && r2.criteria[0].provenance === 'ai',
      JSON.stringify(r2))

    // --- Folded papers are never sent -------------------------------------------
    await query("delete from submission_question_criterion_marks where submission_id = $1 and question_id = $2", [sub, id['2']])
    await query("update activities set body_data = body_data || '{\"foldedFromAssessmentIds\": [\"x\"]}'::jsonb where activity_id = $1", [ACTIVITY])
    check('a folded paper has nothing to send', (await listHeldQuestionsToSend(ACTIVITY)).length === 0 &&
      (await queueHeldAssessmentQuestions({ activityId: ACTIVITY, submissionId: sub, assignmentId: readJob.assignmentId })).length === 0)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1) + (select count(*) from units where unit_id = $2)
          + (select count(*) from profiles where user_id = $3) + (select count(*) from activities where activity_id = $4)
          + (select count(*) from external_jobs where payload->>'activityId' = $4) as left`,
    [`${ACTIVITY}%`, UNIT, PUPIL, ACTIVITY],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
