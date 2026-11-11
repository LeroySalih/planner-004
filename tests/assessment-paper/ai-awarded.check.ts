import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'

import { query } from '@/lib/db'
import {
  confirmAssessmentQuestionMarks,
  recordLegacyQuestionMark,
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherAnswerTranscription,
  setTeacherQuestionCriterionComment,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import { readAssessmentPaperResult } from '@/lib/assessment-paper/results'
import { readAssessmentFeedbackPdfData } from '@/lib/assessment-paper/feedback-pdf'
import { renderClassFeedbackPdf } from '@/lib/assessment-paper/class-feedback-pdf'
import { getAssessmentActivityResult } from '@/lib/mcp/assessment-activities'
import { AssessmentPaperFeedbackDocument } from '@/components/pdf/assessment-paper-feedback-document'

// The AI marker's own mark beside the teacher's (migration 141): every AI
// write sets ai_awarded; a teacher's mark change, comment, confirm or
// transcription leaves it; a re-mark updates it on AI rows only; a teacher
// mark the AI never gave leaves it null. Then the class feedback PDF (teacher
// copy): the cover's AI / final / change and summary line, each pupil's
// Teacher changes box, and the pupil's own PDF unchanged (no AI text). No
// model is called. Creates its own unit, lesson, activity, class and people,
// and removes them. Never prints names.
// Run with DATABASE_URL set, where poppler is installed:
//   npx tsx tests/assessment-paper/ai-awarded.check.ts [pdf-dir]

const execFileAsync = promisify(execFile)

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const PDF_DIR = process.argv[2] || path.join(process.cwd(), 'tmp-ai-awarded-check')
const tag = randomUUID().slice(0, 8)
const UNIT = `aia-check-unit-${tag}`
const LESSON = `aia-check-lesson-${tag}`
const GROUP = `aia-check-${tag}`
const PAPER = randomUUID()

const CHANGED = `aia-check-changed-${tag}` // AI marked, teacher changed one mark, teacher-only Q2
const UNCHANGED = `aia-check-same-${tag}` // AI marked twice, no teacher change
const LEGACY = `aia-check-legacy-${tag}` // legacy marks only
const ABSENT = `aia-check-absent-${tag}` // not sat
const PEOPLE = [CHANGED, UNCHANGED, LEGACY, ABSENT]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    `insert into profiles (user_id, first_name, last_name) values
       ($1, 'Ann', 'Aaa'), ($2, 'Bob', 'Bbb'), ($3, 'Cat', 'Ccc'), ($4, 'Dan', 'Ddd')`,
    PEOPLE,
  )
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Marker unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Marker check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'assessment-paper', $3, '{}'::jsonb, 0)",
    [PAPER, LESSON, `Marker check ${tag}`],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) select $1, unnest($2::text[])', [GROUP, PEOPLE])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period) values ($1, $2, current_date, 'sunday', 1)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from submissions where user_id = any($1::text[])', [PEOPLE])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from profiles where user_id = any($1::text[])', [PEOPLE])
}

