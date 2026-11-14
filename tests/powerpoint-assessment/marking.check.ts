import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { completeAssessmentQuestionMark, setAssessmentQuestions } from '@/lib/assessment-paper/store'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import type { ModelRequest } from '@/lib/ai/model-client'
import { readEvidenceDocument } from '@/lib/docx/evidence'
import { pdfPageCount, pdfText } from '@/lib/pdf/poppler'
import { inspectPptx } from '@/lib/pptx/inspect'
import {
  LESSONS_BUCKET,
  handInPowerPointAssessment,
  pupilMayOpenPracticalFile,
  storePracticalFile,
} from '@/lib/powerpoint-assessment/files'
import { runPowerPointMarkJob, runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { MARK_MAX_IMAGES, POWERPOINT_MARK_SYSTEM } from '@/lib/powerpoint-assessment/marking'
import { SLIDE_IMAGE_MAX_SIDE, type PowerPointReaders } from '@/lib/powerpoint-assessment/reading'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The mark of a PowerPoint assessment (the ai_mark jobs), with the model call
// stubbed (never a real one): a hand-in is read (slides rendered by
// LibreOffice through Gotenberg when it is reachable, otherwise the fallback
// note), then every queued mark job runs through runPowerPointMarkJob with a
// stub that captures the request. Checks: each request carries only its own
// question's sources (a presentation section filter, a PDF, screenshots under
// a heading, typed text, rendered slides, a reference file), with labels;
// over the picture cap fails permanently, naming the question; an invalid
// reply throws and the job can run again; the marker's note is stored as
// marker_evidence and reaches no pupil-facing comment; the last job marks the
// submission with the sum of the marks; no base64 on the job rows. A second
// pupil is read with a renderer that fails: their slide part gets the "not
// available" note and no pictures, and the next read tries again.
// Test data is generic; the presentation and pictures are the test fixtures.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/marking.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-m-check-unit-${tag}`
const LESSON = `ppt-m-check-lesson-${tag}`
const PPT = randomUUID()
const GROUP = `ppt-m-check-group-${tag}`
const PUPIL = `ppt-m-check-pupil-${tag}`
const SECOND = `ppt-m-check-second-${tag}`
const PUPILS = [PUPIL, SECOND]

const SLOTS = [
  { key: 'deck', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'printout', label: 'Printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: false },
]
const REFERENCE_FILE = 'BRIEF.docx'
const BRIEF = 'Use the supplied opening times on the tickets slide.'
const TYPED = 'The audience is families, so the font is large.'
const NOTE = (label: string) => `NOTE-FOR-TEACHER ${label}: decided from the evidence.`

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Bob', 'Bbb')", PUPILS)
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PUPILS])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint mark unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint mark check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Presentation task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS })],
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

async function latestSubmission(pupilId: string) {
  const { rows } = await query<{ submission_id: string; mark_status: string | null; mark_error: string | null; body: any }>(
    `select submission_id, mark_status, mark_error, body::jsonb as body from submissions where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last limit 1`,
    [PPT, pupilId],
  )
  return rows[0]
}

async function claimRead(submissionId: string) {
  const { rows } = await query<{ job_id: string; assignment_id: string }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = 'ai_read' and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id`,
    [submissionId],
  )
  return rows[0] ? { jobId: rows[0].job_id, submissionId, assignmentId: rows[0].assignment_id } : null
}

async function claimMarks(submissionId: string) {
  const { rows } = await query<{ job_id: string; assignment_id: string; question_id: string }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id, payload->>'questionId' as question_id`,
    [submissionId],
  )
  return rows.map((r) => ({ jobId: r.job_id, submissionId, assignmentId: r.assignment_id, questionId: r.question_id }))
}

async function jobRow(jobId: string) {
  const { rows } = await query<{ status: string; model_request: any; model_response: any }>(
    'select status, model_request, model_response from external_jobs where job_id = $1',
    [jobId],
  )
  return rows[0]
}

function hasBase64(value: unknown) {
  const text = JSON.stringify(value ?? null)
  return /base64|data:image|[A-Za-z0-9+/]{400,}/.test(text)
}

type Captured = { request: ModelRequest; label: string }

