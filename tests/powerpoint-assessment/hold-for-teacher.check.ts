import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import {
  listHeldQuestionsToSend,
  listQuestionsAwaitingCheck,
  readSubmissionAnswers,
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
} from '@/lib/assessment-paper/store'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import { handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointMarkJob, runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { POWERPOINT_MARK_SYSTEM, holdReason, isNotAHoldReason } from '@/lib/powerpoint-assessment/marking'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The marker's hold_for_teacher reply: a part that needs a value the report
// gives as UNKNOWN is held for the teacher, as a required screenshot DINO
// cannot show is held at the read. The model is stubbed (never a real call).
// A hand-in of the reader-2 fixture with a theme colour the theme lacks is
// read; then H1 and H2 are answered with hold_for_teacher and M1 with marks.
// Checks: the prompt says UNKNOWN and the rule; a held part gets no AI rows,
// its answer is 'unreadable' with the reason, the job closes and records the
// hold; a teacher's row on a held part is untouched; the submission is marked
// (the last job) with the held part named in mark_error; the held part awaits
// the teacher's check and is not offered to "Send held questions".
// A hold that is not a hold: N1 replies hold_for_teacher "None. …" beside
// full criteria and is marked as usual; N2 replies "None of …" with no
// criteria, which stays a hold: a real reason may start with "None".
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/hold-for-teacher.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'pptx', 'reader-2', 'unknown-colour.pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-h-check-unit-${tag}`
const LESSON = `ppt-h-check-lesson-${tag}`
const PPT = randomUUID()
const GROUP = `ppt-h-check-group-${tag}`
const PUPIL = `ppt-h-check-pupil-${tag}`
const SLOTS = [{ key: 'deck', label: 'Presentation', kind: 'pptx', required: true }]
const HOLD = 'The colour of the text box on slide 1 is UNKNOWN in the report.'
const N2_HOLD = 'None of the fill colours on slide 3 could be resolved (UNKNOWN in the report).'

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Test', 'Pupil')", [PUPIL])
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil')", [PUPIL])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Hold check unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Hold check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Presentation task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) values ($1, $2)', [GROUP, PUPIL])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  const { rows } = await query<{ scope_path: string; file_name: string }>(
    'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
    [ASSESSMENT_SCRIPTS_BUCKET, `${PPT}%`],
  )
  const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
  if (paths.length > 0) await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
  await query('delete from stored_files where bucket = $1 and scope_path like $2', [ASSESSMENT_SCRIPTS_BUCKET, `${PPT}%`])
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, PPT), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = $1)", [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = $1', [PUPIL])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

async function submission() {
  const { rows } = await query<{ submission_id: string; mark_status: string | null; mark_error: string | null }>(
    'select submission_id, mark_status, mark_error from submissions where activity_id = $1 and user_id = $2 order by attempt_number desc limit 1',
    [PPT, PUPIL],
  )
  return rows[0]
}

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
  const { rows } = await query<{ success_criteria_id: string; awarded: number; provenance: string; ai_awarded: number | null }>(
    `select success_criteria_id, awarded::int as awarded, provenance, ai_awarded::int as ai_awarded
       from submission_question_criterion_marks where submission_id = $1 and question_id = $2 order by success_criteria_id`,
    [submissionId, questionId],
  )
  return rows
}

