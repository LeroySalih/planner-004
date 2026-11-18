import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import {
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import { LESSONS_BUCKET, handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { readPupilPowerPointView, type PupilPowerPointView } from '@/lib/powerpoint-assessment/pupil-view'
import { defaultDatabaseAssessmentBody } from '@/lib/practical-assessment/types'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// A database assessment as the pupil's lesson page gets it
// (readPupilPowerPointView): the database and evidence slots, the downloads
// (the starting database and the EVIDENCE template are ordinary activity
// files), no supplied images, the hand-in state, and once feedback is
// released the marks task by task with a teacher's comment winning. Whatever
// the state, the view never carries the mark scheme, the evidence a question
// reads, the database report, the marker's note, the AI's own mark or
// mark_error. A locked lesson gives no download links. No model is called:
// the marks are written as the marker and a teacher would. Creates its own
// unit, lesson, activity, class and pupils, and removes all of it.
// Run with DATABASE_URL set (MARKING_QUEUE_SECRET empty; mdbtools installed):
//   npx tsx tests/database-assessment/pupil-view.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const tag = randomUUID().slice(0, 8)
const UNIT = `db-pv-check-unit-${tag}`
const LESSON = `db-pv-check-lesson-${tag}`
const ACT = randomUUID()
const GROUP = `db-pv-check-group-${tag}`
const PUPIL = `db-pv-check-pupil-${tag}`
const TEACHER = `db-pv-check-teacher-${tag}`

const TEMPLATE_FILE = 'EVIDENCE.docx'
const START_FILE = 'PALM GROVE VETS.accdb'
const QUESTION_PAPER_PATH = `${ACT}/paper/question-paper.pdf`

// Strings that must never reach a pupil, planted wherever they live.
const SECRETS = {
  markScheme1: 'SECRET-MS-ONE',
  markScheme2: 'SECRET-MS-TWO',
  markSchemePath: 'SECRET-MARK-SCHEME-PATH',
  digest: 'SECRET-DIGEST-TEXT',
  markerEvidence: 'SECRET-MARKER-EVIDENCE',
  markError: 'SECRET-MARK-ERROR',
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Tia', 'Ttt')", [PUPIL, TEACHER])
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil'), ($2, 'teacher')", [PUPIL, TEACHER])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database pupil view unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database pupil view check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'database-assessment', 'Database task', $3::jsonb, 0)",
    [ACT, LESSON, JSON.stringify({
      instructions: 'Complete the database tasks.',
      ...defaultDatabaseAssessmentBody(),
      evidenceTemplateFile: TEMPLATE_FILE,
      startingDatabaseFile: START_FILE,
      questionPaperPath: QUESTION_PAPER_PATH,
      markSchemePath: `${ACT}/paper/${SECRETS.markSchemePath}.pdf`,
    })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) values ($1, $2)', [GROUP, PUPIL])
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
  await query('delete from user_roles where user_id = any($1::text[])', [[PUPIL, TEACHER]])
  await query('delete from profiles where user_id = any($1::text[])', [[PUPIL, TEACHER]])
}

const FORBIDDEN_KEYS = ['aiAwarded', 'ai_awarded', 'markerEvidence', 'marker_evidence', 'markScheme', 'mark_scheme',
  'markSchemePath', 'evidence', 'evidenceTexts', 'evidenceSources', 'transcription', 'markError', 'mark_error',
  'uploadSlots', 'startingDatabaseFile', 'provenance', 'fileId', 'report']

function leaks(view: PupilPowerPointView): string[] {
  const json = JSON.stringify(view)
  const found = Object.entries(SECRETS).filter(([, value]) => json.includes(value)).map(([key]) => key)
  if (json.includes('MICROCHIP REMINDER')) found.push('database report')
  const keys = new Set<string>()
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        keys.add(key)
        walk(inner)
      }
    }
  }
  walk(view)
  return [...found, ...FORBIDDEN_KEYS.filter((key) => keys.has(key)).map((key) => `key:${key}`)]
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
  const [A, B] = scs.map((row) => row.success_criteria_id)

  await setUp()
  try {
    const lessons = createLocalStorageClient(LESSONS_BUCKET)
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${TEMPLATE_FILE}`, template, { contentType: 'application/octet-stream' })
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${START_FILE}`, startDb, { contentType: 'application/octet-stream' })

    const [q1, q2] = await setAssessmentQuestions(ACT, [
      {
        label: '7', maxMarks: 2, questionText: 'Create the reminder query.', markScheme: SECRETS.markScheme1,
        evidence: [{ source: 'database', slot: 'database', sections: ['query:MICROCHIP REMINDER'] }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }],
      },
      {
        label: 'B1', maxMarks: 1, markScheme: SECRETS.markScheme2,
        evidence: [{ source: 'evidence_section', slot: 'evidence', heading: 'B1', want: 'text', required: true }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      },
    ])

    // --- Before any upload --------------------------------------------------------
    let view = await readPupilPowerPointView(ACT, PUPIL, false)
    check('instructions', view.instructions === 'Complete the database tasks.')
    check('the database and evidence slots, empty',
      view.slots.map((s) => `${s.key}:${s.kind}:${s.required}`).join('|') === 'database:accdb:true|evidence:docx:true' && view.slots.every((s) => s.file === null),
      view.slots.map((s) => `${s.key}:${s.kind}`).join('|'))
    check('downloads: the starting database and the EVIDENCE template',
      view.downloads.map((d) => d.name).join('|') === `${TEMPLATE_FILE}|${START_FILE}` && view.downloads.every((d) => Boolean(d.url)),
      JSON.stringify(view.downloads))
    check('no supplied images', view.suppliedImages.length === 0)
    check('the question paper is linked', view.questionPaperUrl?.endsWith('/question-paper.pdf') === true, String(view.questionPaperUrl))
    check('missing required slots are named', view.missingRequired.join('|') === 'Database|Evidence document', view.missingRequired.join('|'))
    check('not handed in, no feedback', !view.handedIn && view.markState === 'not-handed-in' && view.feedback === null)
    check('nothing secret before upload', leaks(view).length === 0, leaks(view).join(', '))

    // --- Uploads and hand-in --------------------------------------------------------
    await storePracticalFile({ activityId: ACT, pupilId: PUPIL, slotKey: 'database', bytes: modelDb, originalName: 'My vets.accdb', uploadedBy: PUPIL })
    await storePracticalFile({ activityId: ACT, pupilId: PUPIL, slotKey: 'evidence', bytes: evidenceDoc, originalName: 'My evidence.docx', uploadedBy: PUPIL })
    view = await readPupilPowerPointView(ACT, PUPIL, false)
    const database = view.slots.find((s) => s.key === 'database')
    check('an uploaded database shows its name, size and own link', database?.file?.name === 'My vets.accdb' && database.file.bytes === modelDb.byteLength
      && database.file.url?.startsWith(`/api/files/${ASSESSMENT_SCRIPTS_BUCKET}/`) === true, JSON.stringify(database?.file))
    check('nothing missing once both slots are filled', view.missingRequired.length === 0)

    const { submissionId } = await handInPowerPointAssessment(ACT, PUPIL, { userId: PUPIL, isTeacher: false })
    // The read the hand-in queued is the reader's job, not this check's.
    await query("delete from external_jobs where payload->>'submissionId' = $1", [submissionId])
    view = await readPupilPowerPointView(ACT, PUPIL, false)
    check('handed in, waiting to be marked', view.handedIn && view.markState === 'waiting', view.markState)
    check('no feedback while waiting, even for a teacher', (await readPupilPowerPointView(ACT, PUPIL, true)).feedback === null)

    // --- Marked: the marker's rows, then a teacher's change -------------------------
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance, marker_evidence)
       values ($1, $2, 'mixed', $4, '{}', 'answered', 'ai', $5), ($1, $3, 'text', $4, '{}', 'answered', 'ai', $5)`,
      [submissionId, q1.questionId, q2.questionId, SECRETS.digest, SECRETS.markerEvidence],
    )
    await recordQuestionCriterionMarks(submissionId, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'AI-HOW-7A' },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 0, whyNotAwarded: 'AI-WHY-7B', howToImprove: 'AI-HOW-7B' },
      { questionId: q2.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'AI-HOW-B1A' },
    ], 'ai')
    await setTeacherQuestionCriterionMark(submissionId, q1.questionId, B, 1, 'TEACHER-7B')
    await query("update submissions set mark_status = 'marked', mark_error = $2 where submission_id = $1", [submissionId, SECRETS.markError])

    view = await readPupilPowerPointView(ACT, PUPIL, false)
    check('marked', view.markState === 'marked', view.markState)
    check('no feedback before it is released', view.feedback === null)
    check('nothing secret while feedback is hidden', leaks(view).length === 0, leaks(view).join(', '))
    const preview = await readPupilPowerPointView(ACT, PUPIL, true)
    check('a teacher previews the feedback before release', preview.feedback !== null)
    check('nothing secret in the teacher\'s preview either', leaks(preview).length === 0, leaks(preview).join(', '))

    await query('update planner_assignments set feedback_visible = true where lesson_id = $1', [LESSON])
    view = await readPupilPowerPointView(ACT, PUPIL, false)
    const feedback = view.feedback
    check('feedback once released', feedback !== null)
    check('total out of the activity\'s marks', feedback?.marksAwarded === 3 && feedback.maxMarks === 3, JSON.stringify({ a: feedback?.marksAwarded, m: feedback?.maxMarks }))
    const t7 = feedback?.questions.find((q) => q.label === '7')
    const t7Json = JSON.stringify(t7?.comments ?? [])
    check('per task: awarded / available, the teacher\'s comment wins', t7?.awarded === 2 && t7.available === 2
      && t7Json.includes('TEACHER-7B') && !t7Json.includes('AI-WHY-7B') && t7Json.includes('AI-HOW-7A'), JSON.stringify(t7))
    check('the feedback PDF is linked', feedback?.feedbackPdfUrl === `/api/assessment-paper/${ACT}/feedback-pdf?pupilId=${PUPIL}`, String(feedback?.feedbackPdfUrl))
    check('nothing secret in released feedback (no ai_awarded, marker_evidence, mark scheme)', leaks(view).length === 0, leaks(view).join(', '))

    // --- Locked lesson: no download links -------------------------------------------
    await query('update planner_assignments set locked = true where lesson_id = $1', [LESSON])
    view = await readPupilPowerPointView(ACT, PUPIL, false)
    check('a locked lesson blocks downloads', view.downloadsBlocked && view.questionPaperUrl === null && view.downloads.length === 0 && view.suppliedImages.length === 0)
    check('…the pupil\'s own file links', view.slots.every((s) => s.file === null || s.file.url === null))
    check('…and the feedback PDF link', view.feedback !== null && view.feedback.feedbackPdfUrl === null)
    const teacherLocked = await readPupilPowerPointView(ACT, PUPIL, true)
    check('a teacher still gets the links', !teacherLocked.downloadsBlocked && teacherLocked.downloads.length === 2 && teacherLocked.questionPaperUrl !== null)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1 or scope_path like $2)
          + (select count(*) from units where unit_id = $3)
          + (select count(*) from profiles where user_id = any($4::text[]))
          + (select count(*) from activities where activity_id = $5)
          + (select count(*) from groups where group_id = $6) as left`,
    [`${ACT}%`, `${LESSON}/%`, UNIT, [PUPIL, TEACHER], ACT, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
