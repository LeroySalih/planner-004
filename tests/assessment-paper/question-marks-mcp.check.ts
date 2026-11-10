import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import type { McpCaller } from '@/lib/mcp/auth'
import { claimDownloadLink, createScriptDownloadLink } from '@/lib/mcp/download-links'
import {
  readScriptForDownload,
  scriptFileName,
  scriptFormat,
  setAssessmentActivityQuestionMarks,
} from '@/lib/mcp/assessment-activities'
import { recordQuestionCriterionMarks, setAssessmentQuestions } from '@/lib/assessment-paper/store'

// set_assessment_activity_question_marks and
// create_assessment_activity_script_download_link: refusals before anything is
// written (unknown question, a criterion not on the question, over-allocation,
// duplicates, nothing to change, a comment on an unmarked criterion, no
// submission), a mark with a comment stamped teacher, a changed mark without a
// comment dropping the marker's, a comment alone, the transcription, Confirm,
// work on the latest attempt only, and the one-time script link (single use,
// cancelled by a replacement, held scripts included). No model is called and
// no file is stored. Creates its own unit, lesson, activity and pupils, and
// removes them. Never prints names.
// Run with DATABASE_URL set:
//   npx tsx tests/assessment-paper/question-marks-mcp.check.ts

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

const tag = randomUUID().slice(0, 8)
const UNIT = `qm-check-unit-${tag}`
const LESSON = `qm-check-lesson-${tag}`
const PAPER = randomUUID()
const TEXT_ACTIVITY = randomUUID()
const PUPIL = `qm-check-pupil-${tag}`
const ABSENT = `qm-check-absent-${tag}`
const PEOPLE = [PUPIL, ABSENT]

const caller: McpCaller = { method: 'service_key', userId: null, clientId: null }

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    "insert into profiles (user_id, first_name, last_name) values ($1, 'Pat', 'O/Neil'), ($2, 'Abe', 'Sent')",
    PEOPLE,
  )
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Question marks unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Question marks check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'assessment-paper', $4, '{}'::jsonb, 0),
       ($2, $3, 'text', 'Not a paper', '{}'::jsonb, 1)`,
    [PAPER, TEXT_ACTIVITY, LESSON, `Systems: test ${tag}`],
  )
}

async function tearDown() {
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
  await query('delete from mcp_download_links where lesson_id = $1', [LESSON])
  await query('delete from assessment_scripts where pupil_id = any($1::text[])', [PEOPLE])
  await query('delete from submissions where user_id = any($1::text[])', [PEOPLE])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = any($1::text[])', [PEOPLE])
}

async function submit(attempt: number) {
  const { rows: [{ submission_id }] } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
     values ($1, $2, $3, now() - make_interval(mins => 10 - $3), '{}'::json, 'marked', 'submitted')
     returning submission_id`,
    [PAPER, PUPIL, attempt],
  )
  return submission_id
}

