import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { remarkAssessmentActivity } from '@/lib/assessment-paper/remark-activity'
import { recordQuestionCriterionMarks, setAssessmentQuestions, setTeacherQuestionCriterionComment } from '@/lib/assessment-paper/store'
import { RemarkPupilIdsInput } from '@/lib/mcp/assessment-activities'

// remark_assessment_activity: read and mark again pupils' latest submissions
// on a PowerPoint assessment and an assessment paper. Checks: a handed-in
// pupil is cleared and gets one ai_read job (old jobs dropped), the marker's
// rows and the reader's answers go, a teacher's rows (with ai_awarded) and a
// teacher's comment stay; not handed in, already being read, fully
// teacher-marked and (paper) a held script are skipped and untouched; work
// the queue holds is reported; pupil_ids filters and reports pupils with no
// submission; dry_run changes nothing; a paper keeps a teacher-edited
// transcription and loses the reader's; a folded paper, another activity type
// and an unknown activity are refused. No model is called (run with
// MARKING_QUEUE_SECRET blank): it asserts on external_jobs rows and deletes
// them. Creates its own unit, lesson, activities and pupils, and removes them.
// Never prints names.
// Run with DATABASE_URL set:
//   npx tsx tests/assessment-paper/remark-activity.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const tag = randomUUID().slice(0, 8)
const UNIT = `reread-check-unit-${tag}`
const LESSON = `reread-check-lesson-${tag}`
const PPT = randomUUID()
const PAPER = randomUUID()
const FOLDED = randomUUID()
const TEXT = randomUUID()
const PA = `reread-check-pa-${tag}` // handed in, AI marks, a teacher's mark and comment
const PB = `reread-check-pb-${tag}` // not handed in
const PC = `reread-check-pc-${tag}` // handed in, a read already waiting
const PD = `reread-check-pd-${tag}` // handed in, every question teacher-marked
const PE = `reread-check-pe-${tag}` // handed in, its required file gone: held by the queue
const QA = `reread-check-qa-${tag}` // paper: passed script, a teacher-edited answer
const QB = `reread-check-qb-${tag}` // paper: script held at the front sheet check
const PEOPLE = [PA, PB, PC, PD, PE, QA, QB]
const NOBODY = `reread-check-nobody-${tag}`
const SLOTS = [{ key: 'deck', label: 'Presentation', kind: 'pptx', required: true }]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) select unnest($1::text[]), 'Re', 'Read'", [PEOPLE])
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Reread unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Reread check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $5, 'powerpoint-assessment', 'Presentation task', $6::jsonb, 0),
       ($2, $5, 'assessment-paper', 'Paper', '{}'::jsonb, 1),
       ($3, $5, 'assessment-paper', 'Folded paper', '{"foldedFromAssessmentIds": ["old-1"]}'::jsonb, 2),
       ($4, $5, 'text', 'Some text', '{"text": "hi"}'::jsonb, 3)`,
    [PPT, PAPER, FOLDED, TEXT, LESSON, JSON.stringify({ instructions: 'Build it.', uploadSlots: SLOTS })],
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

async function submit(activityId: string, pupil: string, status: string, markStatus: string | null = 'marked') {
  const { rows: [{ submission_id }] } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
     values ($1, $2, 1, now(), '{}'::json, $3, $4)
     returning submission_id`,
    [activityId, pupil, markStatus, status],
  )
  return submission_id
}

async function deckFile(submissionId: string, pupil: string) {
  await query(
    `insert into practical_submission_files (activity_id, pupil_id, submission_id, slot_key, original_name, storage_path, bytes, sha256)
     values ($1, $2, $3, 'deck', 'deck.pptx', 'x/original.pptx', 10, 'abc')`,
    [PPT, pupil, submissionId],
  )
}

