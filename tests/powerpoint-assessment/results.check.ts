import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createElement, type ReactElement } from 'react'

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { Document, Packer, Paragraph } from 'docx'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { mayDownloadAssessmentFeedback, readAssessmentFeedbackPdfData } from '@/lib/assessment-paper/feedback-pdf'
import { readClassFeedbackPdfData, renderClassFeedbackPdf } from '@/lib/assessment-paper/class-feedback-pdf'
import { readAssessmentPaperResult } from '@/lib/assessment-paper/results'
import { readAssessmentPaperSetup } from '@/lib/assessment-paper/setup'
import {
  listHeldQuestionsToSend,
  queueHeldAssessmentQuestions,
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import { enqueueMarkingTasks } from '@/lib/ai/marking-queue'
import {
  LESSONS_BUCKET,
  NOT_HANDED_IN_FOR_MARKING_MESSAGE,
  handInPowerPointAssessment,
  listPracticalFiles,
  listUnmarkedPowerPointSubmissions,
  powerPointNotQueuedReason,
  storePracticalFile,
} from '@/lib/powerpoint-assessment/files'
import { readPupilPowerPointView } from '@/lib/powerpoint-assessment/pupil-view'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { AssessmentPaperFeedbackDocument } from '@/components/pdf/assessment-paper-feedback-document'

// A PowerPoint assessment on the teacher's results page and in the feedback
// PDFs: the result carries the pupil's files (no script), what the reader
// noticed, and per task the evidence sources, the pictures the marker was
// given (screenshots under its headings, its rendered slides) and the
// marker's note, all teacher-only. The pupil's feedback PDF carries marks,
// comments and typed answers only: no digest, no evidence, no marker's note,
// no AI mark. The class PDF's roster reads "not sat" as not handed in and
// "held" as stopped with a reason. Held questions and unmarked work are
// picked per type. A pupil downloads their own PDF only once handed in and
// released. The reader's output is written as the reader writes it; no
// model is called. Creates its own unit, lesson, activity, class and pupils,
// and removes all of it.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty, poppler-utils installed):
//   npx tsx tests/powerpoint-assessment/results.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const execFileAsync = promisify(execFile)
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-res-check-unit-${tag}`
const LESSON = `ppt-res-check-lesson-${tag}`
const PPT = randomUUID()
const GROUP = `ppt-res-check-group-${tag}`
const MARKED = `ppt-res-check-marked-${tag}`
const UPLOADED = `ppt-res-check-uploaded-${tag}`
const HELD = `ppt-res-check-held-${tag}`
const UNMARKED = `ppt-res-check-unmarked-${tag}`
const ABSENT = `ppt-res-check-absent-${tag}`
const TEACHER = `ppt-res-check-teacher-${tag}`
const PUPILS = [MARKED, UPLOADED, HELD, UNMARKED, ABSENT]

const SLOTS = [
  { key: 'presentation', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'handouts', label: 'Handouts printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true },
]

const SECRETS = {
  digest: 'SECRET-DIGEST-TEXT',
  markerEvidence: 'SECRET-MARKER-EVIDENCE',
  markError: 'SECRET-MARK-ERROR',
}
const TYPED = 'My typed answer for S1'

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  const names = [['Ann', 'Aaa'], ['Ben', 'Bbb'], ['Cat', 'Ccc'], ['Dan', 'Ddd'], ['Eve', 'Eee']]
  for (const [index, id] of PUPILS.entries()) {
    await query('insert into profiles (user_id, first_name, last_name) values ($1, $2, $3)', [id, ...names[index]])
    await query("insert into user_roles (user_id, role_id) values ($1, 'pupil')", [id])
  }
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Tia', 'Ttt')", [TEACHER])
  await query("insert into user_roles (user_id, role_id) values ($1, 'teacher')", [TEACHER])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint results unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint results check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Kiosk task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  for (const id of PUPILS) await query('insert into group_membership (group_id, user_id) values ($1, $2)', [GROUP, id])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  for (const [bucket, prefix] of [[ASSESSMENT_SCRIPTS_BUCKET, PPT], [LESSONS_BUCKET, `lessons/${LESSON}/`]] as const) {
    const { rows } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [bucket, `${prefix}%`],
    )
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, PPT), { recursive: true, force: true })
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, 'lessons', LESSON), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where activity_id = $1)", [PPT])
  await query('delete from submissions where activity_id = $1', [PPT])
  await query('delete from pupil_activity_feedback where activity_id = $1', [PPT]).catch(() => {})
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = any($1::text[])', [[...PUPILS, TEACHER]])
  await query('delete from profiles where user_id = any($1::text[])', [[...PUPILS, TEACHER]])
}

async function docxBytes(text: string) {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] })))
}

async function pdfText(buffer: Buffer, page?: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ppt-res-'))
  try {
    const file = path.join(dir, 'out.pdf')
    await writeFile(file, buffer)
    const range = page ? ['-f', String(page), '-l', String(page)] : []
    return (await execFileAsync('pdftotext', [...range, '-layout', file, '-'])).stdout
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function handIn(pupilId: string, pptx: Buffer) {
  await storePracticalFile({ activityId: PPT, pupilId, slotKey: 'presentation', bytes: pptx, originalName: 'Kiosk.pptx', uploadedBy: pupilId })
  await storePracticalFile({ activityId: PPT, pupilId, slotKey: 'evidence', bytes: await docxBytes('T2'), originalName: 'Evidence.docx', uploadedBy: pupilId })
  const { submissionId } = await handInPowerPointAssessment(PPT, pupilId, { userId: pupilId, isTeacher: false })
  // The read the hand-in queued is the reader's job, not this check's.
  await query("delete from external_jobs where payload->>'submissionId' = $1", [submissionId])
  return submissionId
}

/** The evidence rows the reader writes, with pictures at the paths it uses. */
async function writeEvidence(submissionId: string) {
  const files = await listPracticalFiles(submissionId)
  const pptxFile = files.find((f) => f.slot_key === 'presentation')!
  const docxFile = files.find((f) => f.slot_key === 'evidence')!
  const folder = (fileId: string) => `${PPT}/practical/${fileId}/evidence`
  const picture = (p: string) => ({ path: p, name: 'image1.png', mimeType: 'image/png', width: 800, height: 600, bytes: 1000 })
  const slide = (n: number) => ({ slide: n, path: `${folder(pptxFile.file_id)}/slide-${n}.png`, mimeType: 'image/png', width: 1600, height: 900, bytes: 2000 })
  await query(
    `insert into practical_submission_evidence (file_id, submission_id, slot_key, kind, status, cache_key, report, description)
     values ($1::uuid, $2, 'presentation', 'presentation', 'ok', 'check', $3::jsonb, 'description')`,
    [pptxFile.file_id, submissionId, JSON.stringify({
      presentation: { slideCount: 2 },
      warnings: ['PPT-WARNING'],
      slideImages: { status: 'ok', slideCount: 2, notRendered: [], images: [slide(1), slide(2)] },
    })],
  )
  await query(
    `insert into practical_submission_evidence (file_id, submission_id, slot_key, kind, status, cache_key, report)
     values ($1::uuid, $2, 'evidence', 'evidence_doc', 'ok', 'check', $3::jsonb)`,
    [docxFile.file_id, submissionId, JSON.stringify({
      sections: [
        { label: 'T2', heading: 'T2', text: '', images: [picture(`${folder(docxFile.file_id)}/t2-1.png`)], notShown: [] },
        { label: 'S1', heading: 'S1', text: TYPED, images: [], notShown: [] },
      ],
      unplaced: { text: '', images: [picture(`${folder(docxFile.file_id)}/_unplaced-1.png`)], notShown: [] },
      missingHeadings: ['T9', 'NOT-READ-BY-ANY-QUESTION'],
      warnings: ['DOC-WARNING'],
      template: null,
    })],
  )
  return { pptxFile, docxFile }
}

async function main() {
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)

  await setUp()
  try {
    const [t1, t2, t3, t4, t5] = await setAssessmentQuestions(PPT, [
      {
        label: 'T1', maxMarks: 2, questionText: 'Create a title slide.', markScheme: 'MS-T1',
        evidence: [
          { source: 'presentation', slot: 'presentation', sections: ['slides'] },
          { source: 'slide_images', slot: 'presentation', slides: [1] },
        ],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }],
      },
      {
        label: 'T2', maxMarks: 1, markScheme: 'MS-T2',
        evidence: [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      },
      {
        label: 'T3', maxMarks: 1, markScheme: 'MS-T3',
        evidence: [{ source: 'evidence_section', slot: 'evidence', heading: 'S1', want: 'text', required: true }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      },
      {
        label: 'T4', maxMarks: 1, markScheme: null,
        evidence: [{ source: 'evidence_section', slot: 'evidence', heading: 'T9', want: 'both' }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      },
      {
        label: 'T5', maxMarks: 1, markScheme: 'MS-T5',
        evidence: [{ source: 'presentation', slot: 'presentation', sections: ['slides:3'], required: true }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      },
    ])

    // --- Four pupils' work in four states; one pupil has nothing ------------------
    const marked = await handIn(MARKED, pptx)
    const held = await handIn(HELD, pptx)
    const unmarked = await handIn(UNMARKED, pptx)
    await storePracticalFile({ activityId: PPT, pupilId: UPLOADED, slotKey: 'presentation', bytes: pptx, originalName: 'Kiosk.pptx', uploadedBy: UPLOADED })
    const { rows: [{ submission_id: uploaded }] } = await query<{ submission_id: string }>(
      'select submission_id from submissions where activity_id = $1 and user_id = $2', [PPT, UPLOADED])

    // Marked: the reader's evidence and answers, the marker's rows, then a teacher's change.
    const { docxFile } = await writeEvidence(marked)
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance, marker_evidence)
       values ($1, $2, 'mixed', $7, '{}', 'answered', 'ai', $8),
              ($1, $3, 'mixed', $7, '{}', 'answered', 'ai', $8),
              ($1, $4, 'text', $9, '{}', 'answered', 'ai', null),
              ($1, $5, 'mixed', $7, '{}', 'answered', 'ai', null),
              ($1, $6, 'mixed', $7, '{}', 'blank', 'ai', null)`,
      [marked, t1.questionId, t2.questionId, t3.questionId, t4.questionId, t5.questionId, SECRETS.digest, SECRETS.markerEvidence, TYPED],
    )
    await recordQuestionCriterionMarks(marked, [
      { questionId: t1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'AI-HOW-T1A' },
      { questionId: t1.questionId, successCriteriaId: B, awarded: 0, whyNotAwarded: 'AI-WHY-T1B', howToImprove: 'AI-HOW-T1B' },
      { questionId: t2.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'AI-HOW-T2A' },
      { questionId: t3.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: null },
      { questionId: t5.questionId, successCriteriaId: A, awarded: 0, whyNotAwarded: 'No answer submitted', howToImprove: null },
    ], 'ai')
    await setTeacherQuestionCriterionMark(marked, t1.questionId, B, 1, 'TEACHER-T1B')
    await query("update submissions set mark_status = 'marked', mark_error = null where submission_id = $1", [marked])

    // Held: the reader refused the evidence document.
    const heldFiles = await listPracticalFiles(held)
    await query(
      `insert into practical_submission_evidence (file_id, submission_id, slot_key, kind, status, error, cache_key)
       values ($1::uuid, $2, 'evidence', 'evidence_doc', 'error', 'This Word file is damaged.', 'check')`,
      [heldFiles.find((f) => f.slot_key === 'evidence')!.file_id, held],
    )
    await query('update submissions set mark_status = null, mark_error = $2 where submission_id = $1', [held, `Not marked: ${SECRETS.markError}`])
    // An answer row on held and on not-handed-in work, so only the type's rule keeps them out of "held to send".
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance)
       values ($1, $3, 'mixed', 'x', '{}', 'answered', 'ai'), ($2, $3, 'mixed', 'x', '{}', 'answered', 'ai')`,
      [held, uploaded, t4.questionId],
    )

    // --- The teacher's result -----------------------------------------------------
    const result = await readAssessmentPaperResult(PPT, MARKED)
    check('no script on a PowerPoint assessment', result.script === null)
    const files = result.powerpoint
    check('the pupil\'s files instead', files !== null && files.handedIn)
    check('one entry per upload slot, in slot order', files?.files.map((f) => f.slotKey).join('|') === 'presentation|handouts|evidence', files?.files.map((f) => f.slotKey).join('|'))
    const presentation = files?.files.find((f) => f.slotKey === 'presentation')
    check('a handed-in file: name, link, time, reader status', presentation?.name === 'Kiosk.pptx' && presentation.url?.startsWith(`/api/files/${ASSESSMENT_SCRIPTS_BUCKET}/${PPT}/practical/`) === true && Boolean(presentation.uploadedAt) && presentation.evidenceStatus === 'ok' && presentation.required, JSON.stringify(presentation))
    const handouts = files?.files.find((f) => f.slotKey === 'handouts')
    check('an empty slot', handouts?.name === null && handouts.url === null && handouts.evidenceStatus === null && !handouts.required, JSON.stringify(handouts))
    check('missing headings: only those a question reads', files?.missingHeadings.join('|') === 'T9', files?.missingHeadings.join('|'))
    check('warnings name their slot', files?.warnings.includes('Presentation: PPT-WARNING') === true && files.warnings.includes('Evidence document: DOC-WARNING'), JSON.stringify(files?.warnings))
    check('pictures outside every heading are listed for the teacher', files?.unplacedImages.length === 1 && files.unplacedImages[0].url.endsWith('/_unplaced-1.png'), JSON.stringify(files?.unplacedImages))

    const q = (label: string) => result.questions.find((x) => x.label === label)!
    check('evidence sources per task', q('T1').evidenceSources.length === 2 && q('T1').evidenceSources[1].source === 'slide_images')
    check('T1: the rendered slide it reads, and only that one', q('T1').evidenceImages.length === 1 && q('T1').evidenceImages[0].url.endsWith('/slide-1.png') && q('T1').evidenceImages[0].caption === 'Slide 1', JSON.stringify(q('T1').evidenceImages))
    check('T2: the screenshot under its heading', q('T2').evidenceImages.length === 1 && q('T2').evidenceImages[0].url.endsWith(`/${docxFile.file_id}/evidence/t2-1.png`) && q('T2').evidenceImages[0].caption === 'T2, screenshot 1', JSON.stringify(q('T2').evidenceImages))
    check('T3 (typed text): no pictures', q('T3').evidenceImages.length === 0)
    check('evidence pictures are teacher-only /api/files links', [...q('T1').evidenceImages, ...q('T2').evidenceImages].every((im) => im.url.startsWith(`/api/files/${ASSESSMENT_SCRIPTS_BUCKET}/${PPT}/practical/`) && im.url.includes('/evidence/')))
    check('the marker\'s note for the teacher', q('T1').markerEvidence === SECRETS.markerEvidence && q('T3').markerEvidence === null)
    check('the AI\'s own mark beside the teacher\'s', q('T1').criteria.find((c) => c.successCriteriaId === B)?.aiAwarded === 0 && q('T1').criteria.find((c) => c.successCriteriaId === B)?.awarded === 1)
    check('totals', result.marksAwarded === 4 && result.maxMarks === 6, `${result.marksAwarded}/${result.maxMarks}`)

    const empty = await readAssessmentPaperResult(PPT, ABSENT)
    check('a pupil with nothing: every slot empty, not handed in', empty.powerpoint !== null && !empty.powerpoint.handedIn && empty.powerpoint.files.every((f) => f.name === null) && empty.questions.every((x) => x.evidenceImages.length === 0 && x.markerEvidence === null))
    const notHandedIn = await readAssessmentPaperResult(PPT, UPLOADED)
    check('uploaded but not handed in', notHandedIn.powerpoint?.handedIn === false && notHandedIn.powerpoint.files.find((f) => f.slotKey === 'presentation')?.name === 'Kiosk.pptx')
    const heldResult = await readAssessmentPaperResult(PPT, HELD)
    check('a file the reader refused shows its error', heldResult.powerpoint?.files.find((f) => f.slotKey === 'evidence')?.evidenceError === 'This Word file is damaged.' && heldResult.markStatus === null && Boolean(heldResult.markError))

    // --- The pupil's feedback PDF -------------------------------------------------
    const pdfData = await readAssessmentFeedbackPdfData(PPT, MARKED)
    const pdfJson = JSON.stringify(pdfData)
    check('feedback PDF data: PowerPoint, no script pictures', pdfData.powerPoint && pdfData.questions.every((x) => (x.answer?.images.length ?? 0) === 0))
    check('…no reader digest, marker\'s note or evidence', !pdfJson.includes(SECRETS.digest) && !pdfJson.includes(SECRETS.markerEvidence) && !pdfJson.includes('/practical/') && !['"evidenceSources"', '"evidenceImages"', '"markerEvidence"', '"powerpoint"'].some((key) => pdfJson.includes(key)), pdfJson.slice(0, 300))
    check('…no AI mark beside the teacher\'s', !('teacherChanges' in pdfData) && !pdfJson.includes('aiAwarded'))
    const pdfQ = (label: string) => pdfData.questions.find((x) => x.label === label)!
    check('…a typed answer is the pupil\'s answer', pdfQ('T3').answer?.transcription === TYPED)
    check('…a task read from files has no answer text', pdfQ('T1').answer === null && pdfQ('T2').answer === null)
    const blank = pdfQ('T5').answer
    check('…a blank task says so', blank?.status === 'blank' && blank.transcription === null)
    check('…the teacher\'s comment wins', JSON.stringify(pdfQ('T1').criteria).includes('TEACHER-T1B') && !JSON.stringify(pdfQ('T1').criteria).includes('AI-WHY-T1B'))
    const teacherCopy = await readAssessmentFeedbackPdfData(PPT, MARKED, { teacherCopy: true })
    check('the teacher copy has the AI-against-teacher marks', teacherCopy.teacherChanges?.recorded === true && teacherCopy.teacherChanges.change === 1, JSON.stringify(teacherCopy.teacherChanges))

    const pupilPdf = await renderToBuffer(createElement(AssessmentPaperFeedbackDocument, { data: pdfData }) as unknown as ReactElement<DocumentProps>)
    const pupilText = await pdfText(Buffer.from(pupilPdf))
    // Table cells wrap, so words are compared without the layout.
    const pupilWords = pupilText.replace(/\s+/g, ' ')
    check('the pupil\'s PDF renders', pupilWords.includes('Ann Aaa') && pupilWords.includes('In your files') && pupilWords.includes('TASK') && TYPED.split(' ').every((word) => pupilWords.includes(word)), pupilWords.slice(0, 600))
    check('…with nothing secret', !pupilText.includes(SECRETS.digest) && !pupilText.includes(SECRETS.markerEvidence))

    // --- The class PDF --------------------------------------------------------------
    const classData = await readClassFeedbackPdfData(PPT, GROUP)
    const status = Object.fromEntries(classData.roster.map((row) => [row.pupilName, row.status]))
    check('roster: marked', status['Ann Aaa'] === 'marked', JSON.stringify(status))
    check('roster: uploaded but not handed in is not sat', status['Ben Bbb'] === 'not sat')
    check('roster: stopped with a reason is held', status['Cat Ccc'] === 'held')
    check('roster: handed in, not marked yet', status['Dan Ddd'] === 'not yet marked')
    check('roster: nothing at all is not sat', status['Eve Eee'] === 'not sat')
    check('feedback pages only for handed-in pupils', classData.pupils.map((p) => p.pupilName).join('|') === 'Ann Aaa|Cat Ccc|Dan Ddd', classData.pupils.map((p) => p.pupilName).join('|'))
    check('the class PDF carries the AI\'s marks (teacher copy)', classData.roster.find((r) => r.pupilName === 'Ann Aaa')?.aiMarks === 3)
    const classPdf = await renderClassFeedbackPdf(PPT, GROUP)
    const cover = await pdfText(classPdf.buffer, 1)
    check('the cover says Not handed in and Held, not front sheet', cover.includes('Not handed in') && /\bHeld\b/.test(cover) && !cover.includes('front sheet'), cover)
    const classText = await pdfText(classPdf.buffer)
    check('the class PDF shows no marker\'s note or digest', !classText.includes(SECRETS.markerEvidence) && !classText.includes(SECRETS.digest))

    // --- Held questions, per type -------------------------------------------------
    check('nothing held to send while T4 has no mark scheme', (await listHeldQuestionsToSend(PPT)).length === 0)
    await query("update activity_questions set mark_scheme = 'MS-T4' where question_id = $1", [t4.questionId])
    let heldToSend = await listHeldQuestionsToSend(PPT)
    check('T4 can be sent once it has a mark scheme, on the marked pupil\'s work only', heldToSend.length === 1 && heldToSend[0].submissionId === marked && heldToSend[0].questionId === t4.questionId, JSON.stringify(heldToSend))
    await query(
      "insert into external_jobs (job_type, payload) values ('ai_read', jsonb_build_object('submissionId', $1::text))",
      [marked],
    )
    check('…not while a read is open', (await listHeldQuestionsToSend(PPT)).length === 0)
    await query("delete from external_jobs where payload->>'submissionId' = $1", [marked])
    await query("update submission_question_answers set status = 'unreadable' where submission_id = $1 and question_id = $2", [marked, t4.questionId])
    check('…not an answer held for pictures DINO cannot show', (await listHeldQuestionsToSend(PPT)).length === 0)
    await query("update submission_question_answers set status = 'answered' where submission_id = $1 and question_id = $2", [marked, t4.questionId])
    const setup = await readAssessmentPaperSetup(PPT)
    check('the setup counts it', setup.heldToSend.questions === 1 && setup.heldToSend.pupils === 1, JSON.stringify(setup.heldToSend))
    const queued = await queueHeldAssessmentQuestions({ activityId: PPT, submissionId: marked, assignmentId: `${GROUP}__${LESSON}` })
    const { rows: jobs } = await query<{ question_id: string }>(
      "select payload->>'questionId' as question_id from external_jobs where job_type = 'ai_mark' and payload->>'submissionId' = $1", [marked])
    const { rows: [{ mark_status }] } = await query<{ mark_status: string | null }>('select mark_status from submissions where submission_id = $1', [marked])
    check('sending it queues one mark job and the work waits', queued.join() === t4.questionId && jobs.length === 1 && jobs[0].question_id === t4.questionId && mark_status === 'waiting', JSON.stringify({ queued, jobs, mark_status }))
    heldToSend = await listHeldQuestionsToSend(PPT)
    check('…and it is not offered again', heldToSend.length === 0)
    await query("delete from external_jobs where payload->>'submissionId' = $1", [marked])
    await query("update submissions set mark_status = 'marked' where submission_id = $1", [marked])

    // --- Unmarked work --------------------------------------------------------------
    const list = await listUnmarkedPowerPointSubmissions(PPT)
    check('unmarked: handed-in work with no rows and no job, readable', list.length === 1 && list[0].submissionId === unmarked && list[0].pupilId === UNMARKED, JSON.stringify(list))
    check('the setup counts it as unmarked', (await readAssessmentPaperSetup(PPT)).unmarkedScriptsCount === 1)
    await query(
      "insert into external_jobs (job_type, payload) values ('ai_read', jsonb_build_object('submissionId', $1::text))",
      [unmarked],
    )
    check('…not while its read is queued', (await listUnmarkedPowerPointSubmissions(PPT)).length === 0)
    await query("delete from external_jobs where payload->>'submissionId' = $1", [unmarked])
    await query('delete from practical_submission_files where submission_id = $1 and slot_key = $2', [unmarked, 'evidence'])
    check('…not with a required file missing', (await listUnmarkedPowerPointSubmissions(PPT)).length === 0)

    // --- Who may download a pupil's feedback PDF ------------------------------------
    const pupil = (id: string) => ({ userId: id, isTeacher: false })
    check('a teacher may, for any pupil', await mayDownloadAssessmentFeedback({ userId: TEACHER, isTeacher: true }, PPT, UPLOADED))
    check('a pupil may not before feedback is released', !(await mayDownloadAssessmentFeedback(pupil(MARKED), PPT, MARKED)))
    let view = await readPupilPowerPointView(PPT, MARKED, false)
    check('no PDF link before release', view.feedback === null)
    await query('update planner_assignments set feedback_visible = true where lesson_id = $1', [LESSON])
    check('a pupil may, for their own handed-in work, once released', await mayDownloadAssessmentFeedback(pupil(MARKED), PPT, MARKED))
    check('never another pupil\'s', !(await mayDownloadAssessmentFeedback(pupil(UPLOADED), PPT, MARKED)))
    check('not before handing in', !(await mayDownloadAssessmentFeedback(pupil(UPLOADED), PPT, UPLOADED)))
    check('not with no work at all', !(await mayDownloadAssessmentFeedback(pupil(ABSENT), PPT, ABSENT)))
    view = await readPupilPowerPointView(PPT, MARKED, false)
    check('the pupil view links the PDF once released', view.feedback?.feedbackPdfUrl === `/api/assessment-paper/${PPT}/feedback-pdf?pupilId=${MARKED}`, String(view.feedback?.feedbackPdfUrl))
    await query('update planner_assignments set locked = true where lesson_id = $1', [LESSON])
    check('a locked lesson blocks the download', !(await mayDownloadAssessmentFeedback(pupil(MARKED), PPT, MARKED)))
    view = await readPupilPowerPointView(PPT, MARKED, false)
    check('…and hides the link', view.feedback !== null && view.feedback.feedbackPdfUrl === null)
    await query('update planner_assignments set locked = false where lesson_id = $1', [LESSON])

    // --- The feedback PDF follows the pupil view: never while marking, held only with a teacher's mark
    await query("update submissions set mark_status = 'waiting' where submission_id = $1", [marked])
    check('no PDF while waiting to be marked', !(await mayDownloadAssessmentFeedback(pupil(MARKED), PPT, MARKED)))
    await query("update submissions set mark_status = 'marking' where submission_id = $1", [marked])
    check('…or while marking', !(await mayDownloadAssessmentFeedback(pupil(MARKED), PPT, MARKED)))
    await query("update submissions set mark_status = 'marked' where submission_id = $1", [marked])
    check('…and again once marked', await mayDownloadAssessmentFeedback(pupil(MARKED), PPT, MARKED))
    check('held work with no teacher\'s mark: no PDF', !(await mayDownloadAssessmentFeedback(pupil(HELD), PPT, HELD)))
    check('…and no feedback on the pupil view', (await readPupilPowerPointView(PPT, HELD, false)).feedback === null)
    check('…a teacher still may', await mayDownloadAssessmentFeedback({ userId: TEACHER, isTeacher: true }, PPT, HELD))
    await recordQuestionCriterionMarks(held, [
      { questionId: t2.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'AI-HOW-HELD-T2' },
    ], 'ai')
    check('…nor with only the marker\'s marks', !(await mayDownloadAssessmentFeedback(pupil(HELD), PPT, HELD)))
    await setTeacherQuestionCriterionMark(held, t3.questionId, A, 1, 'TEACHER-HELD-T3')
    await query('update submissions set mark_status = null, mark_error = $2 where submission_id = $1', [held, `Not marked: ${SECRETS.markError}`])
    check('held work with a teacher\'s mark: the pupil may download', await mayDownloadAssessmentFeedback(pupil(HELD), PPT, HELD))
    const heldPdf = await readAssessmentFeedbackPdfData(PPT, HELD)
    const heldPdfQ = (label: string) => heldPdf.questions.find((x) => x.label === label)!
    check('…the teacher\'s question is in it', heldPdfQ('T3').awarded === 1 && JSON.stringify(heldPdfQ('T3').criteria).includes('TEACHER-HELD-T3'), JSON.stringify(heldPdfQ('T3')))
    check('…the marker\'s question is not', heldPdfQ('T2').awarded === null && heldPdfQ('T2').criteria.every((c) => c.awarded === null && c.feedback === null) && !JSON.stringify(heldPdf).includes('AI-HOW-HELD-T2'), JSON.stringify(heldPdfQ('T2')))
    check('…and its total counts only what is shown', heldPdf.marksAwarded === 1, String(heldPdf.marksAwarded))
    const heldView = await readPupilPowerPointView(PPT, HELD, false)
    check('…as the pupil view shows it', heldView.feedback?.marksAwarded === 1 && heldView.feedback.questions.find((x) => x.label === 'T2')?.awarded === null && heldView.feedback.questions.find((x) => x.label === 'T3')?.awarded === 1, JSON.stringify(heldView.feedback))
    const heldTeacherCopy = await readAssessmentFeedbackPdfData(PPT, HELD, { teacherCopy: true })
    check('…the teacher copy shows the marker\'s marks too', heldTeacherCopy.questions.find((x) => x.label === 'T2')?.awarded === 1)

    // --- A teacher's "Mark with AI": says when nothing was queued -------------------
    check('not handed in: not queued, and says so', (await powerPointNotQueuedReason(uploaded)) === NOT_HANDED_IN_FOR_MARKING_MESSAGE)
    await enqueueMarkingTasks(`${GROUP}__${LESSON}`, [{ submissionId: uploaded }])
    const { rows: uploadedJobs } = await query("select 1 from external_jobs where payload->>'submissionId' = $1", [uploaded])
    check('…and no job is queued for it', uploadedJobs.length === 0 && (await powerPointNotQueuedReason(uploaded)) === NOT_HANDED_IN_FOR_MARKING_MESSAGE)
    // Unmarked lost its required evidence document above, so enqueueing holds it.
    await enqueueMarkingTasks(`${GROUP}__${LESSON}`, [{ submissionId: unmarked }])
    const { rows: unmarkedJobs } = await query("select 1 from external_jobs where payload->>'submissionId' = $1 and status in ('pending', 'processing')", [unmarked])
    const heldReason = await powerPointNotQueuedReason(unmarked)
    check('held on a missing file: not queued, with the reason', unmarkedJobs.length === 0 && heldReason === 'Not marked: no Evidence document handed in.', String(heldReason))
    await query("update submissions set mark_status = 'waiting', mark_error = null where submission_id = $1", [unmarked])
    check('waiting to be marked: queued', (await powerPointNotQueuedReason(unmarked)) === null)
    check('another type, or no such submission: nothing to say', (await powerPointNotQueuedReason(randomUUID())) === null)

    // --- A teacher hands in for the pupil -------------------------------------------
    const refusal = await handInPowerPointAssessment(PPT, UPLOADED, { userId: MARKED, isTeacher: false }).then(() => null, (error: Error) => error.message)
    check('another pupil may not hand in for them', refusal === 'You can only hand in your own work.', String(refusal))
    const missing = await handInPowerPointAssessment(PPT, UPLOADED, { userId: TEACHER, isTeacher: true }).then(() => null, (error: Error) => error.message)
    check('a teacher may not either while a required file is missing', missing === 'Upload Evidence document before handing in.', String(missing))
    await storePracticalFile({ activityId: PPT, pupilId: UPLOADED, slotKey: 'evidence', bytes: await docxBytes('T2'), originalName: 'Evidence.docx', uploadedBy: TEACHER, byTeacher: true })
    const byTeacher = await handInPowerPointAssessment(PPT, UPLOADED, { userId: TEACHER, isTeacher: true })
    // The read the hand-in queued is the reader's job, not this check's.
    await query("delete from external_jobs where payload->>'submissionId' = $1", [byTeacher.submissionId])
    const { rows: [afterHandIn] } = await query<{ submission_status: string | null }>('select submission_status from submissions where submission_id = $1', [byTeacher.submissionId])
    check('a teacher hands in for the pupil', byTeacher.submissionId === uploaded && !byTeacher.alreadyHandedIn && afterHandIn.submission_status === 'submitted' && byTeacher.state.handedIn, JSON.stringify({ byTeacher: byTeacher.alreadyHandedIn, afterHandIn }))
    check('…and the results panel shows it handed in', (await readAssessmentPaperResult(PPT, UPLOADED)).powerpoint?.handedIn === true)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1 or scope_path like $2)
          + (select count(*) from units where unit_id = $3)
          + (select count(*) from profiles where user_id = any($4::text[]))
          + (select count(*) from activities where activity_id = $5)
          + (select count(*) from groups where group_id = $6) as left`,
    [`${PPT}%`, `lessons/${LESSON}/%`, UNIT, [...PUPILS, TEACHER], PPT, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
