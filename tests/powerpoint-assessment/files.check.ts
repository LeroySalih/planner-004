import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Document, Packer, Paragraph } from 'docx'
import sharp from 'sharp'

import { query } from '@/lib/db'
import {
  ASSESSMENT_SCRIPTS_BUCKET,
  pupilMayOpenAssessmentPaperFile,
  storePaperFile,
} from '@/lib/assessment-paper/files'
import {
  readAssessmentQuestions,
  recordQuestionCriterionMarks,
  setAssessmentQuestions,
  setTeacherQuestionCriterionMark,
} from '@/lib/assessment-paper/store'
import {
  LESSONS_BUCKET,
  handInPowerPointAssessment,
  listPracticalFiles,
  listSuppliedImages,
  pupilMayOpenPracticalFile,
  readKnownImages,
  readPracticalFileBytes,
  readPracticalSlots,
  removePracticalFile,
  removeSuppliedImage,
  storePracticalFile,
  storeSuppliedImage,
} from '@/lib/powerpoint-assessment/files'
import { DOCX_MESSAGES, PPTX_MESSAGES } from '@/lib/pptx/package'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// A PowerPoint assessment's files: slot validation (unknown slot, wrong file
// for the slot, .ppt and a .docx in the presentation slot refused with the
// reader's own message), PDF and .docx accepted, one file per slot (a
// replacement deletes the old row and stored file), a replacement after
// hand-in is refused to the pupil (a teacher's clears the marker's rows,
// keeps the teacher's and no longer reads as marked), hand-in refused while
// a required slot is empty and done once when sent twice at once, supplied images (store, list,
// readKnownImages, a near-duplicate warned about, a non-image refused,
// remove), and who may open which file. The presentation and images are the
// test fixtures (no pupil data); the PDF and .docx are generated. No model is
// called. Creates its own unit, lesson, activity, class and pupils, stores
// files under the activity's own folders, and removes all of it.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/files.check.ts

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

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-f-check-unit-${tag}`
const LESSON = `ppt-f-check-lesson-${tag}`
const PPT = randomUUID()
const GROUP = `ppt-f-check-group-${tag}`
const PUPIL = `ppt-f-check-pupil-${tag}`
const OTHER = `ppt-f-check-other-${tag}`
const TEACHER = `ppt-f-check-teacher-${tag}`

const SLOTS = [
  { key: 'presentation', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'handouts', label: 'Handouts printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true },
]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    "insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa'), ($2, 'Bob', 'Bbb'), ($3, 'Tia', 'Ttt')",
    [PUPIL, OTHER, TEACHER],
  )
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil'), ($2, 'pupil'), ($3, 'teacher')", [PUPIL, OTHER, TEACHER])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint files unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint files check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Presentation task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  // Only PUPIL is in the class; OTHER is a pupil elsewhere.
  await query('insert into group_membership (group_id, user_id) values ($1, $2)', [GROUP, PUPIL])
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
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [[PUPIL, OTHER]])
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

function pdfBytes(text: string) {
  return Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1')
}

async function docxBytes(text: string) {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] })))
}

// An OLE compound file header, as an old .ppt starts.
const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)])

async function storedExists(bucket: string, fullPath: string) {
  return Boolean(await createLocalStorageClient(bucket).stat(fullPath))
}

const pupil = { userId: PUPIL, roles: ['pupil'] }
const other = { userId: OTHER, roles: ['pupil'] }
const teacher = { userId: TEACHER, roles: ['teacher'] }

async function main() {
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const docx = await docxBytes('1a')
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
      storePracticalFile({ activityId: PPT, pupilId, slotKey, bytes, originalName, uploadedBy: pupilId })
    const storeAsTeacher = (slotKey: string, bytes: Buffer, originalName: string) =>
      storePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey, bytes, originalName, uploadedBy: TEACHER, byTeacher: true })

    // --- Slot validation --------------------------------------------------------
    let [ok, detail] = await refused(() => store('nope', pptx, 'kiosk.pptx'), /no upload slot "nope"/)
    check('an unknown slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('presentation', OLE, 'kiosk.ppt'), PPTX_MESSAGES.oldFormat)
    check('a .ppt is refused with the reader\'s message', ok, detail)
    ;[ok, detail] = await refused(() => store('presentation', docx, 'kiosk.docx'), PPTX_MESSAGES.notThisType)
    check('a .docx in the presentation slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('presentation', pptx, 'kiosk.zip'), PPTX_MESSAGES.notThisType)
    check('a presentation without the .pptx extension is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('handouts', docx, 'handouts.pdf'), /not a PDF/)
    check('a .docx in a PDF slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('evidence', pdfBytes('x'), 'evidence.docx'), DOCX_MESSAGES.notThisType)
    check('a PDF in the evidence slot is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('evidence', OLE, 'evidence.doc'), DOCX_MESSAGES.oldFormat)
    check('a .doc is refused with the reader\'s message', ok, detail)
    ;[ok, detail] = await refused(() => store('presentation', Buffer.alloc(0), 'kiosk.pptx'), /empty/)
    check('an empty file is refused', ok, detail)
    ;[ok, detail] = await refused(() => store('presentation', pptx, 'kiosk.pptx', OTHER), /not a pupil in a class/)
    check('a pupil not in a class the lesson is set to is refused', ok, detail)
    const { rows: [{ n: noRows }] } = await query<{ n: number }>(
      'select count(*)::int as n from practical_submission_files where activity_id = $1', [PPT])
    check('nothing refused was recorded', noRows === 0, String(noRows))

    // --- PDF accepted; hand-in refused while required slots are empty --------
    const handouts = await store('handouts', pdfBytes('handouts'), 'Handouts.pdf')
    check('a PDF is stored in its slot', handouts.storage_path === `${PPT}/practical/${handouts.file_id}/original.pdf`, handouts.storage_path)
    const { rows: [sub] } = await query<{ submission_status: string; attempt_number: number }>(
      'select submission_status, attempt_number from submissions where submission_id = $1', [handouts.submission_id])
    check('the first upload creates attempt 1, not handed in', sub?.attempt_number === 1 && sub?.submission_status === 'inprogress', JSON.stringify(sub))
    ;[ok, detail] = await refused(
      () => handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false }),
      'Upload Presentation and Evidence document before handing in.',
    )
    check('hand-in is refused naming the missing required slots', ok, detail)
    ;[ok, detail] = await refused(
      () => handInPowerPointAssessment(PPT, PUPIL, { userId: OTHER, isTeacher: false }),
      /your own work/,
    )
    check('a pupil cannot hand in for another', ok, detail)

    // --- pptx and docx accepted; replacement ---------------------------------
    const first = await store('presentation', pptx, 'Kiosk.pptx')
    check('a .pptx is stored on the same submission', first.submission_id === handouts.submission_id && first.replaced_file_id === null)
    const evidence = await store('evidence', docx, 'EVIDENCE.docx')
    check('a .docx is stored', evidence.storage_path.endsWith('/original.docx'))
    const bytesBack = await readPracticalFileBytes(first.file_id)
    check('readPracticalFileBytes returns the stored file', bytesBack.equals(pptx))

    // An extracted image the reader would have stored, to see it removed with its file.
    const evidenceImage = `${PPT}/practical/${first.file_id}/evidence/1a-1.png`
    await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).upload(evidenceImage, await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer(), { contentType: 'image/png' })

    const second = await store('presentation', pptx, 'Kiosk v2.pptx')
    const files = await listPracticalFiles(second.submission_id)
    check('one file per slot', files.length === 3 && files.filter((f) => f.slot_key === 'presentation').length === 1, String(files.length))
    check('the replacement names what it replaced', second.replaced_file_id === first.file_id && !second.requeued)
    check('the replaced file row is gone', !files.some((f) => f.file_id === first.file_id))
    check('the replaced stored file is gone', !(await storedExists(ASSESSMENT_SCRIPTS_BUCKET, first.storage_path)))
    check('what was read from the replaced file is gone', !(await storedExists(ASSESSMENT_SCRIPTS_BUCKET, evidenceImage)))
    check('the new file is stored', await storedExists(ASSESSMENT_SCRIPTS_BUCKET, second.storage_path))

    // --- Hand in -------------------------------------------------------------
    // Two at once (a double click): both lock the submission; one hands in.
    const both = await Promise.all([
      handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false }),
      handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false }),
    ])
    check('two hand-ins at once hand in once', both.filter((r) => !r.alreadyHandedIn).length === 1, JSON.stringify(both.map((r) => r.alreadyHandedIn)))
    const handedIn = both.find((r) => !r.alreadyHandedIn) ?? both[0]
    const { rows: [afterHandIn] } = await query<{ submission_status: string }>(
      'select submission_status from submissions where submission_id = $1', [handedIn.submissionId])
    check('hand-in is accepted with every required slot filled', !handedIn.alreadyHandedIn && afterHandIn?.submission_status === 'submitted')
    check('the slot state shows it handed in', handedIn.state.handedIn && handedIn.state.missingRequired.length === 0)
    const again = await handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false })
    check('handing in again does nothing', again.alreadyHandedIn)

    // --- After hand-in a pupil cannot change files ------------------------------
    const HANDED_IN = 'You have handed this in. Ask your teacher if you need to change a file.'
    const filesBefore = (await listPracticalFiles(handedIn.submissionId)).map((f) => f.file_id).sort().join(',')
    ;[ok, detail] = await refused(() => store('presentation', pptx, 'Kiosk late.pptx'), HANDED_IN)
    check('a pupil cannot replace a file after hand-in', ok, detail)
    ;[ok, detail] = await refused(() => store('handouts', pdfBytes('late'), 'Late.pdf'), HANDED_IN)
    check('a pupil cannot upload a file after hand-in', ok, detail)
    ;[ok, detail] = await refused(() => removePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey: 'handouts' }), HANDED_IN)
    check('a pupil cannot remove a file after hand-in', ok, detail)
    check('…and nothing changed', (await listPracticalFiles(handedIn.submissionId)).map((f) => f.file_id).sort().join(',') === filesBefore)
    const { rows: leftover } = await query<{ n: number }>(
      "select count(*)::int as n from stored_files where bucket = $1 and scope_path like $2 and file_name like 'original.%'",
      [ASSESSMENT_SCRIPTS_BUCKET, `${PPT}/practical/%`],
    )
    check('…and a refused upload leaves no stored file', leftover[0]?.n === 3, String(leftover[0]?.n))

    // --- Replacement after hand-in ---------------------------------------------
    const [q1] = await setAssessmentQuestions(PPT, [{
      label: 'Q1', maxMarks: 2, markScheme: 'Title slide (1). Consistent font (1).',
      evidence: [{ source: 'presentation', slot: 'presentation' }],
      criteria: [{ successCriteriaId: A, maxMarks: 1 }, { successCriteriaId: B, maxMarks: 1 }],
    }])
    check('questions saved', (await readAssessmentQuestions(PPT)).length === 1)
    await recordQuestionCriterionMarks(handedIn.submissionId, [
      { questionId: q1.questionId, successCriteriaId: A, awarded: 1, whyNotAwarded: null, howToImprove: null },
    ], 'ai')
    await setTeacherQuestionCriterionMark(handedIn.submissionId, q1.questionId, B, 1)
    await query("update submissions set mark_status = 'marked' where submission_id = $1", [handedIn.submissionId])
    const third = await storeAsTeacher('presentation', pptx, 'Kiosk v3.pptx')
    check('a teacher\'s replacement after hand-in is sent again', third.requeued)
    const { rows: [afterReplace] } = await query<{ mark_status: string | null }>(
      'select mark_status from submissions where submission_id = $1', [handedIn.submissionId])
    check('it no longer reads as marked', afterReplace?.mark_status !== 'marked', String(afterReplace?.mark_status))
    const { rows: marks } = await query<{ success_criteria_id: string; provenance: string }>(
      'select success_criteria_id, provenance from submission_question_criterion_marks where submission_id = $1',
      [handedIn.submissionId],
    )
    check('the marker\'s rows are cleared', !marks.some((m) => m.success_criteria_id === A), JSON.stringify(marks))
    check('the teacher\'s rows are kept', marks.some((m) => m.success_criteria_id === B && m.provenance === 'teacher'), JSON.stringify(marks))
    const { rows: [stillIn] } = await query<{ submission_status: string }>(
      'select submission_status from submissions where submission_id = $1', [handedIn.submissionId])
    check('it stays handed in', stillIn?.submission_status === 'submitted')

    // --- Remove ----------------------------------------------------------------
    const removed = await removePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey: 'handouts', byTeacher: true })
    const slots = await readPracticalSlots(PPT, PUPIL)
    check('a teacher can remove a file after hand-in', removed.removed && removed.requeued && slots.slots.find((s) => s.key === 'handouts')?.file === null)
    check('the removed stored file is gone', !(await storedExists(ASSESSMENT_SCRIPTS_BUCKET, handouts.storage_path)))

    // --- Who may open what -----------------------------------------------------
    const own = third.storage_path
    check('a pupil may open their own file', await pupilMayOpenPracticalFile(own, pupil))
    check('another pupil may not', !(await pupilMayOpenPracticalFile(own, other)))
    check('a pupil may not open what was read from it', !(await pupilMayOpenPracticalFile(`${PPT}/practical/${third.file_id}/evidence/1a-1.png`, pupil)))
    check('a pupil may not open a path not their file\'s', !(await pupilMayOpenPracticalFile(`${PPT}/practical/${third.file_id}/original.pdf`, pupil)))
    check('a teacher may open a pupil\'s file', await pupilMayOpenPracticalFile(own, teacher))
    check('a teacher may open what was read', await pupilMayOpenPracticalFile(`${PPT}/practical/${third.file_id}/evidence/1a-1.png`, teacher))
    check('nobody signed in may open nothing', !(await pupilMayOpenPracticalFile(own, null)))

    const questionPaper = await storePaperFile(PPT, 'question_paper', pdfBytes('question paper'))
    const markScheme = await storePaperFile(PPT, 'mark_scheme', pdfBytes('mark scheme'))
    const segments = (p: string) => p.split('/')
    check('a pupil the lesson is set to may open the question paper', await pupilMayOpenAssessmentPaperFile(PUPIL, segments(questionPaper.path)))
    check('a pupil it is not set to may not', !(await pupilMayOpenAssessmentPaperFile(OTHER, segments(questionPaper.path))))
    check('the mark scheme never opens to a pupil', !(await pupilMayOpenAssessmentPaperFile(PUPIL, segments(markScheme.path))))
    await query('update planner_assignments set feedback_visible = true where lesson_id = $1', [LESSON])
    check('…not even once feedback is released', !(await pupilMayOpenAssessmentPaperFile(PUPIL, segments(markScheme.path))))
    await query(
      `update activities set body_data = body_data || '{"showMarkSchemeToPupils": true}'::jsonb where activity_id = $1`,
      [PPT],
    )
    check('…nor when the feedback shows it', !(await pupilMayOpenAssessmentPaperFile(PUPIL, segments(markScheme.path))))
    check('the question paper still opens', await pupilMayOpenAssessmentPaperFile(PUPIL, segments(questionPaper.path)))

    // A locked lesson allows a pupil no downloads; staff are unaffected.
    await query('update planner_assignments set locked = true where lesson_id = $1', [LESSON])
    check('a locked lesson: the pupil may not open their own file', !(await pupilMayOpenPracticalFile(own, pupil)))
    check('a locked lesson: the pupil may not open the question paper', !(await pupilMayOpenAssessmentPaperFile(PUPIL, segments(questionPaper.path))))
    check('a locked lesson: a teacher may still open the pupil\'s file', await pupilMayOpenPracticalFile(own, teacher))
    await query('update planner_assignments set locked = false where lesson_id = $1', [LESSON])
    check('unlocked again: the pupil may open their own file', await pupilMayOpenPracticalFile(own, pupil))

    // --- Supplied images -------------------------------------------------------
    const turtle = await readFile(path.join(FIXTURES, 'pearl-images', 'TURTLE.jpg'))
    const camel = await readFile(path.join(FIXTURES, 'pearl-images', 'CAMEL.jpg'))
    const t = await storeSuppliedImage({ activityId: PPT, fileName: 'TURTLE.jpg', bytes: turtle })
    const generated = new RegExp(`^lessons/${LESSON}/activities/${PPT}/images/[0-9a-f-]{36}\\.jpg$`)
    check('a supplied image is named after its file and stored under a generated name', t.image.name === 'TURTLE'
      && t.image.file_name === 'TURTLE.jpg' && generated.test(t.image.storage_path) && t.warnings.length === 0, JSON.stringify(t))
    check('its file is in the lessons bucket', await storedExists(LESSONS_BUCKET, t.image.storage_path))
    const c = await storeSuppliedImage({ activityId: PPT, fileName: 'CAMEL.jpg', bytes: camel })
    check('a different image is not warned about', c.warnings.length === 0, c.warnings.join(' | '))
    const nearCopy = await sharp(turtle).resize({ width: 300 }).jpeg({ quality: 60 }).toBuffer()
    const n = await storeSuppliedImage({ activityId: PPT, fileName: 'TURTLE-SMALL.jpg', bytes: nearCopy })
    check('a near-identical image is warned about', n.warnings.some((w) => w.includes('"TURTLE"')), n.warnings.join(' | '))
    const exact = await storeSuppliedImage({ activityId: PPT, fileName: 'COPY.jpg', bytes: turtle })
    check('an exact copy is warned about', exact.warnings.some((w) => w.includes('same image as "TURTLE"')), exact.warnings.join(' | '))
    ;[ok, detail] = await refused(() => storeSuppliedImage({ activityId: PPT, fileName: 'paper.pdf', bytes: pdfBytes('x') }), /must be a PNG, JPEG, GIF or WebP/)
    check('a non-image is refused', ok, detail)
    for (const [what, input, pattern] of [
      ['a file name with a path separator', { fileName: '../TURTLE.jpg' }, /may not contain/],
      ['a name with a control character', { fileName: 'A.jpg', name: 'A\u0007B' }, /control character/],
      ['a name over 200 characters', { fileName: 'A.jpg', name: 'N'.repeat(201) }, /at most 200/],
      ['a blank name', { fileName: 'A.jpg', name: '   ' }, /needs a name/],
    ] as const) {
      ;[ok, detail] = await refused(() => storeSuppliedImage({ activityId: PPT, bytes: camel, ...input }), pattern)
      check(`${what} is refused`, ok, detail)
    }
    ;[ok, detail] = await refused(
      () => storeSuppliedImage({ activityId: PPT, fileName: 'BIG.jpg', bytes: Buffer.concat([turtle, Buffer.alloc(10 * 1024 * 1024)]) }),
      /10 MB or smaller/,
    )
    check('a supplied image over 10 MB is refused', ok, detail)
    const replaced = await storeSuppliedImage({ activityId: PPT, fileName: 'CAMEL.png', name: 'CAMEL', bytes: await sharp(camel).png().toBuffer() })
    check('a name in use is replaced', replaced.replaced && replaced.image.file_name === 'CAMEL.png' && replaced.image.storage_path.endsWith('.png'))
    check('the new image file is stored', await storedExists(LESSONS_BUCKET, replaced.image.storage_path))
    check('the replaced image file is gone', !(await storedExists(LESSONS_BUCKET, c.image.storage_path)))

    const listed = await listSuppliedImages(PPT)
    check('listSuppliedImages lists them by name', listed.map((i) => i.name).join(',') === 'CAMEL,COPY,TURTLE,TURTLE-SMALL', listed.map((i) => i.name).join(','))
    check('listed images carry no fingerprint', listed.every((i) => !('fingerprint' in i)))
    const known = await readKnownImages(PPT)
    const { rows: stored } = await query<{ name: string; fingerprint: string }>(
      'select name, fingerprint from practical_supplied_images where activity_id = $1', [PPT])
    check('readKnownImages returns the stored fingerprints', known.length === 4
      && known.every((k) => stored.find((s) => s.name === k.name)?.fingerprint === k.fingerprint))

    const gone = await removeSuppliedImage(PPT, 'COPY')
    check('a supplied image is removed with its file', gone.removed
      && !(await storedExists(LESSONS_BUCKET, exact.image.storage_path))
      && (await listSuppliedImages(PPT)).length === 3)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from stored_files where scope_path like $1 or scope_path like $2)
          + (select count(*) from units where unit_id = $3)
          + (select count(*) from profiles where user_id = any($4::text[]))
          + (select count(*) from activities where activity_id = $5)
          + (select count(*) from groups where group_id = $6) as left`,
    [`${PPT}%`, `${LESSON}/%`, UNIT, [PUPIL, OTHER, TEACHER], PPT, GROUP],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
