import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import PDFDocument from 'pdfkit'

import { query } from '@/lib/db'
import { enqueueMarkingTasks } from '@/lib/ai/marking-queue'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { NO_ANSWER_COMMENT, completeAssessmentQuestionMark, setAssessmentQuestions } from '@/lib/assessment-paper/store'
import { readEvidenceDocument } from '@/lib/docx/evidence'
import { pdfPageCount, pdfText } from '@/lib/pdf/poppler'
import { inspectPptx } from '@/lib/pptx/inspect'
import { PPTX_MESSAGES } from '@/lib/pptx/package'
import { LESSONS_BUCKET, handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import type { PowerPointReaders } from '@/lib/powerpoint-assessment/reading'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The read of a PowerPoint assessment (the ai_read job), with no model: the
// queue branch (nothing before hand-in; a missing required slot held; one
// ai_read on hand-in), then the read run directly (the worker is not
// started): evidence rows per slot, the presentation's description, the
// evidence document's screenshots stored under evidence/, each question's
// answer (a missing required screenshot -> blank -> 0 with the reason, e.g.
// "There is no T4 section in your Evidence document.", and no mark job; typed text read as the transcription), mark jobs only for
// answered, non-teacher questions with a mark scheme and their reference file,
// cache reuse on a second read (readers counted), a presentation that cannot
// be inspected holding the whole submission, and no base64 on the job row.
// Test data is generic; the presentation and pictures are the test fixtures.
// Creates its own unit, lesson, activity, class and pupils, and removes them.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/reading.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-r-check-unit-${tag}`
const LESSON = `ppt-r-check-lesson-${tag}`
const PPT = randomUUID()
const GROUP = `ppt-r-check-group-${tag}`
const PUPIL = `ppt-r-check-pupil-${tag}`
const SECOND = `ppt-r-check-second-${tag}`
const LATE = `ppt-r-check-late-${tag}`
const PUPILS = [PUPIL, SECOND, LATE]

const SLOTS = [
  { key: 'deck', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'printout', label: 'Printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true },
]
const TEMPLATE_FILE = 'BLANK EVIDENCE.docx'
const REFERENCE_FILE = 'BRIEF.txt'
const TYPED = 'The audience is visitors to the museum, so the text is short.'
const TEMPLATE_LINE = 'Paste your screenshots below this line'

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    "insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Bob', 'Bbb'), ($3, 'Cat', 'Ccc')",
    PUPILS,
  )
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PUPILS])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint read unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint read check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Presentation task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS, evidenceTemplateFile: TEMPLATE_FILE })],
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
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [bucket, `${prefix}%`],
    )
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, PPT), { recursive: true, force: true })
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, LESSON), { recursive: true, force: true })
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
const pic = (data: Buffer, type: 'png' | 'jpg') =>
  new Paragraph({ children: [new ImageRun({ type, data, transformation: { width: 120, height: 80 } })] })

async function docx(children: Paragraph[]) {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })))
}