/** A stub model: captures the request and replies with each criterion's full allocation (or the override). */
function stubModel(captured: Captured[], award: (label: string, criterionId: string, allocation: number) => number) {
  const call: ModelJsonCall = async (request) => {
    const prompt = request.parts[0]?.text ?? ''
    const label = /^PART (\S+) /.exec(prompt)?.[1] ?? '?'
    captured.push({ request, label })
    const criteria = [...prompt.matchAll(/success_criteria_id "([^"]+)" \(topic: [^)]*\): holds 0 to (\d+)\./g)].map((m) => ({
      success_criteria_id: m[1],
      awarded: award(label, m[1], Number(m[2])),
      why_not_awarded: '',
      how_to_improve: '',
    }))
    const data = { criteria, evidence_note: NOTE(label) }
    return { data: data as never, raw: JSON.stringify(data), durationMs: 5, attempts: 1 }
  }
  return call
}

const textOf = (request: ModelRequest) => request.parts.filter((part) => part.text !== undefined).map((part) => part.text).join('\n')
/** The evidence part of the prompt (between its heading and the marking instructions). */
const evidenceText = (request: ModelRequest) => {
  const prompt = request.parts[0]?.text ?? ''
  const start = prompt.indexOf('\n', prompt.indexOf("THE PUPIL'S EVIDENCE FOR THIS PART"))
  return prompt.slice(start, prompt.indexOf('First write the evidence_note'))
}
const inline = (request: ModelRequest) => request.parts.filter((part) => part.inline_data)
/** The label text part right before each attachment. */
const labels = (request: ModelRequest) =>
  request.parts.flatMap((part, i) => (part.inline_data ? [request.parts[i - 1]?.text ?? ''] : []))

