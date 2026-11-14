import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'

import { query } from '@/lib/db'
import { enqueueMarkingTasks, processSingleItem } from '@/lib/ai/marking-queue'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import {
  completeAssessmentQuestionMark,
  completeAssessmentRead,
  setAssessmentQuestions,
} from '@/lib/assessment-paper/store'
import { readEvidenceDocument } from '@/lib/docx/evidence'
import { UnreadablePdfError, pdfPageCount, pdfText } from '@/lib/pdf/poppler'
import { inspectPptx } from '@/lib/pptx/inspect'
import { LESSONS_BUCKET, handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { MARK_MAX_PDF_BYTES } from '@/lib/powerpoint-assessment/marking'
import { PDF_MAX_BYTES, type PowerPointReaders } from '@/lib/powerpoint-assessment/reading'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { joinLabels } from '@/lib/utils'

// The Task 5 review fixes:
//   1. a read that fails after the work was sent again (its job deleted) is
//      ignored by the queue: the newer read stays pending, nothing errors;
//   2. completeAssessmentRead / completeAssessmentQuestionMark write nothing
//      for a job that is no longer this run's (PowerPoint and paper);
//   3. poppler: UnreadablePdfError only when the tool refuses the file; a tool
//      that cannot run is a plain error with the same words, and the read
//      job then throws (retries) and stores nothing;
//   4. a required screenshot heading holding only pictures DINO cannot show
//      is held for the teacher (never 0, never sent), named in mark_error;
//   5. no pupil file names in the read job row or the queue log;
//   6. a PDF over the marker's limit holds the hand-in at the read;
//   and the per-type "names no question" sentence, the shared joinLabels.
// Creates its own data and removes it. Run with DATABASE_URL set (and
// MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/read-guards.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-g-check-unit-${tag}`
const LESSON = `ppt-g-check-lesson-${tag}`
const PPT = randomUUID()
const PAPER = randomUUID()
const GROUP = `ppt-g-check-group-${tag}`
const P = (n: string) => `ppt-g-check-${n}-${tag}`
const PUPILS = [P('a'), P('b'), P('c'), P('d'), P('e'), P('f')]
const [SUPERSEDED, EMF, BIG, BROKEN, NOQ, PAPER_PUPIL] = PUPILS
const SECRET_NAME = 'Zed Quimby deck'

const SLOTS = [
  { key: 'deck', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'printout', label: 'Printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: false },
]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) select unnest($1::text[]), 'Pat', 'Pupil'", [PUPILS])
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PUPILS])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Guards unit ${tag}`, subject])
  await query("insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Guards check', 0, 'standard')", [LESSON, UNIT])
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({ uploadSlots: SLOTS })],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'assessment-paper', 'Paper', '{}'::jsonb, 1)",
    [PAPER, LESSON],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) select $1, unnest($2::text[])', [GROUP, PUPILS])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  for (const [bucket, prefix] of [[ASSESSMENT_SCRIPTS_BUCKET, PPT], [LESSONS_BUCKET, `${LESSON}/`]] as const) {
    const { rows } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, PPT), { recursive: true, force: true })
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

function pdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    pages.forEach((text, i) => {
      if (i > 0) doc.addPage()
      doc.fontSize(18).text(text)
    })
    doc.end()
  })
}

const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 })
const p = (text: string) => new Paragraph({ children: [new TextRun(text)] })
const pic = (data: Buffer) => new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: 120, height: 80 } })] })

function emfBytes() {
  const header = Buffer.alloc(108)
  header.writeUInt32LE(1, 0)
  header.writeUInt32LE(108, 4)
  header.write(' EMF', 40, 'latin1')
  header.writeUInt32LE(0x10000, 44)
  const eof = Buffer.alloc(20)
  eof.writeUInt32LE(14, 0)
  eof.writeUInt32LE(20, 4)
  return Buffer.concat([header, eof])
}

/** An evidence document whose only picture, under U1, is an EMF drawing. */
async function emfEvidence(placeholder: Buffer) {
  const doc = Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [h1('U1'), pic(placeholder), h1('F1'), p('Printout attached.')] }] })))
  const zip = await JSZip.loadAsync(doc)
  let mediaName: string | null = null
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !zip.files[n].dir)) {
    if (Buffer.compare(await zip.file(name)!.async('nodebuffer'), placeholder) === 0) mediaName = name
  }
  if (!mediaName) throw new Error('placeholder media not found')
  const emfName = mediaName.replace(/\.png$/, '.emf')
  zip.remove(mediaName)
  zip.file(emfName, emfBytes())
  const relsPart = 'word/_rels/document.xml.rels'
  zip.file(relsPart, (await zip.file(relsPart)!.async('string')).replace(mediaName.replace('word/', ''), emfName.replace('word/', '')))
  const types = await zip.file('[Content_Types].xml')!.async('string')
  zip.file('[Content_Types].xml', types.replace('<Default ', '<Default ContentType="image/x-emf" Extension="emf"/><Default '))
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

async function latest(pupilId: string, activityId = PPT) {
  const { rows } = await query<{ submission_id: string; mark_status: string | null; mark_error: string | null }>(
    `select submission_id, mark_status, mark_error from submissions where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last limit 1`, [activityId, pupilId])
  return rows[0]
}

async function claim(submissionId: string, jobType = 'ai_read') {
  const { rows } = await query<{ job_id: string; assignment_id: string; attempts: number; question_id: string | null }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = $2 and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id, attempts, payload->>'questionId' as question_id`,
    [submissionId, jobType])
  return rows[0] ? { jobId: rows[0].job_id, submissionId, assignmentId: rows[0].assignment_id, attempts: rows[0].attempts, questionId: rows[0].question_id } : null
}

