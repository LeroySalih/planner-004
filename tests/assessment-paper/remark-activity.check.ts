import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { remarkAssessmentActivity } from '@/lib/assessment-paper/remark-activity'
import {
  completeAssessmentQuestionMark,
  completeAssessmentRead,
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherQuestionCriterionComment,
} from '@/lib/assessment-paper/store'
import { RemarkPupilIdsInput, RemarkQuestionsInput } from '@/lib/mcp/assessment-activities'

// remark_assessment_activity: read and mark again pupils' latest submissions
// on a PowerPoint assessment and an assessment paper. Checks: a handed-in
// pupil is cleared and gets one ai_read job (old jobs dropped), the marker's
// rows and the reader's answers go, a teacher's rows (with ai_awarded) and a
// teacher's comment stay; not handed in, already being read, fully
// teacher-marked and (paper) a held script are skipped and untouched; work
// the queue holds is reported; pupil_ids filters and reports pupils with no
// submission; dry_run changes nothing; a paper keeps a teacher-edited
// transcription and loses the reader's; a folded paper, another activity type
// and an unknown activity are refused. With `questions`: a practical
// assessment clears only the named questions and its read job carries their
// ids, and the read (completeAssessmentRead) then changes only them, the
// submission ending marked when the scoped marks finish; a paper is not read
// again, its named questions are marked again from the stored transcription;
// unknown, teacher-only and no-mark-scheme labels refuse the call; a dry run
// changes nothing; a pupil whose named questions are all teacher-marked is
// skipped. No model is called (run with
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
const PPT2 = randomUUID()
const PAPER2 = randomUUID()
const TEXT = randomUUID()
const PA = `reread-check-pa-${tag}` // handed in, AI marks, a teacher's mark and comment
const PB = `reread-check-pb-${tag}` // not handed in
const PC = `reread-check-pc-${tag}` // handed in, a read already waiting
const PD = `reread-check-pd-${tag}` // handed in, every question teacher-marked
const PE = `reread-check-pe-${tag}` // handed in, its required file gone: held by the queue
const QA = `reread-check-qa-${tag}` // paper: passed script, a teacher-edited answer
const QB = `reread-check-qb-${tag}` // paper: script held at the front sheet check
const SA = `reread-check-sa-${tag}` // practical, scoped re-mark
const SB = `reread-check-sb-${tag}` // practical, the named question teacher-marked
const TA = `reread-check-ta-${tag}` // paper, scoped: one queued, one teacher-marked, one waiting
const TB = `reread-check-tb-${tag}` // paper, scoped: not read yet
const TC = `reread-check-tc-${tag}` // paper, scoped: blank answers
const PEOPLE = [PA, PB, PC, PD, PE, QA, QB, SA, SB, TA, TB, TC]
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
       ($4, $5, 'text', 'Some text', '{"text": "hi"}'::jsonb, 3),
       ($7, $5, 'powerpoint-assessment', 'Presentation task 2', $6::jsonb, 4),
       ($8, $5, 'assessment-paper', 'Paper 2', '{}'::jsonb, 5)`,
    [PPT, PAPER, FOLDED, TEXT, LESSON, JSON.stringify({ instructions: 'Build it.', uploadSlots: SLOTS }), PPT2, PAPER2],
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

async function deckFile(submissionId: string, pupil: string, activityId = PPT) {
  await query(
    `insert into practical_submission_files (activity_id, pupil_id, submission_id, slot_key, original_name, storage_path, bytes, sha256)
     values ($1, $2, $3, 'deck', 'deck.pptx', 'x/original.pptx', 10, 'abc')`,
    [activityId, pupil, submissionId],
  )
}

async function script(submissionId: string, pupil: string, frontSheet: string, activityId = PAPER) {
  await query(
    `insert into assessment_scripts (activity_id, pupil_id, submission_id, original_path, page_count, page_paths, front_sheet_check)
     values ($1, $2, $3, 'x/original.pdf', 3, $4, $5)`,
    [activityId, pupil, submissionId, frontSheet === 'passed' ? ['x/page-2.png', 'x/page-3.png'] : [], frontSheet],
  )
}

async function answer(
  submissionId: string,
  questionId: string,
  provenance = 'ai',
  markerEvidence: string | null = null,
  status = 'answered',
) {
  await query(
    `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance, marker_evidence)
     values ($1, $2, 'text', $3, '{2}', $6, $4, $5)`,
    [submissionId, questionId, `${provenance} answer`, provenance, markerEvidence, status],
  )
}

/** Open jobs of a submission as "type:status:questionLabel" (read: "ai_read:status:*"). */
async function openJobsByLabel(submissionId: string) {
  const { rows } = await query<{ job: string }>(
    `select j.job_type || ':' || j.status || ':' || coalesce(q.label, '*') as job
       from external_jobs j
       left join activity_questions q on q.question_id::text = j.payload->>'questionId'
      where j.payload->>'submissionId' = $1 and j.status in ('pending', 'processing')
      order by 1`,
    [submissionId],
  )
  return rows.map((row) => row.job).join(',')
}

/** Claim one open job of a submission as the worker does (status processing); returns its id. */
async function claim(submissionId: string, jobType: 'ai_read' | 'ai_mark', questionId?: string) {
  const { rows } = await query<{ job_id: string }>(
    `update external_jobs set status = 'processing'
      where job_id = (select job_id from external_jobs
                       where payload->>'submissionId' = $1 and job_type = $2 and status = 'pending'
                         and ($3::text is null or payload->>'questionId' = $3)
                       limit 1)
      returning job_id`,
    [submissionId, jobType, questionId ?? null],
  )
  return rows[0]?.job_id ?? ''
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

    // --- practical, only some questions -------------------------------------------------
    const [s1e, s1j, s2a, s3t, s4n] = await setAssessmentQuestions(PPT2, [
      { label: '1e', maxMarks: 2, markScheme: 'S1.', evidence, criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      { label: '1j', maxMarks: 2, markScheme: 'S2.', evidence, criteria: [{ successCriteriaId: B, maxMarks: 2 }] },
      { label: '2a', maxMarks: 3, markScheme: 'S3.', evidence, criteria: [{ successCriteriaId: C, maxMarks: 3 }] },
      { label: '3t', maxMarks: 1, markScheme: 'S4.', marking: 'teacher', evidence, criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
      { label: '4n', maxMarks: 1, markScheme: '', evidence, criteria: [{ successCriteriaId: B, maxMarks: 1 }] },
    ])
    const sa = await submit(PPT2, SA, 'submitted')
    const sb = await submit(PPT2, SB, 'submitted')
    await deckFile(sa, SA, PPT2)
    await deckFile(sb, SB, PPT2)
    for (const s of [sa, sb]) {
      for (const q of [s1e, s1j, s2a]) await answer(s, q.questionId)
      await recordQuestionCriterionMarks(s, [
        { questionId: s1e.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
        { questionId: s1j.questionId, successCriteriaId: B, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
        { questionId: s2a.questionId, successCriteriaId: C, awarded: 2, whyNotAwarded: 'w', howToImprove: 'h' },
      ], 'ai')
    }
    await setTeacherQuestionCriterionComment(sa, s1j.questionId, B, 'Look again')
    await job(sa, 'ai_mark', s1e.questionId)
    await job(sa, 'ai_mark', s2a.questionId)
    await recordQuestionCriterionMarks(sb, [{ questionId: s1e.questionId, successCriteriaId: A, awarded: 2 }], 'teacher')

    check('questions may be a JSON string', JSON.stringify(RemarkQuestionsInput.parse('["1e"," 1j "]')) === '["1e","1j"]')
    const before = await openJobsByLabel(sa)
    const unknown = await refusal(() => remarkAssessmentActivity({ activityId: PPT2, questions: ['1e', 'zz', '9q'] }))
    check('scoped: an unknown label refuses the call, naming it', /No question "zz", "9q" on this activity/.test(unknown ?? '') && /1e, 1j, 2a/.test(unknown ?? ''), unknown ?? 'not refused')
    const teacherOnly = await refusal(() => remarkAssessmentActivity({ activityId: PPT2, questions: ['1e', '3T'] }))
    check('scoped: a teacher-only question refuses the call', /3t is marked by the teacher only/.test(teacherOnly ?? ''), teacherOnly ?? 'not refused')
    const noScheme = await refusal(() => remarkAssessmentActivity({ activityId: PPT2, questions: ['4n'] }))
    check('scoped: a question with no mark scheme refuses the call', /4n has no mark scheme text/.test(noScheme ?? ''), noScheme ?? 'not refused')
    check('scoped: a refused call changes nothing',
      (await openJobsByLabel(sa)) === before && (await answersOf(sa)).size === 3 && (await rowsOf(sa, s1e.questionId)).get(A)?.provenance === 'ai')

    const scopedDry = await remarkAssessmentActivity({ activityId: PPT2, pupilIds: [SA], questions: ['1E', ' 1j ', '1e'], dryRun: true })
    check('scoped dry run: labels resolved (case, spaces, duplicates) and the pupil reported',
      scopedDry.dry_run && scopedDry.questions?.join() === '1e,1j' && scopedDry.queued_pupil_ids.join() === SA,
      JSON.stringify({ questions: scopedDry.questions, queued: scopedDry.queued }))
    check('scoped dry run: nothing changes',
      (await openJobsByLabel(sa)) === before && (await answersOf(sa)).size === 3 && (await rowsOf(sa, s1e.questionId)).get(A)?.provenance === 'ai'
        && (await submissionState(sa)).mark_status === 'marked')

    const sbOnly = await remarkAssessmentActivity({ activityId: PPT2, pupilIds: [SB], questions: ['1e'] })
    check('scoped: every named question teacher-marked is nothing_to_remark',
      sbOnly.queued === 0 && sbOnly.skipped.nothing_to_remark.join() === SB && (await openJobs(sb)) === '' && (await answersOf(sb)).size === 3)

    const scoped = await remarkAssessmentActivity({ activityId: PPT2, pupilIds: [SA], questions: ['1E', ' 1j '] })
    check('scoped: the pupil is queued', scoped.queued_pupil_ids.join() === SA && scoped.questions?.join() === '1e,1j' && scoped.failed.length === 0,
      JSON.stringify({ queued: scoped.queued, held: scoped.held.length, failed: scoped.failed.map((f) => f.error) }))
    check('scoped: only the named question\'s mark job goes; a read is queued; another question\'s job stays',
      (await openJobsByLabel(sa)) === 'ai_mark:pending:2a,ai_read:pending:*', await openJobsByLabel(sa))
    const { rows: [readJob] } = await query<{ question_ids: string[] | null }>(
      `select payload->'questionIds' as question_ids from external_jobs
        where payload->>'submissionId' = $1 and job_type = 'ai_read' and status = 'pending'`,
      [sa],
    )
    check('scoped: the read job carries the named question ids',
      JSON.stringify(readJob?.question_ids?.slice().sort()) === JSON.stringify([s1e.questionId, s1j.questionId].sort()), JSON.stringify(readJob))
    const saAnswers = await answersOf(sa)
    check('scoped: only the named questions\' answers go', saAnswers.size === 1 && saAnswers.get(s2a.questionId)?.transcription === 'ai answer')
    check('scoped: the named questions\' AI rows go; a row with a teacher\'s comment stays',
      (await rowsOf(sa, s1e.questionId)).size === 0 && (await rowsOf(sa, s1j.questionId)).get(B)?.teacher_feedback === 'Look again')
    check('scoped: another question\'s AI row is untouched', (await rowsOf(sa, s2a.questionId)).get(C)?.awarded === 2)
    check('scoped: the submission waits for the read', (await submissionState(sa)).mark_status === 'waiting')

    // The read completes, with answers for every question: only the named ones change.
    const readId = await claim(sa, 'ai_read')
    const read = await completeAssessmentRead({
      submissionId: sa,
      assignmentId: 'x',
      jobId: readId,
      answers: [s1e, s1j, s2a, s3t, s4n].map((q) => ({
        questionId: q.questionId,
        kind: 'text' as const,
        transcription: 'new read',
        pages: [],
        status: q === s1e ? 'answered' as const : 'blank' as const,
      })),
    })
    check('scoped read: only the named questions are queued or zeroed; nothing else is held',
      read.queuedQuestionIds.join() === s1e.questionId && read.blankQuestionIds.join() === s1j.questionId
        && read.heldQuestionIds.length === 0 && read.teacherQuestionIds.length === 0 && !read.complete,
      JSON.stringify({ queued: read.queuedQuestionIds.length, blank: read.blankQuestionIds.length, held: read.heldQuestionIds.length }))
    const afterRead = await answersOf(sa)
    check('scoped read: answers stored for the named questions only; another question\'s answer kept',
      afterRead.size === 3 && afterRead.get(s1e.questionId)?.transcription === 'new read' && afterRead.get(s1j.questionId)?.transcription === 'new read'
        && afterRead.get(s2a.questionId)?.transcription === 'ai answer',
      JSON.stringify([...afterRead.values()].map((a) => a.transcription)))
    check('scoped read: a named blank answer gets 0; another question\'s blank answer does not',
      (await rowsOf(sa, s1j.questionId)).get(B)?.awarded === 0 && (await rowsOf(sa, s2a.questionId)).get(C)?.awarded === 2)
    check('scoped read: a mark job for the named question; the other question\'s job stays',
      (await openJobsByLabel(sa)) === 'ai_mark:pending:1e,ai_mark:pending:2a', await openJobsByLabel(sa))
    const mark2a = await completeAssessmentQuestionMark({
      submissionId: sa,
      jobId: await claim(sa, 'ai_mark', s2a.questionId),
      rows: [{ questionId: s2a.questionId, successCriteriaId: C, awarded: 3, whyNotAwarded: null, howToImprove: null }],
    })
    const mark1e = await completeAssessmentQuestionMark({
      submissionId: sa,
      jobId: await claim(sa, 'ai_mark', s1e.questionId),
      rows: [{ questionId: s1e.questionId, successCriteriaId: A, awarded: 2, whyNotAwarded: null, howToImprove: null }],
    })
    check('scoped read: the submission is marked when the last mark finishes',
      !mark2a.complete && mark1e.complete && (await submissionState(sa)).mark_status === 'marked', JSON.stringify(await submissionState(sa)))

    // --- assessment paper, only some questions ---------------------------------------
    const [p1, p2, p3] = await setAssessmentQuestions(PAPER2, [
      { label: 'P1', maxMarks: 2, markScheme: 'M1.', criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      { label: 'P2', maxMarks: 2, markScheme: 'M2.', criteria: [{ successCriteriaId: B, maxMarks: 2 }] },
      { label: 'P3', maxMarks: 2, markScheme: 'M3.', criteria: [{ successCriteriaId: C, maxMarks: 2 }] },
    ])
    const ta = await submit(PAPER2, TA, 'submitted')
    const tb = await submit(PAPER2, TB, 'submitted', null)
    const tc = await submit(PAPER2, TC, 'submitted')
    for (const [s, p] of [[ta, TA], [tb, TB], [tc, TC]]) await script(s, p, 'passed', PAPER2)
    await answer(ta, p1.questionId, 'teacher')
    await answer(ta, p2.questionId)
    await answer(ta, p3.questionId)
    await recordQuestionCriterionMarks(ta, [
      { questionId: p1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
      { questionId: p2.questionId, successCriteriaId: B, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
      { questionId: p3.questionId, successCriteriaId: C, awarded: 1, whyNotAwarded: 'w', howToImprove: 'h' },
    ], 'ai')
    await setTeacherQuestionCriterionComment(ta, p1.questionId, A, 'Good start')
    await recordQuestionCriterionMarks(ta, [{ questionId: p2.questionId, successCriteriaId: B, awarded: 2 }], 'teacher')
    await job(ta, 'ai_mark', p3.questionId)
    for (const q of [p1, p2, p3]) await answer(tc, q.questionId, 'ai', null, 'blank')

    const paperDry = await remarkAssessmentActivity({ activityId: PAPER2, questions: ['p1', 'P2', 'P3'], dryRun: true })
    check('paper scoped dry run: per-pupil counts and skips',
      paperDry.queued_pupil_ids.join() === TA && paperDry.question_marks_queued === 1
        && JSON.stringify(paperDry.question_marks) === JSON.stringify([{ pupil_id: TA, queued: 1, already_queued: 1, teacher_marked: 1 }])
        && paperDry.skipped.not_read.join() === TB && paperDry.skipped.blank_answers.join() === TC,
      JSON.stringify({ marks: paperDry.question_marks, not_read: paperDry.skipped.not_read.length, blank: paperDry.skipped.blank_answers.length }))
    check('paper scoped dry run: nothing changes',
      (await openJobsByLabel(ta)) === 'ai_mark:pending:P3' && (await rowsOf(ta, p1.questionId)).get(A)?.provenance === 'ai'
        && (await submissionState(ta)).mark_status === 'marked')

    const paperScoped = await remarkAssessmentActivity({ activityId: PAPER2, questions: ['p1', 'P2', 'P3', 'p1'] })
    check('paper scoped: the pupil is queued; not read and blank are skipped',
      paperScoped.queued_pupil_ids.join() === TA && paperScoped.question_marks_queued === 1
        && paperScoped.skipped.not_read.join() === TB && paperScoped.skipped.blank_answers.join() === TC && paperScoped.questions?.join() === 'P1,P2,P3',
      JSON.stringify({ marks: paperScoped.question_marks, skipped: paperScoped.skipped }))
    check('paper scoped: no read is queued; a mark job for the question to mark; the waiting job is left',
      (await openJobsByLabel(ta)) === 'ai_mark:pending:P1,ai_mark:pending:P3', await openJobsByLabel(ta))
    const taP1 = (await rowsOf(ta, p1.questionId)).get(A)
    check('paper scoped: a marker row with a teacher\'s comment stays (comment kept)', taP1?.teacher_feedback === 'Good start', JSON.stringify(taP1))
    check('paper scoped: a teacher\'s row stays', (await rowsOf(ta, p2.questionId)).get(B)?.provenance === 'teacher')
    check('paper scoped: the waiting question\'s AI row is untouched', (await rowsOf(ta, p3.questionId)).get(C)?.provenance === 'ai')
    const taAnswers = await answersOf(ta)
    check('paper scoped: transcriptions kept',
      taAnswers.size === 3 && taAnswers.get(p1.questionId)?.transcription === 'teacher answer' && taAnswers.get(p2.questionId)?.transcription === 'ai answer')
    check('paper scoped: the submission waits; untouched pupils are untouched',
      (await submissionState(ta)).mark_status === 'waiting' && (await openJobs(tb)) === '' && (await openJobs(tc)) === '')

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