async function submit(pupilId: string) {
  const { rows: [{ submission_id }] } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
     values ($1, $2, 1, now(), '{}'::json, 'marked', 'submitted')
     returning submission_id`,
    [PAPER, pupilId],
  )
  return submission_id
}

async function rowsOf(submissionId: string) {
  const { rows } = await query<{ question_id: string; success_criteria_id: string; awarded: number; ai_awarded: number | null; provenance: string }>(
    `select question_id::text, success_criteria_id, awarded, ai_awarded, provenance
       from submission_question_criterion_marks where submission_id = $1`,
    [submissionId],
  )
  return (questionId: string, sc: string) => rows.find((r) => r.question_id === questionId && r.success_criteria_id === sc)
}

async function pageText(file: string, page: number) {
  return (await execFileAsync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', file, '-'])).stdout
}

async function main() {
  await mkdir(PDF_DIR, { recursive: true })
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)

  await setUp()
  try {
    const [q1, q2] = await setAssessmentQuestions(PAPER, [
      { label: 'Q1', maxMarks: 4, markScheme: 'Strong (2). Light (2).', criteria: [{ successCriteriaId: A, maxMarks: 2 }, { successCriteriaId: B, maxMarks: 2 }] },
      { label: 'Q2', maxMarks: 2, marking: 'teacher', markScheme: 'Sketch (2).', criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
    ])

    // --- Store ------------------------------------------------------------------
    const changed = await submit(CHANGED)
    await recordQuestionCriterionMarks(changed, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: 'Only one point.', howToImprove: 'Say why.' },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 2, whyNotAwarded: null, howToImprove: null },
    ], 'ai')
    let row = await rowsOf(changed)
    check('an AI write sets ai_awarded to its mark', row(q1.questionId, A)?.ai_awarded === 1 && row(q1.questionId, B)?.ai_awarded === 2)

    await setTeacherQuestionCriterionMark(changed, q1.questionId, A, 2)
    row = await rowsOf(changed)
    check('a teacher\'s change of mark keeps ai_awarded', row(q1.questionId, A)?.awarded === 2 && row(q1.questionId, A)?.ai_awarded === 1 && row(q1.questionId, A)?.provenance === 'teacher')

    await setTeacherQuestionCriterionComment(changed, q1.questionId, B, 'Good.')
    await setTeacherAnswerTranscription(changed, q1.questionId, 'Strong and light.')
    row = await rowsOf(changed)
    check('a teacher\'s comment and transcription keep ai_awarded', row(q1.questionId, B)?.ai_awarded === 2 && row(q1.questionId, B)?.provenance === 'ai')

    await confirmAssessmentQuestionMarks(changed, q1.questionId)
    row = await rowsOf(changed)
    check('confirm keeps ai_awarded', row(q1.questionId, B)?.provenance === 'teacher' && row(q1.questionId, B)?.ai_awarded === 2)

    await recordQuestionCriterionMarks(changed, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 0 },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 0 },
    ], 'ai')
    row = await rowsOf(changed)
    check('a re-mark leaves teacher rows and their ai_awarded alone',
      row(q1.questionId, A)?.awarded === 2 && row(q1.questionId, A)?.ai_awarded === 1 && row(q1.questionId, B)?.awarded === 2 && row(q1.questionId, B)?.ai_awarded === 2)

    await setTeacherQuestionCriterionMark(changed, q2.questionId, A, 1)
    row = await rowsOf(changed)
    check('a teacher mark with no AI row before it leaves ai_awarded null', row(q2.questionId, A)?.ai_awarded === null)

    const unchanged = await submit(UNCHANGED)
    await recordQuestionCriterionMarks(unchanged, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1 },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 1 },
    ], 'ai')
    await recordQuestionCriterionMarks(unchanged, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 2 },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 0 },
    ], 'ai')
    row = await rowsOf(unchanged)
    check('a re-mark updates ai_awarded on AI rows', row(q1.questionId, A)?.ai_awarded === 2 && row(q1.questionId, B)?.ai_awarded === 0)

    const legacy = await submit(LEGACY)
    await recordLegacyQuestionMark(legacy, q1.questionId, 3, 'Old mark.', null)
    row = await rowsOf(legacy)
    check('legacy rows have no ai_awarded', row(q1.questionId, A)?.ai_awarded === null && row(q1.questionId, B)?.ai_awarded === null)

    // --- Readers ----------------------------------------------------------------
    const result = await readAssessmentPaperResult(PAPER, CHANGED)
    const r1 = result.questions.find((q) => q.questionId === q1.questionId)!
    check('readAssessmentPaperResult exposes aiAwarded', r1.criteria.find((c) => c.successCriteriaId === A)?.aiAwarded === 1)
    const mcp = await getAssessmentActivityResult(PAPER, CHANGED)
    const m1 = mcp.questions.find((q) => q.question_id === q1.questionId)!
    check('get_assessment_activity_result returns ai_awarded', m1.criteria.find((c) => c.success_criteria_id === A)?.ai_awarded === 1)

    const pupilData = await readAssessmentFeedbackPdfData(PAPER, CHANGED)
    const teacherData = await readAssessmentFeedbackPdfData(PAPER, CHANGED, { teacherCopy: true })
    check('the pupil\'s own PDF data has no teacher changes', !('teacherChanges' in pupilData))
    const { teacherChanges, ...rest } = teacherData
    check('the teacher copy adds only teacherChanges', JSON.stringify(rest) === JSON.stringify(pupilData))
    check(
      'teacher changes: AI 4, final 5, +1, Q1 3/4 -> 4/4, Q2 teacher alone',
      teacherChanges?.recorded === true && teacherChanges.aiMarks === 4 && teacherChanges.finalMarks === 5 && teacherChanges.change === 1
        && JSON.stringify(teacherChanges.changedQuestions) === JSON.stringify([{ label: 'Q1', aiAwarded: 3, finalAwarded: 4, available: 4 }])
        && JSON.stringify(teacherChanges.teacherOnlyLabels) === JSON.stringify(['Q2']),
      JSON.stringify(teacherChanges),
    )

    const pupilFile = path.join(PDF_DIR, `pupil-${tag}.pdf`)
    const pupilElement = createElement(AssessmentPaperFeedbackDocument, { data: pupilData }) as unknown as ReactElement<DocumentProps>
    await writeFile(pupilFile, await renderToBuffer(pupilElement))
    const pupilText = (await execFileAsync('pdftotext', ['-layout', pupilFile, '-'])).stdout
    check('the pupil\'s own PDF shows no AI marks', !/\bAI\b/.test(pupilText) && !/teacher changes/i.test(pupilText) && /5\s*\/\s*6 marks/.test(pupilText))
    await rm(pupilFile, { force: true })

    // --- The class PDF ----------------------------------------------------------
    const { data, buffer } = await renderClassFeedbackPdf(PAPER, GROUP)
    const cover = data.roster.map((r) => `${r.status}|${r.aiMarks ?? '-'}|${r.marksAwarded ?? '-'}|${r.change ?? '-'}`)
    check(
      'cover rows: AI mark, final mark and change',
      JSON.stringify(cover) === JSON.stringify(['marked|4|5|1', 'marked|2|2|0', 'marked|-|3|-', 'not sat|-|-|-']),
      JSON.stringify(cover),
    )
    check('cover summary: 1 of 2 changed, net +1', JSON.stringify(data.changes) === JSON.stringify({ comparable: 2, changed: 1, net: 1 }), JSON.stringify(data.changes))

    const file = path.join(PDF_DIR, `class-${tag}.pdf`)
    await writeFile(file, buffer)
    const coverText = await pageText(file, 1)
    check('cover headings', ['AI MARK', 'FINAL MARK', 'CHANGE', 'STATUS'].every((s) => coverText.includes(s)))
    check('cover summary line', coverText.includes('Teacher changed marks for 1 of 2 AI-marked pupils; net change +1 mark.'))
    const lines = coverText.split('\n')
    const lineOf = (name: string) => lines.find((l) => l.includes(name)) ?? ''
    check('cover row of the changed pupil', /4\s*\/\s*6\s+5\s*\/\s*6\s+\+1\s+Marked/.test(lineOf('Ann Aaa')), lineOf('Ann Aaa').replace(/Ann Aaa/, '<name>'))
    check('cover row of the unchanged pupil', /2\s*\/\s*6\s+2\s*\/\s*6\s+0\s+Marked/.test(lineOf('Bob Bbb')))
    check('cover row of the legacy pupil shows — for AI mark and change', /—\s+3\s*\/\s*6\s+—\s+Marked/.test(lineOf('Cat Ccc')))
    const changedPage = await pageText(file, 2)
    check('changed pupil\'s box', changedPage.includes('TEACHER CHANGES') && changedPage.includes('Q1: AI 3/4 -> Teacher 4/4') && changedPage.includes('Marked by the teacher alone') && changedPage.includes('Q2'))
    const unchangedPage = await pageText(file, 3)
    check('unchanged pupil\'s box', unchangedPage.includes('TEACHER CHANGES') && unchangedPage.includes('No changes to the AI\'s marks.'))
    const legacyPage = await pageText(file, 4)
    check('legacy pupil has no box', legacyPage.includes('Cat Ccc') && !legacyPage.includes('TEACHER CHANGES'))
    await rm(file, { force: true })

    // --- A change of allocations moves ai_awarded with awarded -----------------
    await setAssessmentQuestions(PAPER, [
      { label: 'Q1', maxMarks: 4, markScheme: 'Strong (1). Light (3).', criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 3 }] },
      { label: 'Q2', maxMarks: 2, criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
    ])
    row = await rowsOf(unchanged)
    check('a new allocation caps ai_awarded like awarded', row(q1.questionId, A)?.awarded === 1 && row(q1.questionId, A)?.ai_awarded === 1)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from units where unit_id = $1)
          + (select count(*) from groups where group_id = $2)
          + (select count(*) from profiles where user_id = any($3::text[]))
          + (select count(*) from activities where activity_id = $4) as left`,
    [UNIT, GROUP, PEOPLE, PAPER],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
