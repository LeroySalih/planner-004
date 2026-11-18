import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createElement, type ReactElement } from 'react'

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { readAssessmentFeedbackPdfData } from '@/lib/assessment-paper/feedback-pdf'
import { readClassFeedbackPdfData, renderClassFeedbackPdf } from '@/lib/assessment-paper/class-feedback-pdf'
import { buildPupilAssessmentFeedback, pupilQuestionFlagRefusal } from '@/lib/assessment-paper/pupil-feedback'
import {
  flagAssessmentQuestion,
  readQuestionFlags,
  resolveAssessmentQuestionFlags,
} from '@/lib/assessment-paper/question-flags'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import { readAssessmentPaperResult } from '@/lib/assessment-paper/results'
import { setAssessmentQuestions, setTeacherQuestionCriterionMark } from '@/lib/assessment-paper/store'
import { checkActivityStartingDatabase } from '@/lib/powerpoint-assessment/editor'
import {
  LESSONS_BUCKET,
  handInPowerPointAssessment,
  listPracticalFiles,
  storePracticalFile,
} from '@/lib/powerpoint-assessment/files'
import { runPowerPointMarkJob, runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { defaultDatabaseAssessmentBody } from '@/lib/practical-assessment/types'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { AssessmentPaperFeedbackDocument } from '@/components/pdf/assessment-paper-feedback-document'

// A database assessment on the teacher's results page, in the pupil's
// feedback and in the feedback PDFs. The Palm Grove Vets model answer and
// its EVIDENCE document are handed in and read by the real reader, then
// marked through runPowerPointMarkJob with a stub model (never a real call).
// Checks: result.powerpoint lists the database and evidence slots with their
// reader status, and a refused file shows its error; a question's
// evidenceTexts are the database report sections the marker is given (the
// query design for a query question), titled by slot label, never the file
// name, and [] for screenshot and typed-text questions; the pupil's feedback
// carries no evidenceTexts, AI mark, marker's note or mark scheme; the
// feedback PDF builds, titled by the type's label when the activity has no
// title; the class PDF reads "not sat" as not handed in and "held" as
// stopped with a reason; a pupil flags a database question and a teacher
// resolves it; checkActivityStartingDatabase reads the starting database
// (3 tables, no queries) and words a refusal with the file's name. Creates
// its own unit, lesson, activity, class and people, and removes all of it.
// Run with DATABASE_URL set (MARKING_QUEUE_SECRET empty; mdbtools and
// poppler-utils installed):
//   npx tsx tests/database-assessment/results.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const execFileAsync = promisify(execFile)
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const tag = randomUUID().slice(0, 8)
const UNIT = `db-res-check-unit-${tag}`
const LESSON = `db-res-check-lesson-${tag}`
const ACT = randomUUID()
const GROUP = `db-res-check-group-${tag}`
const MARKED = `db-res-check-marked-${tag}`
const HELD = `db-res-check-held-${tag}`
const UPLOADED = `db-res-check-uploaded-${tag}`
const ABSENT = `db-res-check-absent-${tag}`
const TEACHER = `db-res-check-teacher-${tag}`
const PUPILS = [MARKED, HELD, UPLOADED, ABSENT]

const TEMPLATE_FILE = 'EVIDENCE.docx'
const START_FILE = 'PALM GROVE VETS.accdb'
const DAMAGED_FILE = 'DAMAGED.accdb'
const DB_NAME = `Pupil-Smith-db-${tag}.accdb`
const DOC_NAME = `Pupil-Smith-evidence-${tag}.docx`
const NOTE = (label: string) => `SECRET-MARKER-NOTE ${label}`
const MARK_SCHEME = (label: string) => `SECRET-MARK-SCHEME ${label}`
const READ_ERROR = 'DINO could not open this database (check).'

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  const names = [['Ann', 'Aaa'], ['Ben', 'Bbb'], ['Cat', 'Ccc'], ['Dan', 'Ddd']]
  for (const [index, id] of PUPILS.entries()) {
    await query('insert into profiles (user_id, first_name, last_name) values ($1, $2, $3)', [id, ...names[index]])
    await query("insert into user_roles (user_id, role_id) values ($1, 'pupil')", [id])
  }
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Tia', 'Ttt')", [TEACHER])
  await query("insert into user_roles (user_id, role_id) values ($1, 'teacher')", [TEACHER])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database results unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database results check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'database-assessment', 'Database task', $3::jsonb, 0)",
    [ACT, LESSON, JSON.stringify({
      instructions: 'Complete the database tasks.',
      ...defaultDatabaseAssessmentBody(),
      evidenceTemplateFile: TEMPLATE_FILE,
      startingDatabaseFile: START_FILE,
    })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  for (const id of PUPILS) await query('insert into group_membership (group_id, user_id) values ($1, $2)', [GROUP, id])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  for (const [bucket, prefix] of [[ASSESSMENT_SCRIPTS_BUCKET, ACT], [LESSONS_BUCKET, `${LESSON}/`]] as const) {
    const { rows } = await query<{ scope_path: string; file_name: string }>(
      'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
      [bucket, `${prefix}%`],
    )
    const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
    if (paths.length > 0) await createLocalStorageClient(bucket).remove(paths)
    await query('delete from stored_files where bucket = $1 and scope_path like $2', [bucket, `${prefix}%`])
  }
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, ACT), { recursive: true, force: true })
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, LESSON), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where activity_id = $1)", [ACT])
  await query('delete from submissions where activity_id = $1', [ACT])
  await query('delete from pupil_activity_feedback where activity_id = $1', [ACT]).catch(() => {})
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = any($1::text[])', [[...PUPILS, TEACHER]])
  await query('delete from profiles where user_id = any($1::text[])', [[...PUPILS, TEACHER]])
}

