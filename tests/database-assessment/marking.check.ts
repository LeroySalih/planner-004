import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import type { ModelRequest } from '@/lib/ai/model-client'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import { completeAssessmentQuestionMark, setAssessmentQuestions, setTeacherQuestionCriterionMark } from '@/lib/assessment-paper/store'
import { DATABASE_MARK_SYSTEM } from '@/lib/database-assessment/marking-text'
import { LESSONS_BUCKET, handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointMarkJob, runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { MARK_TEXT, POWERPOINT_MARK_SYSTEM, buildPowerPointMarkPrompt } from '@/lib/powerpoint-assessment/marking'
import { defaultDatabaseAssessmentBody } from '@/lib/practical-assessment/types'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The mark of a database assessment (the ai_mark jobs), with the model call
// stubbed (never a real one): the Palm Grove Vets model answer and its
// EVIDENCE document are handed in and read, then every queued mark job runs
// through runPowerPointMarkJob with a stub that captures the request. Checks:
// the database system prompt; a query question gets that query's design from
// the database report, with the date in words and the sort; a changes question
// gets the changes and the table's records; a named query the database does
// not have is said to be absent; a screenshot question gets its screenshots,
// labelled by heading, and no report; a Section B question gets its typed
// text only; over the picture cap fails permanently, naming the question; no
// pupil file name and no unplaced Name line reach the model or the job rows;
// the marker's note is stored as marker_evidence, ai_awarded is set, and a
// teacher's row is never overwritten. Also: a PowerPoint prompt built with no
// evidenceNames still names "slide number, file or EVIDENCE heading".
// Creates its own unit, lesson, activity, class and pupil, and removes them.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/database-assessment/marking.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const tag = randomUUID().slice(0, 8)
const UNIT = `db-m-check-unit-${tag}`
const LESSON = `db-m-check-lesson-${tag}`
const ACT = randomUUID()
const GROUP = `db-m-check-group-${tag}`
const PUPIL = `db-m-check-pupil-${tag}`
const PUPILS = [PUPIL]

const TEMPLATE_FILE = 'EVIDENCE.docx'
const START_FILE = 'PALM GROVE VETS.accdb'
// Unique upload names, so the privacy checks can look for them.
const DB_NAME = `Pupil-Smith-db-${tag}.accdb`
const DOC_NAME = `Pupil-Smith-evidence-${tag}.docx`
const NOTE = (label: string) => `NOTE-FOR-TEACHER ${label}: decided from the evidence.`

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa')", PUPILS)
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PUPILS])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database mark unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database mark check', 0, 'standard')",
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

async function latestSubmission(pupilId: string) {
  const { rows } = await query<{ submission_id: string; mark_status: string | null; mark_error: string | null; body: any }>(
    `select submission_id, mark_status, mark_error, body::jsonb as body from submissions where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc limit 1`,
    [ACT, pupilId],
  )
  return rows[0]
}

async function claimRead(submissionId: string) {
  const { rows } = await query<{ job_id: string; assignment_id: string }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = 'ai_read' and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id`,
    [submissionId],
  )
  return rows[0] ? { jobId: rows[0].job_id, submissionId, assignmentId: rows[0].assignment_id } : null
}

async function claimMarks(submissionId: string) {
  const { rows } = await query<{ job_id: string; assignment_id: string; question_id: string }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id, payload->>'questionId' as question_id`,
    [submissionId],
  )
  return rows.map((r) => ({ jobId: r.job_id, submissionId, assignmentId: r.assignment_id, questionId: r.question_id }))
}

function hasBase64(value: unknown) {
  const text = JSON.stringify(value ?? null)
  return /base64|data:image|[A-Za-z0-9+/]{400,}/.test(text)
}

type Captured = { request: ModelRequest; label: string }

