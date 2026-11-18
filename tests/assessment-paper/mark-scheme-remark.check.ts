import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { setAssessmentActivityQuestions } from '@/lib/mcp/assessment-activities'
import { recordQuestionCriterionMarks, setAssessmentQuestions, setTeacherQuestionCriterionComment } from '@/lib/assessment-paper/store'

// set_assessment_activity_questions' remark option: a changed mark_scheme
// re-marks (by default) only the changed questions on pupils' latest
// submissions whose read is complete, never teacher-only questions, blank
// answers, a question a teacher marked in full, an earlier attempt or a held
// script; the marker's rows go, a teacher's rows (and a teacher's comment on
// a marker's row) stay; a waiting job is not duplicated and a running one is
// replaced. remark false saves only. No model is called (run with
// MARKING_QUEUE_SECRET blank): it asserts on external_jobs rows and deletes
// them. Creates its own unit, lesson, activity and pupils, and removes them.
// Never prints names.
// Run with DATABASE_URL set:
//   npx tsx tests/assessment-paper/mark-scheme-remark.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const tag = randomUUID().slice(0, 8)
const UNIT = `remark-check-unit-${tag}`
const LESSON = `remark-check-lesson-${tag}`
const PAPER = randomUUID()
const P1 = `remark-check-p1-${tag}` // two attempts, AI marks, Q1 criterion A teacher-marked
const P2 = `remark-check-p2-${tag}` // Q1 teacher-marked in full, Q2 a teacher's comment on the marker's row
const P3 = `remark-check-p3-${tag}` // Q1 blank
const P4 = `remark-check-p4-${tag}` // script held at the front sheet check
const PEOPLE = [P1, P2, P3, P4]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) select unnest($1::text[]), 'Re', 'Mark'", [PEOPLE])
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Remark unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Remark check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'assessment-paper', $3, '{}'::jsonb, 0)",
    [PAPER, LESSON, `Remark paper ${tag}`],
  )
}

async function tearDown() {
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
  await query('delete from assessment_scripts where pupil_id = any($1::text[])', [PEOPLE])
  await query('delete from submissions where user_id = any($1::text[])', [PEOPLE])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from user_roles where user_id = any($1::text[])', [PEOPLE])
  await query('delete from profiles where user_id = any($1::text[])', [PEOPLE])
}

