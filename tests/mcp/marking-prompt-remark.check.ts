import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { setActivityMarkingPromptAndRemark } from '@/lib/mcp/marking-prompt-remark'

// set_activity_marking_prompt's remark option, through the lib it calls: a
// changed prompt re-marks (by default) each pupil's latest submission already
// sent for marking, through enqueueMarkingTasks (one ai_mark job per
// criterion); not an earlier attempt, work never sent, or a submission a
// teacher marked on every criterion; the marker's criterion rows go, a
// teacher's stay, and a whole-activity override in the body stays; a second
// call does not double the jobs; an unchanged prompt, remark false, and an
// upload-file with Mark with AI off queue nothing. No model is called (run
// with MARKING_QUEUE_SECRET blank): it asserts on external_jobs rows and
// deletes them. Creates its own unit, lesson, activities and pupils, and
// removes them. Never prints names.
// Run with DATABASE_URL set:
//   npx tsx tests/mcp/marking-prompt-remark.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const tag = randomUUID().slice(0, 8)
const UNIT = `mpr-check-unit-${tag}`
const LESSON = `mpr-check-lesson-${tag}`
const CODE = randomUUID()
const FILE_OFF = randomUUID()
const P1 = `mpr-check-p1-${tag}` // two attempts; criterion A teacher-marked on the latest, a teacher override
const P2 = `mpr-check-p2-${tag}` // every criterion teacher-marked
const P3 = `mpr-check-p3-${tag}` // never sent for marking
const PEOPLE = [P1, P2, P3]

async function setUp(A: string, B: string) {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) select unnest($1::text[]), 'Re', 'Prompt'", [PEOPLE])
  await query("insert into user_roles (user_id, role_id) select unnest($1::text[]), 'pupil'", [PEOPLE])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Prompt remark unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Prompt remark check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'upload-code', 'Code', $4::jsonb, 0),
       ($2, $3, 'upload-file', 'File', '{"instructions":"Upload"}'::jsonb, 1)`,
    [CODE, FILE_OFF, LESSON, JSON.stringify({ task: 'Print hello', markingGuidance: 'Old prompt', language: 'python' })],
  )
  await query(
    `insert into activity_success_criteria (activity_id, success_criteria_id)
     select a, sc from unnest($1::text[]) a cross join unnest($2::text[]) sc`,
    [[CODE, FILE_OFF], [A, B]],
  )
}

async function tearDown() {
  // enqueueMarkingTasks logs the assignment ("self__<lesson>") and submission ids.
  const { rows: subs } = await query<{ submission_id: string }>(
    'select submission_id from submissions where user_id = any($1::text[])', [PEOPLE])
  await query(
    `delete from ai_marking_logs
      where created_at > timezone('utc', now()) - interval '1 hour'
        and message like any($1::text[])`,
    [[LESSON, ...subs.map((s) => s.submission_id)].map((id) => `%${id}%`)],
  )
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
  await query('delete from submissions where user_id = any($1::text[])', [PEOPLE])
  await query('delete from activity_success_criteria where activity_id = any($1::text[])', [[CODE, FILE_OFF]])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from user_roles where user_id = any($1::text[])', [PEOPLE])
  await query('delete from profiles where user_id = any($1::text[])', [PEOPLE])
}

async function submit(activityId: string, pupil: string, attempt: number, markStatus: string | null, body: Record<string, unknown> = {}) {
  const { rows: [{ submission_id }] } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, mark_status, submission_status)
     values ($1, $2, $3, now() - make_interval(mins => 10 - $3), $5::json, $4, 'submitted')
     returning submission_id`,
    [activityId, pupil, attempt, markStatus, JSON.stringify(body)],
  )
  return submission_id
}

async function scRow(submissionId: string, criterion: string, awarded: number, provenance: string) {
  await query(
    `insert into submission_sc_marks (submission_id, success_criteria_id, awarded, available, provenance)
     values ($1, $2, $3, 1, $4)`,
    [submissionId, criterion, awarded, provenance],
  )
}