async function criterionRows(submissionId: string, questionId: string) {
  const { rows } = await query<{
    success_criteria_id: string
    awarded: number
    why_not_awarded: string | null
    teacher_feedback: string | null
    provenance: string
  }>(
    `select success_criteria_id, awarded, why_not_awarded, teacher_feedback, provenance
       from submission_question_criterion_marks where submission_id = $1 and question_id = $2`,
    [submissionId, questionId],
  )
  return new Map(rows.map((row) => [row.success_criteria_id, row]))
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 3 limit 1)
      order by sc.success_criteria_id limit 3`,
  )
  const [A, B, C] = scs.map((row) => row.success_criteria_id)

  await setUp()
  try {
    const [q1, q2] = await setAssessmentQuestions(PAPER, [
      { label: 'Q1(a)', maxMarks: 4, markScheme: 'Strong (2). Light (2).', criteria: [{ successCriteriaId: A, maxMarks: 2 }, { successCriteriaId: B, maxMarks: 2 }] },
      { label: 'Q2', maxMarks: 3, markScheme: 'Three points.', criteria: [{ successCriteriaId: C, maxMarks: 3 }] },
    ])
    const older = await submit(1)
    const latest = await submit(2)
    // The marker's marks on the latest attempt.
    await recordQuestionCriterionMarks(latest, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: 'Only one point', howToImprove: 'Say why' },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 0, whyNotAwarded: 'Missing', howToImprove: 'Mention weight' },
      { questionId: q2.questionId, successCriteriaId: C, awarded: 2, whyNotAwarded: 'Two of three', howToImprove: 'A third point' },
    ], 'ai')
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance)
       values ($1, $2, 'text', 'it is strng', '{2}', 'answered', 'ai')`,
      [latest, q1.questionId],
    )

    const base = { activityId: PAPER, pupilId: PUPIL }
    const run = (rest: Partial<Parameters<typeof setAssessmentActivityQuestionMarks>[0]>) =>
      setAssessmentActivityQuestionMarks({ ...base, question: 'q1(a)', ...rest })

    // --- Refusals ----------------------------------------------------------------
    let [ok, detail] = await refused(() => run({ question: 'Q9' }), /No question "Q9".*Q1\(a\), Q2/)
    check('an unknown question is refused, listing the labels', ok, detail)
    ;[ok, detail] = await refused(() => run({}), /Nothing to change/)
    check('nothing to change is refused', ok, detail)
    ;[ok, detail] = await refused(() => run({ criteria: [{ success_criteria_id: A, marks: 2 }, { success_criteria_id: C, marks: 1 }] }), /does not test criterion/)
    check('a criterion not on the question is refused', ok, detail)
    ;[ok, detail] = await refused(() => run({ criteria: [{ success_criteria_id: A, marks: 3 }] }), /from 0 to 2/)
    check('marks over the allocation are refused', ok, detail)
    ;[ok, detail] = await refused(() => run({ criteria: [{ success_criteria_id: A, marks: 1 }, { success_criteria_id: A, marks: 2 }] }), /more than once/)
    check('a duplicate criterion is refused', ok, detail)
    ;[ok, detail] = await refused(() => run({ criteria: [{ success_criteria_id: A }] }), /give marks, feedback or both/)
    check('a criterion with neither marks nor feedback is refused', ok, detail)
    ;[ok, detail] = await refused(() => run({ criteria: [{ success_criteria_id: A, feedback: 'x'.repeat(2001) }] }), /over 2000/)
    check('over-long feedback is refused', ok, detail)
    ;[ok, detail] = await refused(() => run({ transcription: 'x'.repeat(20001) }), /over 20000/)
    check('an over-long transcription is refused', ok, detail)
    ;[ok, detail] = await refused(() => setAssessmentActivityQuestionMarks({ activityId: PAPER, pupilId: ABSENT, question: 'Q1(a)', confirm: true }), /no submission/)
    check('a pupil with no submission is refused', ok, detail)
    ;[ok, detail] = await refused(() => setAssessmentActivityQuestionMarks({ activityId: TEXT_ACTIVITY, pupilId: PUPIL, question: 'Q1(a)', confirm: true }), /not an assessment paper/)
    check('a non-paper activity is refused', ok, detail)
    const before = await criterionRows(latest, q1.questionId)
    ;[ok, detail] = await refused(
      () => run({ transcription: 'should not land', criteria: [{ success_criteria_id: A, marks: 2 }, { success_criteria_id: B, marks: 5 }] }),
      /from 0 to 2/,
    )
    const after = await criterionRows(latest, q1.questionId)
    const { rows: [answerAfter] } = await query<{ transcription: string }>(
      'select transcription from submission_question_answers where submission_id = $1 and question_id = $2',
      [latest, q1.questionId],
    )
    check(
      'one bad criterion refuses the whole call and writes nothing',
      ok && after.get(A)?.awarded === 1 && after.get(A)?.provenance === 'ai' && JSON.stringify([...before]) === JSON.stringify([...after])
        && answerAfter.transcription === 'it is strng',
      detail,
    )

    // A comment alone needs a mark to sit beside: take B's away, then put it back.
    await query('delete from submission_question_criterion_marks where submission_id = $1 and question_id = $2 and success_criteria_id = $3', [latest, q1.questionId, B])
    ;[ok, detail] = await refused(() => run({ criteria: [{ success_criteria_id: B, feedback: 'Nice' }] }), /has no mark yet/)
    check('a comment on an unmarked criterion is refused', ok, detail)
    await recordQuestionCriterionMarks(latest, [
      { questionId: q1.questionId, successCriteriaId: B, awarded: 0, whyNotAwarded: 'Missing', howToImprove: 'Mention weight' },
    ], 'ai')

    // --- Writes ------------------------------------------------------------------
    const changed = await run({ criteria: [{ success_criteria_id: A, marks: 2 }] })
    let rows = await criterionRows(latest, q1.questionId)
    check(
      'a changed mark without a comment is stamped teacher and drops the marker\'s comment',
      rows.get(A)?.awarded === 2 && rows.get(A)?.provenance === 'teacher' && rows.get(A)?.why_not_awarded === null && rows.get(A)?.teacher_feedback === null,
      JSON.stringify(rows.get(A)),
    )
    check('the result is the question and the paper total', changed.question.label === 'Q1(a)' && changed.question.awarded === 2
      && changed.marks_awarded === 4 && changed.max_marks === 7 && changed.submission_id === latest,
      JSON.stringify({ awarded: changed.question.awarded, total: changed.marks_awarded, max: changed.max_marks }))

    const commented = await run({ criteria: [{ success_criteria_id: B, feedback: 'Weight matters here' }] })
    rows = await criterionRows(latest, q1.questionId)
    check(
      'a comment alone keeps the mark and its provenance',
      rows.get(B)?.awarded === 0 && rows.get(B)?.provenance === 'ai' && rows.get(B)?.teacher_feedback === 'Weight matters here'
        && commented.question.criteria.find((c) => c.success_criteria_id === B)?.teacher_feedback === 'Weight matters here',
      JSON.stringify(rows.get(B)),
    )

    const both = await run({ question: q1.questionId, criteria: [{ success_criteria_id: B, marks: 1, feedback: 'Better: one point on weight' }] })
    rows = await criterionRows(latest, q1.questionId)
    check(
      'a mark with a comment, by question_id, is stamped teacher with the comment',
      rows.get(B)?.awarded === 1 && rows.get(B)?.provenance === 'teacher' && rows.get(B)?.teacher_feedback === 'Better: one point on weight'
        && both.question.provenance !== null && both.marks_awarded === 5,
      JSON.stringify({ row: rows.get(B), total: both.marks_awarded }),
    )

    await run({ criteria: [{ success_criteria_id: B, marks: 1 }] })
    rows = await criterionRows(latest, q1.questionId)
    check('marks without feedback keep the teacher\'s comment', rows.get(B)?.teacher_feedback === 'Better: one point on weight')
    await run({ criteria: [{ success_criteria_id: B, feedback: '' }] })
    rows = await criterionRows(latest, q1.questionId)
    check('feedback "" clears the comment', rows.get(B)?.teacher_feedback === null && rows.get(B)?.awarded === 1)

    const transcribed = await run({ transcription: '  it is strong  ' })
    check(
      'the transcription is replaced and stamped teacher',
      transcribed.question.answer?.transcription === 'it is strong' && transcribed.question.answer?.provenance === 'teacher',
      JSON.stringify(transcribed.question.answer),
    )
    const cleared = await run({ transcription: '' })
    check('transcription "" clears it', cleared.question.answer?.transcription === null)

    const confirmed = await setAssessmentActivityQuestionMarks({ ...base, question: 'q2', confirm: true })
    const q2rows = await criterionRows(latest, q2.questionId)
    check(
      'confirm stamps the marker\'s marks teacher, unchanged, comments kept',
      q2rows.get(C)?.provenance === 'teacher' && q2rows.get(C)?.awarded === 2 && q2rows.get(C)?.why_not_awarded === 'Two of three'
        && confirmed.question.awarded === 2 && confirmed.marks_awarded === 5,
      JSON.stringify(q2rows.get(C)),
    )

    const { rows: [{ n: olderRows }] } = await query<{ n: number }>(
      'select count(*)::int as n from submission_question_criterion_marks where submission_id = $1',
      [older],
    )
    check('the older attempt is untouched', Number(olderRows) === 0)

    // --- Script links ------------------------------------------------------------
    ;[ok, detail] = await refused(() => createScriptDownloadLink(caller, base), /no script uploaded/)
    check('no script: refused', ok, detail)
    ;[ok, detail] = await refused(() => createScriptDownloadLink(caller, { activityId: PAPER, pupilId: ABSENT }), /no submission/)
    check('no submission: refused', ok, detail)
    ;[ok, detail] = await refused(() => createScriptDownloadLink(caller, { activityId: TEXT_ACTIVITY, pupilId: PUPIL }), /not an assessment paper/)
    check('not a paper: refused', ok, detail)

    const olderScript = randomUUID()
    const heldScript = randomUUID()
    await query(
      `insert into assessment_scripts (script_id, activity_id, pupil_id, submission_id, original_path, page_count, front_sheet_check, uploaded_at)
       values ($1, $3, $4, $5, 'old.pdf', 5, 'passed', now() - interval '1 hour'),
              ($2, $3, $4, $6, 'held.pdf', 6, 'The front sheet does not match', now())`,
      [olderScript, heldScript, PAPER, PUPIL, latest, latest],
    )
    const link = await createScriptDownloadLink(caller, base)
    check(
      'the link is for the newest script on the latest submission, held or not',
      link.script.scriptId === heldScript && link.script.frontSheetCheck === 'The front sheet does not match' && link.script.pageCount === 6,
      JSON.stringify({ ...link.script, fileName: undefined }),
    )
    check('the file name is the title and pupil, sanitised', link.script.fileName === `Systems test ${tag} - Pat O Neil.pdf`, link.script.fileName)
    check('scriptFileName falls back when there is no title or name', scriptFileName(null, null, null) === 'Assessment - pupil.pdf')
    check(
      'a folded JPEG or PNG script keeps its type and extension',
      scriptFormat('a/scripts/s/original.jpg').contentType === 'image/jpeg' && scriptFormat('a/scripts/s/original.png').extension === 'png'
        && scriptFormat('held.pdf').contentType === 'application/pdf' && scriptFileName('T', 'A', 'B', 'jpg') === 'T - A B.jpg',
    )
    const claimed = await claimDownloadLink(link.token)
    check(
      'the link is claimed once as a script link',
      claimed?.kind === 'assessment_script' && claimed.script_id === heldScript && claimed.activity_id === PAPER && claimed.lesson_id === LESSON,
      JSON.stringify(claimed && { ...claimed, caller: undefined }),
    )
    check('a second claim fails', (await claimDownloadLink(link.token)) === null)
    const download = await readScriptForDownload(heldScript, PAPER)
    check('the download reads the script\'s original path', download?.originalPath === 'held.pdf' && download.pupilId === PUPIL)
    check('a script on another activity is not read', (await readScriptForDownload(heldScript, TEXT_ACTIVITY)) === null)

    const replaced = await createScriptDownloadLink(caller, base)
    await query('delete from assessment_scripts where script_id = $1', [heldScript])
    check('replacing the script cancels its link', (await claimDownloadLink(replaced.token)) === null)
    const [shapeOk] = await refused(
      () => query(
        "insert into mcp_download_links (token_hash, kind, lesson_id, activity_id, auth_method, expires_at) values ($1, 'assessment_script', $2, $3, 'service_key', now())",
        [`qm-check-${tag}`, LESSON, PAPER],
      ),
      /kind_shape/,
    )
    check('a script link without a script is refused by the table', shapeOk)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from units where unit_id = $1)
          + (select count(*) from profiles where user_id = any($2::text[]))
          + (select count(*) from activities where activity_id = $3)
          + (select count(*) from mcp_download_links where lesson_id = $4) as left`,
    [UNIT, PEOPLE, PAPER, LESSON],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
