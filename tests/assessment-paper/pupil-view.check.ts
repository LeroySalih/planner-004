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
  ASSESSMENT_SCRIPTS_BUCKET,
  pupilMayOpenAssessmentPaperFile,
  storePaperFile,
  storeScript,
} from '@/lib/assessment-paper/files'
import {
  setAssessmentQuestions,
  setTeacherQuestionCriterionComment,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import { readPupilAssessmentPaperView } from '@/lib/assessment-paper/results'
import { mayDownloadAssessmentFeedback, readAssessmentFeedbackPdfData } from '@/lib/assessment-paper/feedback-pdf'
import { AssessmentPaperFeedbackDocument } from '@/components/pdf/assessment-paper-feedback-document'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { pagesToPdf, syntheticFrontSheet, syntheticQuestionPage } from './synthetic-front-sheet'

// What a pupil sees of an assessment paper (plan, Marking v2 section 6): the
// file access rules for the question paper, mark scheme, markable pages and
// their own script, the lesson-page view, and the feedback PDF for a v2
// submission with a sketch answer and for a folded legacy submission. No
// model is called: the read and marks are written directly. Creates its own
// unit, intervention lesson, two pupils and activity, and removes them and
// every file it stored. Only reads the folded papers. Never prints names.
// Run as the files owner (1001:999), with DATABASE_URL set, where poppler and
// sharp are installed: npx tsx tests/assessment-paper/pupil-view.check.ts [pdf-dir]

const execFileAsync = promisify(execFile)

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const PDF_DIR = process.argv[2] || path.join(process.cwd(), 'tmp-pupil-view-check')
const tag = randomUUID().slice(0, 8)
const UNIT = `pv-check-unit-${tag}`
const LESSON = `pv-check-lesson-${tag}`
const PUPIL = `pv-check-pupil-${tag}`
const OTHER = `pv-check-other-${tag}`
const ACTIVITY = randomUUID()

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'View', 'Check'), ($2, 'Other', 'Check')", [PUPIL, OTHER])
  await query("insert into units (unit_id, title, subject) values ($1, 'Pupil view check', $2)", [UNIT, subject])
  await query("insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Pupil view check', 0, 'intervention')", [LESSON, UNIT])
  await query("insert into intervention_assignments (lesson_id, pupil_id, reason, feedback_visible) values ($1, $2, 'pupil view check', false)", [LESSON, PUPIL])
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'assessment-paper', 'Pupil view check', '{}'::jsonb, 0)",
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
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [[PUPIL, OTHER]])
  await query('delete from submissions where user_id = any($1::text[])', [[PUPIL, OTHER]])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = any($1::text[])', [[PUPIL, OTHER]])
}

/** Close the read job storeScript queued before any running worker takes it. */
async function dropJobs(submissionId: string) {
  await query("delete from external_jobs where payload->>'submissionId' = $1", [submissionId])
}

async function renderPdf(activityId: string, pupilId: string, fileName: string) {
  const data = await readAssessmentFeedbackPdfData(activityId, pupilId)
  const element = createElement(AssessmentPaperFeedbackDocument, { data }) as unknown as ReactElement<DocumentProps>
  const buffer = await renderToBuffer(element)
  const file = path.join(PDF_DIR, fileName)
  await writeFile(file, buffer)
  const info = await execFileAsync('pdfinfo', [file])
  const pages = Number.parseInt(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? '0', 10)
  const text = (await execFileAsync('pdftotext', ['-layout', file, '-'])).stdout
  const images = (await execFileAsync('pdfimages', ['-list', file])).stdout.trim().split('\n').length - 2
  return { data, file, pages, text, images }
}