async function pdfText(buffer: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-res-'))
  try {
    const file = path.join(dir, 'out.pdf')
    await writeFile(file, buffer)
    return (await execFileAsync('pdftotext', ['-layout', file, '-'])).stdout
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function latestSubmissionId(pupilId: string) {
  const { rows } = await query<{ submission_id: string }>(
    `select submission_id from submissions where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc limit 1`,
    [ACT, pupilId],
  )
  return rows[0]?.submission_id
}

async function claim(submissionId: string, jobType: 'ai_read' | 'ai_mark') {
  const { rows } = await query<{ job_id: string; assignment_id: string; question_id: string | null }>(
    `update external_jobs set status = 'processing', updated_at = now()
      where job_type = $2 and status = 'pending' and payload->>'submissionId' = $1
      returning job_id, payload->>'assignmentId' as assignment_id, payload->>'questionId' as question_id`,
    [submissionId, jobType],
  )
  return rows.map((r) => ({ jobId: r.job_id, submissionId, assignmentId: r.assignment_id, questionId: r.question_id ?? '' }))
}

/** A fake model: each criterion's full allocation, and a note for the teacher. */
const fakeModel: ModelJsonCall = async (request) => {
  const prompt = request.parts[0]?.text ?? ''
  const label = /^PART (\S+) /.exec(prompt)?.[1] ?? '?'
  const criteria = [...prompt.matchAll(/success_criteria_id "([^"]+)" \(topic: [^)]*\): holds 0 to (\d+)\./g)].map((m) => ({
    success_criteria_id: m[1],
    awarded: Number(m[2]),
    why_not_awarded: '',
    how_to_improve: `AI-HOW ${label}`,
  }))
  const data = { evidence_note: NOTE(label), criteria }
  return { data: data as never, raw: JSON.stringify(data), durationMs: 5, attempts: 1 }
}

function keysOf(value: unknown): Set<string> {
  const keys = new Set<string>()
  const walk = (inner: unknown) => {
    if (Array.isArray(inner)) inner.forEach(walk)
    else if (inner && typeof inner === 'object') {
      for (const [key, next] of Object.entries(inner)) {
        keys.add(key)
        walk(next)
      }
    }
  }
  walk(value)
  return keys
}