async function openJobs(submissionId: string) {
  const { rows } = await query<{ job_id: string; job_type: string; status: string }>(
    "select job_id, job_type, status from external_jobs where payload->>'submissionId' = $1 and status in ('pending', 'processing')", [submissionId])
  return rows
}

async function countRows(table: string, submissionId: string) {
  const { rows: [{ n }] } = await query<{ n: number }>(`select count(*)::int as n from ${table} where submission_id = $1`, [submissionId])
  return n
}

async function main() {
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const placeholder = await sharp({ create: { width: 7, height: 5, channels: 3, background: '#123456' } }).png().toBuffer()
  const { rows: [{ success_criteria_id: A }] } = await query<{ success_criteria_id: string }>(
    'select success_criteria_id from success_criteria order by success_criteria_id limit 1')

  await setUp()
  try {
    const q = (label: string, evidence: unknown[]) => ({
      label, maxMarks: 1, markScheme: `Mark scheme for ${label}.`, evidence, criteria: [{ successCriteriaId: A, maxMarks: 1 }],
    })
    const saved = await setAssessmentQuestions(PPT, [
      q('P1', [{ source: 'presentation', slot: 'deck', sections: ['slides:1'] }]),
      // A required screenshot heading holding only an EMF drawing.
      q('U1', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true }]),
      // The same heading, not required, beside the presentation.
      q('N1', [{ source: 'evidence_section', slot: 'evidence', heading: 'U1', want: 'screenshots' },
               { source: 'presentation', slot: 'deck', sections: ['slides:2'] }]),
      q('F1', [{ source: 'file', slot: 'printout' }]),
    ])
    const id = (label: string) => saved.find((s) => s.label === label)!.questionId
    const store = (pupilId: string, slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: PPT, pupilId, slotKey, bytes, originalName, uploadedBy: pupilId })
    const handIn = (pupilId: string) => handInPowerPointAssessment(PPT, pupilId, { userId: pupilId, isTeacher: false })

    check('one shared joinLabels', joinLabels(['A']) === 'A' && joinLabels(['A', 'B']) === 'A and B' && joinLabels(['A', 'B', 'C']) === 'A, B and C')

    // --- 1 + 2: a read superseded while it ran ------------------------------
    await store(SUPERSEDED, 'deck', pptx, 'deck.pptx')
    await handIn(SUPERSEDED)
    const sup = await latest(SUPERSEDED)
    const oldRead = (await claim(sup.submission_id))!
    // Sent again while it runs: its job is replaced by a new pending read.
    await enqueueMarkingTasks(oldRead.assignmentId, [{ submissionId: sup.submission_id }])
    const afterResend = await openJobs(sup.submission_id)
    check('sending again replaces the running read with a pending one',
      afterResend.length === 1 && afterResend[0].job_type === 'ai_read' && afterResend[0].status === 'pending'
      && afterResend[0].job_id !== oldRead.jobId, JSON.stringify(afterResend))

    // The old run finishing writes nothing.
    const outcome = await runPowerPointReadJob(oldRead)
    check('a superseded read writes no answers, marks or jobs', outcome.superseded === true
      && (await countRows('submission_question_answers', sup.submission_id)) === 0
      && (await countRows('submission_question_criterion_marks', sup.submission_id)) === 0
      && (await openJobs(sup.submission_id)).length === 1, JSON.stringify(outcome))

    // The old run failing is ignored by the queue.
    const { rows: [{ storage_path }] } = await query<{ storage_path: string }>(
      "select storage_path from practical_submission_files where submission_id = $1 and slot_key = 'deck'", [sup.submission_id])
    await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, storage_path), { force: true })
    await query('delete from practical_submission_evidence where submission_id = $1', [sup.submission_id])
    const ran = await processSingleItem({
      submission_id: sup.submission_id, assignment_id: oldRead.assignmentId, job_type: 'ai_read',
      attempts: oldRead.attempts, job_id: oldRead.jobId,
    }).then(() => 'resolved', (error) => `threw ${error.message}`)
    const supAfter = await latest(SUPERSEDED)
    const supJobs = await openJobs(sup.submission_id)
    check('a superseded read that fails is ignored', ran === 'resolved', ran)
    check('…the new read stays pending', supJobs.length === 1 && supJobs[0].status === 'pending' && supJobs[0].job_id === afterResend[0].job_id, JSON.stringify(supJobs))
    check('…and the submission is not marking-error', supAfter.mark_status !== 'marking-error' && supAfter.mark_error === null, JSON.stringify(supAfter))

    // --- 2: the paper, read and mark --------------------------------------
    const [paperQ] = await setAssessmentQuestions(PAPER, [{ label: '1', maxMarks: 1, markScheme: 'One mark.', criteria: [{ successCriteriaId: A, maxMarks: 1 }] }])
    const { rows: [{ submission_id: paperSub }] } = await query<{ submission_id: string }>(
      `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
       values ($1, $2, 1, now(), '{}'::json, 'marking', 'submitted') returning submission_id`, [PAPER, PAPER_PUPIL])
    const job = async (type: string, status: string, questionId?: string) => (await query<{ job_id: string }>(
      `insert into external_jobs (job_type, status, payload) values ($1, $2,
         jsonb_build_object('submissionId', $3::text, 'assignmentId', 'self__x') || coalesce(jsonb_build_object('questionId', $4::text), '{}'::jsonb))
       returning job_id`, [type, status, paperSub, questionId ?? null])).rows[0].job_id
    const goneRead = await job('ai_read', 'processing')
    await query('delete from external_jobs where job_id = $1', [goneRead])
    const paperRead = await completeAssessmentRead({
      submissionId: paperSub, assignmentId: 'self__x', jobId: goneRead,
      answers: [{ questionId: paperQ.questionId, kind: 'text', transcription: 'An answer', pages: [2], status: 'answered' }],
    })
    check('paper: a read whose job has gone writes nothing', paperRead.superseded === true
      && (await countRows('submission_question_answers', paperSub)) === 0 && (await openJobs(paperSub)).length === 0)
    const doneRead = await job('ai_read', 'done')
    const paperRead2 = await completeAssessmentRead({
      submissionId: paperSub, assignmentId: 'self__x', jobId: doneRead,
      answers: [{ questionId: paperQ.questionId, kind: 'text', transcription: 'An answer', pages: [2], status: 'answered' }],
    })
    check('paper: …nor one no longer processing', paperRead2.superseded === true && (await countRows('submission_question_answers', paperSub)) === 0)
    const liveRead = await job('ai_read', 'processing')
    const paperRead3 = await completeAssessmentRead({
      submissionId: paperSub, assignmentId: 'self__x', jobId: liveRead,
      answers: [{ questionId: paperQ.questionId, kind: 'text', transcription: 'An answer', pages: [2], status: 'answered' }],
    })
    check('paper: a running read still writes and queues', !paperRead3.superseded
      && (await countRows('submission_question_answers', paperSub)) === 1 && paperRead3.queuedQuestionIds.length === 1)
    const mark = { questionId: paperQ.questionId, successCriteriaId: A, awarded: 1 }
    await query("delete from external_jobs where job_type = 'ai_mark' and payload->>'submissionId' = $1", [paperSub])
    const goneMark = await job('ai_mark', 'processing', paperQ.questionId)
    await query('delete from external_jobs where job_id = $1', [goneMark])
    const m1 = await completeAssessmentQuestionMark({ submissionId: paperSub, jobId: goneMark, rows: [mark] })
    check('paper: a mark whose job has gone writes nothing', m1.superseded === true && (await countRows('submission_question_criterion_marks', paperSub)) === 0)
    const pendingMark = await job('ai_mark', 'pending', paperQ.questionId)
    const m2 = await completeAssessmentQuestionMark({ submissionId: paperSub, jobId: pendingMark, rows: [mark] })
    check('paper: …nor one back in the queue', m2.superseded === true && (await countRows('submission_question_criterion_marks', paperSub)) === 0)
    await query("update external_jobs set status = 'processing' where job_id = $1", [pendingMark])
    const m3 = await completeAssessmentQuestionMark({ submissionId: paperSub, jobId: pendingMark, rows: [mark] })
    check('paper: a running mark writes and completes', !m3.superseded && m3.complete
      && (await countRows('submission_question_criterion_marks', paperSub)) === 1, JSON.stringify(m3))

    // --- 3: poppler errors are typed ----------------------------------------
    const goodPdf = await pdf(['One page'])
    const badError = await pdfPageCount(Buffer.from('%PDF-1.4 not really')).then(() => null, (e) => e)
    check('a PDF pdfinfo refuses is an UnreadablePdfError', badError instanceof UnreadablePdfError
      && badError.message === 'Could not read the PDF. Is it a valid PDF file?', String(badError))
    const savedPath = process.env.PATH
    process.env.PATH = '/nonexistent'
    const noTool = await pdfPageCount(goodPdf).then(() => null, (e) => e)
    const noText = await pdfText(goodPdf, { maxChars: 100 }).then(() => null, (e) => e)
    process.env.PATH = savedPath
    check('a missing tool is a plain error with the same message', noTool instanceof Error && !(noTool instanceof UnreadablePdfError)
      && noTool.message === 'Could not read the PDF. Is it a valid PDF file?', String(noTool))
    check('…for pdftotext too', noText instanceof Error && !(noText instanceof UnreadablePdfError))

    // --- 4 + 3: the EMF pupil ------------------------------------------------
    await store(EMF, 'deck', pptx, 'deck.pptx')
    await store(EMF, 'printout', goodPdf, 'print.pdf')
    await store(EMF, 'evidence', await emfEvidence(placeholder), 'EVIDENCE.docx')
    await handIn(EMF)
    const emf = await latest(EMF)
    // A PDF tool that cannot run: the read throws (and retries); nothing is stored for the PDF.
    const toolDown: PowerPointReaders = {
      inspectPptx, readEvidenceDocument, pdfText,
      pdfPageCount: async () => { throw new Error('Could not read the PDF. Is it a valid PDF file?') },
      renderPresentation: async () => ({ pdf: null, error: 'off' }),
    }
    const emfRead = (await claim(emf.submission_id))!
    const thrown = await runPowerPointReadJob(emfRead, toolDown).then(() => null, (e) => e)
    const { rows: pdfEvidence } = await query("select 1 from practical_submission_evidence where submission_id = $1 and slot_key = 'printout'", [emf.submission_id])
    check('a PDF tool that cannot run makes the read throw', thrown instanceof Error, String(thrown))
    check('…storing nothing for the PDF, holding nothing', pdfEvidence.length === 0 && (await latest(EMF)).mark_status !== null)
    // A PDF the tool refuses holds the hand-in.
    const refusing: PowerPointReaders = { ...toolDown, pdfPageCount: async () => { throw new UnreadablePdfError('Could not read the PDF. Is it a valid PDF file?') } }
    const refusedOutcome = await runPowerPointReadJob(emfRead, refusing)
    check('a PDF the tool refuses holds the hand-in', /Printout \(print\.pdf\) could not be read: Could not read the PDF/.test(refusedOutcome.held ?? ''), String(refusedOutcome.held))

    // Read again properly (the refusal is stored for that file, so it goes first).
    await query("delete from practical_submission_evidence where submission_id = $1 and slot_key = 'printout'", [emf.submission_id])
    await enqueueMarkingTasks(emfRead.assignmentId, [{ submissionId: emf.submission_id }])
    const emfRead2 = (await claim(emf.submission_id))!
    const emfOutcome = await runPowerPointReadJob(emfRead2, { inspectPptx, readEvidenceDocument, pdfPageCount, pdfText })
    const { rows: answers } = await query<{ question_id: string; status: string; transcription: string | null }>(
      'select question_id, status, transcription from submission_question_answers where submission_id = $1', [emf.submission_id])
    const answer = (label: string) => answers.find((a) => a.question_id === id(label))
    const expectedText = 'the screenshot under "U1" is a .emf picture DINO cannot show; mark it yourself.'
    check('a required heading of only an EMF picture is held, not blank', answer('U1')?.status === 'unreadable'
      && answer('U1')?.transcription === expectedText, JSON.stringify(answer('U1')))
    check('…not sent and not given 0', !emfOutcome.queuedQuestionIds.includes(id('U1')) && emfOutcome.heldQuestionIds.includes(id('U1'))
      && (await query('select 1 from submission_question_criterion_marks where submission_id = $1 and question_id = $2', [emf.submission_id, id('U1')])).rows.length === 0)
    check('the same heading not required is still sent', answer('N1')?.status === 'answered' && emfOutcome.queuedQuestionIds.includes(id('N1')), JSON.stringify(answer('N1')))
    const emfMarks = await query<{ job_id: string }>(
      "update external_jobs set status = 'processing' where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1 returning job_id",
      [emf.submission_id])
    for (const row of emfMarks.rows) await completeAssessmentQuestionMark({ submissionId: emf.submission_id, jobId: row.job_id, rows: [] })
    const emfAfter = await latest(EMF)
    check('the held question is named in mark_error', (emfAfter.mark_error ?? '').includes(`Not sent for marking: question U1: ${expectedText}`), String(emfAfter.mark_error))

    // --- 5: privacy of a held read ------------------------------------------
    const broken = await (async () => {
      const zip = await JSZip.loadAsync(pptx)
      zip.file(Object.keys(zip.files).find((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))!, '<<<')
      return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
    })()
    await store(BROKEN, 'deck', broken, `${SECRET_NAME}.pptx`)
    await handIn(BROKEN)
    const brk = await latest(BROKEN)
    const brkRead = (await claim(brk.submission_id))!
    const brkOutcome = await runPowerPointReadJob(brkRead)
    const brkAfter = await latest(BROKEN)
    check('a held read names the file for the teacher', Boolean(brkOutcome.held) && (brkAfter.mark_error ?? '').includes(SECRET_NAME), String(brkAfter.mark_error))
    const { rows: [brkJob] } = await query<{ model_request: unknown; model_response: unknown; last_error: string | null }>(
      'select model_request, model_response, last_error from external_jobs where job_id = $1', [brkRead.jobId])
    check('…but not on the job row', !JSON.stringify(brkJob).includes(SECRET_NAME) && /file [0-9a-f-]{36}\.pptx/.test(brkJob.last_error ?? ''), JSON.stringify(brkJob).slice(0, 300))
    const { rows: files } = await query<{ f: any }>("select model_request->'files' as f from external_jobs where job_id = $1", [brkRead.jobId])
    check('…the job row lists files by slot label, id and type', files[0].f?.[0]?.label === 'Presentation' && files[0].f[0].ext === 'pptx'
      && typeof files[0].f[0].fileId === 'string' && files[0].f[0].name === undefined, JSON.stringify(files[0].f))
    const { rows: logs } = await query<{ n: number }>(
      "select count(*)::int as n from ai_marking_logs where created_at > now() - interval '10 minutes' and metadata::text like $1", [`%${SECRET_NAME}%`])
    check('…nor in the queue log', logs[0].n === 0, String(logs[0].n))

    // --- 6: a PDF over the marker's limit holds the hand-in at the read -----
    check('the read limit is the marker\'s', PDF_MAX_BYTES === MARK_MAX_PDF_BYTES && PDF_MAX_BYTES === 10 * 1024 * 1024)
    const bigPdf = Buffer.concat([goodPdf, Buffer.from('\n%'), Buffer.alloc(PDF_MAX_BYTES, 0x20)])
    await store(BIG, 'deck', pptx, 'deck.pptx')
    await store(BIG, 'printout', bigPdf, 'big.pdf')
    await handIn(BIG)
    const big = await latest(BIG)
    const bigOutcome = await runPowerPointReadJob((await claim(big.submission_id))!, { inspectPptx, readEvidenceDocument, pdfPageCount, pdfText })
    check('a PDF over 10 MB holds the hand-in with a clear message',
      bigOutcome.held === 'Not marked: Printout is larger than 10 MB; save it again with smaller pictures.'
      && (await latest(BIG)).mark_status === null, String(bigOutcome.held))

    // --- The per-type sentence for a mark job with no question --------------
    await store(NOQ, 'deck', pptx, 'deck.pptx')
    await handIn(NOQ)
    const noq = await latest(NOQ)
    await query("delete from external_jobs where payload->>'submissionId' = $1", [noq.submission_id])
    const { rows: [{ job_id: noqJob }] } = await query<{ job_id: string }>(
      `insert into external_jobs (job_type, status, payload) values ('ai_mark', 'processing', jsonb_build_object('submissionId', $1::text, 'assignmentId', 'self__x'))
       returning job_id`, [noq.submission_id])
    await processSingleItem({ submission_id: noq.submission_id, assignment_id: 'self__x', job_type: 'ai_mark', attempts: 0, job_id: noqJob })
      .catch(() => null)
    const noqAfter = await latest(NOQ)
    check('a mark job with no question names the type properly',
      noqAfter.mark_status === 'marking-error' && (noqAfter.mark_error ?? '').includes('A PowerPoint assessment is read, then marked per question; this job names no question.'),
      String(noqAfter.mark_error))
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1)
          + (select count(*) from activities where activity_id = any($2::text[]))
          + (select count(*) from profiles where user_id = any($3::text[])) as left`,
    [`${PPT}%`, [PPT, PAPER], PUPILS])
  check('cleaned up', Number(left) === 0, String(left))
  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