const segs = (p: string) => p.split('/')

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
    const paper = await pagesToPdf([await syntheticFrontSheet(false, false), await syntheticQuestionPage(2, false, false), await syntheticQuestionPage(3, false, false)])
    await storePaperFile(ACTIVITY, 'question_paper', paper)
    await storePaperFile(ACTIVITY, 'mark_scheme', paper)
    const { rows: [{ body_data: body }] } = await query<{ body_data: { questionPaperPath: string; markSchemePath: string } }>(
      'select body_data from activities where activity_id = $1', [ACTIVITY],
    )
    const qp = segs(body.questionPaperPath)
    const ms = segs(body.markSchemePath)

    const saved = await setAssessmentQuestions(ACTIVITY, [
      { label: '1', maxMarks: 2, questionText: 'Explain why aluminium is used.', markScheme: 'Strong (1). Light (1).', criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }] },
      { label: '2', maxMarks: 1, questionText: 'Name a metal.', markScheme: 'Any metal (1).', criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
      { label: '3', maxMarks: 2, questionText: 'Sketch a cube with a cylinder on top.', markScheme: 'Cylinder on the top face (1). Hidden detail (1).', criteria: [{ successCriteriaId: B, maxMarks: 2 }] },
    ])
    const id = Object.fromEntries(saved.map((q) => [q.label, q.questionId]))

    // --- Before the script is uploaded -----------------------------------------
    check('before upload: the question paper is refused', !(await pupilMayOpenAssessmentPaperFile(PUPIL, qp)))
    check('before upload: the mark scheme is refused', !(await pupilMayOpenAssessmentPaperFile(PUPIL, ms)))
    check('before upload: no feedback PDF', !(await mayDownloadAssessmentFeedback({ userId: PUPIL, isTeacher: false }, ACTIVITY, PUPIL)))
    const before = await readPupilAssessmentPaperView(ACTIVITY, PUPIL, false)
    check('before upload: the page shows nothing but the title', !before.sat && before.questionPaperUrl === null && before.feedback === null)

    // --- Script uploaded, feedback off -----------------------------------------
    const stored = await storeScript({
      activityId: ACTIVITY,
      pupilId: PUPIL,
      bytes: await pagesToPdf([await syntheticFrontSheet(true, true), await syntheticQuestionPage(2, true, true), await syntheticQuestionPage(3, true, true)]),
    })
    const sub = stored.submission_id
    await dropJobs(sub)
    const { rows: [script] } = await query<{ original_path: string; page_paths: string[] }>(
      'select original_path, page_paths from assessment_scripts where script_id = $1::uuid', [stored.script_id],
    )
    check('the script passed the front sheet check', script.page_paths.length === 2, JSON.stringify(stored))

    check('uploaded: the question paper opens', await pupilMayOpenAssessmentPaperFile(PUPIL, qp))
    check('uploaded: the mark scheme is still refused', !(await pupilMayOpenAssessmentPaperFile(PUPIL, ms)))
    check('uploaded, feedback off: their own script is refused', !(await pupilMayOpenAssessmentPaperFile(PUPIL, segs(script.original_path))))
    check('uploaded, feedback off: no feedback PDF', !(await mayDownloadAssessmentFeedback({ userId: PUPIL, isTeacher: false }, ACTIVITY, PUPIL)))
    const off = await readPupilAssessmentPaperView(ACTIVITY, PUPIL, false)
    check('uploaded, feedback off: the page shows the question paper only', off.sat && off.questionPaperUrl !== null && off.feedback === null)
    check('a path that only looks like the question paper is refused', !(await pupilMayOpenAssessmentPaperFile(PUPIL, [ACTIVITY, 'paper', 'mark-scheme.pdf'])) && !(await pupilMayOpenAssessmentPaperFile(PUPIL, [...qp, 'x'])))

    // --- The other pupil -------------------------------------------------------
    check('another pupil: the question paper is refused', !(await pupilMayOpenAssessmentPaperFile(OTHER, qp)))
    check('another pupil: the script is refused', !(await pupilMayOpenAssessmentPaperFile(OTHER, segs(script.original_path))))

    // --- Read and marks, written directly (no model) ---------------------------
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance) values
         ($1, $2, 'text', 'It is strong and light', '{2}', 'answered', 'ai'),
         ($1, $3, 'text', '', '{}', 'blank', 'ai'),
         ($1, $4, 'sketch', 'A cube with a cylinder on top', '{3}', 'answered', 'ai')`,
      [sub, id['1'], id['2'], id['3']],
    )
    await setTeacherQuestionCriterionMark(sub, id['1'], A, 1)
    await setTeacherQuestionCriterionMark(sub, id['1'], B, 0)
    await setTeacherQuestionCriterionComment(sub, id['1'], B, 'Say why lightness matters for a boat.')
    await setTeacherQuestionCriterionMark(sub, id['2'], A, 0)
    await setTeacherQuestionCriterionMark(sub, id['3'], B, 1)
    // A model's comment, kept as the marker's: it shows when no teacher comment overrides it.
    await query(
      `update submission_question_criterion_marks set provenance = 'ai', why_not_awarded = 'No hidden detail shown.',
              how_to_improve = 'Draw hidden edges as dashed lines.'
        where submission_id = $1 and question_id = $2`,
      [sub, id['3']],
    )

    // --- Feedback on -----------------------------------------------------------
    await query('update intervention_assignments set feedback_visible = true where lesson_id = $1 and pupil_id = $2', [LESSON, PUPIL])
    check('feedback on: their own script opens', await pupilMayOpenAssessmentPaperFile(PUPIL, segs(script.original_path)))
    check('feedback on: the mark scheme is still refused', !(await pupilMayOpenAssessmentPaperFile(PUPIL, ms)))
    check('feedback on: a markable page is refused', !(await pupilMayOpenAssessmentPaperFile(PUPIL, segs(script.page_paths[0]))))
    check('feedback on: the pupil may download their feedback', await mayDownloadAssessmentFeedback({ userId: PUPIL, isTeacher: false }, ACTIVITY, PUPIL))
    check('another pupil may not download it', !(await mayDownloadAssessmentFeedback({ userId: OTHER, isTeacher: false }, ACTIVITY, PUPIL)))
    check('another pupil: the script is still refused', !(await pupilMayOpenAssessmentPaperFile(OTHER, segs(script.original_path))))
    check('a teacher may download any pupil\'s', await mayDownloadAssessmentFeedback({ userId: OTHER, isTeacher: true }, ACTIVITY, PUPIL))
    const on = await readPupilAssessmentPaperView(ACTIVITY, PUPIL, false)
    check(
      'feedback on: the page shows the paper, 2 / 5, the PDF and the script',
      on.questionPaperUrl !== null && on.feedback?.marksAwarded === 2 && on.feedback.maxMarks === 5 &&
        Boolean(on.feedback.feedbackPdfUrl) && on.feedback.scriptUrl !== null,
      JSON.stringify(on.feedback),
    )

    // --- The v2 feedback PDF ---------------------------------------------------
    const v2 = await renderPdf(ACTIVITY, PUPIL, `v2-${tag}.pdf`)
    check('v2 PDF builds', v2.pages > 0, String(v2.pages))
    check('v2 PDF: overall marks', /2 \/ 5 marks/.test(v2.text))
    const row = (text: string, label: string) => text.search(new RegExp(`(^|\\n)\\s*${label.replace(/[()]/g, '\\$&')}\\s`))
    check('v2 PDF: a table row per question, in paper order', row(v2.text, '1') >= 0 && row(v2.text, '1') < row(v2.text, '2') && row(v2.text, '2') < row(v2.text, '3'))
    check('v2 PDF: the transcription', v2.text.includes('It is strong and light'))
    check('v2 PDF: a blank answer says so', v2.text.includes('No answer submitted'))
    check('v2 PDF: the teacher comment wins', v2.text.includes('Say why lightness matters'))
    check('v2 PDF: how to improve, without why marks were lost', !v2.text.includes('No hidden detail shown.') && v2.text.includes('Draw hidden edges'))
    check('v2 PDF: the mark scheme', v2.text.includes('Cylinder on the top face'))
    check('v2 PDF: one image, the sketch\'s markable page', v2.images === 1 && v2.data.questions[2].answer?.images[0]?.pageNumber === 3, String(v2.images))

    await query("update activities set body_data = body_data || '{\"showMarkSchemeToPupils\": false}'::jsonb where activity_id = $1", [ACTIVITY])
    const hidden = await renderPdf(ACTIVITY, PUPIL, `v2-no-scheme-${tag}.pdf`)
    check('v2 PDF: the mark scheme is left out when the paper says so', hidden.pages > 0 && !hidden.text.includes('Cylinder on the top face') && !hidden.text.includes('Mark scheme'))

    // --- A folded legacy submission (read only) --------------------------------
    const { rows: folded } = await query<{ activity_id: string; user_id: string }>(
      `select s.activity_id, s.user_id from submissions s join activities a on a.activity_id = s.activity_id
        where a.type = 'assessment-paper' and a.body_data ? 'foldedFromAssessmentIds'
          and exists (select 1 from submission_question_marks m where m.submission_id = s.submission_id)
        order by s.submitted_at desc nulls last limit 1`,
    )
    if (!folded[0]) {
      check('a folded submission to test with', false, 'none on this database')
    } else {
      const legacy = await renderPdf(folded[0].activity_id, folded[0].user_id, `folded-${tag}.pdf`)
      check('folded PDF builds', legacy.pages > 0, String(legacy.pages))
      check('folded PDF: marks and feedback only, no answers or images', legacy.data.folded && legacy.data.questions.every((q) => q.answer === null) && legacy.images === 0)
      check('folded PDF: every question', legacy.data.questions.length > 0 && legacy.data.questions.every((q) => row(legacy.text, q.label) >= 0))
      const view = await readPupilAssessmentPaperView(folded[0].activity_id, folded[0].user_id, true)
      check('folded: a pupil with a result has sat it', view.sat)
      // It names a real pupil: do not keep it.
      await rm(legacy.file, { force: true })
    }
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    "select (select count(*) from stored_files where scope_path like $1) + (select count(*) from units where unit_id = $2) + (select count(*) from profiles where user_id = any($3::text[])) + (select count(*) from activities where activity_id = $4) as left",
    [`${ACTIVITY}%`, UNIT, [PUPIL, OTHER], ACTIVITY],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
