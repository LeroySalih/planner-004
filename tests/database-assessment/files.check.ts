import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { DATABASE_MESSAGES } from '@/lib/accdb/errors'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import {
  readAssessmentQuestions,
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import {
  HANDED_IN_MESSAGE,
  NOT_HANDED_IN_FOR_MARKING_MESSAGE,
  REPLACEMENT_REQUEUE_DELAY_SECONDS,
  handInPowerPointAssessment,
  listPracticalFiles,
  listUnmarkedPowerPointSubmissions,
  powerPointNotQueuedReason,
  pupilMayOpenPracticalFile,
  readPracticalFileBytes,
  readPracticalSlots,
  removePracticalFile,
  reopenPowerPointAssessment,
  storePracticalFile,
  storeSuppliedImage,
} from '@/lib/powerpoint-assessment/files'
import { reopenPowerPointAssessmentForTeacher } from '@/lib/powerpoint-assessment/reopen'
import { DOCX_MESSAGES } from '@/lib/pptx/package'
import { defaultDatabaseAssessmentBody } from '@/lib/practical-assessment/types'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// A database assessment's files, through the same store as a PowerPoint
// assessment's: the model .accdb and the EVIDENCE .docx stored in their slots
// (default slots); a .mdb header, .mdb and .laccdb names, garbage, a truncated
// database and a .docx in the database slot refused with the reader's message,
// and an .accdb in the evidence slot with Word's; hand-in refused while the
// database is missing, then one ai_read job queued (nothing runs it: the queue
// secret is blank); a pupil refused after hand-in; a teacher's replacement
// clears the marker's rows, keeps the teacher's and re-queues after the delay;
// Undo hand in and the Request Resubmission reopen; who may open which file,
// and nothing while the lesson is locked; the latest attempt used; the
// unmarked list; supplied images refused (PowerPoint only). The files are the
// teacher's Palm Grove Vets fixtures (no pupil data). No model is called.
// Creates its own unit, lesson, activity, class and pupils and removes them.
// Needs mdbtools. Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/database-assessment/files.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refused(run: () => Promise<unknown> | unknown, pattern: RegExp | string): Promise<[boolean, string]> {
  try {
    await run()
    return [false, 'not refused']
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [typeof pattern === 'string' ? message === pattern : pattern.test(message), message]
  }
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const tag = randomUUID().slice(0, 8)
const UNIT = `db-f-check-unit-${tag}`
const LESSON = `db-f-check-lesson-${tag}`
const DB = randomUUID()
const GROUP = `db-f-check-group-${tag}`
const PUPIL = `db-f-check-pupil-${tag}`
const OTHER = `db-f-check-other-${tag}`
const TEACHER = `db-f-check-teacher-${tag}`

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    "insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Bob', 'Bbb'), ($3, 'Tia', 'Ttt')",
    [PUPIL, OTHER, TEACHER],
  )
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil'), ($2, 'pupil'), ($3, 'teacher')", [PUPIL, OTHER, TEACHER])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database files unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database files check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'database-assessment', 'Database task', $3::jsonb, 0)",
    [DB, LESSON, JSON.stringify({ instructions: 'Build the database.', ...defaultDatabaseAssessmentBody() })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  // PUPIL and OTHER are both in the class, so OTHER is refused only another's file.
  await query('insert into group_membership (group_id, user_id) values ($1, $2), ($1, $3)', [GROUP, PUPIL, OTHER])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  const { rows } = await query<{ scope_path: string; file_name: string }>(
    'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
    [ASSESSMENT_SCRIPTS_BUCKET, `${DB}%`],
  )
  const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
  if (paths.length > 0) await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
  await query('delete from stored_files where bucket = $1 and scope_path like $2', [ASSESSMENT_SCRIPTS_BUCKET, `${DB}%`])
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, DB), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [[PUPIL, OTHER]])
  await query('delete from submission_resubmit_requests where user_id = any($1::text[])', [[PUPIL, OTHER]])
  await query('delete from submissions where user_id = any($1::text[])', [[PUPIL, OTHER]])
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = any($1::text[])', [[PUPIL, OTHER, TEACHER]])
  await query('delete from profiles where user_id = any($1::text[])', [[PUPIL, OTHER, TEACHER]])
}

async function readJobs(submissionId: string) {
  const { rows } = await query<{ job_type: string; due_in: number }>(
    `select job_type, extract(epoch from (process_after - now()))::int as due_in
       from external_jobs
      where status in ('pending', 'processing') and payload->>'submissionId' = $1`,
    [submissionId],
  )
  return rows
}