async function main() {
  const modelDb = await readFile(path.join(FIXTURES, 'palm-grove-model-answer.accdb'))
  const startDb = await readFile(path.join(FIXTURES, 'palm-grove-start.accdb'))
  const evidenceDoc = await readFile(path.join(FIXTURES, 'palm-grove-evidence-model-answer.docx'))
  const template = await readFile(path.join(FIXTURES, 'palm-grove-evidence-template.docx'))
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
    const activityFile = (name: string, bytes: Buffer) =>
      lessons.upload(`lessons/${LESSON}/activities/${ACT}/${name}`, bytes, { contentType: 'application/octet-stream' })
    await activityFile(TEMPLATE_FILE, template)
    await activityFile(START_FILE, startDb)
    await activityFile(DAMAGED_FILE, Buffer.concat([startDb.subarray(0, 4096), Buffer.alloc(8192, 0x5a)]))

    // --- The editor's starting database check ---------------------------------------
    const start = await checkActivityStartingDatabase(ACT)
    check('starting database: the saved file is read', start.fileName === START_FILE)
    check('…3 tables and 0 queries', start.tables.length === 3 && start.queries.length === 0, JSON.stringify(start))
    check('…each table with its record count', start.tables.every((t) => typeof t.name === 'string' && Number.isInteger(t.rows) && t.rows >= 0), JSON.stringify(start.tables))
    const refusal = (name: string) => checkActivityStartingDatabase(ACT, name).then(() => null, (error: Error) => error.message)
    const damaged = await refusal(DAMAGED_FILE)
    check('a damaged database is refused, naming the file', damaged?.startsWith(`${DAMAGED_FILE}: `) === true, String(damaged))
    check('a missing file is refused', (await refusal('NOPE.accdb'))?.includes('has no file called "NOPE.accdb"') === true)
    check('a file that is not .accdb is refused', (await refusal(TEMPLATE_FILE)) === "The starting database must be one of this activity's .accdb files.")

    const q = (label: string, evidence: unknown[], criteria = [{ successCriteriaId: A, maxMarks: 1 }]) => ({
      label,
      maxMarks: criteria.reduce((sum, c) => sum + c.maxMarks, 0),
      questionText: `Task ${label}.`,
      markScheme: MARK_SCHEME(label),
      evidence,
      criteria,
    })
    const db = (sections?: string[]) => ({ source: 'database', slot: 'database', ...(sections ? { sections } : {}) })
    await setAssessmentQuestions(ACT, [
      q('D3', [db(['query:MICROCHIP REMINDER'])], [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }]),
      q('CH', [db(['changes', 'records:OWNERS'])]),
      q('DF', [db()]),
      q('6', [{ source: 'evidence_section', slot: 'evidence', heading: '6', want: 'screenshots' }]),
      q('B1', [{ source: 'evidence_section', slot: 'evidence', heading: 'B1', want: 'text' }]),
    ])

    const store = (pupilId: string, slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: ACT, pupilId, slotKey, bytes, originalName, uploadedBy: pupilId })

    // Marked: handed in, read by the reader, marked by the stub, then a teacher's change.
    await store(MARKED, 'database', modelDb, DB_NAME)
    await store(MARKED, 'evidence', evidenceDoc, DOC_NAME)
    await handInPowerPointAssessment(ACT, MARKED, { userId: MARKED, isTeacher: false })
    const marked = (await latestSubmissionId(MARKED))!
    const [readJob] = await claim(marked, 'ai_read')
    const readOutcome = await runPowerPointReadJob(readJob)
    check('(setup) the read is not held', readOutcome.held === null, String(readOutcome.held))
    for (const job of await claim(marked, 'ai_mark')) await runPowerPointMarkJob(job, fakeModel)
    const { rows: [{ mark_status: markedStatus }] } = await query<{ mark_status: string | null }>(
      'select mark_status from submissions where submission_id = $1', [marked])
    check('(setup) the work is marked', markedStatus === 'marked', String(markedStatus))

    // Held: handed in, the reader refused the database.
    await store(HELD, 'database', modelDb, DB_NAME)
    await store(HELD, 'evidence', evidenceDoc, DOC_NAME)
    await handInPowerPointAssessment(ACT, HELD, { userId: HELD, isTeacher: false })
    const held = (await latestSubmissionId(HELD))!
    await query("delete from external_jobs where payload->>'submissionId' = $1", [held])
    const heldDb = (await listPracticalFiles(held)).find((f) => f.slot_key === 'database')!
    await query(
      `insert into practical_submission_evidence (file_id, submission_id, slot_key, kind, status, error, cache_key)
       values ($1::uuid, $2, 'database', 'database', 'error', $3, 'check')`,
      [heldDb.file_id, held, READ_ERROR],
    )
    await query("update submissions set mark_status = null, mark_error = 'Not marked: the Database could not be read.' where submission_id = $1", [held])

    // Uploaded the database only, not handed in.
    await store(UPLOADED, 'database', modelDb, DB_NAME)

    // --- The teacher's result -------------------------------------------------------
    const result = await readAssessmentPaperResult(ACT, MARKED)
    const files = result.powerpoint
    check('no script on a database assessment', result.script === null)
    check('the pupil\'s files, handed in', files !== null && files.handedIn)
    check('both slots, database (accdb) then evidence (docx)',
      files?.files.map((f) => `${f.slotKey}:${f.kind}:${f.required}`).join('|') === 'database:accdb:true|evidence:docx:true',
      files?.files.map((f) => `${f.slotKey}:${f.kind}`).join('|'))
    check('…each read by the reader', files?.files.every((f) => f.evidenceStatus === 'ok' && f.evidenceError === null) === true, JSON.stringify(files?.files))
    check('…with a link and the name for the teacher', files?.files.find((f) => f.slotKey === 'database')?.name === DB_NAME
      && files.files[0].url?.startsWith(`/api/files/${ASSESSMENT_SCRIPTS_BUCKET}/${ACT}/practical/`) === true)
    const dbSummary = files?.files.find((f) => f.slotKey === 'database')?.database ?? null
    check('the database slot says what was read: tables with record counts, queries, forms, reports',
      dbSummary !== null && dbSummary.tables.length >= 3 && dbSummary.tables.every((t) => Number.isInteger(t.records))
        && dbSummary.queries.length >= 1 && Array.isArray(dbSummary.forms) && Array.isArray(dbSummary.reports),
      JSON.stringify(dbSummary))
    check('…and its changes from the starting database',
      dbSummary?.startingDatabase === START_FILE && Array.isArray(dbSummary.changes) && dbSummary.changes.length > 0,
      JSON.stringify(dbSummary?.changes))
    check('…without the pupil\'s file name', !JSON.stringify(dbSummary).includes('Pupil-Smith'))
    check('the evidence slot has no database summary', files?.files.find((f) => f.slotKey === 'evidence')?.database === null)

    const rq = (label: string) => result.questions.find((x) => x.label === label)!
    const d3Texts = rq('D3').evidenceTexts
    check('D3: one evidence text, titled by slot label and selector',
      d3Texts.length === 1 && d3Texts[0].title === 'Database report, Database, query:MICROCHIP REMINDER', JSON.stringify(d3Texts.map((t) => t.title)))
    check('…the query design, as the marker gets it',
      d3Texts[0]?.text.startsWith('QUERY "MICROCHIP REMINDER" (select query)') === true
        && d3Texts[0].text.includes('  Fields shown, in order: PETS.[PET ID], ')
        && d3Texts[0].text.includes('<#1/1/2020# (1 January 2020)')
        && d3Texts[0].text.includes('  Sort: PETS.[DATE OF BIRTH] ascending'), d3Texts[0]?.text.slice(0, 600))
    check('…and no other query or records', !/UNPAID TREATMENTS|RECORDS IN/.test(d3Texts[0]?.text ?? ''))
    const chText = rq('CH').evidenceTexts[0]?.text ?? ''
    check('CH: the changes and OWNERS\' records',
      /^CHANGES \(compared with the starting database "PALM GROVE VETS\.accdb"\)$/m.test(chText)
        && /^ {2}OWNERS: 1 record added: /m.test(chText) && /^RECORDS IN OWNERS \(/m.test(chText), chText.slice(0, 500))
    const dfText = rq('DF').evidenceTexts[0]
    check('DF (default sections): every part but records',
      dfText?.title === 'Database report, Database, every part but records' && /^TABLES \(/m.test(dfText.text) && !/^RECORDS IN /m.test(dfText.text),
      dfText?.title)
    check('screenshot and typed-text questions have no evidence texts', rq('6').evidenceTexts.length === 0 && rq('B1').evidenceTexts.length === 0)
    check('…the screenshot question has its pictures', rq('6').evidenceImages.length >= 1 && rq('6').evidenceImages.every((im) => im.caption.startsWith('6, screenshot ')),
      JSON.stringify(rq('6').evidenceImages.map((im) => im.caption)))
    check('no evidence text carries a pupil file name', result.questions.every((x) => x.evidenceTexts.every((t) => !t.title.includes('Pupil-Smith') && !t.text.includes('Pupil-Smith'))))
    check('the marker\'s note for the teacher', rq('D3').markerEvidence === NOTE('D3'))

    const absent = await readAssessmentPaperResult(ACT, ABSENT)
    check('a pupil with nothing: no evidence texts, every slot empty',
      absent.powerpoint !== null && !absent.powerpoint.handedIn && absent.powerpoint.files.every((f) => f.name === null)
        && absent.questions.every((x) => x.evidenceTexts.length === 0))
    const heldResult = await readAssessmentPaperResult(ACT, HELD)
    const heldFile = heldResult.powerpoint?.files.find((f) => f.slotKey === 'database')
    check('a refused file shows its error', heldFile?.evidenceStatus === 'error' && heldFile.evidenceError === READ_ERROR, JSON.stringify(heldFile))
    check('…and no database summary', heldFile?.database === null)
    check('…no evidence texts from a refused file', heldResult.questions.every((x) => x.evidenceTexts.length === 0))

    // A teacher's change, so the AI's own mark differs from the final one.
    const d3Id = rq('D3').questionId
    await setTeacherQuestionCriterionMark(marked, d3Id, B, 0, 'TEACHER-D3B')

    // --- The pupil's feedback ---------------------------------------------------------
    const afterChange = await readAssessmentPaperResult(ACT, MARKED)
    const feedback = await buildPupilAssessmentFeedback(afterChange, { shown: () => true, feedbackPdfUrl: null })
    const feedbackJson = JSON.stringify(feedback)
    const feedbackKeys = keysOf(feedback)
    check('pupil feedback: no evidenceTexts, AI mark, marker\'s note or sources',
      ['evidenceTexts', 'aiAwarded', 'ai_awarded', 'markerEvidence', 'marker_evidence', 'evidenceSources', 'evidenceImages', 'markScheme', 'powerpoint']
        .every((key) => !feedbackKeys.has(key)), [...feedbackKeys].join(','))
    check('…no mark scheme, marker\'s note or report text',
      !feedbackJson.includes('SECRET-MARK-SCHEME') && !feedbackJson.includes('SECRET-MARKER-NOTE') && !feedbackJson.includes('MICROCHIP REMINDER'))
    const fd3 = feedback.questions.find((x) => x.label === 'D3')
    check('…the teacher\'s comment wins', fd3?.awarded === 1 && JSON.stringify(fd3.comments).includes('TEACHER-D3B'), JSON.stringify(fd3))

    // --- The feedback PDFs --------------------------------------------------------------
    const pdfData = await readAssessmentFeedbackPdfData(ACT, MARKED)
    const pdfJson = JSON.stringify(pdfData)
    check('feedback PDF data: practical, the activity\'s title', pdfData.powerPoint && pdfData.paperTitle === 'Database task')
    check('…no marker\'s note, report text, evidence or AI mark',
      !pdfJson.includes('SECRET-MARKER-NOTE') && !pdfJson.includes('MICROCHIP REMINDER') && !pdfJson.includes('/practical/')
        && !['"evidenceTexts"', '"evidenceSources"', '"evidenceImages"', '"markerEvidence"', '"aiAwarded"'].some((key) => pdfJson.includes(key))
        && !('teacherChanges' in pdfData))
    const pupilPdf = await renderToBuffer(createElement(AssessmentPaperFeedbackDocument, { data: pdfData }) as unknown as ReactElement<DocumentProps>)
    const pupilWords = (await pdfText(Buffer.from(pupilPdf))).replace(/\s+/g, ' ')
    check('the pupil\'s PDF renders', pupilWords.includes('Ann Aaa') && pupilWords.includes('Database task') && pupilWords.includes('In your files'), pupilWords.slice(0, 400))
    const teacherCopy = await readAssessmentFeedbackPdfData(ACT, MARKED, { teacherCopy: true })
    check('the teacher copy has the AI-against-teacher marks', teacherCopy.teacherChanges?.recorded === true && teacherCopy.teacherChanges.change === -1,
      JSON.stringify(teacherCopy.teacherChanges))
    await query("update activities set title = '' where activity_id = $1", [ACT])
    check('an untitled activity is titled by its type', (await readAssessmentFeedbackPdfData(ACT, MARKED)).paperTitle === 'Database assessment')
    await query("update activities set title = 'Database task' where activity_id = $1", [ACT])

    const classData = await readClassFeedbackPdfData(ACT, GROUP)
    const status = Object.fromEntries(classData.roster.map((row) => [row.pupilName, row.status]))
    check('class roster: marked, held, not handed in and nothing are read per practical rules',
      status['Ann Aaa'] === 'marked' && status['Ben Bbb'] === 'held' && status['Cat Ccc'] === 'not sat' && status['Dan Ddd'] === 'not sat',
      JSON.stringify(status))
    check('class PDF: practical, feedback pages only for handed-in pupils',
      classData.powerPoint && classData.pupils.map((p) => p.pupilName).join('|') === 'Ann Aaa|Ben Bbb', classData.pupils.map((p) => p.pupilName).join('|'))
    const classPdf = await renderClassFeedbackPdf(ACT, GROUP)
    const classText = await pdfText(classPdf.buffer)
    check('the class PDF renders: Not handed in, no marker\'s note or report text',
      classText.includes('Not handed in') && !classText.includes('SECRET-MARKER-NOTE') && !classText.includes('MICROCHIP REMINDER'), classText.slice(0, 400))

    // --- A pupil's flag on a database question ---------------------------------------
    const refusalOf = (value: { error: string } | { activityId: string }) => ('error' in value ? value.error : null)
    check('flag refused before feedback is released',
      refusalOf(await pupilQuestionFlagRefusal(marked, d3Id, MARKED)) === 'Your feedback has not been released yet.')
    await query('update planner_assignments set feedback_visible = true where lesson_id = $1', [LESSON])
    check('flag allowed: own latest, marked, released', refusalOf(await pupilQuestionFlagRefusal(marked, d3Id, MARKED)) === null)
    check('flag refused: another pupil', refusalOf(await pupilQuestionFlagRefusal(marked, d3Id, HELD)) === 'You can only flag your own work.')
    check('flag refused: held work with no teacher\'s mark',
      refusalOf(await pupilQuestionFlagRefusal(held, d3Id, HELD)) === 'This question has not been marked yet.')
    const flagged = await flagAssessmentQuestion(marked, d3Id, MARKED)
    check('flag: is_flagged set', flagged.isFlagged)
    let flags = await readQuestionFlags(marked)
    check('flag: open on the question', flags.get(d3Id)?.open !== null && flags.get(d3Id)?.open !== undefined)
    const flaggedFeedback = await buildPupilAssessmentFeedback(await readAssessmentPaperResult(ACT, MARKED), { shown: () => true, feedbackPdfUrl: null })
    check('the pupil\'s feedback shows the open flag', flaggedFeedback.questions.find((x) => x.questionId === d3Id)?.flag.open === true)
    await setTeacherQuestionCriterionMark(marked, d3Id, B, 1, 'TEACHER-D3B-AGAIN')
    const resolved = await resolveAssessmentQuestionFlags(marked, TEACHER, d3Id)
    flags = await readQuestionFlags(marked)
    check('a teacher resolves it: changed', resolved.resolved === 1 && !resolved.isFlagged && flags.get(d3Id)?.history[0]?.outcome === 'changed',
      JSON.stringify(flags.get(d3Id)))
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1 or scope_path like $2)
          + (select count(*) from units where unit_id = $3)
          + (select count(*) from profiles where user_id = any($4::text[]))
          + (select count(*) from activities where activity_id = $5)
          + (select count(*) from groups where group_id = $6) as left`,
    [`${ACT}%`, `${LESSON}/%`, UNIT, [...PUPILS, TEACHER], ACT, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
