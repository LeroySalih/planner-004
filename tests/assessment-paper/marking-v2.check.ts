import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET, readMarkablePages, storePaperFile, storeScript } from '@/lib/assessment-paper/files'
import {
  confirmAssessmentQuestionMarks,
  listQuestionsAwaitingCheck,
  setAssessmentQuestions,
  setTeacherAnswerTranscription,
  setTeacherQuestionCriterionMark,
  type AssessmentQuestionInput,
} from '@/lib/assessment-paper/store'
import { validateReadReply, type ModelJsonCall } from '@/lib/assessment-paper/reading'
import { validateMarkReply } from '@/lib/assessment-paper/marking'
import { runAssessmentMarkJob, runAssessmentReadJob } from '@/lib/assessment-paper/jobs'
import { readAssessmentPaperResult } from '@/lib/assessment-paper/results'
import { enqueueMarkingTasks } from '@/lib/ai/marking-queue'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { pagesToPdf, syntheticFrontSheet, syntheticQuestionPage } from './synthetic-front-sheet'

// Marking v2 (read, then mark per question) against a dev database and
// ./files, with every model call stubbed: no request leaves the machine.
// Creates its own unit, intervention lesson, pupil and assessment-paper
// activity, and removes them and every file it stored at the end.
// Run as the files owner (1001:999), with DATABASE_URL set, where poppler and
// sharp are installed: npx tsx tests/assessment-paper/marking-v2.check.ts

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
const UNIT = `v2-check-unit-${tag}`
const LESSON = `v2-check-lesson-${tag}`
const PUPIL = `v2-check-pupil-${tag}`
const ACTIVITY = randomUUID()

// Every request any stub saw, to check page 1 never reached a "model".
type CapturedRequest = Parameters<ModelJsonCall>[0]
const captured: CapturedRequest[] = []
function stub(reply: unknown): ModelJsonCall {
  return async (request) => {
    captured.push(request)
    return { data: reply, raw: JSON.stringify(reply), durationMs: 1, attempts: 1 }
  }
}
function imageCount(request: CapturedRequest) {
  return request.parts.filter((part) => part.inline_data).length
}
function labelsOf(request: CapturedRequest) {
  return request.parts.flatMap((part) => (part.text && /PAGE \d+:$/.test(part.text) ? [part.text] : []))
}

async function openJobs(submissionId: string) {
  const { rows } = await query<{ job_id: string; job_type: string; status: string; question_id: string | null }>(
    `select job_id, job_type, status, payload->>'questionId' as question_id from external_jobs
      where payload->>'submissionId' = $1 and status in ('pending', 'processing') order by created_at`,
    [submissionId],
  )
  return rows
}
/** Take a job as the worker would, before anything else can. */
async function claim(jobId: string) {
  await query("update external_jobs set status = 'processing', updated_at = now() where job_id = $1", [jobId])
}
/** Park every pending job of the submission so no running worker picks one up. */
async function park(submissionId: string) {
  await query(
    "update external_jobs set process_after = now() + interval '1 day' where payload->>'submissionId' = $1 and status = 'pending'",
    [submissionId],
  )
}
async function submission(submissionId: string) {
  const { rows } = await query<{ mark_status: string | null; mark_error: string | null; marks: number | null }>(
    "select mark_status, mark_error, (body::jsonb->>'marks')::int as marks from submissions where submission_id = $1",
    [submissionId],
  )
  return rows[0]
}
async function criterionRows(submissionId: string, questionId: string) {
  const { rows } = await query<{
    success_criteria_id: string
    awarded: number
    provenance: string
    why_not_awarded: string | null
  }>(
    `select success_criteria_id, awarded, provenance, why_not_awarded from submission_question_criterion_marks
      where submission_id = $1 and question_id = $2 order by success_criteria_id`,
    [submissionId, questionId],
  )
  return rows
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Marking', 'Check')", [PUPIL])
  await query("insert into units (unit_id, title, subject) values ($1, 'Marking v2 check', $2)", [UNIT, subject])
  await query("insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Marking v2 check', 0, 'intervention')", [LESSON, UNIT])
  await query("insert into intervention_assignments (lesson_id, pupil_id, reason) values ($1, $2, 'marking v2 check')", [LESSON, PUPIL])
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'assessment-paper', 'Marking v2 check', '{}'::jsonb, 0)",
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
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = $1)", [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