async function storedExists(fullPath: string) {
  return Boolean(await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).stat(fullPath))
}

const pupil = { userId: PUPIL, roles: ['pupil'] }
const other = { userId: OTHER, roles: ['pupil'] }
const teacher = { userId: TEACHER, roles: ['teacher'] }

async function main() {
  const accdb = await readFile(path.join(FIXTURES, 'palm-grove-model-answer.accdb'))
  const evidenceDocx = await readFile(path.join(FIXTURES, 'palm-grove-evidence-model-answer.docx'))
  const jet = Buffer.from(accdb)
  jet.write('Standard Jet DB', 4, 'latin1')
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)

  await setUp()
  try {
    const store = (slotKey: string, bytes: Buffer, originalName: string, pupilId = PUPIL) =>
      storePracticalFile({ activityId: DB, pupilId, slotKey, bytes, originalName, uploadedBy: pupilId })
    const storeAsTeacher = (slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: DB, pupilId: PUPIL, slotKey, bytes, originalName, uploadedBy: TEACHER, byTeacher: true })

    // --- Slot validation --------------------------------------------------------
    let [ok, detail] = await refused(() => store('presentation', accdb, 'Palm Grove.accdb'), /no upload slot "presentation"/)
    check('a slot the database type does not have is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('database', jet, 'Palm Grove.accdb'), DATABASE_MESSAGES.mdb)
    check('a .mdb header named .accdb is refused as an .mdb', ok, detail)
    ;[ok, detail] = await refused(() => store('database', accdb, 'Palm Grove.mdb'), DATABASE_MESSAGES.mdb)
    check('a .mdb name is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('database', accdb, 'Palm Grove.laccdb'), DATABASE_MESSAGES.lockFile)
    check('a .laccdb lock file is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('database', randomBytes(64 * 1024), 'Palm Grove.accdb'), DATABASE_MESSAGES.notAccess)
    check('garbage is refused as not an Access database', ok, detail)
    ;[ok, detail] = await refused(() => store('database', accdb.subarray(0, 4096), 'Palm Grove.accdb'), DATABASE_MESSAGES.unopenable)
    check('a truncated database is refused as unopenable', ok, detail)
    ;[ok, detail] = await refused(() => store('database', evidenceDocx, 'Palm Grove.accdb'), DATABASE_MESSAGES.notAccess)
    check('a .docx in the database slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('database', evidenceDocx, 'EVIDENCE.docx'), DATABASE_MESSAGES.notThisType)
    check('a .docx name in the database slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('evidence', accdb, 'EVIDENCE.docx'), DOCX_MESSAGES.notThisType)
    check('an .accdb in the evidence slot is refused', ok, detail)
    const { rows: [{ n: noRows }] } = await query<{ n: number }>(
      'select count(*)::int as n from practical_submission_files where activity_id = $1', [DB])
    check('nothing refused was recorded', noRows === 0, String(noRows))

    // --- Evidence first; hand-in refused while the database is missing ---------
    const evidence = await store('evidence', evidenceDocx, 'EVIDENCE.docx')
    check('the EVIDENCE .docx is stored', evidence.storage_path === `${DB}/practical/${evidence.file_id}/original.docx`, evidence.storage_path)
    ;[ok, detail] = await refused(
      () => handInPowerPointAssessment(DB, PUPIL, { userId: PUPIL, isTeacher: false }),
      'Upload Database before handing in.',
    )
    check('hand-in is refused naming the missing database', ok, detail)

    const database = await store('database', accdb, 'PALM GROVE VETS.accdb')
    check('the .accdb is stored at original.accdb', database.storage_path === `${DB}/practical/${database.file_id}/original.accdb`, database.storage_path)
    check('…on the same submission', database.submission_id === evidence.submission_id)
    check('readPracticalFileBytes returns the stored database', (await readPracticalFileBytes(database.file_id)).equals(accdb))
    const { rows: [storedRow] } = await query<{ content_type: string | null }>(
      "select content_type from stored_files where bucket = $1 and scope_path = $2 and file_name = 'original.accdb'",
      [ASSESSMENT_SCRIPTS_BUCKET, `${DB}/practical/${database.file_id}`],
    )
    check('…as an Access file', storedRow?.content_type === 'application/vnd.ms-access', String(storedRow?.content_type))
    const slotsBefore = await readPracticalSlots(DB, PUPIL)
    check('the slot state lists both slots filled', slotsBefore.slots.map((s) => `${s.key}:${s.kind}:${Boolean(s.file)}`).join(',')
      === 'database:accdb:true,evidence:docx:true' && slotsBefore.missingRequired.length === 0, JSON.stringify(slotsBefore.slots))
    check('not handed in: not queued, and says so', (await powerPointNotQueuedReason(database.submission_id)) === NOT_HANDED_IN_FOR_MARKING_MESSAGE)

    // --- Hand in ---------------------------------------------------------------
    const handedIn = await handInPowerPointAssessment(DB, PUPIL, { userId: PUPIL, isTeacher: false })
    const submissionId = handedIn.submissionId
    const { rows: [afterHandIn] } = await query<{ submission_status: string; mark_status: string | null }>(
      'select submission_status, mark_status from submissions where submission_id = $1', [submissionId])
    check('hand-in sets submitted', !handedIn.alreadyHandedIn && afterHandIn?.submission_status === 'submitted', JSON.stringify(afterHandIn))
    const jobs = await readJobs(submissionId)
    check('hand-in queues one ai_read job', jobs.length === 1 && jobs[0].job_type === 'ai_read', JSON.stringify(jobs))
    check('…and the work is waiting', afterHandIn?.mark_status === 'waiting' && (await powerPointNotQueuedReason(submissionId)) === null)

    check('not listed as unmarked while its read is queued', (await listUnmarkedPowerPointSubmissions(DB)).length === 0)
    await query("delete from external_jobs where payload->>'submissionId' = $1", [submissionId])
    const unmarked = await listUnmarkedPowerPointSubmissions(DB)
    check('listUnmarkedPowerPointSubmissions lists the database submission', unmarked.length === 1
      && unmarked[0].submissionId === submissionId && unmarked[0].pupilId === PUPIL, JSON.stringify(unmarked))

    // --- After hand-in a pupil cannot change files ------------------------------
    ;[ok, detail] = await refused(() => store('database', accdb, 'late.accdb'), HANDED_IN_MESSAGE)
    check('a pupil cannot replace the database after hand-in', ok, detail)
    ;[ok, detail] = await refused(() => removePracticalFile({ activityId: DB, pupilId: PUPIL, slotKey: 'evidence' }), HANDED_IN_MESSAGE)
    check('a pupil cannot remove a file after hand-in', ok, detail)

    // --- A teacher's replacement after hand-in ---------------------------------
    const [q1] = await setAssessmentQuestions(DB, [{
      label: '1a', maxMarks: 2, markScheme: 'Owners table created (1). Primary key set (1).',
      evidence: [{ source: 'database', slot: 'database' }],
      criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }],
    }])
    check('questions saved', (await readAssessmentQuestions(DB)).length === 1)
    await recordQuestionCriterionMarks(submissionId, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: null },
    ], 'ai')
    await setTeacherQuestionCriterionMark(submissionId, q1.questionId, B, 1)
    await query("update submissions set mark_status = 'marked' where submission_id = $1", [submissionId])
    const replaced = await storeAsTeacher('database', accdb, 'PALM GROVE VETS v2.accdb')
    check('a teacher\'s replacement after hand-in is sent again', replaced.requeued && replaced.replaced_file_id === database.file_id)
    check('the replaced database is gone', !(await storedExists(database.storage_path)))
    const { rows: marks } = await query<{ success_criteria_id: string; provenance: string }>(
      'select success_criteria_id, provenance from submission_question_criterion_marks where submission_id = $1', [submissionId])
    check('the marker\'s rows are cleared', !marks.some((m) => m.success_criteria_id === A), JSON.stringify(marks))
    check('the teacher\'s rows are kept', marks.some((m) => m.success_criteria_id === B && m.provenance === 'teacher'), JSON.stringify(marks))
    const requeued = await readJobs(submissionId)
    check('it is re-queued after the delay', requeued.length === 1 && requeued[0].job_type === 'ai_read'
      && requeued[0].due_in > REPLACEMENT_REQUEUE_DELAY_SECONDS - 30 && requeued[0].due_in <= REPLACEMENT_REQUEUE_DELAY_SECONDS, JSON.stringify(requeued))

    // --- Undo hand in ------------------------------------------------------------
    await recordQuestionCriterionMarks(submissionId, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: null },
    ], 'ai')
    const reopened = await reopenPowerPointAssessment(DB, PUPIL)
    const { rows: [afterReopen] } = await query<{ submission_status: string }>(
      'select submission_status from submissions where submission_id = $1', [submissionId])
    check('undo hand-in sets inprogress', reopened.reopened && afterReopen?.submission_status === 'inprogress' && !reopened.state.handedIn)
    check('…drops the queued jobs', (await readJobs(submissionId)).length === 0)
    check('…keeps the files', (await listPracticalFiles(submissionId)).length === 2)
    const { rows: marksAfterReopen } = await query<{ success_criteria_id: string }>(
      'select success_criteria_id from submission_question_criterion_marks where submission_id = $1', [submissionId])
    check('…clears the marker\'s rows and keeps the teacher\'s', marksAfterReopen.map((m) => m.success_criteria_id).join(',') === B, JSON.stringify(marksAfterReopen))

    // --- Request Resubmission's reopen -----------------------------------------
    const handedInAgain = await handInPowerPointAssessment(DB, PUPIL, { userId: PUPIL, isTeacher: false })
    check('the pupil can hand in again on the same attempt', !handedInAgain.alreadyHandedIn && handedInAgain.submissionId === submissionId)
    const forTeacher = await reopenPowerPointAssessmentForTeacher(DB, PUPIL, TEACHER)
    const { rows: [afterTeacherReopen] } = await query<{ submission_status: string }>(
      'select submission_status from submissions where submission_id = $1', [submissionId])
    check('the Request Resubmission reopen works', forTeacher.reopened && afterTeacherReopen?.submission_status === 'inprogress'
      && (await readJobs(submissionId)).length === 0)

    // --- Who may open what -----------------------------------------------------
    const own = replaced.storage_path
    check('the pupil may open their own original.accdb', await pupilMayOpenPracticalFile(own, pupil))
    check('…but not what was read from it', !(await pupilMayOpenPracticalFile(`${DB}/practical/${replaced.file_id}/evidence/1-1.png`, pupil)))
    check('another pupil may not', !(await pupilMayOpenPracticalFile(own, other)))
    check('a teacher may', await pupilMayOpenPracticalFile(own, teacher))
    await query('update planner_assignments set locked = true where lesson_id = $1', [LESSON])
    check('a locked lesson: the pupil may not open their own file', !(await pupilMayOpenPracticalFile(own, pupil)))
    check('a locked lesson: a teacher still may', await pupilMayOpenPracticalFile(own, teacher))
    await query('update planner_assignments set locked = false where lesson_id = $1', [LESSON])

    // --- Supplied images are PowerPoint's alone --------------------------------
    ;[ok, detail] = await refused(
      () => storeSuppliedImage({ activityId: DB, fileName: 'x.png', bytes: Buffer.from('89504e470d0a1a0a', 'hex') }),
      /not a PowerPoint assessment/,
    )
    check('supplied images are refused on a database assessment', ok, detail)

    // --- The latest attempt ------------------------------------------------------
    const { rows: [attempt2] } = await query<{ submission_id: string }>(
      `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
       values ($1, $2, 2, '{}'::json, now(), 'inprogress') returning submission_id`,
      [DB, PUPIL],
    )
    const latestSlots = await readPracticalSlots(DB, PUPIL)
    check('the slots are the latest attempt\'s', latestSlots.submissionId === attempt2.submission_id
      && latestSlots.slots.every((s) => s.file === null), JSON.stringify(latestSlots))
    const onLatest = await store('database', accdb, 'PALM GROVE VETS.accdb')
    check('an upload goes to the latest attempt', onLatest.submission_id === attempt2.submission_id)
    ;[ok, detail] = await refused(
      () => handInPowerPointAssessment(DB, PUPIL, { userId: PUPIL, isTeacher: false }),
      'Upload Evidence document before handing in.',
    )
    check('hand-in looks at the latest attempt', ok, detail)
    check('the earlier attempt is not listed as unmarked', (await listUnmarkedPowerPointSubmissions(DB)).length === 0)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1)
          + (select count(*) from units where unit_id = $2)
          + (select count(*) from profiles where user_id = any($3::text[]))
          + (select count(*) from activities where activity_id = $4)
          + (select count(*) from groups where group_id = $5) as left`,
    [`${DB}%`, UNIT, [PUPIL, OTHER, TEACHER], DB, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