async function corruptSlide(pptx: Buffer) {
  const zip = await JSZip.loadAsync(pptx)
  const slide = Object.keys(zip.files).find((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))!
  zip.file(slide, '<<<')
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

function countingReaders() {
  const counts = { inspect: 0, docx: 0, pdf: 0 }
  const readers: PowerPointReaders = {
    inspectPptx: (...args) => { counts.inspect += 1; return inspectPptx(...args) },
    readEvidenceDocument: (...args) => { counts.docx += 1; return readEvidenceDocument(...args) },
    pdfPageCount: (...args) => { counts.pdf += 1; return pdfPageCount(...args) },
    pdfText: (...args) => pdfText(...args),
  }
  return { counts, readers }
}

async function latestSubmission(pupilId: string) {
  const { rows } = await query<{ submission_id: string; mark_status: string | null; mark_error: string | null }>(
    `select submission_id, mark_status, mark_error from submissions where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last limit 1`,
    [PPT, pupilId],
  )
  return rows[0]
}

/** Claim the pending read job of a submission as the worker would, and return it. */
async function claimRead(submissionId: string) {
  const { rows } = await query<{ job_id: string; assignment_id: string }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = 'ai_read' and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id`,
    [submissionId],
  )
  return rows[0] ? { jobId: rows[0].job_id, submissionId, assignmentId: rows[0].assignment_id } : null
}

async function jobRow(jobId: string) {
  const { rows } = await query<{ status: string; last_error: string | null; model_request: unknown; model_response: unknown }>(
    'select status, last_error, model_request, model_response from external_jobs where job_id = $1',
    [jobId],
  )
  return rows[0]
}

function hasBase64(value: unknown) {
  const text = JSON.stringify(value ?? null)
  return /base64|data:image|[A-Za-z0-9+/]{400,}/.test(text)
}

async function main() {
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const shotA = await readFile(path.join(FIXTURES, 'pearl-images', 'LOGO.png'))
  const shotB = await readFile(path.join(FIXTURES, 'pearl-images', 'TURTLE.jpg'))
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 1`,
  )
  const A = scs[0].success_criteria_id

  await setUp()
  try {
    // Teacher materials: the blank evidence template and a reference file.
    const lessons = createLocalStorageClient(LESSONS_BUCKET)
    const template = await docx([h1('T1'), p(TEMPLATE_LINE), h1('T2'), h1('T3'), h1('W1'), p('Type your answer here')])
    await lessons.upload(`lessons/${LESSON}/activities/${PPT}/${TEMPLATE_FILE}`, template, { contentType: 'application/octet-stream' })
    await lessons.upload(`lessons/${LESSON}/activities/${PPT}/${REFERENCE_FILE}`, Buffer.from('The brief.'), { contentType: 'text/plain' })

    const q = (label: string, evidence: unknown[], extra: Record<string, unknown> = {}) => ({
      label, maxMarks: 1, markScheme: `Mark scheme for ${label}.`, evidence,
      criteria: [{ successCriteriaId: A, maxMarks: 1 }], ...extra,
    })
    const saved = await setAssessmentQuestions(PPT, [
      // Screenshots under T1, required, and the first slide.
      q('T1', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true },
               { source: 'presentation', slot: 'deck', sections: ['slides:1'] }]),
      // The presentation's masters and slides, with a reference file that exists.
      q('P1', [{ source: 'presentation', slot: 'deck', sections: ['master', 'slides'] },
               { source: 'reference_file', fileName: REFERENCE_FILE }]),
      // A required screenshot heading the pupil left out.
      q('T4', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true }]),
      // A required screenshot heading with text but no screenshot.
      q('T2', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true }]),
      // A typed answer.
      q('W1', [{ source: 'evidence_section', slot: 'evidence', want: 'text', required: true }]),
      // The printout, required.
      q('F1', [{ source: 'file', slot: 'printout', required: true }]),
      // Teacher-only.
      q('M1', [{ source: 'presentation', slot: 'deck' }], { marking: 'teacher' }),
      // No mark scheme.
      q('N1', [{ source: 'presentation', slot: 'deck' }], { markScheme: null }),
      // A reference file that is not among the activity's files.
      q('R1', [{ source: 'presentation', slot: 'deck', sections: ['slides:2'] },
               { source: 'reference_file', fileName: 'NOT THERE.docx' }]),
      // Not required, under a heading that has both.
      q('T3', [{ source: 'evidence_section', slot: 'evidence', want: 'both' }]),
    ])
    const id = (label: string) => saved.find((s) => s.label === label)!.questionId

    // The pupil's evidence document, built on the template.
    const evidenceDoc = await docx([
      p('Name: Ann'),
      pic(shotB, 'jpg'),
      h1('T1'), p(TEMPLATE_LINE), pic(shotA, 'png'), pic(shotB, 'jpg'),
      h1('T2'), p('I forgot the screenshot.'),
      h1('T3'), p('Some notes.'), pic(shotA, 'png'),
      h1('W1'), p(TYPED),
    ])
    const printout = await pdf(['PRINTOUT page one', 'PRINTOUT page two'])

    // --- Queue branch ---------------------------------------------------------
    const store = (pupilId: string, slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: PPT, pupilId, slotKey, bytes, originalName, uploadedBy: pupilId })
    await store(PUPIL, 'deck', pptx, 'My Deck.pptx')
    await store(PUPIL, 'printout', printout, 'Printout.pdf')
    await store(PUPIL, 'evidence', evidenceDoc, 'EVIDENCE.docx')
    const before = await latestSubmission(PUPIL)
    await enqueueMarkingTasks('self__x', [{ submissionId: before.submission_id }])
    const { rows: [{ n: earlyJobs }] } = await query<{ n: number }>(
      "select count(*)::int as n from external_jobs where payload->>'submissionId' = $1", [before.submission_id])
    check('nothing is queued before hand-in', earlyJobs === 0, String(earlyJobs))

    // A hand-in missing a required slot (a file removed behind the hand-in check) is held.
    await store(SECOND, 'deck', pptx, 'Deck.pptx')
    const second = await latestSubmission(SECOND)
    await query("update submissions set submission_status = 'submitted' where submission_id = $1", [second.submission_id])
    await enqueueMarkingTasks('self__x', [{ submissionId: second.submission_id }])
    const secondAfter = await latestSubmission(SECOND)
    check('a missing required slot is held, naming it',
      secondAfter.mark_status === null && secondAfter.mark_error === 'Not marked: no Evidence document handed in.',
      JSON.stringify(secondAfter))
    const { rows: [{ n: secondJobs }] } = await query<{ n: number }>(
      "select count(*)::int as n from external_jobs where payload->>'submissionId' = $1 and status in ('pending','processing')",
      [second.submission_id])
    check('nothing is queued for it', secondJobs === 0, String(secondJobs))

    await handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false })
    const job = await claimRead(before.submission_id)
    check('hand-in queues one read', Boolean(job))
    const waiting = await latestSubmission(PUPIL)
    check('the submission waits', waiting.mark_status === 'marking' || waiting.mark_status === 'waiting', String(waiting.mark_status))
    if (!job) throw new Error('no read job')

    // --- The read ---------------------------------------------------------------
    const first = countingReaders()
    const outcome = await runPowerPointReadJob(job, first.readers)
    check('the read is not held', outcome.held === null, String(outcome.held))
    check('each file was read once', first.counts.inspect === 1 && first.counts.docx === 1 && first.counts.pdf === 1, JSON.stringify(first.counts))

    const { rows: evidence } = await query<{
      slot_key: string; kind: string; status: string; description: string | null; image_paths: string[]; report: any; file_id: string
    }>(
      'select slot_key, kind, status, description, image_paths, report, file_id::text as file_id from practical_submission_evidence where submission_id = $1 order by slot_key',
      [before.submission_id],
    )
    check('one evidence row per handed-in slot', evidence.map((e) => `${e.slot_key}:${e.kind}:${e.status}`).join(',')
      === 'deck:presentation:ok,evidence:evidence_doc:ok,printout:pdf:ok', JSON.stringify(evidence.map((e) => e.slot_key)))
    const deck = evidence.find((e) => e.slot_key === 'deck')!
    check('the presentation description is stored', Boolean(deck.description?.startsWith('PRESENTATION')) && Boolean(deck.report?.slides?.length))
    const printed = evidence.find((e) => e.slot_key === 'printout')!
    check('the PDF\'s pages and text are stored', printed.report?.pageCount === 2 && /PRINTOUT page two/.test(printed.report?.text ?? ''), JSON.stringify(printed.report).slice(0, 200))
    const ev = evidence.find((e) => e.slot_key === 'evidence')!
    const t1 = ev.report.sections.find((s: any) => s.label === 'T1')
    check('the screenshots under a heading are stored under evidence/',
      t1?.images.length === 2 && t1.images.every((im: any) => im.path.startsWith(`${PPT}/practical/${ev.file_id}/evidence/t1-`)),
      JSON.stringify(t1?.images.map((im: any) => im.path)))
    check('the template text is removed', t1?.text === '', JSON.stringify(t1?.text))
    check('unplaced screenshots are kept for the teacher', ev.report.unplaced.images.length === 1
      && ev.report.unplaced.images[0].path.includes('/evidence/_unplaced-1.'), JSON.stringify(ev.report.unplaced.images))
    check('a missing heading is recorded', ev.report.missingHeadings.join(',') === 'T4', ev.report.missingHeadings.join(','))
    const storage = createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET)
    const statted = await Promise.all(ev.image_paths.map((p) => storage.stat(p)))
    check('every picture path is a stored file', ev.image_paths.length === 4 && statted.every(Boolean), String(ev.image_paths.length))

    const { rows: answers } = await query<{ question_id: string; kind: string; status: string; transcription: string | null; pages: number[] }>(
      'select question_id, kind, status, transcription, pages from submission_question_answers where submission_id = $1',
      [before.submission_id],
    )
    const answer = (label: string) => answers.find((a) => a.question_id === id(label))
    check('every question has an answer', answers.length === saved.length, String(answers.length))
    check('answers name no pages', answers.every((a) => a.pages.length === 0))
    check('screenshots present: answered, mixed', answer('T1')?.status === 'answered' && answer('T1')?.kind === 'mixed', JSON.stringify(answer('T1')))
    check('the digest lists the evidence',
      answer('T1')?.transcription === 'EVIDENCE T1: 2 screenshots. My Deck.pptx: slide 1.', String(answer('T1')?.transcription))
    check('a missing required heading is blank', answer('T4')?.status === 'blank', JSON.stringify(answer('T4')))
    check('a required heading with no screenshot is blank', answer('T2')?.status === 'blank', JSON.stringify(answer('T2')))
    check('typed text is the transcription', answer('W1')?.status === 'answered' && answer('W1')?.kind === 'text'
      && answer('W1')?.transcription === TYPED, JSON.stringify(answer('W1')))
    check('a required printout handed in is answered', answer('F1')?.status === 'answered'
      && answer('F1')?.transcription === 'Printout.pdf: 2 pages.', JSON.stringify(answer('F1')))
    check('"both" is answered with text and a picture', answer('T3')?.status === 'answered'
      && answer('T3')?.transcription === 'Some notes.', JSON.stringify(answer('T3')))

    const { rows: marks } = await query<{ question_id: string; awarded: number; why_not_awarded: string | null }>(
      'select question_id, awarded, why_not_awarded from submission_question_criterion_marks where submission_id = $1',
      [before.submission_id],
    )
    const blankIds = [id('T4'), id('T2')]
    const why = (label: string) => marks.find((m) => m.question_id === id(label))?.why_not_awarded
    check('a blank answer scores 0 with the reason it is blank',
      marks.length === 2 && marks.every((m) => blankIds.includes(m.question_id) && m.awarded === 0)
        && why('T4') === 'There is no T4 section in your Evidence document.'
        && why('T2') === 'There is no screenshot under T2 in your Evidence document.',
      JSON.stringify(marks))
    check('…not the general "No answer submitted"', marks.every((m) => m.why_not_awarded !== NO_ANSWER_COMMENT))

    const { rows: markJobs } = await query<{ question_id: string }>(
      `select payload->>'questionId' as question_id from external_jobs
        where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1`,
      [before.submission_id],
    )
    const queued = markJobs.map((j) => saved.find((s) => s.questionId === j.question_id)?.label).sort().join(',')
    check('mark jobs only for answered, non-teacher questions with a mark scheme and their files', queued === 'F1,P1,T1,T3,W1', queued)
    // Close the mark jobs as a marker that found nothing to write would: the
    // last one marks the submission and names what is held.
    const { rows: openMarks } = await query<{ job_id: string }>(
      `update external_jobs set status = 'processing'
        where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1
        returning job_id`,
      [before.submission_id],
    )
    let completed = false
    for (const mark of openMarks) {
      completed = (await completeAssessmentQuestionMark({ submissionId: before.submission_id, jobId: mark.job_id, rows: [] })).complete
    }
    const afterRead = await latestSubmission(PUPIL)
    check('the last mark job marks the submission', completed && afterRead.mark_status === 'marked', String(afterRead.mark_status))
    check('the held questions are named', /question N1 has no mark scheme/.test(afterRead.mark_error ?? '')
      && /question R1 reads the reference file "NOT THERE.docx"/.test(afterRead.mark_error ?? ''), String(afterRead.mark_error))
    check('outcome lists them held', outcome.heldQuestionIds.sort().join() === [id('N1'), id('R1')].sort().join())

    const row = await jobRow(job.jobId)
    const request = row.model_request as any
    check('the read job is closed', row.status === 'done', row.status)
    check('the job row records the files read', request?.reader === 'powerpoint'
      && request.files.length === 3 && request.files.every((f: any) => f.cached === false && f.sha256 && f.bytes > 0), JSON.stringify(request?.files))
    const response = row.model_response as any
    check('the job row records sections found and missing headings',
      response?.slots?.find((s: any) => s.slot === 'evidence')?.missingHeadings?.join() === 'T4'
      && response.slots.find((s: any) => s.slot === 'evidence').sectionsFound.sort().join() === 'T1,T2,T3,W1', JSON.stringify(response?.slots))
    check('no base64 on the job row', !hasBase64(row.model_request) && !hasBase64(row.model_response))

    // --- Read again: the stored evidence is reused ------------------------------
    await enqueueMarkingTasks('self__x', [{ submissionId: before.submission_id }])
    const again = await claimRead(before.submission_id)
    if (!again) throw new Error('no second read job')
    const second2 = countingReaders()
    const outcome2 = await runPowerPointReadJob(again, second2.readers)
    check('an unchanged file is not read again', second2.counts.inspect === 0 && second2.counts.docx === 0 && second2.counts.pdf === 0, JSON.stringify(second2.counts))
    const row2 = await jobRow(again.jobId)
    check('the job row says the files were cached', (row2.model_request as any)?.files?.every((f: any) => f.cached === true), JSON.stringify((row2.model_request as any)?.files))
    check('the second read gives the same questions to mark', outcome2.queuedQuestionIds.length === 5, String(outcome2.queuedQuestionIds.length))

    // A changed supplied image set changes the presentation's cache key.
    await query(
      "insert into practical_supplied_images (activity_id, name, file_name, storage_path, sha256, fingerprint) values ($1, 'X', 'x.png', 'x', 'abc', '')",
      [PPT],
    )
    await enqueueMarkingTasks('self__x', [{ submissionId: before.submission_id }])
    const third = await claimRead(before.submission_id)
    if (!third) throw new Error('no third read job')
    const counted3 = countingReaders()
    await runPowerPointReadJob(third, counted3.readers).catch(() => null)
    check('new supplied images make the presentation be read again', counted3.counts.inspect === 1 && counted3.counts.docx === 0, JSON.stringify(counted3.counts))
    await query("delete from practical_supplied_images where activity_id = $1", [PPT])

    // --- A presentation that cannot be inspected holds the whole submission ----
    await store(LATE, 'deck', await corruptSlide(pptx), 'Broken.pptx')
    await store(LATE, 'evidence', evidenceDoc, 'EVIDENCE.docx')
    await handInPowerPointAssessment(PPT, LATE, { userId: LATE, isTeacher: false })
    const late = await latestSubmission(LATE)
    const lateJob = await claimRead(late.submission_id)
    if (!lateJob) throw new Error('no read job for the broken file')
    const lateOutcome = await runPowerPointReadJob(lateJob)
    const lateAfter = await latestSubmission(LATE)
    const expected = `Not marked: Presentation (Broken.pptx) could not be read: ${PPTX_MESSAGES.damaged} Upload a working file again.`
    check('a damaged presentation holds the submission', lateOutcome.held === expected
      && lateAfter.mark_status === null && lateAfter.mark_error === expected, JSON.stringify(lateAfter))
    const { rows: lateEvidence } = await query<{ slot_key: string; status: string; error: string | null }>(
      'select slot_key, status, error from practical_submission_evidence where submission_id = $1', [late.submission_id])
    check('its evidence row records the error', lateEvidence.find((e) => e.slot_key === 'deck')?.status === 'error'
      && lateEvidence.find((e) => e.slot_key === 'deck')?.error === PPTX_MESSAGES.damaged, JSON.stringify(lateEvidence))
    const { rows: [{ answers: lateAnswers, marks: lateMarks, jobs: lateJobs }] } = await query<{ answers: number; marks: number; jobs: number }>(
      `select (select count(*)::int from submission_question_answers where submission_id = $1) as answers,
              (select count(*)::int from submission_question_criterion_marks where submission_id = $1) as marks,
              (select count(*)::int from external_jobs where payload->>'submissionId' = $1 and status in ('pending','processing')) as jobs`,
      [late.submission_id])
    check('nothing is marked or zeroed, and no job is open', lateAnswers === 0 && lateMarks === 0 && lateJobs === 0,
      JSON.stringify({ lateAnswers, lateMarks, lateJobs }))
    const { rows: [{ file_id: lateEvidenceFile }] } = await query<{ file_id: string }>(
      "select file_id::text as file_id from practical_submission_files where submission_id = $1 and slot_key = 'deck'", [late.submission_id])
    const lateRow = await jobRow(lateJob.jobId)
    check('the read job is closed with the reason, without the pupil\'s file name', lateRow.status === 'error'
      && lateRow.last_error === expected.replace('Broken.pptx', `file ${lateEvidenceFile}.pptx`), JSON.stringify(lateRow.last_error))
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1 or scope_path like $2)
          + (select count(*) from units where unit_id = $3)
          + (select count(*) from profiles where user_id = any($4::text[]))
          + (select count(*) from activities where activity_id = $5)
          + (select count(*) from groups where group_id = $6) as left`,
    [`${PPT}%`, `${LESSON}/%`, UNIT, PUPILS, PPT, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
