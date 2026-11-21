import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { practicalActivityFileDownloadName, pupilFileDownloadName, scriptFileName } from '@/lib/assessment-paper/files'
import { feedbackPdfFileName } from '@/lib/assessment-paper/feedback-pdf'
import { lessonDownloadFileName, pupilDownloadFileName, pupilFullName } from '@/lib/storage/pupil-file-name'

// The names a pupil's own assessment files download under: the rule
// (pupilDownloadFileName: the pupil's name in front, not doubled, unsafe
// characters taken out, unchanged with no name), and the lookup /api/files
// uses (pupilFileDownloadName) for a practical assessment's file and an
// assessment paper's script, with no answer for any other path. Creates its
// own unit, lesson, activities, pupils, submissions and file rows (no stored
// files), and removes them. Never prints names.
// Run with DATABASE_URL set:
//   npx tsx tests/powerpoint-assessment/download-names.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const tag = randomUUID().slice(0, 8)
const UNIT = `dl-names-unit-${tag}`
const LESSON = `dl-names-lesson-${tag}`
const PPT = randomUUID()
const PAPER = randomUUID()
const PUPIL = `dl-names-pupil-${tag}`
const NAMELESS = `dl-names-nameless-${tag}`
const FILE = randomUUID()
const NAMELESS_FILE = randomUUID()
const SCRIPT = randomUUID()
const IMAGE = randomUUID()

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    "insert into profiles (user_id, first_name, last_name) values ($1, 'Zoë', 'O/Brien'), ($2, null, null)",
    [PUPIL, NAMELESS],
  )
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Download names unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Download names check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'powerpoint-assessment', 'Presentation task', '{}'::jsonb, 0),
       ($2, $3, 'assessment-paper', 'Systems: paper 1', '{}'::jsonb, 1)`,
    [PPT, PAPER, LESSON],
  )
  const submission = async (activityId: string, userId: string) => {
    const { rows } = await query<{ submission_id: string }>(
      `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
       values ($1, $2, 1, '{}'::json, now(), 'submitted') returning submission_id`,
      [activityId, userId],
    )
    return rows[0].submission_id
  }
  const file = async (fileId: string, userId: string, originalName: string) =>
    query(
      `insert into practical_submission_files
         (file_id, activity_id, pupil_id, submission_id, slot_key, original_name, storage_path, bytes, sha256)
       values ($1, $2, $3, $4, 'presentation', $5, $6, 1, 'x')`,
      [fileId, PPT, userId, await submission(PPT, userId), originalName, `${PPT}/practical/${fileId}/original.pptx`],
    )
  await query(
    `insert into practical_supplied_images (activity_id, name, file_name, storage_path, sha256, fingerprint)
     values ($1, 'logo', 'logo.png', $2, 'x', 'x')`,
    [PPT, `lessons/${LESSON}/activities/${PPT}/images/${IMAGE}.png`],
  )
  await file(FILE, PUPIL, 'ORBIT KIOSK.pptx')
  await file(NAMELESS_FILE, NAMELESS, 'ORBIT KIOSK.pptx')
  await query(
    `insert into assessment_scripts (script_id, activity_id, pupil_id, submission_id, original_path, page_count)
     values ($1, $2, $3, $4, $5, 3)`,
    [SCRIPT, PAPER, PUPIL, await submission(PAPER, PUPIL), `${PAPER}/scripts/${SCRIPT}/original.pdf`],
  )
}

async function tearDown() {
  await query('delete from practical_supplied_images where activity_id = $1', [PPT])
  await query('delete from practical_submission_files where activity_id = $1', [PPT])
  await query('delete from assessment_scripts where activity_id = $1', [PAPER])
  await query('delete from submissions where user_id = any($1::text[])', [[PUPIL, NAMELESS]])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = any($1::text[])', [[PUPIL, NAMELESS]])
}

async function main() {
  // --- The rule -----------------------------------------------------------------------------
  check('the pupil\'s name goes in front', pupilDownloadFileName('Ann Smith', 'ORBIT KIOSK.pptx') === 'Ann Smith - ORBIT KIOSK.pptx')
  check('not doubled when the name is already there', pupilDownloadFileName('Ann Smith', 'Ann Smith - kiosk.pptx') === 'Ann Smith - kiosk.pptx')
  check('…in any case', pupilDownloadFileName('Ann Smith', 'ann smith.pptx') === 'ann smith.pptx')
  check('…but a longer name is not the same name', pupilDownloadFileName('Ann Smith', 'Ann Smithson.pptx') === 'Ann Smith - Ann Smithson.pptx')
  check('unsafe characters are taken out of the name', pupilDownloadFileName('Ann/Sm:ith*?"<>|\\\u0007', 'a.pdf') === 'Ann Sm ith - a.pdf')
  check('a non-Latin name is kept', pupilDownloadFileName('زينب علي', 'a.pdf') === 'زينب علي - a.pdf')
  check('no name leaves the file name alone', pupilDownloadFileName('', 'a.pdf') === 'a.pdf' && pupilDownloadFileName(null, 'a.pdf') === 'a.pdf' && pupilDownloadFileName(' / ', 'a.pdf') === 'a.pdf')
  check('pupilFullName joins and cleans', pupilFullName(' Ann ', 'O/Neil') === 'Ann O Neil' && pupilFullName(null, null) === '')
  check('a script is named pupil then title', scriptFileName('Paper: 1', 'Ann', 'Smith') === 'Ann Smith - Paper 1.pdf')
  check('a feedback PDF is named pupil then title', feedbackPdfFileName('Orbit kiosk', 'Ann', 'Smith') === 'Ann Smith - orbit-kiosk-feedback.pdf')
  check('…and stays as it was with no name', feedbackPdfFileName('Orbit kiosk', null, null) === 'orbit-kiosk-feedback.pdf')

  check('a practical activity file: the lesson title in front', lessonDownloadFileName('Assessment 3', 'Evidence.pdf') === 'Assessment 3 Evidence.pdf')
  check('…not doubled', lessonDownloadFileName('Assessment 3', 'assessment 3 evidence.pdf') === 'assessment 3 evidence.pdf')
  check('…but a longer title is not the same title', lessonDownloadFileName('Assessment 3', 'Assessment 30.pdf') === 'Assessment 3 Assessment 30.pdf')
  check('…unsafe characters out of the title, none left alone', lessonDownloadFileName('6.5: Orbit/kiosk', 'a.pdf') === '6.5 Orbit kiosk a.pdf'
    && lessonDownloadFileName(null, 'a.pdf') === 'a.pdf' && lessonDownloadFileName(' ', 'a.pdf') === 'a.pdf')

  // --- The lookup /api/files uses -----------------------------------------------------------
  await setUp()
  try {
    const practical = await pupilFileDownloadName([PPT, 'practical', FILE, 'original.pptx'])
    check('a practical file: the pupil and the uploaded name', practical === 'Zoë O Brien - ORBIT KIOSK.pptx', practical === null ? 'null' : 'other name')
    const nameless = await pupilFileDownloadName([PPT, 'practical', NAMELESS_FILE, 'original.pptx'])
    check('…a pupil with no name: the uploaded name', nameless === 'ORBIT KIOSK.pptx')
    const script = await pupilFileDownloadName([PAPER, 'scripts', SCRIPT, 'original.pdf'])
    check('a script: the pupil and the activity title', script === 'Zoë O Brien - Systems paper 1.pdf', script === null ? 'null' : 'other name')
    check('another path in the bucket: no name', (await pupilFileDownloadName([PPT, 'practical', FILE, 'evidence', 'a-1.png'])) === null
      && (await pupilFileDownloadName([PAPER, 'scripts', SCRIPT, 'page-2.png'])) === null
      && (await pupilFileDownloadName([PAPER, 'paper', 'question-paper.pdf'])) === null)
    check('a path that names another activity\'s file: no name', (await pupilFileDownloadName([PAPER, 'practical', FILE, 'original.pptx'])) === null
      && (await pupilFileDownloadName([PPT, 'scripts', SCRIPT, 'original.pdf'])) === null)
    check('an unknown file id: no name', (await pupilFileDownloadName([PPT, 'practical', randomUUID(), 'original.pptx'])) === null)

    const activityFile = await practicalActivityFileDownloadName('lessons', ['lessons', LESSON, 'activities', PPT, 'Evidence.docx'])
    check('a practical activity file: the lesson title and its name', activityFile === 'Download names check Evidence.docx', String(activityFile))
    check('…also without the leading lessons folder', (await practicalActivityFileDownloadName('lessons', [LESSON, 'activities', PPT, 'Evidence.docx'])) === 'Download names check Evidence.docx')
    const image = await practicalActivityFileDownloadName('lessons', ['lessons', LESSON, 'activities', PPT, 'images', `${IMAGE}.png`])
    check('a supplied image: the lesson title and the image\'s file name', image === 'Download names check logo.png', String(image))
    check('an unknown supplied image: no name', (await practicalActivityFileDownloadName('lessons', ['lessons', LESSON, 'activities', PPT, 'images', 'x.png'])) === null)
    const paper = await practicalActivityFileDownloadName('assessment-scripts', [PPT, 'paper', 'question-paper.pdf'])
    check('a practical question paper: the lesson title', paper === 'Download names check Question paper.pdf', String(paper))
    check('an assessment paper\'s files: no name', (await practicalActivityFileDownloadName('assessment-scripts', [PAPER, 'paper', 'question-paper.pdf'])) === null
      && (await practicalActivityFileDownloadName('lessons', ['lessons', LESSON, 'activities', PAPER, 'a.pdf'])) === null)
    check('the mark scheme and pupil files: no name', (await practicalActivityFileDownloadName('assessment-scripts', [PPT, 'paper', 'mark-scheme.pdf'])) === null
      && (await practicalActivityFileDownloadName('assessment-scripts', [PPT, 'practical', FILE, 'original.pptx'])) === null)
    check('a path naming another lesson: no name', (await practicalActivityFileDownloadName('lessons', ['lessons', 'other-lesson', 'activities', PPT, 'a.pdf'])) === null)
  } finally {
    await tearDown()
  }

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await tearDown().catch(() => {})
  process.exit(1)
})