async function main() {
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const shotA = await readFile(path.join(FIXTURES, 'pearl-images', 'LOGO.png'))
  const shotB = await readFile(path.join(FIXTURES, 'pearl-images', 'TURTLE.jpg'))
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((s) => s.success_criteria_id)

  await setUp()
  try {
    const lessons = createLocalStorageClient(LESSONS_BUCKET)
    await lessons.upload(`lessons/${LESSON}/activities/${PPT}/${REFERENCE_FILE}`, await docx([p(BRIEF)]), {
      contentType: 'application/octet-stream',
    })

    const q = (label: string, evidence: unknown[], criteria = [{ successCriteriaId: A, maxMarks: 1 }]) => ({
      label,
      maxMarks: criteria.reduce((sum, c) => sum + c.maxMarks, 0),
      markScheme: `Mark scheme for ${label}.`,
      evidence,
      criteria,
    })
    const saved = await setAssessmentQuestions(PPT, [
      // The presentation, one slide only, two criteria.
      q('P1', [{ source: 'presentation', slot: 'deck', sections: ['slides:3'] }],
        [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }]),
      // The printout PDF alone.
      q('F1', [{ source: 'file', slot: 'printout', required: true }]),
      // Screenshots under a heading.
      q('E1', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true }]),
      // Typed text.
      q('W1', [{ source: 'evidence_section', slot: 'evidence', want: 'text', required: true }]),
      // Rendered slides with the first slide's report.
      q('V1', [{ source: 'slide_images', slot: 'deck', slides: [1, 2] }, { source: 'presentation', slot: 'deck', sections: ['slides:1'] }]),
      // A slide and the teacher's reference file.
      q('R1', [{ source: 'presentation', slot: 'deck', sections: ['slides:2'] }, { source: 'reference_file', fileName: REFERENCE_FILE }]),
      // More screenshots than one call takes.
      q('BIG', [{ source: 'evidence_section', slot: 'evidence', want: 'screenshots' }]),
    ])
    const labelOf = (questionId: string) => saved.find((s) => s.questionId === questionId)?.label ?? '?'

    const evidenceDoc = await docx([
      p('Name: Ann'),
      h1('E1'), pic(shotA, 'png'), pic(shotB, 'jpg'),
      h1('W1'), p(TYPED),
      h1('BIG'), ...Array.from({ length: MARK_MAX_IMAGES + 1 }, (_, i) => pic(i % 2 ? shotA : shotB, i % 2 ? 'png' : 'jpg')),
    ])
    const printout = await pdf(['PRINTOUT page one', 'PRINTOUT page two'])
    const store = (pupilId: string, slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: PPT, pupilId, slotKey, bytes, originalName, uploadedBy: pupilId })
    for (const pupil of PUPILS) {
      await store(pupil, 'deck', pptx, 'My Deck.pptx')
      await store(pupil, 'printout', printout, 'Printout.pdf')
      await store(pupil, 'evidence', evidenceDoc, 'EVIDENCE.docx')
      await handInPowerPointAssessment(PPT, pupil, { userId: pupil, isTeacher: false })
    }

    // --- The read, with the real renderer (Gotenberg when it is reachable) ----
    const sub = await latestSubmission(PUPIL)
    const read = await claimRead(sub.submission_id)
    if (!read) throw new Error('no read job')
    const readOutcome = await runPowerPointReadJob(read)
    check('the read is not held', readOutcome.held === null, String(readOutcome.held))
    const { rows: [deckEvidence] } = await query<{ report: any; image_paths: string[]; cache_key: string; file_id: string }>(
      "select report, image_paths, cache_key, file_id::text as file_id from practical_submission_evidence where submission_id = $1 and slot_key = 'deck'",
      [sub.submission_id],
    )
    const slideImages = deckEvidence.report?.slideImages
    const rendered = slideImages?.status === 'ok'
    console.log(`INFO slide rendering: ${rendered ? `rendered by Gotenberg (${slideImages.images.length} slides)` : `fallback (${slideImages?.reason ?? 'no slideImages'})`}`)
    const storage = createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET)
    if (rendered) {
      check('every slide is drawn', slideImages.slideCount === 6 && slideImages.images.length === 6 && slideImages.notRendered.length === 0,
        JSON.stringify({ count: slideImages.slideCount, n: slideImages.images.length }))
      check('slides are stored under evidence/slide-N',
        slideImages.images.every((im: any, i: number) => im.slide === i + 1
          && new RegExp(`^${PPT}/practical/${deckEvidence.file_id}/evidence/slide-${i + 1}\\.(png|jpg)$`).test(im.path)),
        JSON.stringify(slideImages.images.map((im: any) => im.path)))
      check('…and listed on the evidence row', deckEvidence.image_paths.length === 6
        && deckEvidence.image_paths.every((p) => slideImages.images.some((im: any) => im.path === p)))
      const stats = await Promise.all(slideImages.images.map((im: any) => storage.stat(im.path)))
      check('…as stored files', stats.every(Boolean))
      const first = await (async () => {
        const { stream } = await storage.getFileStream(slideImages.images[0].path)
        const chunks: Buffer[] = []
        for await (const c of stream!) chunks.push(Buffer.from(c))
        return sharp(Buffer.concat(chunks)).metadata()
      })()
      check(`a slide's long side is at most ${SLIDE_IMAGE_MAX_SIDE} px`,
        Math.max(first.width ?? 0, first.height ?? 0) <= SLIDE_IMAGE_MAX_SIDE && (first.width ?? 0) > 800, `${first.width}×${first.height}`)
      check('the cache key names the rendering', /:slides-1:/.test(deckEvidence.cache_key) && !/not-rendered/.test(deckEvidence.cache_key), deckEvidence.cache_key)
      check('a pupil cannot open a rendered slide', !(await pupilMayOpenPracticalFile(slideImages.images[0].path, { userId: PUPIL, roles: ['pupil'] })))
    } else {
      check('rendering unavailable is recorded, not held', slideImages?.status === 'unavailable' && readOutcome.held === null, JSON.stringify(slideImages))
      check('…and tried again next read', /:not-rendered$/.test(deckEvidence.cache_key), deckEvidence.cache_key)
    }

    // --- Every mark job, through the stubbed model ------------------------------
    const captured: Captured[] = []
    const award = (label: string, id: string, allocation: number) => (label === 'P1' && id === B ? 0 : allocation)
    const jobs = await claimMarks(sub.submission_id)
    const queuedLabels = jobs.map((j) => labelOf(j.questionId)).sort().join(',')
    check('every question is queued', queuedLabels === 'BIG,E1,F1,P1,R1,V1,W1', queuedLabels)

    // An invalid reply throws, and is not permanent, so the job retries.
    const w1 = jobs.find((j) => labelOf(j.questionId) === 'W1')!
    const bad: ModelJsonCall = async () => ({ data: { criteria: [{ success_criteria_id: A, awarded: 5, why_not_awarded: '', how_to_improve: '' }], evidence_note: 'x' } as never, raw: '{}', durationMs: 1, attempts: 1 })
    const badError = await runPowerPointMarkJob(w1, bad).then(() => null, (error) => error)
    check('an invalid reply throws', badError instanceof Error && /awards 5/.test(badError.message), String(badError?.message))
    check('…as a retryable error', badError && (badError as { permanent?: boolean }).permanent !== true)
    const noNote: ModelJsonCall = async () => ({ data: { criteria: [{ success_criteria_id: A, awarded: 1, why_not_awarded: '', how_to_improve: '' }] } as never, raw: '{}', durationMs: 1, attempts: 1 })
    const noNoteError = await runPowerPointMarkJob(w1, noNote).then(() => null, (error) => error)
    check('a reply with no evidence_note throws', noNoteError instanceof Error && /evidence_note/.test(noNoteError.message), String(noNoteError?.message))
    check('…and nothing was written', (await query('select 1 from submission_question_criterion_marks where submission_id = $1 and question_id = $2', [sub.submission_id, w1.questionId])).rows.length === 0)

    // Damage the output guard catches: a pupil comment ending in a stray digit,
    // and a teacher note carrying an HTML tag. Both throw, retryably, and write nothing.
    const damaged = (comment: string, note: string): ModelJsonCall => async () => ({
      data: { evidence_note: note, criteria: [{ success_criteria_id: A, awarded: 0, why_not_awarded: 'Slide 3 starts On Click.', how_to_improve: comment }] } as never,
      raw: '{}', durationMs: 1, attempts: 1,
    })
    const digitError = await runPowerPointMarkJob(w1, damaged('Set it to After Previous so they play one after another automatically.4', 'Slide 3: On Click.')).then(() => null, (error) => error)
    check('a pupil comment ending ".4" throws', digitError instanceof Error && /trailing-digit/.test(digitError.message), String(digitError?.message))
    check('…as a retryable error', digitError && (digitError as { permanent?: boolean }).permanent !== true)
    const tagError = await runPowerPointMarkJob(w1, damaged('Set it to After Previous.', 'Slide 3 starts On Click, so 0 marks awarded.</br>')).then(() => null, (error) => error)
    check('a teacher note with </br> throws', tagError instanceof Error && /evidence_note .*html-tag/.test(tagError.message), String(tagError?.message))
    check('…and nothing was written', (await query('select 1 from submission_question_criterion_marks where submission_id = $1 and question_id = $2', [sub.submission_id, w1.questionId])).rows.length === 0)

    // BIG goes over the picture cap: a permanent error naming the question, no call.
    const big = jobs.find((j) => labelOf(j.questionId) === 'BIG')!
    const bigError = await runPowerPointMarkJob(big, stubModel(captured, award)).then(() => null, (error) => error)
    check('over the picture cap is refused permanently, naming the question',
      bigError && (bigError as { permanent?: boolean }).permanent === true && /^Question BIG: .*11 pictures \(at most 10\)/.test(bigError.message),
      String(bigError?.message))
    check('…before any model call', captured.length === 0, String(captured.length))
    // The worker would fail it; here it is closed as an abandoned job.
    await completeAssessmentQuestionMark({ submissionId: sub.submission_id, jobId: big.jobId, rows: [] })

    let last: Awaited<ReturnType<typeof runPowerPointMarkJob>> | null = null
    const rest = jobs.filter((j) => j !== big)
    for (const [i, job] of rest.entries()) {
      const before = await latestSubmission(PUPIL)
      if (i < rest.length - 1) {
        last = await runPowerPointMarkJob(job, stubModel(captured, award))
        check(`not marked while jobs are open (${labelOf(job.questionId)})`, !last.complete && before.mark_status !== 'marked')
      } else {
        last = await runPowerPointMarkJob(job, stubModel(captured, award))
      }
    }
    const req = (label: string) => captured.find((c) => c.label === label)?.request
    if (process.env.DUMP_PROMPTS) for (const c of captured) console.log(`----- ${c.label}\n${textOf(c.request)}`)
    check('one model call per marked question', captured.map((c) => c.label).sort().join(',') === 'E1,F1,P1,R1,V1,W1', captured.map((c) => c.label).join(','))
    check('the system prompt and schema', captured.every((c) => c.request.systemText === POWERPOINT_MARK_SYSTEM
      && Boolean((c.request.responseSchema as any)?.properties?.evidence_note)
      && (c.request.responseSchema as any).required.includes('evidence_note')))
    check('the schema asks for evidence_note before the marks',
      captured.every((c) => Object.keys((c.request.responseSchema as any).properties).join(',') === 'evidence_note,criteria'),
      Object.keys((captured[0]?.request.responseSchema as any)?.properties ?? {}).join(','))
    check('the prompt decides point by point, every condition and do-not-accept clause, note first',
      captured.every((c) => {
        const prompt = c.request.parts[0]?.text ?? ''
        return prompt.indexOf('First write the evidence_note') > prompt.indexOf("THE PUPIL'S EVIDENCE FOR THIS PART")
          && prompt.includes('every "Check / do not accept" clause')
          && /earned only when every condition is met and no do-not-accept clause applies/.test(prompt)
          && /one condition not met, or one do-not-accept clause applying, is 0 for that point/.test(prompt)
      }))
    check('the system prompt: every condition, no mark against a failed condition, the whole presentation',
      /every one of its conditions met and no do-not-accept clause applies/.test(POWERPOINT_MARK_SYSTEM)
      && /never award a point while noting that one of its conditions is missing/.test(POWERPOINT_MARK_SYSTEM)
      && /judge every slide in the evidence/.test(POWERPOINT_MARK_SYSTEM)
      && /stretched or not at its own aspect ratio, overlapping, off the slide or cut off/.test(POWERPOINT_MARK_SYSTEM)
      && /missing or empty count against it/.test(POWERPOINT_MARK_SYSTEM)
      && /Write it first, before the marks/.test(POWERPOINT_MARK_SYSTEM))

    const p1 = req('P1')!
    check('presentation part: its slide only', /^SLIDE 3 \(/m.test(textOf(p1)) && !/^SLIDE 1 \(/m.test(textOf(p1)) && !/^SLIDE MASTER/m.test(textOf(p1)), textOf(p1).slice(0, 400))
    check('…labelled, with no attachments', /PRESENTATION REPORT, Presentation \(deck\.pptx\), slides:3:/.test(textOf(p1)) && inline(p1).length === 0)
    check('…and nothing else of the work', !/FILE |EVIDENCE |REFERENCE FILE|PRINTOUT|SLIDE PICTURES/.test(evidenceText(p1)), evidenceText(p1).slice(0, 300))

    const f1 = req('F1')!
    check('PDF part: exactly one PDF attachment', inline(f1).length === 1 && inline(f1)[0].inline_data!.mime_type === 'application/pdf')
    check('…labelled with the slot, name and pages', labels(f1)[0] === 'FILE Printout (printout.pdf, 2 pages):', labels(f1).join('|'))
    check('…and no presentation text', !/PRESENTATION REPORT|^SLIDE \d/m.test(textOf(f1)) && !/EVIDENCE /.test(evidenceText(f1)), evidenceText(f1))
    check('…the PDF is the pupil\'s file', Buffer.from(inline(f1)[0].inline_data!.data, 'base64').equals(printout))

    const e1 = req('E1')!
    check('screenshot part: its two screenshots', inline(e1).length === 2 && inline(e1).every((part) => /^image\/(png|jpeg)$/.test(part.inline_data!.mime_type)))
    check('…labelled by heading', labels(e1).join('|') === 'EVIDENCE E1, SCREENSHOT 1:|EVIDENCE E1, SCREENSHOT 2:', labels(e1).join('|'))
    check('…and nothing else', !/PRESENTATION REPORT|FILE |TYPED TEXT/.test(evidenceText(e1)))

    const w1req = req('W1')!
    check('text part: no attachments', inline(w1req).length === 0)
    check('…the typed text, labelled', textOf(w1req).includes(`EVIDENCE W1, TYPED TEXT (evidence.docx):\n${TYPED}`), textOf(w1req).slice(-1200))
    check('…and no presentation', !/PRESENTATION REPORT/.test(textOf(w1req)))

    const v1 = req('V1')!
    if (rendered) {
      check('slide part: the two rendered slides', inline(v1).length === 2 && labels(v1).join('|')
        === 'SLIDE 1 (rendered by LibreOffice; fonts and effects may differ slightly from PowerPoint):|SLIDE 2 (rendered by LibreOffice; fonts and effects may differ slightly from PowerPoint):',
        labels(v1).join('|'))
      check('…as PNG or JPEG', inline(v1).every((part) => /^image\/(png|jpeg)$/.test(part.inline_data!.mime_type)))
    } else {
      check('slide part: the not-available note and no pictures', inline(v1).length === 0 && /Rendered slides are not available/.test(textOf(v1)))
    }
    check('…with slide 1\'s report', /^SLIDE 1 \(layout/m.test(evidenceText(v1)) && !/^SLIDE 2 \(layout/m.test(evidenceText(v1)))

    const r1 = req('R1')!
    check('reference part: the reference file\'s text', textOf(r1).includes(`REFERENCE FILE ${REFERENCE_FILE} (the teacher's material given to the pupil, not the pupil's work):\n${BRIEF}`))
    check('…with its slide, no attachments', /^SLIDE 2 \(/m.test(textOf(r1)) && inline(r1).length === 0)

    // --- What is stored ------------------------------------------------------
    const final = await latestSubmission(PUPIL)
    const expected = 1 /* P1: A only */ + 5 /* F1 E1 W1 V1 R1 */
    check('the last job marks the submission', Boolean(last?.complete) && final.mark_status === 'marked', String(final.mark_status))
    check('the score is the sum of the marks', last?.totals?.awarded === expected && Number(final.body?.marks) === expected,
      JSON.stringify({ totals: last?.totals, marks: final.body?.marks }))

    const { rows: notes } = await query<{ question_id: string; marker_evidence: string | null }>(
      'select question_id, marker_evidence from submission_question_answers where submission_id = $1', [sub.submission_id])
    const noteOf = (label: string) => notes.find((n) => labelOf(n.question_id) === label)?.marker_evidence
    check('the marker\'s note is stored as marker_evidence', ['P1', 'F1', 'E1', 'W1', 'V1', 'R1'].every((l) => noteOf(l) === NOTE(l)),
      JSON.stringify(notes.map((n) => [labelOf(n.question_id), n.marker_evidence])))
    check('…and not for a question that was not marked', !noteOf('BIG'))
    const { rows: comments } = await query<{ c: string | null }>(
      `select coalesce(why_not_awarded, '') || ' ' || coalesce(how_to_improve, '') as c
         from submission_question_criterion_marks where submission_id = $1`, [sub.submission_id])
    check('…never in a pupil-facing comment or the submission body',
      comments.every((r) => !(r.c ?? '').includes('NOTE-FOR-TEACHER')) && !JSON.stringify(final.body).includes('NOTE-FOR-TEACHER'))
    try {
      const { readAssessmentFeedbackPdfData } = await import('@/lib/assessment-paper/feedback-pdf')
      const data = await readAssessmentFeedbackPdfData(PPT, PUPIL)
      check('…nor in the pupil\'s feedback PDF data', !JSON.stringify(data).includes('NOTE-FOR-TEACHER'))
    } catch (error) {
      console.log(`INFO pupil feedback PDF data not built for this type yet (Task 7): ${(error as Error).message.slice(0, 120)}`)
    }

    const { rows: markRows } = await query<{ model_request: any; model_response: any; payload: any }>(
      `select model_request, model_response, payload from external_jobs
        where job_type = 'ai_mark' and payload->>'submissionId' = $1 and model_request is not null`, [sub.submission_id])
    check('every marked job records its call', markRows.length === 6, String(markRows.length))
    check('the pupil\'s own file names reach neither the model nor the job rows',
      captured.every((c) => !/My Deck|Printout\.pdf|EVIDENCE\.docx/.test(textOf(c.request)))
      && markRows.every((r) => !/My Deck|Printout\.pdf|EVIDENCE\.docx/.test(JSON.stringify(r.model_request))))
    check('no base64 on the job rows', markRows.every((r) => !hasBase64(r.model_request) && !hasBase64(r.model_response)))
    const f1Row = markRows.find((r) => r.model_request.label === 'F1')?.model_request
    check('the job row lists attachments as metadata', f1Row?.attachments?.length === 1
      && f1Row.attachments[0].label === 'FILE Printout (printout.pdf, 2 pages):' && f1Row.attachments[0].mimeType === 'application/pdf'
      && f1Row.attachments[0].bytes === printout.byteLength && f1Row.attachments[0].fileName === 'printout.pdf', JSON.stringify(f1Row?.attachments))
    const p1Row = markRows.find((r) => r.model_request.label === 'P1')
    check('…and text sections by key', p1Row?.model_request.textSections?.length === 1
      && p1Row.model_request.textSections[0].key === 'presentation:deck:slides:3' && p1Row.model_request.textSections[0].chars > 50,
      JSON.stringify(p1Row?.model_request.textSections))
    check('…the provider, model, system, prompt and criteria', Boolean(p1Row?.model_request.provider && p1Row.model_request.model
      && p1Row.model_request.system === POWERPOINT_MARK_SYSTEM && p1Row.model_request.prompt.startsWith('PART P1 ')
      && p1Row.model_request.criteria.length === 2 && p1Row.model_request.questionId))
    check('…and the reply, with the note', p1Row?.model_response.marksAwarded === 1 && p1Row.model_response.evidenceNote === NOTE('P1')
      && typeof p1Row.model_response.raw === 'string' && p1Row.model_response.raw.length <= 4000)

    // --- The second pupil: a renderer that fails ------------------------------
    const sub2 = await latestSubmission(SECOND)
    const read2 = await claimRead(sub2.submission_id)
    if (!read2) throw new Error('no second read job')
    const offReaders: PowerPointReaders = {
      inspectPptx, readEvidenceDocument, pdfPageCount, pdfText,
      renderPresentation: async () => ({ pdf: null, error: 'the test renderer is off' }),
    }
    const out2 = await runPowerPointReadJob(read2, offReaders)
    check('a failed rendering does not hold the submission', out2.held === null && out2.queuedQuestionIds.length === 7, String(out2.held))
    const read2Row = await jobRow(read2.jobId)
    check('…the read job row records it', read2Row.model_response?.slots?.find((s: any) => s.slot === 'deck')?.warnings
      ?.includes('Rendered slides are not available: the test renderer is off.'), JSON.stringify(read2Row.model_response?.slots))
    const { rows: [deck2] } = await query<{ cache_key: string; image_paths: string[] }>(
      "select cache_key, image_paths from practical_submission_evidence where submission_id = $1 and slot_key = 'deck'", [sub2.submission_id])
    check('…no slide pictures are stored', deck2.image_paths.length === 0)
    const { rows: [v1Answer] } = await query<{ transcription: string; status: string }>(
      'select transcription, status from submission_question_answers where submission_id = $1 and question_id = $2',
      [sub2.submission_id, saved.find((s) => s.label === 'V1')!.questionId])
    check('…the slide part is still answered', v1Answer.status === 'answered' && /pictures of slides 1, 2 not available/.test(v1Answer.transcription), JSON.stringify(v1Answer))
    const jobs2 = await claimMarks(sub2.submission_id)
    const captured2: Captured[] = []
    await runPowerPointMarkJob(jobs2.find((j) => labelOf(j.questionId) === 'V1')!, stubModel(captured2, award))
    const v1b = captured2[0]?.request
    check('the slide part gets the not-available note and no pictures', Boolean(v1b) && inline(v1b!).length === 0
      && textOf(v1b!).includes('Rendered slides are not available: the test renderer is off.'), v1b ? textOf(v1b).slice(-1500) : 'no call')
    check('…still with the slide\'s report', Boolean(v1b) && /^SLIDE 1 \(/m.test(textOf(v1b!)))

    // The next read tries the rendering again (the presentation is not cached).
    await query("update external_jobs set status = 'done' where payload->>'submissionId' = $1 and status in ('pending', 'processing')", [sub2.submission_id])
    await query("update submissions set mark_status = 'waiting' where submission_id = $1", [sub2.submission_id])
    await query(
      "insert into external_jobs (job_type, payload) values ('ai_read', jsonb_build_object('submissionId', $1::text, 'assignmentId', $2::text))",
      [sub2.submission_id, read2.assignmentId])
    const reread = await claimRead(sub2.submission_id)
    let inspected = 0
    let renderCalls = 0
    await runPowerPointReadJob(reread!, {
      ...offReaders,
      inspectPptx: (...args) => { inspected += 1; return inspectPptx(...args) },
      renderPresentation: async () => { renderCalls += 1; return { pdf: null, error: 'still off' } },
    })
    check('a presentation whose slides were not rendered is read again', inspected === 1 && renderCalls === 1, JSON.stringify({ inspected, renderCalls }))
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