async function script(submissionId: string, pupil: string, frontSheet: string) {
  await query(
    `insert into assessment_scripts (activity_id, pupil_id, submission_id, original_path, page_count, page_paths, front_sheet_check)
     values ($1, $2, $3, 'x/original.pdf', 3, $4, $5)`,
    [PAPER, pupil, submissionId, frontSheet === 'passed' ? ['x/page-2.png', 'x/page-3.png'] : [], frontSheet],
  )
}

async function answer(submissionId: string, questionId: string, provenance = 'ai', markerEvidence: string | null = null) {
  await query(
    `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance, marker_evidence)
     values ($1, $2, 'text', $3, '{2}', 'answered', $4, $5)`,
    [submissionId, questionId, `${provenance} answer`, provenance, markerEvidence],
  )
}

async function job(submissionId: string, jobType: 'ai_read' | 'ai_mark', questionId?: string) {
  await query(
    `insert into external_jobs (job_type, payload) values ($1, jsonb_build_object('submissionId', $2::text, 'assignmentId', 'x', 'questionId', $3::text))`,
    [jobType, submissionId, questionId ?? null],
  )
}

async function openJobs(submissionId: string) {
  const { rows } = await query<{ job_type: string; status: string }>(
    `select job_type, status from external_jobs
      where payload->>'submissionId' = $1 and status in ('pending', 'processing') order by job_type`,
    [submissionId],
  )
  return rows.map((row) => `${row.job_type}:${row.status}`).join(',')
}

async function rowsOf(submissionId: string, questionId: string) {
  const { rows } = await query<{ success_criteria_id: string; awarded: number; provenance: string; ai_awarded: number | null; teacher_feedback: string | null }>(
    `select success_criteria_id, awarded::int as awarded, provenance, ai_awarded::int as ai_awarded, teacher_feedback
       from submission_question_criterion_marks where submission_id = $1 and question_id = $2`,
    [submissionId, questionId],
  )
  return new Map(rows.map((row) => [row.success_criteria_id, row]))
}

async function answersOf(submissionId: string) {
  const { rows } = await query<{ question_id: string; provenance: string; transcription: string | null; marker_evidence: string | null }>(
    'select question_id, provenance, transcription, marker_evidence from submission_question_answers where submission_id = $1',
    [submissionId],
  )
  return new Map(rows.map((row) => [row.question_id, row]))
}

async function submissionState(submissionId: string) {
  const { rows } = await query<{ mark_status: string | null; mark_error: string | null }>(
    'select mark_status, mark_error from submissions where submission_id = $1',
    [submissionId],
  )
  return rows[0]
}

