import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Document, Packer, Paragraph } from 'docx'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import {
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import {
  LESSONS_BUCKET,
  handInPowerPointAssessment,
  listPracticalFiles,
  storePracticalFile,
  storeSuppliedImage,
} from '@/lib/powerpoint-assessment/files'
import { readPupilPowerPointView, type PupilPowerPointView } from '@/lib/powerpoint-assessment/pupil-view'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// A PowerPoint assessment as the pupil's lesson page gets it
// (readPupilPowerPointView): instructions, the question paper, the files the
// pupil needs (activity files and supplied images), the upload slots with the
// pupil's files, the hand-in state, where marking has got to in pupil terms,
// and once feedback is released the marks and comments task by task, with a
// teacher's comment and mark winning over the marker's. Whatever the state,
// the view never carries the mark scheme (its path or any question's text),
// the evidence each question reads, the reader's digests, the marker's
// evidence note, the AI's own mark or the submission's mark_error. A file the
// reader refused shows its reader message on its slot. A locked lesson gives
// no download links. No model is called: the marks are written as the marker
// and a teacher would. Creates its own unit, lesson, activity, class and
// pupils, and removes all of it.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/pupil-view.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-pv-check-unit-${tag}`
const LESSON = `ppt-pv-check-lesson-${tag}`
const PPT = randomUUID()
const GROUP = `ppt-pv-check-group-${tag}`
const PUPIL = `ppt-pv-check-pupil-${tag}`
const OUTSIDER = `ppt-pv-check-outsider-${tag}`
const TEACHER = `ppt-pv-check-teacher-${tag}`

const MARK_SCHEME_PATH = `${PPT}/paper/SECRET-MARK-SCHEME-PATH.pdf`
const QUESTION_PAPER_PATH = `${PPT}/paper/question-paper.pdf`

const SLOTS = [
  { key: 'presentation', label: 'Presentation', kind: 'pptx', required: true, hint: 'Your finished kiosk file.' },
  { key: 'handouts', label: 'Handouts printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true },
]

// Strings that must never reach a pupil, planted wherever they live.
const SECRETS = {
  markScheme1: 'SECRET-MS-ONE',
  markScheme2: 'SECRET-MS-TWO',
  markSchemePath: 'SECRET-MARK-SCHEME-PATH',
  digest: 'SECRET-DIGEST-TEXT',
  markerEvidence: 'SECRET-MARKER-EVIDENCE',
  markError: 'SECRET-MARK-ERROR',
  heading: 'SECRET-EVIDENCE-HEADING',
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    "insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Oli', 'Ooo'), ($3, 'Tia', 'Ttt')",
    [PUPIL, OUTSIDER, TEACHER],
  )
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil'), ($2, 'pupil'), ($3, 'teacher')", [PUPIL, OUTSIDER, TEACHER])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint pupil view unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint pupil view check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Presentation task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({
      instructions: 'Build the presentation.',
      uploadSlots: SLOTS,
      questionPaperPath: QUESTION_PAPER_PATH,
      markSchemePath: MARK_SCHEME_PATH,
      evidenceTemplateFile: 'EVIDENCE.docx',
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
  await query('delete from user_roles where user_id = any($1::text[])', [[PUPIL, OUTSIDER, TEACHER]])
  await query('delete from profiles where user_id = any($1::text[])', [[PUPIL, OUTSIDER, TEACHER]])
}

async function docxBytes(text: string) {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] })))
}

const FORBIDDEN_KEYS = ['aiAwarded', 'ai_awarded', 'markerEvidence', 'marker_evidence', 'markScheme', 'mark_scheme',
  'markSchemePath', 'evidence', 'transcription', 'markError', 'mark_error', 'uploadSlots', 'provenance', 'fileId']