async function main() {
  // The reply parser on its own.
  check('holdReason: none when absent', holdReason({ criteria: [] }) === null)
  check('holdReason: none when the reason is empty', holdReason({ hold_for_teacher: { reason: '  ' } }) === null)
  check('holdReason: one line', holdReason({ hold_for_teacher: { reason: 'a\nb  c' } }) === 'a b c')
  for (const reason of [
    'None. Mark scheme and evidence are clear. All values are stated.',
    'none',
    'NONE!',
    'N/A',
    'n/a - nothing unknown',
    'NA',
    'null',
    'No hold needed.',
    'No-hold',
    'Not needed',
    'No issue.',
    'No issues: the report states every value.',
    '...',
    '—',
  ]) {
    check(`isNotAHoldReason: "${reason}"`, isNotAHoldReason(reason))
  }
  for (const reason of [
    HOLD,
    'Name of the font on slide 2 is UNKNOWN.',
    'Nonstandard fill on slide 3 is UNKNOWN in the report.',
    'Nothing in the report gives the anchor of the title on slide 1 (UNKNOWN).',
    'National flag image colour UNKNOWN on slide 4.',
  ]) {
    check(`holdReason: "${reason}" is a hold`, holdReason({ hold_for_teacher: { reason } }) === reason)
  }
  check('the system prompt tells the marker to hold, not 0, on UNKNOWN',
    POWERPOINT_MARK_SYSTEM.includes('UNKNOWN (reader could not resolve), do not give 0') && POWERPOINT_MARK_SYSTEM.includes('hold_for_teacher'))

  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((s) => s.success_criteria_id)

  await setUp()
  try {
    const q = (label: string) => ({
      label,
      maxMarks: 2,
      markScheme: `Mark scheme for ${label}: the text box is filled pale yellow.`,
      evidence: [{ source: 'presentation', slot: 'deck', sections: ['slides:1'] }],
      criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }],
    })
    const saved = await setAssessmentQuestions(PPT, [q('H1'), q('H2'), q('M1'), q('N1'), q('N2')])
    const id = (label: string) => saved.find((s) => s.label === label)!.questionId

    await storePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey: 'deck', bytes: await readFile(FIXTURE), originalName: 'deck.pptx', uploadedBy: PUPIL })
    await handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false })
    const sub = (await submission()).submission_id
    const [read] = await claim(sub, 'ai_read')
    const readOutcome = await runPowerPointReadJob(read)
    check('the read is not held', readOutcome.held === null, String(readOutcome.held))

    // A teacher marks one criterion of H2 before the marker runs.
    await recordQuestionCriterionMarks(sub, [{ questionId: id('H2'), successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: null }], 'teacher')

    const prompts: string[] = []
    const calls = new Map<string, number>()
    const stub: ModelJsonCall = async (request) => {
      const prompt = request.parts[0]?.text ?? ''
      prompts.push(prompt)
      const label = /^PART (\S+) /.exec(prompt)?.[1] ?? '?'
      calls.set(label, (calls.get(label) ?? 0) + 1)
      const criteria = [A, B].map((c) => ({ success_criteria_id: c, awarded: 1, why_not_awarded: '', how_to_improve: '' }))
      const data = label === 'M1'
        ? { evidence_note: 'All points met.', criteria }
        : label === 'N1'
          ? { evidence_note: 'All points met.', criteria, hold_for_teacher: { reason: 'None. Mark scheme and evidence are clear. The fill is stated.' } }
          : label === 'N2'
            ? { evidence_note: 'The fill colours are UNKNOWN.', hold_for_teacher: { reason: N2_HOLD } }
            : { evidence_note: 'The fill colour is UNKNOWN.', criteria, hold_for_teacher: { reason: HOLD } }
      return { data: data as never, raw: JSON.stringify(data), durationMs: 3, attempts: 1 }
    }

    const jobs = await claim(sub, 'ai_mark')
    check('five mark jobs', jobs.length === 5, String(jobs.length))
    // M1 last, so it is the job that completes the submission.
    const ordered = [...jobs].sort((a, b) => (a.questionId === id('M1') ? 1 : 0) - (b.questionId === id('M1') ? 1 : 0))
    for (const job of ordered) await runPowerPointMarkJob(job, stub)
    check('N2 was asked once', calls.get('N2') === 1, String(calls.get('N2')))

    check('the prompt gives the report with UNKNOWN', prompts.some((p) => p.includes('UNKNOWN (reader could not resolve)')))
    check('the prompt tells the marker about hold_for_teacher', prompts.every((p) => p.includes('- hold_for_teacher:')))
    check('and to leave it out when nothing needs the teacher', prompts.every((p) => p.includes('When nothing needs the teacher, leave hold_for_teacher out entirely')))

    const h1 = await marksOf(sub, id('H1'))
    check('H1: no AI marks', h1.length === 0, JSON.stringify(h1))
    const h2 = await marksOf(sub, id('H2'))
    check('H2: the teacher row is untouched and no AI row is added',
      h2.length === 1 && h2[0].provenance === 'teacher' && h2[0].awarded === 1 && h2[0].success_criteria_id === A && h2[0].ai_awarded === null,
      JSON.stringify(h2))
    const m1 = await marksOf(sub, id('M1'))
    check('M1: marked as usual', m1.length === 2 && m1.every((r) => r.provenance === 'ai' && r.awarded === 1), JSON.stringify(m1))
    const n1 = await marksOf(sub, id('N1'))
    check('N1: a "None." hold beside full criteria is marked as usual', n1.length === 2 && n1.every((r) => r.provenance === 'ai' && r.awarded === 1 && r.ai_awarded === 1), JSON.stringify(n1))
    const n2 = await marksOf(sub, id('N2'))
    check('N2: a "None of …" reason with no criteria is held: no AI marks', n2.length === 0, JSON.stringify(n2))

    const answers = await readSubmissionAnswers(sub)
    check('N1: its answer is not held', answers.get(id('N1'))?.status !== 'unreadable', JSON.stringify(answers.get(id('N1'))))
    check('N2: its answer is held with the reason', answers.get(id('N2'))?.status === 'unreadable'
      && (answers.get(id('N2'))?.transcription ?? '').includes('None of the fill colours'), JSON.stringify(answers.get(id('N2'))))
    const a1 = answers.get(id('H1'))
    check('H1: the answer is held (unreadable) with the reason',
      a1?.status === 'unreadable' && a1.kind === 'mixed' && a1.transcription === `the marker could not check it: ${HOLD.replace(/\.$/, '')}; mark it yourself.`,
      JSON.stringify(a1))
    const { rows: [note] } = await query<{ marker_evidence: string | null }>(
      'select marker_evidence from submission_question_answers where submission_id = $1 and question_id = $2',
      [sub, id('H1')],
    )
    check('H1: the marker\'s note is kept for the teacher', note?.marker_evidence === 'The fill colour is UNKNOWN.', String(note?.marker_evidence))

    const { rows: jobRows } = await query<{ status: string; response: any; question_id: string }>(
      "select status, model_response as response, payload->>'questionId' as question_id from external_jobs where job_type = 'ai_mark' and payload->>'submissionId' = $1",
      [sub],
    )
    check('every mark job is closed', jobRows.length === 5 && jobRows.every((j) => j.status === 'done'), JSON.stringify(jobRows.map((j) => j.status)))
    const h1Job = jobRows.find((j) => j.question_id === id('H1'))
    check('the job row records the hold and no marks', h1Job?.response?.holdForTeacher === HOLD && h1Job.response.criteria.length === 0, JSON.stringify(h1Job?.response))
    const n1Job = jobRows.find((j) => j.question_id === id('N1'))
    check('the N1 job row records marks and no hold', n1Job?.response?.holdForTeacher === undefined && n1Job?.response?.criteria?.length === 2, JSON.stringify(n1Job?.response))

    const after = await submission()
    check('the submission is marked, as with a held screenshot', after.mark_status === 'marked', String(after.mark_status))
    check('mark_error names H1 and why', /question H1: the marker could not check it: The colour of the text box/.test(after.mark_error ?? ''), String(after.mark_error))
    check('mark_error does not name H2 (a teacher has marked it)', !/question H2/.test(after.mark_error ?? ''), String(after.mark_error))
    check('mark_error names N2 but not N1', /question N2: the marker could not check it: None of the fill colours/.test(after.mark_error ?? '') && !/question N1/.test(after.mark_error ?? ''), String(after.mark_error))

    const awaiting = (await listQuestionsAwaitingCheck(PPT, sub)).map((r) => r.questionId)
    check('H1 and N2 await the teacher\'s check', awaiting.includes(id('H1')) && awaiting.includes(id('N2')), JSON.stringify(awaiting))
    check('H2 (teacher-marked), M1 and N1 do not', ['H2', 'M1', 'N1'].every((l) => !awaiting.includes(id(l))), JSON.stringify(awaiting))
    const held = await listHeldQuestionsToSend(PPT)
    check('"Send held questions" does not send the held part again', !held.some((h) => h.questionId === id('H1')), JSON.stringify(held))
  } finally {
    await tearDown()
  }
  console.log(failed === 0 ? 'All checks passed' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
