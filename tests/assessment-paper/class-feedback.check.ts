import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { query } from '@/lib/db'
import type { McpCaller } from '@/lib/mcp/auth'
import { claimDownloadLink, createClassFeedbackDownloadLink } from '@/lib/mcp/download-links'
import { resolveClassFeedbackTarget } from '@/lib/mcp/assessment-activities'
import { setAssessmentQuestions, setTeacherQuestionCriterionMark } from '@/lib/assessment-paper/store'
import { classFeedbackFileName, renderClassFeedbackPdf } from '@/lib/assessment-paper/class-feedback-pdf'

// create_assessment_activity_class_feedback_link: resolving the class, unit
// and activity by id or name (ambiguous names and a wrong type refused, a
// class not set the lesson refused), the one-time link (single use, expiry),
// and the class PDF: the cover's statuses from each pupil's latest attempt,
// staff and other classes left out, and one page per pupil who sat it after
// the cover. No model is called and no file is stored. Creates its own units,
// lessons, activities, classes and people, and removes them. Never prints names.
// Run with DATABASE_URL set, where poppler is installed:
//   npx tsx tests/assessment-paper/class-feedback.check.ts [pdf-dir]

const execFileAsync = promisify(execFile)

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refused(run: () => Promise<unknown>, pattern: RegExp): Promise<[boolean, string]> {
  try {
    await run()
    return [false, 'not refused']
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [pattern.test(message), message]
  }
}

const PDF_DIR = process.argv[2] || path.join(process.cwd(), 'tmp-class-feedback-check')
const tag = randomUUID().slice(0, 8)
const UNIT = `cf-check-unit-${tag}`
const TWIN_A = `cf-check-twin-a-${tag}`
const TWIN_B = `cf-check-twin-b-${tag}`
const LESSON = `cf-check-lesson-${tag}`
const OTHER_LESSON = `cf-check-lesson2-${tag}`
const INTERVENTION_LESSON = `cf-check-lesson3-${tag}`
const GROUP = `cf-check-${tag}`
const GROUP_UPPER = `CF-CHECK-${tag}`
const OTHER_GROUP = `cf-check-other-${tag}`
const PAPER = randomUUID()
const TWIN_PAPER_1 = randomUUID()
const TWIN_PAPER_2 = randomUUID()
const TEXT_ACTIVITY = randomUUID()
const UNSET_PAPER = randomUUID()
const INTERVENTION_PAPER = randomUUID()
const PAPER_TITLE = `Class feedback check ${tag}`

// Last names sort Adams, Brown (Amy), Brown (Zed), Clark, Davis.
const ADAMS = `cf-check-adams-${tag}` // marked, two attempts
const ZED_BROWN = `cf-check-zbrown-${tag}` // held: front sheet check failed
const AMY_BROWN = `cf-check-abrown-${tag}` // not sat
const CLARK = `cf-check-clark-${tag}` // not yet marked
const DAVIS = `cf-check-davis-${tag}` // not sat
const STAFF = `cf-check-staff-${tag}` // teacher with a pupil role and a submission
const OUTSIDER = `cf-check-outsider-${tag}` // a pupil of another class with a submission
const PEOPLE = [ADAMS, ZED_BROWN, AMY_BROWN, CLARK, DAVIS, STAFF, OUTSIDER]