function leaks(view: PupilPowerPointView): string[] {
  const json = JSON.stringify(view)
  const found = Object.entries(SECRETS).filter(([, value]) => json.includes(value)).map(([key]) => key)
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
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const camel = await readFile(path.join(FIXTURES, 'pearl-images', 'CAMEL.jpg'))
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)

  await setUp()
  try {
    // An ordinary activity file (the blank evidence document) and a supplied image.
    await createLocalStorageClient(LESSONS_BUCKET).upload(
      `lessons/${LESSON}/activities/${PPT}/EVIDENCE.docx`,
      await docxBytes('Evidence'),
      { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    )
    await storeSuppliedImage({ activityId: PPT, fileName: 'CAMEL.jpg', bytes: camel })

    const [q1, q2] = await setAssessmentQuestions(PPT, [
      {
        label: 'T1', maxMarks: 2, questionText: 'Create a title slide.', markScheme: SECRETS.markScheme1,
        evidence: [{ source: 'presentation', slot: 'presentation', sections: ['slides'] }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }],
      },
      {
        label: 'T2', maxMarks: 1, markScheme: SECRETS.markScheme2,
        evidence: [{ source: 'evidence_section', slot: 'evidence', heading: SECRETS.heading, want: 'screenshots', required: true }],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      },
    ])

    // --- Before any upload --------------------------------------------------------
    let view = await readPupilPowerPointView(PPT, PUPIL, false)
    check('instructions', view.instructions === 'Build the presentation.')
    check('the question paper is linked for a pupil who sits it', view.questionPaperUrl?.endsWith('/question-paper.pdf') === true, String(view.questionPaperUrl))
    check('the activity\'s files are listed', view.downloads.length === 1 && view.downloads[0].name === 'EVIDENCE.docx', JSON.stringify(view.downloads))
    check('supplied images are listed with a link', view.suppliedImages.length === 1 && view.suppliedImages[0].name === 'CAMEL.jpg' && view.suppliedImages[0].url.startsWith('/api/files/lessons/'), JSON.stringify(view.suppliedImages))
    check('one slot per upload slot, empty', view.slots.length === 3 && view.slots.every((s) => s.file === null))
    check('a slot carries its hint', view.slots[0].hint === 'Your finished kiosk file.')
    check('missing required slots are named', view.missingRequired.join('|') === 'Presentation|Evidence document', view.missingRequired.join('|'))
    check('not handed in', !view.handedIn && view.markState === 'not-handed-in' && view.feedback === null)
    check('nothing secret before upload', leaks(view).length === 0, leaks(view).join(', '))

    const outsider = await readPupilPowerPointView(PPT, OUTSIDER, false)
    check('no question paper for a pupil who does not sit it', outsider.questionPaperUrl === null)

    // --- Uploads ------------------------------------------------------------------
    await storePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey: 'presentation', bytes: pptx, originalName: 'Kiosk.pptx', uploadedBy: PUPIL })
    await storePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey: 'evidence', bytes: await docxBytes('T2'), originalName: 'My evidence.docx', uploadedBy: PUPIL })
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    const presentation = view.slots.find((s) => s.key === 'presentation')
    check('an uploaded file shows its name, size and time', presentation?.file?.name === 'Kiosk.pptx' && presentation.file.bytes === pptx.byteLength && Boolean(Date.parse(presentation.file.uploadedAt)))
    check('…with a link to the pupil\'s own file', presentation?.file?.url?.startsWith(`/api/files/${ASSESSMENT_SCRIPTS_BUCKET}/`) === true, String(presentation?.file?.url))
    check('…and no reader error', view.slots.every((s) => s.file === null || s.file.readError === null))
    check('nothing missing once required slots are filled', view.missingRequired.length === 0)
    check('still not handed in', !view.handedIn && view.markState === 'not-handed-in')

    // --- Hand in -----------------------------------------------------------------
    const handed = await handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false })
    const submissionId = handed.submissionId
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    check('handed in', view.handedIn)
    check('waiting to be marked', view.markState === 'waiting', view.markState)
    check('no feedback while waiting, even for a teacher', (await readPupilPowerPointView(PPT, PUPIL, true)).feedback === null)

    // --- Marked: the marker's rows, then a teacher's changes ----------------------
    await query("delete from external_jobs where payload->>'submissionId' = $1", [submissionId])
    await query(
      `insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance, marker_evidence)
       values ($1, $2, 'mixed', $4, '{}', 'answered', 'ai', $5), ($1, $3, 'mixed', $4, '{}', 'answered', 'ai', $5)`,
      [submissionId, q1.questionId, q2.questionId, SECRETS.digest, SECRETS.markerEvidence],
    )
    await recordQuestionCriterionMarks(submissionId, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'AI-HOW-T1A' },
      { questionId: q1.questionId, successCriteriaId: B, awarded: 0, whyNotAwarded: 'AI-WHY-T1B', howToImprove: 'AI-HOW-T1B' },
      { questionId: q2.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: 'AI-HOW-T2A' },
    ], 'ai')
    // T1 B: the teacher gives the mark with a comment. T2 A: the teacher takes the mark away, no comment.
    await setTeacherQuestionCriterionMark(submissionId, q1.questionId, B, 1, 'TEACHER-T1B')
    await setTeacherQuestionCriterionMark(submissionId, q2.questionId, A, 0)
    await query("update submissions set mark_status = 'marked', mark_error = null where submission_id = $1", [submissionId])
    const { rows: [{ ai }] } = await query<{ ai: number }>(
      'select count(*)::int as ai from submission_question_criterion_marks where submission_id = $1 and ai_awarded is not null', [submissionId])
    check('(setup) the marker\'s own marks are on record', ai === 3, String(ai))

    view = await readPupilPowerPointView(PPT, PUPIL, false)
    check('marked', view.markState === 'marked', view.markState)
    check('no feedback before it is released', view.feedback === null)
    check('nothing secret while feedback is hidden', leaks(view).length === 0, leaks(view).join(', '))

    const preview = await readPupilPowerPointView(PPT, PUPIL, true)
    check('a teacher previews the feedback before release', preview.feedback !== null)
    check('nothing secret in the teacher\'s preview either', leaks(preview).length === 0, leaks(preview).join(', '))

    await query('update planner_assignments set feedback_visible = true where lesson_id = $1', [LESSON])
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    const feedback = view.feedback
    check('feedback once released', feedback !== null)
    check('total out of the activity\'s marks', feedback?.marksAwarded === 2 && feedback.maxMarks === 3, JSON.stringify({ a: feedback?.marksAwarded, m: feedback?.maxMarks }))
    const t1 = feedback?.questions.find((q) => q.label === 'T1')
    const t2 = feedback?.questions.find((q) => q.label === 'T2')
    check('per task: label, text, awarded / available', t1?.awarded === 2 && t1.available === 2 && t1.questionText === 'Create a title slide.' && t2?.awarded === 0 && t2.available === 1)
    const t1Json = JSON.stringify(t1?.comments ?? [])
    check('the teacher\'s comment wins over the marker\'s', t1Json.includes('TEACHER-T1B') && !t1Json.includes('AI-WHY-T1B') && !t1Json.includes('AI-HOW-T1B'), t1Json)
    check('the marker\'s comment stays where the teacher changed nothing', t1Json.includes('AI-HOW-T1A'), t1Json)
    check('a mark the teacher changed without a comment shows no marker comment', (t2?.comments.length ?? -1) === 0, JSON.stringify(t2?.comments))
    check('nothing secret in released feedback', leaks(view).length === 0, leaks(view).join(', '))

    // --- Waiting again (a teacher resent it) hides the half-marked feedback ------
    await query("update submissions set mark_status = 'waiting' where submission_id = $1", [submissionId])
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    check('no feedback while it is being marked again', view.markState === 'waiting' && view.feedback === null)

    // --- A file the reader refused: held, message on its slot, mark_error hidden --
    const files = await listPracticalFiles(submissionId)
    const evidenceFile = files.find((f) => f.slot_key === 'evidence')!
    const READ_ERROR = 'This Word file is damaged and could not be read.'
    await query(
      `insert into practical_submission_evidence (file_id, submission_id, slot_key, kind, status, error, cache_key)
       values ($1::uuid, $2, 'evidence', 'evidence_doc', 'error', $3, 'check')`,
      [evidenceFile.file_id, submissionId, READ_ERROR],
    )
    await query('update submissions set mark_status = null, mark_error = $2 where submission_id = $1', [submissionId, `Not marked: ${SECRETS.markError}`])
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    check('held', view.markState === 'held' && view.hasReadError, view.markState)
    check('the reader\'s message shows on its slot', view.slots.find((s) => s.key === 'evidence')?.file?.readError === READ_ERROR)
    check('held work with teacher marks still shows them once released', view.feedback !== null)
    check('mark_error never reaches the pupil', leaks(view).length === 0, leaks(view).join(', '))

    // Held: only the questions a teacher has marked show their marks.
    await query("update submission_question_marks set provenance = 'ai' where submission_id = $1 and question_id = $2", [submissionId, q2.questionId])
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    const heldT1 = view.feedback?.questions.find((q) => q.label === 'T1')
    const heldT2 = view.feedback?.questions.find((q) => q.label === 'T2')
    check('held: a teacher-marked task shows its mark and comments', heldT1?.awarded === 2 && JSON.stringify(heldT1.comments).includes('TEACHER-T1B'), JSON.stringify(heldT1))
    check('held: a task only the marker marked shows no mark and no comments', heldT2?.awarded === null && heldT2.comments.length === 0, JSON.stringify(heldT2))
    check('held: the total counts only the teacher-marked tasks', view.feedback?.marksAwarded === 2, String(view.feedback?.marksAwarded))
    await query("update submission_question_marks set provenance = 'ai' where submission_id = $1", [submissionId])
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    check('held work with only the marker\'s marks shows no feedback', view.feedback === null, JSON.stringify(view.feedback))

    // --- Locked lesson: no download links -------------------------------------------
    await query('update planner_assignments set locked = true where lesson_id = $1', [LESSON])
    view = await readPupilPowerPointView(PPT, PUPIL, false)
    check('a locked lesson blocks downloads', view.downloadsBlocked && view.questionPaperUrl === null && view.downloads.length === 0 && view.suppliedImages.length === 0)
    check('…and the pupil\'s own file links', view.slots.every((s) => s.file === null || s.file.url === null))
    const teacherLocked = await readPupilPowerPointView(PPT, PUPIL, true)
    check('a teacher still gets the links', !teacherLocked.downloadsBlocked && teacherLocked.questionPaperUrl !== null)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1 or scope_path like $2)
          + (select count(*) from units where unit_id = $3)
          + (select count(*) from profiles where user_id = any($4::text[]))
          + (select count(*) from activities where activity_id = $5)
          + (select count(*) from groups where group_id = $6) as left`,
    [`${PPT}%`, `lessons/${LESSON}/%`, UNIT, [PUPIL, OUTSIDER, TEACHER], PPT, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
