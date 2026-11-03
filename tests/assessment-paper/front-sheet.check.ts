import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { query } from '@/lib/db'
import {
  ASSESSMENT_SCRIPTS_BUCKET,
  listUnmarkedScriptSubmissions,
  readMarkablePages,
  storePaperFile,
  storeScript,
} from '@/lib/assessment-paper/files'
import { NO_FRONT_SHEET_MESSAGE, checkFrontSheet } from '@/lib/assessment-paper/front-sheet'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { pagesToPdf, syntheticFrontSheet, syntheticQuestionPage } from './synthetic-front-sheet'

// The front sheet check and the markable-page loader (migration 134) against
// a dev database and ./files. Creates its own unit, intervention lesson,
// pupil and two assessment-paper activities, and removes them and every file
// it stored at the end. Never touches the folded papers except to read them.
// Run as the files owner (1001:999), with DATABASE_URL set, where poppler and
// sharp are installed: npx tsx tests/assessment-paper/front-sheet.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
async function refuses(name: string, action: () => Promise<unknown>, pattern?: RegExp) {
  try {
    await action()
    check(name, false, 'was accepted')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, !pattern || pattern.test(message), message)
  }
}

const tag = randomUUID().slice(0, 8)
const UNIT = `fs-check-unit-${tag}`
const LESSON = `fs-check-lesson-${tag}`
const PUPIL = `fs-check-pupil-${tag}`
const ACTIVITY = randomUUID()
const BARE_ACTIVITY = randomUUID()

async function scriptRow(scriptId: string) {
  const { rows } = await query<{ page_paths: string[]; front_sheet_check: string | null; page_count: number }>(
    'select page_paths, front_sheet_check, page_count from assessment_scripts where script_id = $1::uuid',
    [scriptId],
  )
  return rows[0]
}
async function submissionRow(submissionId: string) {
  const { rows } = await query<{ mark_status: string | null; mark_error: string | null }>(
    'select mark_status, mark_error from submissions where submission_id = $1',
    [submissionId],
  )
  return rows[0]
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Front', 'Sheet')", [PUPIL])
  await query("insert into units (unit_id, title, subject) values ($1, 'Front sheet check', $2)", [UNIT, subject])
  await query("insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Front sheet check', 0, 'intervention')", [LESSON, UNIT])
  await query("insert into intervention_assignments (lesson_id, pupil_id, reason) values ($1, $2, 'front sheet check')", [LESSON, PUPIL])
  for (const id of [ACTIVITY, BARE_ACTIVITY]) {
    await query(
      "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'assessment-paper', 'Front sheet check', '{}'::jsonb, 0)",
      [id, LESSON],
    )
  }
}

async function tearDown() {
  const { rows: files } = await query<{ scope_path: string; file_name: string }>(
    'select scope_path, file_name from stored_files where bucket = $1 and (scope_path like $2 or scope_path like $3)',
    [ASSESSMENT_SCRIPTS_BUCKET, `${ACTIVITY}%`, `${BARE_ACTIVITY}%`],
  )
  const paths = files.map((f) => `${f.scope_path}/${f.file_name}`.replace(/^\/+/, ''))
  if (paths.length > 0) await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
  await query("delete from stored_files where bucket = $1 and (scope_path like $2 or scope_path like $3)", [ASSESSMENT_SCRIPTS_BUCKET, `${ACTIVITY}%`, `${BARE_ACTIVITY}%`])
  // The folders this check created (new ids, so nothing else is in them).
  for (const id of [ACTIVITY, BARE_ACTIVITY]) {
    await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, id), { recursive: true, force: true })
  }
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = $1)", [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