/** A fake model: captures the request and replies with each criterion's full allocation. */
function fakeModel(captured: Captured[]) {
  const call: ModelJsonCall = async (request) => {
    const prompt = request.parts[0]?.text ?? ''
    const label = /^PART (\S+) /.exec(prompt)?.[1] ?? '?'
    captured.push({ request, label })
    const criteria = [...prompt.matchAll(/success_criteria_id "([^"]+)" \(topic: [^)]*\): holds 0 to (\d+)\./g)].map((m) => ({
      success_criteria_id: m[1],
      awarded: Number(m[2]),
      why_not_awarded: '',
      how_to_improve: '',
    }))
    const data = { evidence_note: NOTE(label), criteria }
    return { data: data as never, raw: JSON.stringify(data), durationMs: 5, attempts: 1 }
  }
  return call
}

const textOf = (request: ModelRequest) => request.parts.filter((part) => part.text !== undefined).map((part) => part.text).join('\n')
/** The evidence part of the prompt (between its heading and the marking instructions). */
const evidenceText = (request: ModelRequest) => {
  const prompt = request.parts[0]?.text ?? ''
  const start = prompt.indexOf('\n', prompt.indexOf("THE PUPIL'S EVIDENCE FOR THIS PART"))
  return prompt.slice(start, prompt.indexOf('First write the evidence_note'))
}
const inline = (request: ModelRequest) => request.parts.filter((part) => part.inline_data)
/** The label text part right before each attachment. */
const labels = (request: ModelRequest) =>
  request.parts.flatMap((part, i) => (part.inline_data ? [request.parts[i - 1]?.text ?? ''] : []))