const caller: McpCaller = { method: 'service_key', userId: null, clientId: null }

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query(
    `insert into profiles (user_id, first_name, last_name) values
       ($1, 'Ann', 'Adams'), ($2, 'Zed', 'Brown'), ($3, 'Amy', 'Brown'), ($4, 'Cal', 'Clark'),
       ($5, 'Dee', 'Davis'), ($6, 'Sam', 'Staff'), ($7, 'Out', 'Sider')`,
    PEOPLE,
  )
  await query(
    "insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'",
    [PEOPLE],
  )
  await query("insert into user_roles (user_id, role_id) values ($1, 'teacher')", [STAFF])
  await query(
    "insert into units (unit_id, title, subject) values ($1, $4, $5), ($2, 'Twin unit ' || $6, $5), ($3, 'twin UNIT ' || $6, $5)",
    [UNIT, TWIN_A, TWIN_B, `Class feedback unit ${tag}`, subject, tag],
  )
  await query(
    `insert into lessons (lesson_id, unit_id, title, order_by, kind) values
       ($1, $3, 'Class feedback check', 0, 'standard'), ($2, $3, 'Class feedback check 2', 1, 'standard'),
       ($4, $3, 'Class feedback check 3', 2, 'intervention')`,
    [LESSON, OTHER_LESSON, UNIT, INTERVENTION_LESSON],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $6, 'assessment-paper', $7, '{}'::jsonb, 0),
       ($2, $6, 'assessment-paper', 'Twin paper', '{}'::jsonb, 1),
       ($3, $6, 'assessment-paper', 'twin paper', '{}'::jsonb, 2),
       ($4, $6, 'text', 'Not a paper', '{}'::jsonb, 3),
       ($5, $8, 'assessment-paper', 'Unset paper', '{}'::jsonb, 0),
       ($9, $10, 'assessment-paper', 'Intervention paper', '{}'::jsonb, 0)`,
    [PAPER, TWIN_PAPER_1, TWIN_PAPER_2, TEXT_ACTIVITY, UNSET_PAPER, LESSON, PAPER_TITLE, OTHER_LESSON, INTERVENTION_PAPER, INTERVENTION_LESSON],
  )
  await query('insert into groups (group_id, subject) values ($1, $4), ($2, $4), ($3, $4)', [GROUP, GROUP_UPPER, OTHER_GROUP, subject])
  await query(
    'insert into group_membership (group_id, user_id) select $1, unnest($2::text[])',
    [GROUP, [ADAMS, ZED_BROWN, AMY_BROWN, CLARK, DAVIS, STAFF]],
  )
  await query('insert into group_membership (group_id, user_id) values ($1, $2)', [OTHER_GROUP, OUTSIDER])
  await query(
    `insert into planner_assignments (group_id, lesson_id, week_start_date, day, period) values
       ($1, $3, current_date, 'sunday', 1), ($2, $3, current_date, 'sunday', 1)`,
    [GROUP, OTHER_GROUP, LESSON],
  )
}

async function tearDown() {
  await query('delete from planner_assignments where lesson_id = any($1::text[])', [[LESSON, OTHER_LESSON, INTERVENTION_LESSON]])
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
  await query('delete from assessment_scripts where pupil_id = any($1::text[])', [PEOPLE])
  await query('delete from submissions where user_id = any($1::text[])', [PEOPLE])
  await query('delete from mcp_download_links where group_id = any($1::text[])', [[GROUP, GROUP_UPPER, OTHER_GROUP]])
  await query('delete from activities where lesson_id = any($1::text[])', [[LESSON, OTHER_LESSON, INTERVENTION_LESSON]])
  await query('delete from lessons where lesson_id = any($1::text[])', [[LESSON, OTHER_LESSON, INTERVENTION_LESSON]])
  await query('delete from units where unit_id = any($1::text[])', [[UNIT, TWIN_A, TWIN_B]])
  await query('delete from groups where group_id = any($1::text[])', [[GROUP, GROUP_UPPER, OTHER_GROUP]])
  await query('delete from profiles where user_id = any($1::text[])', [PEOPLE])
}

async function submit(pupilId: string, attempt: number, markStatus: string | null, marks: number | null) {
  const { rows: [{ submission_id }] } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
     values ($1, $2, $3, now() - make_interval(mins => 10 - $3), $4::json, $5, 'submitted')
     returning submission_id`,
    [PAPER, pupilId, attempt, JSON.stringify(marks === null ? {} : { marks }), markStatus],
  )
  return submission_id
}