async function refusal(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 3 limit 1)
      order by sc.success_criteria_id limit 3`,
  )
  const [A, B, C] = scs.map((row) => row.success_criteria_id)

  check('pupil_ids may be a JSON string', JSON.stringify(RemarkPupilIdsInput.parse('["a","b"]')) === '["a","b"]')

  await setUp()
  try {
    const evidence = [{ source: 'presentation', slot: 'deck' }]
    const [q1, q2] = await setAssessmentQuestions(PPT, [
      { label: '1a', maxMarks: 4, markScheme: 'Q1.', evidence, criteria: [{ successCriteriaId: A, maxMarks: 2 }, { successCriteriaId: B, maxMarks: 2 }] },
      { label: '1b', maxMarks: 3, markScheme: 'Q2.', evidence, criteria: [{ successCriteriaId: C, maxMarks: 3 }] },
    ])
    const [r1, r2] = await setAssessmentQuestions(PAPER, [
      { label: 'Q1', maxMarks: 2, markScheme: 'R1.', criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      { label: 'Q2', maxMarks: 2, markScheme: 'R2.', criteria: [{ successCriteriaId: B, maxMarks: 2 }] },
    ])
    const aiMarks = [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
      { questionId: q2.questionId, successCriteriaId: C, awarded: 2, whyNotAwarded: 'w', howToImprove: 'h' },
    ]

    const pa = await submit(PPT, PA, 'submitted')
    const pb = await submit(PPT, PB, 'inprogress', null)
    const pc = await submit(PPT, PC, 'submitted', 'waiting')
    const pd = await submit(PPT, PD, 'submitted')
    const pe = await submit(PPT, PE, 'submitted')
    for (const [s, p] of [[pa, PA], [pb, PB], [pc, PC], [pd, PD]]) await deckFile(s, p)
    for (const s of [pa, pb, pc, pd, pe]) {
      await answer(s, q1.questionId)
      await answer(s, q2.questionId)
      await recordQuestionCriterionMarks(s, aiMarks, 'ai')
    }
    await recordQuestionCriterionMarks(pa, [{ questionId: q1.questionId, successCriteriaId: A, awarded: 2 }], 'teacher')
    await setTeacherQuestionCriterionComment(pa, q2.questionId, C, 'See me')
    await job(pa, 'ai_mark', q1.questionId)
    await job(pc, 'ai_read')
    await recordQuestionCriterionMarks(pd, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 2 },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 2 },
      { questionId: q2.questionId, successCriteriaId: C, awarded: 3 },
    ], 'teacher')

    // --- dry run -----------------------------------------------------------------
    const dry = await remarkAssessmentActivity({ activityId: PPT, dryRun: true })
    check(
      'dry run: reports who would be queued and why the rest are skipped',
      dry.dry_run && dry.queued === 2 && dry.queued_pupil_ids.join() === [PA, PE].sort().join()
        && dry.skipped.not_handed_in.join() === PB && dry.skipped.already_reading.join() === PC
        && dry.skipped.nothing_to_remark.join() === PD && dry.type === 'powerpoint-assessment',
      JSON.stringify({ queued: dry.queued, skipped: Object.fromEntries(Object.entries(dry.skipped).map(([k, v]) => [k, v.length])) }),
    )
    check(
      'dry run: nothing changes',
      (await openJobs(pa)) === 'ai_mark:pending' && (await rowsOf(pa, q1.questionId)).get(B)?.provenance === 'ai'
        && (await answersOf(pa)).size === 2 && (await submissionState(pa)).mark_status === 'marked',
    )

    // --- pupil_ids ----------------------------------------------------------------
    const one = await remarkAssessmentActivity({ activityId: PPT, pupilIds: [PA, NOBODY, PA] })
    check(
      'pupil_ids: only that pupil is queued; an id with no submission is reported',
      one.queued === 1 && one.queued_pupil_ids.join() === PA && one.skipped.no_submission.join() === NOBODY
        && one.skipped.not_handed_in.length === 0 && one.skipped.already_reading.length === 0 && one.failed.length === 0,
      JSON.stringify({ queued: one.queued, no_submission: one.skipped.no_submission.length }),
    )
    check('the old mark job is dropped and one read is queued', (await openJobs(pa)) === 'ai_read:pending', await openJobs(pa))
    const paQ1 = await rowsOf(pa, q1.questionId)
    check(
      'the marker\'s row goes; the teacher\'s row stays with its ai_awarded',
      !paQ1.has(B) && paQ1.get(A)?.provenance === 'teacher' && paQ1.get(A)?.awarded === 2 && paQ1.get(A)?.ai_awarded === 1,
      JSON.stringify([...paQ1.values()]),
    )
    const paQ2 = await rowsOf(pa, q2.questionId)
    check('a marker\'s row with a teacher\'s comment stays, comment kept', paQ2.get(C)?.teacher_feedback === 'See me')
    check('the reader\'s answers go (practical)', (await answersOf(pa)).size === 0)
    const paState = await submissionState(pa)
    check('the submission waits for the read', paState.mark_status === 'waiting' && paState.mark_error === null, JSON.stringify(paState))
    check('a pupil not asked for is untouched', (await rowsOf(pe, q1.questionId)).get(B)?.provenance === 'ai' && (await openJobs(pe)) === '')

    // --- every pupil ----------------------------------------------------------------
    const all = await remarkAssessmentActivity({ activityId: PPT })
    check(
      'every pupil: a pupil just sent is already being read; held work is reported',
      all.queued === 0 && all.skipped.already_reading.slice().sort().join() === [PA, PC].sort().join()
        && all.held.length === 1 && all.held[0].pupil_id === PE && /no Presentation handed in/.test(all.held[0].reason),
      JSON.stringify({ queued: all.queued, already: all.skipped.already_reading.length, held: all.held.map((h) => h.reason) }),
    )
    check('not handed in: untouched', (await rowsOf(pb, q1.questionId)).get(B)?.provenance === 'ai' && (await answersOf(pb)).size === 2)
    check('already reading: untouched', (await rowsOf(pc, q1.questionId)).get(B)?.provenance === 'ai' && (await openJobs(pc)) === 'ai_read:pending')
    check('fully teacher-marked: untouched', (await rowsOf(pd, q1.questionId)).get(A)?.provenance === 'teacher' && (await answersOf(pd)).size === 2
      && (await openJobs(pd)) === '')
    check('held work: cleared, no job, the reason recorded',
      !(await rowsOf(pe, q1.questionId)).has(B) && (await openJobs(pe)) === '' && /no Presentation/.test((await submissionState(pe)).mark_error ?? ''))

    // --- assessment paper -------------------------------------------------------------
    const qa = await submit(PAPER, QA, 'submitted')
    const qb = await submit(PAPER, QB, 'submitted')
    await script(qa, QA, 'passed')
    await script(qb, QB, 'The front sheet does not match')
    for (const s of [qa, qb]) {
      await answer(s, r1.questionId, s === qa ? 'teacher' : 'ai', 'marker note')
      await answer(s, r2.questionId)
      await recordQuestionCriterionMarks(s, [
        { questionId: r1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
        { questionId: r2.questionId, successCriteriaId: B, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
      ], 'ai')
    }
    const paper = await remarkAssessmentActivity({ activityId: PAPER })
    check(
      'paper: a passed script is queued; a held script is skipped',
      paper.queued_pupil_ids.join() === QA && paper.skipped.no_passed_script.join() === QB && paper.type === 'assessment-paper',
      JSON.stringify({ queued: paper.queued, no_passed_script: paper.skipped.no_passed_script.length }),
    )
    const qaAnswers = await answersOf(qa)
    check(
      'paper: a teacher-edited transcription stays (its marker note goes); the reader\'s answer goes',
      qaAnswers.size === 1 && qaAnswers.get(r1.questionId)?.provenance === 'teacher'
        && qaAnswers.get(r1.questionId)?.transcription === 'teacher answer' && qaAnswers.get(r1.questionId)?.marker_evidence === null,
      JSON.stringify([...qaAnswers.values()].map((a) => [a.provenance, a.marker_evidence])),
    )
    check('paper: the AI rows go and a read is queued',
      (await rowsOf(qa, r1.questionId)).size === 0 && (await rowsOf(qa, r2.questionId)).size === 0 && (await openJobs(qa)) === 'ai_read:pending')
    check('paper: a held script is untouched', (await answersOf(qb)).size === 2 && (await rowsOf(qb, r2.questionId)).size === 1)

    // --- refusals --------------------------------------------------------------------
    const folded = await refusal(() => remarkAssessmentActivity({ activityId: FOLDED }))
    check('a folded paper is refused', /folded in from the old assessments module/.test(folded ?? ''), folded ?? 'not refused')
    const text = await refusal(() => remarkAssessmentActivity({ activityId: TEXT, dryRun: true }))
    check('another activity type is refused', /only an assessment paper, PowerPoint assessment or database assessment/.test(text ?? ''), text ?? 'not refused')
    const missing = await refusal(() => remarkAssessmentActivity({ activityId: randomUUID() }))
    check('an unknown activity is refused', /not found/.test(missing ?? ''), missing ?? 'not refused')
  } finally {
    await tearDown()
  }
  const { rows: [{ left }] } = await query<{ left: string }>(
    "select count(*)::text as left from profiles where user_id like $1", [`reread-check-%-${tag}`],
  )
  check('clean-up removed everything', left === '0')
  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  process.exit(1)
})