async function main() {
  // --- Pure: the per-type texts, and PowerPoint's prompt unchanged ------------
  check('MARK_TEXT: PowerPoint keeps its system prompt', MARK_TEXT['powerpoint-assessment'].system === POWERPOINT_MARK_SYSTEM)
  check('MARK_TEXT: database uses DATABASE_MARK_SYSTEM', MARK_TEXT['database-assessment'].system === DATABASE_MARK_SYSTEM)
  const pptPrompt = buildPowerPointMarkPrompt({
    question: { label: 'P1', questionText: 'Q', maxMarks: 1, markScheme: 'MS' },
    criteria: [{ successCriteriaId: 'sc', description: 'd', allocation: 1 }],
    instructions: null,
    blocks: [],
    attachmentLabels: [],
  })
  check('a PowerPoint prompt with no evidenceNames names "slide number, file or EVIDENCE heading"',
    pptPrompt.includes('naming the evidence (slide number, file or EVIDENCE heading).'))
  check('the database system prompt: the mark scheme is the only standard, criteria are labels, anonymity, the note',
    DATABASE_MARK_SYSTEM.includes('The mark scheme is the only standard.')
      && DATABASE_MARK_SYSTEM.includes('These are labels for filing marks, not standards to mark against')
      && DATABASE_MARK_SYSTEM.includes('Never write the pupil\'s name')
      && DATABASE_MARK_SYSTEM.includes('The evidence_note is for the teacher only'))
  check('…report facts are exact, criteria dates are month first, design only from screenshots',
    DATABASE_MARK_SYSTEM.includes('These are exact facts')
      && DATABASE_MARK_SYSTEM.includes('#m/d/yyyy#')
      && DATABASE_MARK_SYSTEM.includes('The report cannot show the design of a form or report')
      && /Judge these only from a screenshot that shows them, never from the report, and never infer them\./.test(DATABASE_MARK_SYSTEM))

  const modelDb = await readFile(path.join(FIXTURES, 'palm-grove-model-answer.accdb'))
  const startDb = await readFile(path.join(FIXTURES, 'palm-grove-start.accdb'))
  const evidenceDoc = await readFile(path.join(FIXTURES, 'palm-grove-evidence-model-answer.docx'))
  const template = await readFile(path.join(FIXTURES, 'palm-grove-evidence-template.docx'))
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((s) => s.success_criteria_id)

  await setUp()
  try {
    const lessons = createLocalStorageClient(LESSONS_BUCKET)
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${TEMPLATE_FILE}`, template, { contentType: 'application/octet-stream' })
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${START_FILE}`, startDb, { contentType: 'application/octet-stream' })

    const q = (label: string, evidence: unknown[], criteria = [{ successCriteriaId: A, maxMarks: 1 }], extra: Record<string, unknown> = {}) => ({
      label,
      maxMarks: criteria.reduce((sum, c) => sum + c.maxMarks, 0),
      markScheme: `Mark scheme for ${label}.`,
      evidence,
      criteria,
      ...extra,
    })
    const db = (sections: string[]) => ({ source: 'database', slot: 'database', sections })
    const shots = (heading: string) => ({ source: 'evidence_section', slot: 'evidence', heading, want: 'screenshots' })
    const typed = (heading: string) => ({ source: 'evidence_section', slot: 'evidence', heading, want: 'text' })
    const saved = await setAssessmentQuestions(ACT, [
      // A query's design (Palm Grove task 7: MICROCHIP REMINDER).
      q('D3', [db(['query:MICROCHIP REMINDER'])]),
      // Records added (task 4): the changes and the OWNERS records; two criteria, one teacher-marked.
      q('CH', [db(['changes', 'records:OWNERS'])], [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }]),
      // A query the database does not have, beside the forms and reports.
      q('DN', [db(['objects', 'query:NOPE'])]),
      // A screenshot heading (a form's design).
      q('6', [shots('6')]),
      // Section B, typed answers.
      q('B1', [typed('B1')]),
      // Every screenshot heading: more pictures than one call takes.
      q('BIG', ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(shots)),
      // The other Section B headings, so each typed section ends at its own; teacher-only.
      q('REST', ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'].map(typed), undefined, { marking: 'teacher' }),
    ])
    const labelOf = (questionId: string) => saved.find((s) => s.questionId === questionId)?.label ?? '?'
    const idOf = (label: string) => saved.find((s) => s.label === label)!.questionId

    const store = (slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: ACT, pupilId: PUPIL, slotKey, bytes, originalName, uploadedBy: PUPIL })
    await store('database', modelDb, DB_NAME)
    await store('evidence', evidenceDoc, DOC_NAME)
    await handInPowerPointAssessment(ACT, PUPIL, { userId: PUPIL, isTeacher: false })

    // --- The read ---------------------------------------------------------------
    const sub = await latestSubmission(PUPIL)
    const read = await claimRead(sub.submission_id)
    if (!read) throw new Error('no read job')
    const readOutcome = await runPowerPointReadJob(read)
    check('the read is not held', readOutcome.held === null, String(readOutcome.held))
    const { rows: [evRow] } = await query<{ report: any }>(
      "select report from practical_submission_evidence where submission_id = $1 and slot_key = 'evidence'",
      [sub.submission_id],
    )
    const unplacedLines = String(evRow?.report?.unplaced?.text ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 6)
    check('the evidence document has an unplaced Name line to keep out', unplacedLines.some((l) => /Name/i.test(l)), JSON.stringify(unplacedLines))
    const b1Text = String(evRow?.report?.sections?.find((s: any) => s.label === 'B1')?.text ?? '').trim()

    // A teacher marks CH's second criterion before the marker runs.
    await setTeacherQuestionCriterionMark(sub.submission_id, idOf('CH'), B, 0, 'Teacher: the new owner has no phone number.')

    const jobs = await claimMarks(sub.submission_id)
    const queuedLabels = jobs.map((j) => labelOf(j.questionId)).sort().join(',')
    check('every AI-marked question is queued', queuedLabels === '6,B1,BIG,CH,D3,DN', queuedLabels)

    // BIG goes over the picture cap: a permanent error naming the question, no call.
    const captured: Captured[] = []
    const big = jobs.find((j) => labelOf(j.questionId) === 'BIG')!
    const bigError = await runPowerPointMarkJob(big, fakeModel(captured)).then(() => null, (error) => error)
    check('over the picture cap is refused permanently, naming the question',
      bigError && (bigError as { permanent?: boolean }).permanent === true && /^Question BIG: .*15 pictures \(at most 10\)/.test(bigError.message),
      String(bigError?.message))
    check('…before any model call', captured.length === 0, String(captured.length))
    await completeAssessmentQuestionMark({ submissionId: sub.submission_id, jobId: big.jobId, rows: [] })

    let last: Awaited<ReturnType<typeof runPowerPointMarkJob>> | null = null
    for (const job of jobs.filter((j) => j !== big)) last = await runPowerPointMarkJob(job, fakeModel(captured))
    const req = (label: string) => captured.find((c) => c.label === label)?.request
    if (process.env.DUMP_PROMPTS) for (const c of captured) console.log(`----- ${c.label}\n${textOf(c.request)}`)
    check('one model call per marked question', captured.map((c) => c.label).sort().join(',') === '6,B1,CH,D3,DN', captured.map((c) => c.label).join(','))
    check('every call has the database system prompt', captured.every((c) => c.request.systemText === DATABASE_MARK_SYSTEM))
    check('…and names database evidence in the comment instructions', captured.every((c) =>
      (c.request.parts[0]?.text ?? '').includes('naming the evidence (EVIDENCE heading, table, query, form or report, or file).')
      && !(c.request.parts[0]?.text ?? '').includes('slide number')))

    const d3 = req('D3')!
    const d3Text = textOf(d3)
    check('query part: the query block, labelled with the slot and slot_key.accdb',
      d3Text.includes('DATABASE REPORT, Database (database.accdb), query:MICROCHIP REMINDER:\nQUERY "MICROCHIP REMINDER" (select query)'), evidenceText(d3).slice(0, 400))
    check('…the fields shown, in order', d3Text.includes('  Fields shown, in order: PETS.[PET ID], '), evidenceText(d3))
    check('…the criteria date in words', d3Text.includes('<#1/1/2020# (1 January 2020)'))
    check('…the sort', d3Text.includes('  Sort: PETS.[DATE OF BIRTH] ascending'))
    check('…no other query, no records, no attachments',
      !/UNPAID TREATMENTS|RECORDS IN|EVIDENCE /.test(evidenceText(d3)) && inline(d3).length === 0, evidenceText(d3))

    const ch = req('CH')!
    const chEvidence = evidenceText(ch)
    check('changes part: the changes and OWNERS\' records, in one block',
      /^DATABASE REPORT, Database \(database\.accdb\), (changes, records:OWNERS|records:OWNERS, changes):$/m.test(chEvidence)
        && /^CHANGES \(compared with the starting database "PALM GROVE VETS\.accdb"\)$/m.test(chEvidence)
        && /^ {2}APPOINTMENTS: 1 record added: /m.test(chEvidence) && /^ {2}OWNERS: 1 record added: /m.test(chEvidence)
        && /^RECORDS IN OWNERS \(/m.test(chEvidence), chEvidence.slice(0, 600))
    check('…and no other table\'s records', !/^RECORDS IN (PETS|APPOINTMENTS)/m.test(chEvidence))

    const dn = req('DN')!
    check('an absent query is said to be absent, with the queries there are',
      evidenceText(dn).includes('There is no saved query called NOPE in this database. Its saved queries are: MICROCHIP REMINDER, UNPAID TREATMENTS.')
        && /^FORMS AND REPORTS$/m.test(evidenceText(dn)), evidenceText(dn))

    const six = req('6')!
    check('screenshot part: its two screenshots, labelled by heading',
      labels(six).join('|') === 'EVIDENCE 6, SCREENSHOT 1:|EVIDENCE 6, SCREENSHOT 2:'
        && inline(six).every((part) => /^image\/(png|jpeg)$/.test(part.inline_data!.mime_type)), labels(six).join('|'))
    check('…no database report, no typed text', !/DATABASE REPORT|TYPED TEXT/.test(evidenceText(six)), evidenceText(six))
    check('…and the system prompt says design is judged from screenshots only',
      (six.systemText ?? '').includes('The report cannot show the design of a form or report'))

    const b1 = req('B1')!
    check('Section B part: the typed text only', Boolean(b1Text) && textOf(b1).includes(`EVIDENCE B1, TYPED TEXT (evidence.docx):\n${b1Text}`)
      && inline(b1).length === 0 && !/DATABASE REPORT|SCREENSHOT/.test(evidenceText(b1)), evidenceText(b1).slice(0, 400))

    // --- Privacy ----------------------------------------------------------------
    const { rows: markRows } = await query<{ model_request: any; model_response: any; payload: any }>(
      `select model_request, model_response, payload from external_jobs
        where job_type = 'ai_mark' and payload->>'submissionId' = $1 and model_request is not null`, [sub.submission_id])
    check('every marked job records its call', markRows.length === 5, String(markRows.length))
    const everything = [...captured.map((c) => textOf(c.request)), ...markRows.map((r) => JSON.stringify(r))]
    check('no pupil file name reaches the model or the job rows',
      everything.every((t) => !t.includes(DB_NAME) && !t.includes(DOC_NAME) && !t.includes('Pupil-Smith')))
    check('no unplaced Name line reaches the model or the job rows',
      everything.every((t) => !/\bName\s*:/.test(t) && unplacedLines.every((l) => !t.includes(l))))
    check('no base64 on the job rows', markRows.every((r) => !hasBase64(r.model_request) && !hasBase64(r.model_response)))
    const d3Row = markRows.find((r) => r.model_request.label === 'D3')?.model_request
    check('the job row stores the database system prompt and the block key',
      d3Row?.system === DATABASE_MARK_SYSTEM && d3Row.textSections?.length === 1
        && d3Row.textSections[0].key === 'database:database:query:MICROCHIP REMINDER', JSON.stringify(d3Row?.textSections))
    const sixRow = markRows.find((r) => r.model_request.label === '6')?.model_request
    check('…and attachments as metadata', sixRow?.attachments?.length === 2
      && sixRow.attachments.every((a: any) => /^EVIDENCE 6, SCREENSHOT \d:$/.test(a.label) && a.bytes > 0), JSON.stringify(sixRow?.attachments))

    // --- What is stored ----------------------------------------------------------
    const { rows: notes } = await query<{ question_id: string; marker_evidence: string | null }>(
      'select question_id, marker_evidence from submission_question_answers where submission_id = $1', [sub.submission_id])
    const noteOf = (label: string) => notes.find((n) => labelOf(n.question_id) === label)?.marker_evidence
    check('the marker\'s note is stored as marker_evidence', ['D3', 'CH', 'DN', '6', 'B1'].every((l) => noteOf(l) === NOTE(l)),
      JSON.stringify(notes.map((n) => [labelOf(n.question_id), n.marker_evidence])))
    check('…and not for the question over the cap', !noteOf('BIG'))
    const { rows: marks } = await query<{ question_id: string; success_criteria_id: string; awarded: number; ai_awarded: number | null; provenance: string; teacher_feedback: string | null }>(
      `select question_id, success_criteria_id, awarded, ai_awarded, provenance, teacher_feedback
         from submission_question_criterion_marks where submission_id = $1`, [sub.submission_id])
    const mark = (label: string, sc: string) => marks.find((m) => labelOf(m.question_id) === label && m.success_criteria_id === sc)
    check('ai_awarded is set on the marker\'s rows', ['D3', 'DN', '6', 'B1'].every((l) => mark(l, A)?.provenance === 'ai' && mark(l, A)?.ai_awarded === 1)
      && mark('CH', A)?.ai_awarded === 1, JSON.stringify(marks.map((m) => [labelOf(m.question_id), m.provenance, m.awarded, m.ai_awarded])))
    const teacherRow = mark('CH', B)
    check('a teacher\'s row is never overwritten', teacherRow?.provenance === 'teacher' && teacherRow.awarded === 0
      && teacherRow.ai_awarded === null && teacherRow.teacher_feedback === 'Teacher: the new owner has no phone number.', JSON.stringify(teacherRow))
    const final = await latestSubmission(PUPIL)
    check('the last job marks the submission', Boolean(last?.complete) && final.mark_status === 'marked', String(final.mark_status))
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