async function pageText(file: string, page: number) {
  return (await execFileAsync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', file, '-'])).stdout
}

async function main() {
  await mkdir(PDF_DIR, { recursive: true })
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 2 limit 1)
      order by sc.success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)

  await setUp()
  try {
    const [question] = await setAssessmentQuestions(PAPER, [
      { label: '1', maxMarks: 4, questionText: 'Explain why aluminium is used.', markScheme: 'Strong (2). Light (2).', criteria: [{ successCriteriaId: A, maxMarks: 2 }, { successCriteriaId: B, maxMarks: 2 }] },
    ])

    // --- Resolution -------------------------------------------------------------
    const byId = await resolveClassFeedbackTarget({ class: GROUP, unit: UNIT, activity: PAPER })
    check('resolves by ids', byId.groupId === GROUP && byId.unitId === UNIT && byId.activityId === PAPER && byId.lessonId === LESSON)
    const byName = await resolveClassFeedbackTarget({ class: OTHER_GROUP.toUpperCase(), unit: `class FEEDBACK unit ${tag}`, activity: ` ${PAPER_TITLE.toLowerCase()} ` })
    check('resolves by case-insensitive names', byName.groupId === OTHER_GROUP && byName.unitId === UNIT && byName.activityId === PAPER)
    // GROUP_UPPER also matches GROUP case-insensitively; the exact id is taken, and that class is not set the lesson.
    let [ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: GROUP_UPPER, unit: UNIT, activity: PAPER }), /^Class CF-CHECK-.* is not set the lesson/)
    check('an exact class id wins over a case-insensitive match', ok, detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: `Cf-Check-${tag}`, unit: UNIT, activity: PAPER }), /More than one class.*Retry with the id/)
    check('an ambiguous class name is refused, listing the candidates', ok && detail.includes(GROUP) && detail.includes(GROUP_UPPER), detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: GROUP, unit: `TWIN unit ${tag}`, activity: PAPER }), /More than one unit/)
    check('an ambiguous unit title is refused, listing the ids', ok && detail.includes(TWIN_A) && detail.includes(TWIN_B), detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: GROUP, unit: UNIT, activity: 'TWIN PAPER' }), /More than one activity/)
    check('an ambiguous activity title is refused, listing the ids', ok && detail.includes(TWIN_PAPER_1) && detail.includes(TWIN_PAPER_2), detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: GROUP, unit: UNIT, activity: 'Not a paper' }), /not an assessment paper/)
    check('a non-paper activity is refused', ok, detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: GROUP, unit: TWIN_A, activity: PAPER }), /No activity matches/)
    check('an activity outside the unit is refused', ok, detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: GROUP, unit: UNIT, activity: UNSET_PAPER }), /not set the lesson/)
    check('a class not set the lesson is refused', ok, detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: `nope-${tag}`, unit: UNIT, activity: PAPER }), /No class matches/)
    check('an unknown class is refused', ok, detail)
    ;[ok, detail] = await refused(() => resolveClassFeedbackTarget({ class: GROUP, unit: UNIT, activity: INTERVENTION_PAPER }), /No activity matches/)
    check('an activity in an intervention lesson is refused', ok, detail)

    // --- The link ---------------------------------------------------------------
    const link = await createClassFeedbackDownloadLink(caller, { class: GROUP, unit: UNIT, activity: PAPER_TITLE })
    const claimed = await claimDownloadLink(link.token)
    check(
      'the link is claimed once as a class feedback link',
      claimed?.kind === 'assessment_class_feedback' && claimed.activity_id === PAPER && claimed.group_id === GROUP && claimed.lesson_id === LESSON,
      JSON.stringify(claimed && { ...claimed, caller: undefined }),
    )
    check('a second claim fails', (await claimDownloadLink(link.token)) === null)
    const expiring = await createClassFeedbackDownloadLink(caller, { class: GROUP, unit: UNIT, activity: PAPER })
    await query("update mcp_download_links set expires_at = now() - interval '1 minute' where group_id = $1 and used_at is null", [GROUP])
    check('an expired link fails', (await claimDownloadLink(expiring.token)) === null)
    const [shapeOk] = await refused(
      () => query(
        "insert into mcp_download_links (token_hash, kind, lesson_id, activity_id, auth_method, expires_at) values ($1, 'assessment_class_feedback', $2, $3, 'service_key', now())",
        [`cf-check-${tag}`, LESSON, PAPER],
      ),
      /kind_shape/,
    )
    check('a class feedback link without a class is refused by the table', shapeOk)

    // --- Submissions ------------------------------------------------------------
    const adamsOld = await submit(ADAMS, 1, 'marked', null)
    const adamsLatest = await submit(ADAMS, 2, 'marked', null)
    await setTeacherQuestionCriterionMark(adamsOld, question.questionId, A, 0, 'Old attempt comment')
    await setTeacherQuestionCriterionMark(adamsOld, question.questionId, B, 0)
    await setTeacherQuestionCriterionMark(adamsLatest, question.questionId, A, 2, 'Latest attempt comment')
    await setTeacherQuestionCriterionMark(adamsLatest, question.questionId, B, 1)
    await query("update submissions set mark_status = 'marked' where submission_id = any($1::text[])", [[adamsOld, adamsLatest]])
    const brown = await submit(ZED_BROWN, 1, null, null)
    await query(
      "insert into assessment_scripts (activity_id, pupil_id, submission_id, original_path, front_sheet_check) values ($1, $2, $3, 'none.pdf', 'The front sheet does not match')",
      [PAPER, ZED_BROWN, brown],
    )
    await submit(CLARK, 1, 'marking', null)
    await submit(STAFF, 1, 'marked', 4)
    await submit(OUTSIDER, 1, 'marked', 4)

    // --- The PDF ----------------------------------------------------------------
    const { data, buffer, fileName } = await renderClassFeedbackPdf(PAPER, GROUP)
    check('file name is the slugified title and class', fileName === `class-feedback-check-${tag}-cf-check-${tag}-feedback.pdf`, fileName)
    check('the tool\'s file name matches the download\'s', classFeedbackFileName(PAPER_TITLE, GROUP) === fileName)
    const order = data.roster.map((r) => `${r.pupilName}|${r.status}|${r.marksAwarded ?? '-'}`)
    check(
      'cover: every pupil of the class, sorted by last then first name, with status and latest marks',
      JSON.stringify(order) === JSON.stringify([
        'Ann Adams|marked|3',
        'Amy Brown|not sat|-',
        'Zed Brown|held|-',
        'Cal Clark|not yet marked|-',
        'Dee Davis|not sat|-',
      ]),
      JSON.stringify(order),
    )
    check('staff and other classes are left out', !order.some((r) => r.startsWith('Sam') || r.startsWith('Out')))
    check('a section for each pupil who sat it, in roster order', JSON.stringify(data.pupils.map((p) => p.pupilName)) === JSON.stringify(['Ann Adams', 'Zed Brown', 'Cal Clark']))
    check('the sections carry the class', data.pupils.every((p) => p.className === GROUP))
    check('the cover has the class, unit and a DD-MM-YYYY date', data.className === GROUP && data.unitTitle === `Class feedback unit ${tag}` && /^\d{2}-\d{2}-\d{4}$/.test(data.generatedOn))

    const file = path.join(PDF_DIR, `class-${tag}.pdf`)
    await writeFile(file, buffer)
    const info = await execFileAsync('pdfinfo', [file])
    const pages = Number.parseInt(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? '0', 10)
    check('a valid PDF: the cover plus a page per pupil who sat it', buffer.subarray(0, 5).toString() === '%PDF-' && pages === 4, String(pages))
    const cover = await pageText(file, 1)
    check('cover page lists the statuses', ['Marked', 'Not sat', 'Held', 'Not yet marked'].every((s) => cover.includes(s)) && /3\s*\/\s*4/.test(cover) && cover.includes(GROUP))
    // Marked by the teacher alone: no AI mark on record to compare with.
    check('cover has AI mark, final mark and change columns, — where not recorded', ['AI MARK', 'FINAL MARK', 'CHANGE'].every((s) => cover.includes(s)) && data.roster.every((r) => r.aiMarks === null && r.change === null) && cover.includes('No AI marks on record'))
    const p2 = await pageText(file, 2)
    const p3 = await pageText(file, 3)
    const p4 = await pageText(file, 4)
    check('each pupil starts a new page', p2.includes('Ann Adams') && p3.includes('Zed Brown') && p4.includes('Cal Clark'))
    check('the section is the pupil\'s full feedback from the latest attempt', p2.includes('3 / 4 marks') && p2.includes('Latest attempt comment') && p2.includes('Strong (2)') && !p2.includes('Old attempt comment'))
    check('page header carries pupil and class, footer page numbers', /Zed Brown\s+·\s+cf-check-/.test(p3) && p3.includes('Page 3 of 4'))
    const all = cover + p2 + p3 + p4
    check('no staff or outsider anywhere in the PDF', !all.includes('Staff') && !all.includes('Sider'))
    await rm(file, { force: true })
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from units where unit_id = any($1::text[]))
          + (select count(*) from groups where group_id = any($2::text[]))
          + (select count(*) from profiles where user_id = any($3::text[]))
          + (select count(*) from activities where activity_id = $4)
          + (select count(*) from mcp_download_links where token_hash = $5) as left`,
    [[UNIT, TWIN_A, TWIN_B], [GROUP, GROUP_UPPER, OTHER_GROUP], PEOPLE, PAPER, `cf-check-${tag}`],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