async function openJobs() {
  const { rows } = await query<{ submission_id: string; criterion: string }>(
    `select payload->>'submissionId' as submission_id, payload->>'successCriteriaId' as criterion
       from external_jobs
      where job_type = 'ai_mark' and status in ('pending', 'processing')
        and payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))`,
    [PEOPLE],
  )
  return rows
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select success_criteria_id from success_criteria
      where coalesce(sc_type, 'binary') = 'binary'
      order by success_criteria_id limit 2`,
  )
  const [A, B] = scs.map((row) => row.success_criteria_id)
  await setUp(A, B)
  try {
    const p1Old = await submit(CODE, P1, 1, 'marked')
    const p1 = await submit(CODE, P1, 2, 'marked', { teacher_override_score: 1 })
    const p2 = await submit(CODE, P2, 1, 'marked')
    await submit(CODE, P3, 1, null)
    const offSub = await submit(FILE_OFF, P1, 1, 'marked')
    for (const s of [p1Old, offSub]) {
      await scRow(s, A, 0, 'ai')
      await scRow(s, B, 0, 'ai')
    }
    await scRow(p1, A, 1, 'teacher')
    await scRow(p1, B, 0, 'ai')
    await scRow(p2, A, 1, 'teacher')
    await scRow(p2, B, 1, 'teacher')

    const same = await setActivityMarkingPromptAndRemark(CODE, { markingPrompt: 'Old prompt' }, { remark: true })
    check('an unchanged prompt re-marks nothing', !same.remarking.prompt_changed && (await openJobs()).length === 0, JSON.stringify(same.remarking))

    const off = await setActivityMarkingPromptAndRemark(CODE, { markingPrompt: 'New prompt' }, { remark: false })
    const { rows: [p1B] } = await query<{ provenance: string }>(
      'select provenance from submission_sc_marks where submission_id = $1 and success_criteria_id = $2', [p1, B])
    check(
      'remark false saves the prompt, queues nothing and keeps marks',
      off.prompt.marking_prompt === 'New prompt' && off.remarking.prompt_changed && off.remarking.submissions_queued === 0
        && (await openJobs()).length === 0 && p1B?.provenance === 'ai',
      JSON.stringify(off.remarking),
    )

    const on = await setActivityMarkingPromptAndRemark(CODE, { markingPrompt: 'Newer prompt' }, { remark: true })
    let jobs = await openJobs()
    check(
      'remark: only the latest attempt already sent and not fully teacher-marked is queued, per criterion',
      jobs.length === 2 && jobs.every((j) => j.submission_id === p1) && new Set(jobs.map((j) => j.criterion)).size === 2,
      JSON.stringify(jobs.map((j) => (j.submission_id === p1 ? 'p1' : 'other'))),
    )
    check(
      'remark: the result counts queued and teacher-marked',
      on.remarking.submissions_queued === 1 && on.remarking.skipped_teacher_marked === 1,
      JSON.stringify(on.remarking),
    )
    const { rows: p1Rows } = await query<{ success_criteria_id: string; provenance: string }>(
      'select success_criteria_id, provenance from submission_sc_marks where submission_id = $1', [p1])
    const { rows: [p1Body] } = await query<{ override: string | null; mark_status: string }>(
      "select body::jsonb->>'teacher_override_score' as override, mark_status from submissions where submission_id = $1", [p1])
    check(
      'remark: the marker\'s row goes, the teacher\'s row and override stay, the work waits',
      p1Rows.length === 1 && p1Rows[0].success_criteria_id === A && p1Rows[0].provenance === 'teacher'
        && p1Body.override === '1' && p1Body.mark_status === 'waiting',
      JSON.stringify({ p1Rows, p1Body }),
    )
    const { rows: oldRows } = await query('select 1 from submission_sc_marks where submission_id = $1', [p1Old])
    check('remark: an earlier attempt is untouched', oldRows.length === 2)

    await setActivityMarkingPromptAndRemark(CODE, { markingPrompt: 'Newest prompt' }, { remark: true })
    jobs = await openJobs()
    check('a second change does not double the jobs', jobs.length === 2, String(jobs.length))

    await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = any($1::text[]))", [PEOPLE])
    const fileOff = await setActivityMarkingPromptAndRemark(FILE_OFF, { markingPrompt: 'Look for a sketch' }, { remark: true })
    const { rows: [offStatus] } = await query<{ mark_status: string | null }>('select mark_status from submissions where submission_id = $1', [offSub])
    check(
      'an upload-file with Mark with AI off is not re-marked and keeps its status',
      fileOff.remarking.submissions_queued === 0 && (await openJobs()).length === 0 && offStatus.mark_status === 'marked',
      JSON.stringify(fileOff.remarking),
    )
  } finally {
    await tearDown()
  }
  const { rows: [{ left }] } = await query<{ left: string }>(
    'select count(*)::text as left from profiles where user_id = any($1::text[])', [PEOPLE],
  )
  check('clean-up removed everything', left === '0')
  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