async function submit(pupil: string, attempt: number, frontSheet = 'passed') {
  const { rows: [{ submission_id }] } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
     values ($1, $2, $3, now() - make_interval(mins => 10 - $3), '{}'::json, 'marked', 'submitted')
     returning submission_id`,
    [PAPER, pupil, attempt],
  )
  await query(
    `insert into assessment_scripts (activity_id, pupil_id, submission_id, original_path, page_count, page_paths, front_sheet_check)
     values ($1, $2, $3, 'x/original.pdf', 3, $4, $5)`,
    [PAPER, pupil, submission_id, frontSheet === 'passed' ? ['x/page-2.png', 'x/page-3.png'] : [], frontSheet],
  )
  return submission_id
}

async function answer(submissionId: string, questionIds: string[], status = 'answered') {
  await query(
    `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance)
     select $1, q::uuid, 'text', 'an answer', '{2}', $3, 'ai' from unnest($2::text[]) as q`,
    [submissionId, questionIds, status],
  )
}

async function openJobs() {
  const { rows } = await query<{ submission_id: string; question_id: string; status: string; job_id: string }>(
    `select payload->>'submissionId' as submission_id, payload->>'questionId' as question_id, status, job_id::text
       from external_jobs
      where job_type = 'ai_mark' and status in ('pending', 'processing')
        and payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))`,
    [PEOPLE],
  )
  return rows
}

async function rowsOf(submissionId: string, questionId: string) {
  const { rows } = await query<{ success_criteria_id: string; awarded: number; provenance: string; ai_awarded: number | null; teacher_feedback: string | null }>(
    `select success_criteria_id, awarded, provenance, ai_awarded, teacher_feedback
       from submission_question_criterion_marks where submission_id = $1 and question_id = $2`,
    [submissionId, questionId],
  )
  return new Map(rows.map((row) => [row.success_criteria_id, row]))
}

async function markStatus(submissionId: string) {
  const { rows } = await query<{ mark_status: string | null }>('select mark_status from submissions where submission_id = $1', [submissionId])
  return rows[0]?.mark_status ?? null
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 3 limit 1)
      order by sc.success_criteria_id limit 3`,
  )
  const [A, B, C] = scs.map((row) => row.success_criteria_id)

  const mcpQuestions = (q1Scheme: string, q2Scheme: string, q3Scheme: string) => [
    { label: 'Q1', max_marks: 4, mark_scheme: q1Scheme, criteria: [{ success_criteria_id: A, max_marks: 2 }, { success_criteria_id: B, max_marks: 2 }] },
    { label: 'Q2', max_marks: 3, mark_scheme: q2Scheme, criteria: [{ success_criteria_id: C, max_marks: 3 }] },
    { label: 'Q3', max_marks: 2, mark_scheme: q3Scheme, marking: 'teacher' as const, criteria: [{ success_criteria_id: A, max_marks: 2 }] },
  ]

  await setUp()
  try {
    const [q1, q2, q3] = await setAssessmentQuestions(PAPER, [
      { label: 'Q1', maxMarks: 4, markScheme: 'Old Q1.', criteria: [{ successCriteriaId: A, maxMarks: 2 }, { successCriteriaId: B, maxMarks: 2 }] },
      { label: 'Q2', maxMarks: 3, markScheme: 'Old Q2.', criteria: [{ successCriteriaId: C, maxMarks: 3 }] },
      { label: 'Q3', maxMarks: 2, markScheme: 'Old Q3.', marking: 'teacher', criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
    ])
    const all = [q1.questionId, q2.questionId, q3.questionId]

    const p1Old = await submit(P1, 1)
    const p1 = await submit(P1, 2)
    const p2 = await submit(P2, 1)
    const p3 = await submit(P3, 1)
    const p4 = await submit(P4, 1, 'The front sheet does not match')
    for (const s of [p1Old, p1, p2, p4]) await answer(s, all)
    await answer(p3, [q1.questionId], 'blank')
    await answer(p3, [q2.questionId, q3.questionId])

    const aiMarks = (q1A: number, q1B: number, q2C: number) => [
      { questionId: q1.questionId, successCriteriaId: A, awarded: q1A, whyNotAwarded: 'w', howToImprove: 'h' },
      { questionId: q1.questionId, successCriteriaId: B, awarded: q1B, whyNotAwarded: 'w', howToImprove: 'h' },
      { questionId: q2.questionId, successCriteriaId: C, awarded: q2C, whyNotAwarded: 'w', howToImprove: 'h' },
    ]
    for (const s of [p1Old, p1, p2, p4]) await recordQuestionCriterionMarks(s, aiMarks(1, 1, 2), 'ai')
    await recordQuestionCriterionMarks(p3, aiMarks(0, 0, 2), 'ai')
    // P1: criterion A of Q1 overridden by a teacher. P2: Q1 teacher-marked in
    // full; a teacher's comment on the marker's Q2 row.
    await recordQuestionCriterionMarks(p1, [{ questionId: q1.questionId, successCriteriaId: A, awarded: 2 }], 'teacher')
    await recordQuestionCriterionMarks(p2, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 2 },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 2 },
    ], 'teacher')
    await setTeacherQuestionCriterionComment(p2, q2.questionId, C, 'Good, see me')

    // --- remark false --------------------------------------------------------
    const off = await setAssessmentActivityQuestions(PAPER, mcpQuestions('New Q1.', 'Old Q2.', 'Old Q3.'), { remark: false })
    check(
      'remark false: the change is reported and nothing is queued',
      off.remark === false && off.changed_questions.join() === 'Q1' && off.question_marks_queued === 0 && (await openJobs()).length === 0,
      JSON.stringify(off),
    )
    const keptRows = await rowsOf(p1, q1.questionId)
    check(
      'remark false: marks stay and the submission stays marked',
      keptRows.get(B)?.provenance === 'ai' && keptRows.get(B)?.awarded === 1 && (await markStatus(p1)) === 'marked',
      JSON.stringify([...keptRows]),
    )
    const { rows: [saved] } = await query<{ mark_scheme: string }>('select mark_scheme from activity_questions where question_id = $1', [q1.questionId])
    check('remark false: the new mark scheme is saved', saved.mark_scheme === 'New Q1.')

    const same = await setAssessmentActivityQuestions(PAPER, mcpQuestions('New Q1.', 'Old Q2.', 'Old Q3.'), { remark: true })
    check('an unchanged mark scheme re-marks nothing', same.changed_questions.length === 0 && (await openJobs()).length === 0, JSON.stringify(same))

    // --- remark (default true) -----------------------------------------------
    const on = await setAssessmentActivityQuestions(PAPER, mcpQuestions('Newer Q1.', 'Old Q2.', 'New Q3.'), { remark: true })
    let jobs = await openJobs()
    check(
      'remark: only the changed AI-marked question on latest, read, passed, non-blank work not fully teacher-marked is queued',
      jobs.length === 1 && jobs[0].submission_id === p1 && jobs[0].question_id === q1.questionId && jobs[0].status === 'pending',
      JSON.stringify(jobs.map((j) => [j.submission_id === p1 ? 'p1' : j.submission_id, j.question_id === q1.questionId ? 'q1' : j.question_id])),
    )
    check(
      'remark: the result counts queued and teacher-marked',
      on.changed_questions.join() === 'Q1,Q3' && on.question_marks_queued === 1 && on.submissions_queued === 1
        && on.skipped_teacher_marked === 1 && on.already_queued === 0,
      JSON.stringify(on),
    )
    const p1Rows = await rowsOf(p1, q1.questionId)
    check(
      'remark: the marker\'s row goes, the teacher\'s row stays with its ai_awarded',
      !p1Rows.has(B) && p1Rows.get(A)?.provenance === 'teacher' && p1Rows.get(A)?.awarded === 2 && p1Rows.get(A)?.ai_awarded === 1,
      JSON.stringify([...p1Rows]),
    )
    check('remark: the re-marked submission waits for the marker', (await markStatus(p1)) === 'waiting')
    const p1q2 = await rowsOf(p1, q2.questionId)
    check('remark: an unchanged question keeps its marks', p1q2.get(C)?.provenance === 'ai' && p1q2.get(C)?.awarded === 2)
    const oldRows = await rowsOf(p1Old, q1.questionId)
    check('remark: an earlier attempt is untouched', oldRows.get(B)?.provenance === 'ai' && (await markStatus(p1Old)) === 'marked')
    const p2Rows = await rowsOf(p2, q1.questionId)
    check('remark: a question a teacher marked in full is untouched',
      p2Rows.get(A)?.provenance === 'teacher' && p2Rows.get(B)?.provenance === 'teacher' && (await markStatus(p2)) === 'marked')
    const p3Rows = await rowsOf(p3, q1.questionId)
    check('remark: a blank answer keeps its 0', p3Rows.get(A)?.awarded === 0 && p3Rows.get(A)?.provenance === 'ai')
    check('remark: a held script is untouched', (await rowsOf(p4, q1.questionId)).get(B)?.provenance === 'ai' && (await markStatus(p4)) === 'marked')

    // --- no duplicates ---------------------------------------------------------
    const again = await setAssessmentActivityQuestions(PAPER, mcpQuestions('Newest Q1.', 'Old Q2.', 'New Q3.'), { remark: true })
    jobs = await openJobs()
    check(
      'a waiting job is not duplicated',
      jobs.length === 1 && again.already_queued === 1 && again.question_marks_queued === 0,
      JSON.stringify({ jobs: jobs.length, again }),
    )
    const firstJob = jobs[0].job_id
    await query("update external_jobs set status = 'processing' where job_id = $1", [firstJob])
    const running = await setAssessmentActivityQuestions(PAPER, mcpQuestions('Final Q1.', 'Old Q2.', 'New Q3.'), { remark: true })
    jobs = await openJobs()
    check(
      'a job running against the old mark scheme is replaced, not doubled',
      jobs.length === 1 && jobs[0].job_id !== firstJob && jobs[0].status === 'pending' && running.question_marks_queued === 1,
      JSON.stringify({ jobs: jobs.map((j) => j.status), running }),
    )

    // --- a teacher's comment on a marker's row --------------------------------
    const q2Change = await setAssessmentActivityQuestions(PAPER, mcpQuestions('Final Q1.', 'New Q2.', 'New Q3.'), { remark: true })
    const p2q2 = await rowsOf(p2, q2.questionId)
    jobs = await openJobs()
    check(
      'a marker\'s row with a teacher\'s comment is kept for the marker to overwrite, and the question is queued',
      p2q2.get(C)?.teacher_feedback === 'Good, see me'
        && jobs.some((j) => j.submission_id === p2 && j.question_id === q2.questionId)
        && q2Change.question_marks_queued === 3,
      JSON.stringify({ row: p2q2.get(C), q2Change }),
    )
  } finally {
    await tearDown()
  }
  const { rows: [{ left }] } = await query<{ left: string }>(
    "select count(*)::text as left from profiles where user_id like $1", [`remark-check-%-${tag}`],
  )
  check('clean-up removed everything', left === '0')
  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  process.exit(1)
})