async function main() {
  // --- The comparison alone -------------------------------------------------
  const blank = await syntheticFrontSheet(false, false)
  const written = await syntheticFrontSheet(true, false)
  const scanned = await syntheticFrontSheet(true, true)
  const question = await syntheticQuestionPage(2, true, true)
  const pass = async (scriptFirstPage: Buffer, scriptPageCount = 3) =>
    checkFrontSheet({ scriptFirstPage, scriptPageCount, paperFirstPage: blank, paperPageCount: 3 })

  check('front sheet vs itself passes', (await pass(blank)).result === 'passed')
  check('front sheet with the name written in passes', (await pass(written)).result === 'passed')
  const scannedResult = await pass(scanned)
  check('scanned front sheet with the name written in passes', scannedResult.result === 'passed', String(scannedResult.difference))
  const wrong = await pass(question)
  check('a question page as page 1 is held', /not the front sheet/.test(wrong.result), `${wrong.result} (${wrong.difference})`)
  const short = await pass(written, 2)
  check('a missing sheet is held on the page count', /2 pages but the question paper has 3/.test(short.result), short.result)

  // --- Upload, end to end ---------------------------------------------------
  await setUp()
  try {
    const paper = await pagesToPdf([blank, await syntheticQuestionPage(2, false, false), await syntheticQuestionPage(3, false, false)])
    await storePaperFile(ACTIVITY, 'question_paper', paper)
    const page2 = await syntheticQuestionPage(2, true, true)
    const page3 = await syntheticQuestionPage(3, true, true)

    await refuses('a script must be a PDF', () => storeScript({ activityId: ACTIVITY, pupilId: PUPIL, bytes: scanned }), /must be a PDF/)

    // No question paper: held with a clear reason.
    const bare = await storeScript({ activityId: BARE_ACTIVITY, pupilId: PUPIL, bytes: await pagesToPdf([scanned, page2, page3]) })
    check('no question paper: held', bare.marking === 'held' && bare.front_sheet_check === NO_FRONT_SHEET_MESSAGE, bare.front_sheet_check)
    check('no question paper: no markable pages', (await scriptRow(bare.script_id)).page_paths.length === 0)

    // Out of order: page 1 is a question page.
    const flipped = await storeScript({ activityId: ACTIVITY, pupilId: PUPIL, bytes: await pagesToPdf([page2, scanned, page3]) })
    const flippedRow = await scriptRow(flipped.script_id)
    check('out of order: held', flipped.marking === 'held' && /not the front sheet/.test(flipped.front_sheet_check), flipped.front_sheet_check)
    check('out of order: original kept, no markable pages', flippedRow.page_paths.length === 0 && flippedRow.page_count === 3)
    const flippedSubmission = await submissionRow(flipped.submission_id)
    check('out of order: submission held with the reason', flippedSubmission.mark_status === null && flippedSubmission.mark_error === flipped.front_sheet_check, JSON.stringify(flippedSubmission))
    await refuses('readMarkablePages refuses a held script', () => readMarkablePages(flipped.script_id), /failed the front sheet check/)
    check('a held script is not offered for sending', (await listUnmarkedScriptSubmissions(ACTIVITY)).length === 0)

    // A missing sheet.
    const missing = await storeScript({ activityId: ACTIVITY, pupilId: PUPIL, bytes: await pagesToPdf([scanned, page2]) })
    check('missing sheet: held on the page count', missing.marking === 'held' && /2 pages but the question paper has 3/.test(missing.front_sheet_check), missing.front_sheet_check)
    check('a re-upload replaces the earlier script', missing.replaced_scripts === 1 && !(await scriptRow(flipped.script_id)))

    // In order.
    const good = await storeScript({ activityId: ACTIVITY, pupilId: PUPIL, bytes: await pagesToPdf([scanned, page2, page3]) })
    // Parked at once, so no running worker reads it with a real model.
    await query("update external_jobs set process_after = now() + interval '1 day' where payload->>'submissionId' = $1 and status = 'pending'", [good.submission_id])
    const goodRow = await scriptRow(good.script_id)
    check('in order: passed', good.front_sheet_check === 'passed' && goodRow.front_sheet_check === 'passed')
    check(
      'in order: pages 2 and 3 stored, page 1 not',
      goodRow.page_paths.length === 2 && goodRow.page_paths.every((p, i) => p.endsWith(`/page-${i + 2}.png`)),
      JSON.stringify(goodRow.page_paths),
    )
    const pages = await readMarkablePages(good.script_id)
    check('readMarkablePages returns pages 2 and 3 only', pages.map((p) => p.pageNumber).join(',') === '2,3' && pages.every((p) => p.bytes.length > 0))
    check('in order: queued for reading', good.marking === 'queued', good.message)
    check('a queued script is not offered for sending again', (await listUnmarkedScriptSubmissions(ACTIVITY)).length === 0)
    await query("delete from external_jobs where payload->>'submissionId' = $1", [good.submission_id])
    const sendable = await listUnmarkedScriptSubmissions(ACTIVITY)
    check('a passed, unmarked script is offered for sending', sendable.length === 1 && sendable[0].submissionId === good.submission_id)

    // Rows of any kind take it out of the send list.
    const { rows: [{ question_id }] } = await query<{ question_id: string }>(
      "insert into activity_questions (activity_id, label, max_marks) values ($1, '1', 2) returning question_id",
      [ACTIVITY],
    )
    await query(
      "insert into submission_question_answers (submission_id, question_id, kind, transcription, pages, status, provenance) values ($1, $2, 'text', 'x', '{2}', 'answered', 'ai')",
      [good.submission_id, question_id],
    )
    check('a script already read is not offered for sending', (await listUnmarkedScriptSubmissions(ACTIVITY)).length === 0)
    await refuses(
      'an answer cannot point at page 1',
      () => query("update submission_question_answers set pages = '{1}' where submission_id = $1", [good.submission_id]),
    )
    await query('delete from submission_question_answers where submission_id = $1', [good.submission_id])

    // A folded paper is never offered.
    await query("update activities set body_data = body_data || '{\"foldedFromAssessmentIds\": [\"x\"]}'::jsonb where activity_id = $1", [ACTIVITY])
    check('a folded paper is not offered for sending', (await listUnmarkedScriptSubmissions(ACTIVITY)).length === 0)
    await query("update activities set body_data = body_data - 'foldedFromAssessmentIds' where activity_id = $1", [ACTIVITY])

    // The loader trusts only a passed check and page-N paths with N >= 2.
    const { rows: [{ page_paths }] } = await query<{ page_paths: string[] }>('select page_paths from assessment_scripts where script_id = $1::uuid', [good.script_id])
    await query('update assessment_scripts set front_sheet_check = null where script_id = $1::uuid', [good.script_id])
    await refuses('readMarkablePages refuses an unchecked script', () => readMarkablePages(good.script_id), /not passed the front sheet check/)
    await query(
      "update assessment_scripts set front_sheet_check = 'passed', page_paths = array_prepend(replace($2, 'page-2', 'page-1'), page_paths) where script_id = $1::uuid",
      [good.script_id, page_paths[0]],
    )
    await refuses('readMarkablePages refuses a listed page 1', () => readMarkablePages(good.script_id), /not a markable page/)
    await query("update assessment_scripts set page_paths = array[replace($2, 'page-2.png', 'original.pdf')] where script_id = $1::uuid", [good.script_id, page_paths[0]])
    await refuses('readMarkablePages refuses the original', () => readMarkablePages(good.script_id), /not a markable page/)
    await query('update assessment_scripts set page_paths = $2 where script_id = $1::uuid', [good.script_id, page_paths])

    // The real folded papers are never offered, and nothing on them is markable.
    const { rows: folded } = await query<{ activity_id: string }>(
      "select activity_id from activities where type = 'assessment-paper' and body_data ? 'foldedFromAssessmentIds'",
    )
    let offered = 0
    for (const row of folded) offered += (await listUnmarkedScriptSubmissions(row.activity_id)).length
    check(`folded papers (${folded.length}) offer nothing for sending`, offered === 0)
    const { rows: [{ n }] } = await query<{ n: number }>(
      "select count(*)::int as n from assessment_scripts s join activities a using (activity_id) where a.body_data ? 'foldedFromAssessmentIds' and s.front_sheet_check is not null",
    )
    check('folded papers\' scripts are not checked', n === 0)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    "select (select count(*) from stored_files where scope_path like $1 or scope_path like $2) + (select count(*) from units where unit_id = $3) + (select count(*) from profiles where user_id = $4) as left",
    [`${ACTIVITY}%`, `${BARE_ACTIVITY}%`, UNIT, PUPIL],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