function validatorChecks() {
  const labels = ['1', '2']
  const pages = [2, 3]
  const ok = {
    answers: [
      { label: '1', kind: 'text', transcription: 'Strong', pages: [2], status: 'answered' },
      { label: '2', kind: 'sketch', transcription: 'A cube', pages: [3, 2, 3], status: 'continued' },
    ],
  }
  const read = validateReadReply(ok, labels, pages)
  check('read: a good reply passes, in paper order, pages sorted and unique', read[1].pages.join(',') === '2,3' && read[0].label === '1')
  const blank = validateReadReply(
    { answers: [{ ...ok.answers[0], status: 'blank', transcription: 'stray', pages: [2] }, ok.answers[1]] },
    labels,
    pages,
  )
  check('read: a blank answer keeps no text or pages', blank[0].transcription === '' && blank[0].pages.length === 0)
  throwsWith('read: no answers list', () => validateReadReply({}, labels, pages), /no answers list/)
  throwsWith('read: a missing label', () => validateReadReply({ answers: [ok.answers[0]] }, labels, pages), /leaves out question 2/)
  throwsWith('read: a repeated label', () => validateReadReply({ answers: [ok.answers[0], ok.answers[0], ok.answers[1]] }, labels, pages), /more than once/)
  throwsWith('read: an unknown label', () => validateReadReply({ answers: [...ok.answers, { ...ok.answers[0], label: '9' }] }, labels, pages), /not on the paper/)
  throwsWith('read: page 1 is out of range', () => validateReadReply({ answers: [{ ...ok.answers[0], pages: [1] }, ok.answers[1]] }, labels, pages), /names page 1/)
  throwsWith('read: a page past the end is out of range', () => validateReadReply({ answers: [{ ...ok.answers[0], pages: [4] }, ok.answers[1]] }, labels, pages), /names page 4/)
  throwsWith('read: a fractional page', () => validateReadReply({ answers: [{ ...ok.answers[0], pages: [2.5] }, ok.answers[1]] }, labels, pages), /names page 2.5/)
  throwsWith('read: an unknown kind', () => validateReadReply({ answers: [{ ...ok.answers[0], kind: 'photo' }, ok.answers[1]] }, labels, pages), /kind/)
  throwsWith('read: an unknown status', () => validateReadReply({ answers: [{ ...ok.answers[0], status: 'maybe' }, ok.answers[1]] }, labels, pages), /status/)

  const criteria = [{ successCriteriaId: 'a', allocation: 2 }, { successCriteriaId: 'b', allocation: 1 }]
  const row = (id: string, awarded: unknown) => ({ success_criteria_id: id, awarded, why_not_awarded: '', how_to_improve: '' })
  const mark = validateMarkReply({ criteria: [row('b', 0), row('a', 2)] }, criteria)
  check('mark: a good reply passes, in criterion order', mark.map((r) => `${r.successCriteriaId}${r.awarded}`).join() === 'a2,b0')
  throwsWith('mark: no criteria list', () => validateMarkReply({}, criteria), /no criteria list/)
  throwsWith('mark: a missing criterion', () => validateMarkReply({ criteria: [row('a', 1)] }, criteria), /leaves out criterion b/)
  throwsWith('mark: a repeated criterion', () => validateMarkReply({ criteria: [row('a', 1), row('a', 1), row('b', 1)] }, criteria), /more than once/)
  throwsWith('mark: an unknown criterion', () => validateMarkReply({ criteria: [row('a', 1), row('b', 1), row('c', 0)] }, criteria), /does not test/)
  throwsWith('mark: above the allocation', () => validateMarkReply({ criteria: [row('a', 3), row('b', 1)] }, criteria), /from 0 to 2/)
  throwsWith('mark: below 0', () => validateMarkReply({ criteria: [row('a', -1), row('b', 1)] }, criteria), /from 0 to 2/)
  throwsWith('mark: not a whole number', () => validateMarkReply({ criteria: [row('a', 1.5), row('b', 1)] }, criteria), /from 0 to 2/)
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

  await setUp()
  try {
    const blankFront = await syntheticFrontSheet(false, false)
    const paper = await pagesToPdf([blankFront, await syntheticQuestionPage(2, false, false), await syntheticQuestionPage(3, false, false)])
    await storePaperFile(ACTIVITY, 'question_paper', paper)

    const questions: AssessmentQuestionInput[] = [
      { label: '1', maxMarks: 2, markScheme: 'Strong (1). Light (1).', criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }] },
      { label: '2', maxMarks: 2, markScheme: null, criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      { label: '3', maxMarks: 1, markScheme: 'Any.', marking: 'teacher', criteria: [{ successCriteriaId: B, maxMarks: 1 }] },
      { label: '4', maxMarks: 1, markScheme: 'Any.', criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
      { label: '5', maxMarks: 2, markScheme: 'Uses answer to 1 (2).', marking: 'ai_check', dependsOn: '1', criteria: [{ successCriteriaId: B, maxMarks: 2 }] },
      { label: '6', maxMarks: 1, markScheme: 'Cylinder on top (1).', criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
    ]

    // --- Marking setting and depends-on ------------------------------------
    await rejects('depends on a later question is refused', () => setAssessmentQuestions(ACTIVITY, [
      { ...questions[0], dependsOn: '2' }, questions[1],
    ]), /not an earlier question/)
    await rejects('depends on itself is refused', () => setAssessmentQuestions(ACTIVITY, [{ ...questions[0], dependsOn: '1' }]), /cannot depend on itself/)
    await rejects('depends on an unknown question is refused', () => setAssessmentQuestions(ACTIVITY, [{ ...questions[0], dependsOn: 'X' }]), /not an earlier question/)
    await rejects('an unknown marking setting is refused', () => setAssessmentQuestions(ACTIVITY, [{ ...questions[0], marking: 'robot' as never }]), /unknown marking/)
    const saved = await setAssessmentQuestions(ACTIVITY, questions)
    const id = Object.fromEntries(saved.map((q) => [q.label, q.questionId]))
    check('marking and depends-on are saved', saved[2].marking === 'teacher' && saved[4].marking === 'ai_check' && saved[4].dependsOnQuestionId === id['1'] && saved[0].marking === 'ai')
    const resaved = await setAssessmentQuestions(ACTIVITY, questions.map(({ marking: _m, dependsOn: _d, ...rest }) => rest))
    check('a save without them (MCP) keeps them', resaved[2].marking === 'teacher' && resaved[4].dependsOnQuestionId === id['1'])

    // --- Upload queues the read ----------------------------------------------
    const page2 = await syntheticQuestionPage(2, true, true)
    const page3 = await syntheticQuestionPage(3, true, true)
    const stored = await storeScript({ activityId: ACTIVITY, pupilId: PUPIL, bytes: await pagesToPdf([await syntheticFrontSheet(true, true), page2, page3]) })
    const sub = stored.submission_id
    let jobs = await openJobs(sub)
    if (jobs[0]) await claim(jobs[0].job_id)
    check('a passed script queues one ai_read job', stored.marking === 'queued' && jobs.length === 1 && jobs[0].job_type === 'ai_read', JSON.stringify({ stored, jobs }))
    check('the submission waits', (await submission(sub)).mark_status === 'waiting')
    const readJob = { jobId: jobs[0].job_id, submissionId: sub, assignmentId: `self__${LESSON}` }
    const markable = await readMarkablePages(stored.script_id)
    const markableBytes = new Set(markable.map((p) => p.bytes.toString('base64')))

    // --- Read ------------------------------------------------------------------
    await rejects('an invalid read reply throws (the job retries)', () => runAssessmentReadJob(readJob, stub({ answers: [] })), /leaves out question/)
    check('an invalid read stores nothing', (await query('select 1 from submission_question_answers where submission_id = $1', [sub])).rows.length === 0)

    const readReply = {
      answers: [
        { label: '1', kind: 'text', transcription: 'It is strong\nand light', pages: [2], status: 'answered' },
        { label: '2', kind: 'text', transcription: 'Because', pages: [2], status: 'answered' },
        { label: '3', kind: 'text', transcription: 'Teacher marks me', pages: [3], status: 'answered' },
        { label: '4', kind: 'text', transcription: '', pages: [], status: 'blank' },
        { label: '5', kind: 'text', transcription: '2 x 3 = 6', pages: [3], status: 'answered' },
        { label: '6', kind: 'sketch', transcription: 'A cube with a cylinder on top', pages: [3], status: 'answered' },
      ],
    }
    const before = captured.length
    const read = await runAssessmentReadJob(readJob, stub(readReply))
    await park(sub)
    const readRequest = captured[before]
    check('read request: pages 2 and 3, labelled, nothing else', imageCount(readRequest) === 2 && labelsOf(readRequest).join('|') === 'PAGE 2:|PAGE 3:', labelsOf(readRequest).join('|'))
    check('read request: lists every question', ['1', '2', '3', '4', '5', '6'].every((l) => readRequest.parts[0].text!.includes(`- ${l} (`)))
    check(
      'read outcome: Q1, Q5, Q6 queued; Q4 blank; Q3 teacher-only; Q2 held',
      read.queuedQuestionIds.join() === [id['1'], id['5'], id['6']].join() &&
        read.blankQuestionIds.join() === id['4'] && read.teacherQuestionIds.join() === id['3'] &&
        read.heldQuestionIds.join() === id['2'] && !read.complete,
      JSON.stringify(read),
    )
    const { rows: answerRows } = await query<{ n: number }>("select count(*)::int as n from submission_question_answers where submission_id = $1 and provenance = 'ai'", [sub])
    check('read: an answer per question stored', answerRows[0].n === 6)
    const blankRows = await criterionRows(sub, id['4'])
    check('blank: 0 with "No answer submitted"', blankRows.length === 1 && blankRows[0].awarded === 0 && blankRows[0].why_not_awarded === 'No answer submitted' && blankRows[0].provenance === 'ai', JSON.stringify(blankRows))
    check('teacher-only: left unmarked', (await criterionRows(sub, id['3'])).length === 0)
    check('missing mark scheme: not marked', (await criterionRows(sub, id['2'])).length === 0)
    jobs = await openJobs(sub)
    check('one ai_mark job per queued question, read job closed', jobs.length === 3 && jobs.every((j) => j.job_type === 'ai_mark') && jobs.map((j) => j.question_id).join() === read.queuedQuestionIds.join(), JSON.stringify(jobs))
    check('still waiting after the read', (await submission(sub)).mark_status === 'waiting')
    const jobOf = (questionId: string) => jobs.find((j) => j.question_id === questionId)!.job_id

    // --- Mark ------------------------------------------------------------------
    const reply = (rows: Array<[string, number, string?]>) => ({
      criteria: rows.map(([scId, awarded, why]) => ({ success_criteria_id: scId, awarded, why_not_awarded: why ?? '', how_to_improve: '' })),
    })
    await claim(jobOf(id['1']))
    await rejects('an invalid mark reply throws (the job retries)', () =>
      runAssessmentMarkJob({ ...readJob, jobId: jobOf(id['1']), questionId: id['1'] }, stub(reply([[A, 5]]))), /from 0 to 1|leaves out/)
    check('an invalid mark writes nothing', (await criterionRows(sub, id['1'])).length === 0)

    let at = captured.length
    let outcome = await runAssessmentMarkJob({ ...readJob, jobId: jobOf(id['1']), questionId: id['1'] }, stub(reply([[A, 1], [B, 0, 'Not light enough.']])))
    const q1Request = captured[at]
    check('mark request: only the answer\'s page', imageCount(q1Request) === 1 && labelsOf(q1Request).join() === 'PAGE 2:', labelsOf(q1Request).join())
    check('mark request: mark scheme, criteria, transcription, 0 is valid, one criterion per point',
      /Strong \(1\)\. Light \(1\)\./.test(q1Request.parts[0].text!) && q1Request.parts[0].text!.includes(A) && q1Request.parts[0].text!.includes(B) &&
        q1Request.parts[0].text!.includes('It is strong\nand light') && /0 is a valid/.test(q1Request.parts[0].text!) && /ONE criterion only/.test(q1Request.parts[0].text!))
    check('Q1 marked, submission not yet', !outcome.complete && (await submission(sub)).mark_status !== 'marked')

    await claim(jobOf(id['5']))
    at = captured.length
    outcome = await runAssessmentMarkJob({ ...readJob, jobId: jobOf(id['5']), questionId: id['5'] }, stub(reply([[B, 1, 'Half the method.']])))
    const q5Request = captured[at]
    check('depends-on: the earlier answer and its page are added',
      labelsOf(q5Request).join('|') === 'PAGE 3:|EARLIER ANSWER (question 1), PAGE 2:' && /EARLIER ANSWER \(question 1/.test(q5Request.parts[0].text!) && q5Request.parts[0].text!.includes('It is strong'),
      labelsOf(q5Request).join('|'))
    check('Q5 marked, submission not yet', !outcome.complete && (await submission(sub)).mark_status !== 'marked')

    // A teacher marks Q1/A, then Q1 is marked again: the teacher's row stays.
    await setTeacherQuestionCriterionMark(sub, id['1'], A, 0)
    const { rows: [{ job_id: remarkJob }] } = await query<{ job_id: string }>(
      "insert into external_jobs (job_type, payload, status) values ('ai_mark', jsonb_build_object('submissionId', $1::text, 'assignmentId', $2::text, 'questionId', $3::text), 'processing') returning job_id",
      [sub, readJob.assignmentId, id['1']],
    )
    outcome = await runAssessmentMarkJob({ ...readJob, jobId: remarkJob, questionId: id['1'] }, stub(reply([[A, 1], [B, 1]])))
    let q1 = await criterionRows(sub, id['1'])
    const rowA = q1.find((r) => r.success_criteria_id === A)!
    const rowB = q1.find((r) => r.success_criteria_id === B)!
    check('re-mark: the teacher row survives', rowA.provenance === 'teacher' && rowA.awarded === 0 && rowB.provenance === 'ai' && rowB.awarded === 1, JSON.stringify(q1))
    check('re-mark: not complete while Q6 is open', !outcome.complete)

    await claim(jobOf(id['6']))
    at = captured.length
    outcome = await runAssessmentMarkJob({ ...readJob, jobId: jobOf(id['6']), questionId: id['6'] }, stub(reply([[A, 1]])))
    check('the last mark completes the submission', outcome.complete)
    let state = await submission(sub)
    check('marked, with the held question named', state.mark_status === 'marked' && /question 2 has no mark scheme/.test(state.mark_error ?? ''), JSON.stringify(state))
    // Q1 0+1, Q4 0, Q5 1, Q6 1 = 3
    check('totals recomputed', state.marks === 3 && outcome.totals?.awarded === 3, JSON.stringify(state))
    check('no open jobs left', (await openJobs(sub)).length === 0)

    // --- Check, confirm, override ---------------------------------------------
    let awaiting = await listQuestionsAwaitingCheck(ACTIVITY)
    check('ai_check and sketch questions await a check', awaiting.map((r) => r.questionId).sort().join() === [id['5'], id['6']].sort().join(), JSON.stringify(awaiting))
    await confirmAssessmentQuestionMarks(sub, id['6'])
    const q6 = await criterionRows(sub, id['6'])
    check('confirm stamps teacher without changing the mark', q6.length === 1 && q6[0].provenance === 'teacher' && q6[0].awarded === 1)
    awaiting = await listQuestionsAwaitingCheck(ACTIVITY)
    check('a confirmed question no longer awaits a check', awaiting.length === 1 && awaiting[0].questionId === id['5'])
    await rejects('confirm refuses a question with no marks', () => confirmAssessmentQuestionMarks(sub, id['3']), /no marks to confirm/)

    await setTeacherQuestionCriterionMark(sub, id['5'], B, 1)
    let q5 = await criterionRows(sub, id['5'])
    check('an unchanged teacher mark keeps the AI comment', q5[0].provenance === 'teacher' && q5[0].why_not_awarded === 'Half the method.')
    await setTeacherQuestionCriterionMark(sub, id['5'], B, 2)
    q5 = await criterionRows(sub, id['5'])
    check('a changed teacher mark drops the AI comment', q5[0].awarded === 2 && q5[0].why_not_awarded === null)
    await setTeacherQuestionCriterionMark(sub, id['3'], B, 1)
    state = await submission(sub)
    check('overrides recompute the total at once', state.marks === 5, JSON.stringify(state))

    const result = await readAssessmentPaperResult(ACTIVITY, PUPIL)
    const r6 = result.questions.find((q) => q.questionId === id['6'])!
    check('results: answers, marking and check counts', result.awaitingCheckCount === 0 && result.paperAwaitingCheck.questions === 0 &&
      r6.answer?.kind === 'sketch' && result.questions[4].dependsOnLabel === '1' && result.questions[2].marking === 'teacher' && !result.questions[1].hasMarkScheme,
      JSON.stringify({ c: result.awaitingCheckCount, p: result.paperAwaitingCheck }))

    // --- Re-read: teacher answer and rows survive ------------------------------
    await setTeacherAnswerTranscription(sub, id['1'], 'It is strong and light (teacher)')
    await enqueueMarkingTasks(readJob.assignmentId, [{ submissionId: sub }])
    jobs = await openJobs(sub)
    await claim(jobs[0].job_id)
    check('a resend queues a fresh read', jobs.length === 1 && jobs[0].job_type === 'ai_read' && (await submission(sub)).mark_status === 'waiting')
    const reread = await runAssessmentReadJob({ ...readJob, jobId: jobs[0].job_id }, stub({
      answers: readReply.answers.map((a) => (a.label === '1' ? { ...a, transcription: 'misread' } : a)),
    }))
    await park(sub)
    const { rows: [q1Answer] } = await query<{ transcription: string; provenance: string }>(
      'select transcription, provenance from submission_question_answers where submission_id = $1 and question_id = $2',
      [sub, id['1']],
    )
    check('re-read: the teacher\'s transcription survives', q1Answer.provenance === 'teacher' && q1Answer.transcription === 'It is strong and light (teacher)')
    check('re-read: fully teacher-marked questions are not re-sent', reread.queuedQuestionIds.join() === id['1'], JSON.stringify(reread.queuedQuestionIds))
    jobs = await openJobs(sub)
    await claim(jobs[0].job_id)
    at = captured.length
    outcome = await runAssessmentMarkJob({ ...readJob, jobId: jobs[0].job_id, questionId: id['1'] }, stub(reply([[A, 1], [B, 0]])))
    check('re-mark reads the teacher\'s transcription', captured[at].parts[0].text!.includes('(teacher)'))
    q1 = await criterionRows(sub, id['1'])
    check('re-read + re-mark: teacher rows survive', q1.find((r) => r.success_criteria_id === A)!.provenance === 'teacher' && q1.find((r) => r.success_criteria_id === A)!.awarded === 0)
    check('re-read + re-mark: other teacher marks survive', (await criterionRows(sub, id['6']))[0].provenance === 'teacher' && (await criterionRows(sub, id['5']))[0].awarded === 2)
    check('re-read completes the submission again', outcome.complete && (await submission(sub)).mark_status === 'marked')

    // --- Page 1 never reaches a model ----------------------------------------
    const sentImages = captured.flatMap((request) => request.parts.flatMap((part) => (part.inline_data ? [part.inline_data.data] : [])))
    check(
      `page 1 never appears in any built request (${captured.length} requests, ${sentImages.length} images)`,
      sentImages.length > 0 && sentImages.every((data) => markableBytes.has(data)) &&
        captured.every((request) => request.parts.every((part) => !/PAGE 1:/.test(part.text ?? ''))) &&
        markable.every((page) => page.pageNumber >= 2),
    )

    // --- Folded papers are never read ----------------------------------------
    await query("update activities set body_data = body_data || '{\"foldedFromAssessmentIds\": [\"x\"]}'::jsonb where activity_id = $1", [ACTIVITY])
    await enqueueMarkingTasks(readJob.assignmentId, [{ submissionId: sub }])
    state = await submission(sub)
    check('a folded paper is not sent', (await openJobs(sub)).length === 0 && state.mark_status === null && /folded/.test(state.mark_error ?? ''), JSON.stringify(state))
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    "select (select count(*) from stored_files where scope_path like $1) + (select count(*) from units where unit_id = $2) + (select count(*) from profiles where user_id = $3) + (select count(*) from activities where activity_id = $4) as left",
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
