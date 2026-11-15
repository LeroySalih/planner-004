import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import {
  flagAssessmentQuestion,
  flagOutcome,
  readQuestionFlags,
  resolveAssessmentQuestionFlags,
  withdrawAssessmentQuestionFlag,
} from '@/lib/assessment-paper/question-flags'
import { pupilQuestionFlagRefusal, readPupilAssessmentPaperView } from '@/lib/assessment-paper/pupil-feedback'
import {
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import { getAssessmentActivity, getAssessmentActivityResult } from '@/lib/mcp/assessment-activities'
import { readPupilPowerPointView } from '@/lib/powerpoint-assessment/pupil-view'

// A pupil's flag on one question of a question-marked activity (migration
// 144), on a PowerPoint assessment and an assessment paper: flagging
// snapshots the question's marks and sets submissions.is_flagged; a second
// flag while one is open changes nothing; withdrawing ends it as
// 'withdrawn'; a teacher resolving it (one question, or the whole submission
// as the grid's Clear flag does) snapshots the marks again, and the outcome
// ('changed' / 'unchanged') is read from the two snapshots. The pupil's view
// shows the flag (never who resolved it), the guard refuses another pupil,
// an earlier attempt, unreleased feedback and a question the pupil cannot
// see a mark on, and MCP reports flags per question and an open count per
// pupil. No model is called: marks are written as the marker and a teacher
// would. Creates its own unit, lesson, activities, class and people, and
// removes them.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/assessment-paper/question-flags.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const tag = randomUUID().slice(0, 8)
const UNIT = `qflag-check-unit-${tag}`
const LESSON = `qflag-check-lesson-${tag}`
const GROUP = `qflag-check-group-${tag}`
const PPT = randomUUID()
const PAPER = randomUUID()
const PUPIL = `qflag-check-pupil-${tag}`
const OTHER = `qflag-check-other-${tag}`
const TEACHER = `qflag-check-teacher-${tag}`
const PEOPLE = [PUPIL, OTHER, TEACHER]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    "insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Oli', 'Ooo'), ($3, 'Tia', 'Ttt')",
    PEOPLE,
  )
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil'), ($2, 'pupil'), ($3, 'teacher')", PEOPLE)
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Question flags unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Question flags check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'powerpoint-assessment', 'Presentation task', $4::jsonb, 0),
       ($2, $3, 'assessment-paper', 'Paper', '{}'::jsonb, 1)`,
    [PPT, PAPER, LESSON, JSON.stringify({
      instructions: 'Build it.',
      uploadSlots: [{ key: 'presentation', label: 'Presentation', kind: 'pptx', required: true }],
    })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) values ($1, $2), ($1, $3)', [GROUP, PUPIL, OTHER])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where activity_id = any($1::text[]))", [[PPT, PAPER]])
  await query('delete from assessment_scripts where activity_id = any($1::text[])', [[PPT, PAPER]])
  await query('delete from submissions where activity_id = any($1::text[])', [[PPT, PAPER]])
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = any($1::text[])', [PEOPLE])
  await query('delete from profiles where user_id = any($1::text[])', [PEOPLE])
}

async function newSubmission(activityId: string, attempt: number, status: string, markStatus: string | null) {
  const id = randomUUID()
  await query(
    `insert into submissions (submission_id, activity_id, user_id, body, attempt_number, submission_status, mark_status, submitted_at)
     values ($1, $2, $3, '{}'::json, $4, $5, $6, now())`,
    [id, activityId, PUPIL, attempt, status, markStatus],
  )
  return id
}

async function isFlagged(submissionId: string) {
  const { rows } = await query<{ is_flagged: boolean }>('select is_flagged from submissions where submission_id = $1', [submissionId])
  return rows[0]?.is_flagged
}

const refusalOf = (r: { error: string } | { activityId: string }) => ('error' in r ? r.error : null)

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)

  // The outcome rule on its own.
  const snap = (a: number, b: number) => [{ success_criteria_id: 'a', awarded: a }, { success_criteria_id: 'b', awarded: b }]
  check('outcome: same marks are unchanged', flagOutcome({ withdrawn_at: null, awarded_at_flag: 1, awarded_at_resolve: 1, marks_at_flag: snap(1, 0), marks_at_resolve: snap(1, 0) }) === 'unchanged')
  check('outcome: marks moved between criteria are changed', flagOutcome({ withdrawn_at: null, awarded_at_flag: 1, awarded_at_resolve: 1, marks_at_flag: snap(1, 0), marks_at_resolve: snap(0, 1) }) === 'changed')
  check('outcome: withdrawn wins', flagOutcome({ withdrawn_at: new Date(), awarded_at_flag: 1, awarded_at_resolve: null, marks_at_flag: snap(1, 0), marks_at_resolve: null }) === 'withdrawn')

  await setUp()
  try {
    // --- PowerPoint assessment ----------------------------------------------------
    const evidence = [{ source: 'presentation', slot: 'presentation', sections: ['slides'] }]
    const [t1, t2] = await setAssessmentQuestions(PPT, [
      { label: 'T1', maxMarks: 2, markScheme: 'MS', evidence, criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }] },
      { label: 'T2', maxMarks: 1, markScheme: 'MS', marking: 'teacher', evidence, criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
    ])
    const sub = await newSubmission(PPT, 1, 'submitted', 'marked')
    await recordQuestionCriterionMarks(sub, [
      { questionId: t1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'HOW-A' },
      { questionId: t1.questionId, successCriteriaId: B, awarded: 0, whyNotAwarded: 'WHY-B', howToImprove: 'HOW-B' },
    ], 'ai')

    check('refused: feedback not released', refusalOf(await pupilQuestionFlagRefusal(sub, t1.questionId, PUPIL)) === 'Your feedback has not been released yet.')
    await query('update planner_assignments set feedback_visible = true where lesson_id = $1', [LESSON])
    check('allowed: own latest, marked, released', refusalOf(await pupilQuestionFlagRefusal(sub, t1.questionId, PUPIL)) === null)
    check('refused: another pupil', refusalOf(await pupilQuestionFlagRefusal(sub, t1.questionId, OTHER)) === 'You can only flag your own work.')
    check('refused: an unmarked teacher-only task', refusalOf(await pupilQuestionFlagRefusal(sub, t2.questionId, PUPIL)) === 'This question has not been marked yet.')
    check('refused: a question from another activity', refusalOf(await pupilQuestionFlagRefusal(sub, randomUUID(), PUPIL)) === 'That question is not on this activity.')
    await query("update submissions set mark_status = 'marking' where submission_id = $1", [sub])
    check('refused: while it is being marked', refusalOf(await pupilQuestionFlagRefusal(sub, t1.questionId, PUPIL)) === 'This question has not been marked yet.')
    await query("update submissions set mark_status = 'marked' where submission_id = $1", [sub])
    await query('update planner_assignments set locked = true where lesson_id = $1', [LESSON])
    check('refused: a locked lesson', refusalOf(await pupilQuestionFlagRefusal(sub, t1.questionId, PUPIL))?.includes('locked') === true)
    await query('update planner_assignments set locked = false where lesson_id = $1', [LESSON])

    // Flag, twice.
    const flagged = await flagAssessmentQuestion(sub, t1.questionId, PUPIL)
    check('flag: is_flagged set', flagged.isFlagged && (await isFlagged(sub)) === true)
    await flagAssessmentQuestion(sub, t1.questionId, PUPIL)
    const { rows: flagRows } = await query<{ awarded_at_flag: number; marks_at_flag: Array<{ success_criteria_id: string; awarded: number }> }>(
      'select awarded_at_flag, marks_at_flag from submission_question_flags where submission_id = $1', [sub],
    )
    check('flag twice: one row', flagRows.length === 1, String(flagRows.length))
    check('flag: the question\'s mark is snapshotted', flagRows[0]?.awarded_at_flag === 1)
    check('flag: each criterion\'s mark is snapshotted',
      JSON.stringify(flagRows[0]?.marks_at_flag.map((m) => [m.success_criteria_id, m.awarded]).sort()) === JSON.stringify([[A, 1], [B, 0]].sort()),
      JSON.stringify(flagRows[0]?.marks_at_flag))

    let view = await readPupilPowerPointView(PPT, PUPIL, false)
    let q1 = view.feedback?.questions.find((q) => q.label === 'T1')
    check('pupil view: the task carries its id and an open flag', q1?.questionId === t1.questionId && q1.flag.open && q1.flag.lastOutcome === null, JSON.stringify(q1?.flag))
    check('pupil view: the latest submission id', view.feedback?.submissionId === sub)
    check('pupil view: no resolver or snapshot keys', !/resolved_?[bB]y|marks_?[aA]t|ai_?[aA]warded/.test(JSON.stringify(view)))

    let mcp = await getAssessmentActivity(PPT)
    check('MCP: questions_flagged per pupil', mcp.pupils.find((p) => p.pupil_id === PUPIL)?.progress?.questions_flagged === 1)

    // Withdraw.
    const withdrawn = await withdrawAssessmentQuestionFlag(sub, t1.questionId)
    check('withdraw: is_flagged cleared', !withdrawn.isFlagged && (await isFlagged(sub)) === false)
    let flags = await readQuestionFlags(sub)
    check('withdraw: history says withdrawn', flags.get(t1.questionId)?.open === null && flags.get(t1.questionId)?.history[0]?.outcome === 'withdrawn')
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    q1 = view.feedback?.questions.find((q) => q.label === 'T1')
    check('pupil view: nothing to say after a withdrawal', q1?.flag.open === false && q1.flag.lastOutcome === null)

    // Flag, the teacher changes a mark, resolves the one question.
    await flagAssessmentQuestion(sub, t1.questionId, PUPIL)
    await setTeacherQuestionCriterionMark(sub, t1.questionId, B, 1)
    const resolved = await resolveAssessmentQuestionFlags(sub, TEACHER, t1.questionId)
    check('resolve: one flag, is_flagged cleared', resolved.resolved === 1 && !resolved.isFlagged && (await isFlagged(sub)) === false)
    flags = await readQuestionFlags(sub)
    const last = flags.get(t1.questionId)?.history[0]
    check('resolve: outcome changed, 1 -> 2', last?.outcome === 'changed' && last.awardedAtFlag === 1 && last.awardedAtResolve === 2, JSON.stringify(last))
    const { rows: [{ resolved_by }] } = await query<{ resolved_by: string }>(
      'select resolved_by from submission_question_flags where submission_id = $1 and resolved_at is not null', [sub],
    )
    check('resolve: the teacher is recorded', resolved_by === TEACHER)
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    q1 = view.feedback?.questions.find((q) => q.label === 'T1')
    check('pupil view: teacher checked it, mark changed', q1?.flag.open === false && q1.flag.lastOutcome === 'changed')

    // Flag again, resolve everything on the submission (the grid's Clear flag), unchanged.
    await flagAssessmentQuestion(sub, t1.questionId, PUPIL)
    const all = await resolveAssessmentQuestionFlags(sub, TEACHER)
    flags = await readQuestionFlags(sub)
    check('resolve all: unchanged', all.resolved === 1 && flags.get(t1.questionId)?.history[0]?.outcome === 'unchanged' && !all.isFlagged)
    check('resolve all with nothing open does nothing', (await resolveAssessmentQuestionFlags(sub, TEACHER)).resolved === 0)

    const result = await getAssessmentActivityResult(PPT, PUPIL)
    const mcpT1 = result.questions.find((q) => q.label === 'T1')
    check('MCP: per-question flag history, newest first',
      mcpT1?.flag.open === false && mcpT1.flag.history.map((h) => h.outcome).join(',') === 'unchanged,changed,withdrawn',
      JSON.stringify(mcpT1?.flag))
    mcp = await getAssessmentActivity(PPT)
    check('MCP: no open flags now', mcp.pupils.find((p) => p.pupil_id === PUPIL)?.progress?.questions_flagged === 0)

    // A newer attempt: the old one may not be flagged.
    await newSubmission(PPT, 2, 'inprogress', null)
    check('refused: an earlier attempt', refusalOf(await pupilQuestionFlagRefusal(sub, t1.questionId, PUPIL)) === 'Only your latest answer can be flagged.')

    // --- Assessment paper ---------------------------------------------------------
    const [p1, p2] = await setAssessmentQuestions(PAPER, [
      { label: '1', maxMarks: 2, questionText: 'Explain.', markScheme: 'MS', criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }] },
      { label: '2', maxMarks: 1, questionText: 'Name one.', markScheme: 'MS', criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
    ])
    const paperSub = await newSubmission(PAPER, 1, 'submitted', 'marking')
    await query("insert into assessment_scripts (activity_id, pupil_id, submission_id, original_path) values ($1, $2, $3, $4)",
      [PAPER, PUPIL, paperSub, `${PAPER}/scripts/x/original.pdf`])
    await recordQuestionCriterionMarks(paperSub, [
      { questionId: p1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'PAPER-HOW' },
      { questionId: p1.questionId, successCriteriaId: B, awarded: 1, whyNotAwarded: null, howToImprove: null },
    ], 'ai')
    await setTeacherQuestionCriterionMark(paperSub, p2.questionId, A, 0, 'PAPER-TEACHER')

    let paperView = await readPupilAssessmentPaperView(PAPER, PUPIL, false)
    let pq1 = paperView.feedback?.questions.find((q) => q.label === '1')
    let pq2 = paperView.feedback?.questions.find((q) => q.label === '2')
    check('paper, still marking: the AI-marked question is hidden', pq1?.awarded === null && pq1.comments.length === 0, JSON.stringify(pq1))
    check('paper, still marking: the teacher-marked question shows', pq2?.awarded === 0 && JSON.stringify(pq2.comments).includes('PAPER-TEACHER'))
    check('paper, still marking: the total counts only what shows', paperView.feedback?.marksAwarded === 0, String(paperView.feedback?.marksAwarded))
    check('paper: the script link sits beside the feedback', paperView.scriptUrl?.endsWith('/original.pdf') === true)
    check('paper refused: a question still being marked', refusalOf(await pupilQuestionFlagRefusal(paperSub, p1.questionId, PUPIL)) === 'This question has not been marked yet.')
    check('paper allowed: a question the teacher marked', refusalOf(await pupilQuestionFlagRefusal(paperSub, p2.questionId, PUPIL)) === null)

    await query("update submissions set mark_status = 'marked' where submission_id = $1", [paperSub])
    check('paper allowed once marked', refusalOf(await pupilQuestionFlagRefusal(paperSub, p1.questionId, PUPIL)) === null)
    await flagAssessmentQuestion(paperSub, p1.questionId, PUPIL)
    check('paper flag: is_flagged set', (await isFlagged(paperSub)) === true)
    paperView = await readPupilAssessmentPaperView(PAPER, PUPIL, false)
    pq1 = paperView.feedback?.questions.find((q) => q.label === '1')
    check('paper view: marks, comments and the open flag', pq1?.awarded === 2 && JSON.stringify(pq1.comments).includes('PAPER-HOW') && pq1.flag.open, JSON.stringify(pq1))
    check('paper view: total once marked', paperView.feedback?.marksAwarded === 2 && paperView.feedback.maxMarks === 3, JSON.stringify({ m: paperView.feedback?.marksAwarded, x: paperView.feedback?.maxMarks }))
    const paperResolved = await resolveAssessmentQuestionFlags(paperSub, TEACHER)
    check('paper resolve all: is_flagged cleared, unchanged', paperResolved.resolved === 1 && !paperResolved.isFlagged &&
      (await readQuestionFlags(paperSub)).get(p1.questionId)?.history[0]?.outcome === 'unchanged')
    paperView = await readPupilAssessmentPaperView(PAPER, PUPIL, false)
    pq2 = paperView.feedback?.questions.find((q) => q.label === '1')
    check('paper view: teacher checked it', pq2?.flag.open === false && pq2.flag.lastOutcome === 'unchanged')
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from submission_question_flags f join submissions s on s.submission_id = f.submission_id
              where s.activity_id = any($1::text[]))
          + (select count(*) from activities where activity_id = any($1::text[]))
          + (select count(*) from profiles where user_id = any($2::text[]))
          + (select count(*) from units where unit_id = $3) as left`,
    [[PPT, PAPER], PEOPLE, UNIT],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
