import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { mcpBoolean } from '@/lib/mcp/activities'
import { getActivityMarkingPrompt, setActivityMarkingPrompt } from '@/lib/mcp/marking-prompts'

// MCP get_activity_marking_prompt / set_activity_marking_prompt, through the
// lib they call: what is read per AI-marked type (short-text-question with its
// model answer, upload-code, upload-spreadsheet, upload-worksheet with and
// without a template, mark-worksheet, upload-file on and off, an assessment
// paper pointing to the per-question tools, a text activity with none); what
// is written (the prompt replaced and trimmed, the rest of the body kept, an
// empty prompt removed where allowed and refused where required, the
// upload-file switch, ai_marking refused on other types); refusals for
// question-marked and non-AI types and unknown activities; the unit audit
// stamp; and that writing a prompt queues nothing and leaves pupils' work as
// it was. No model is called. Creates its own unit, lesson, activities,
// template and pupil, and removes them. Never prints names.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/mcp/marking-prompts.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refused(run: () => Promise<unknown> | unknown, pattern: RegExp): Promise<[boolean, string]> {
  try {
    await run()
    return [false, 'not refused']
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [pattern.test(message), message]
  }
}

const tag = randomUUID().slice(0, 8)
const UNIT = `mp-check-unit-${tag}`
const LESSON = `mp-check-lesson-${tag}`
const PUPIL = `mp-check-pupil-${tag}`
const TEMPLATE = randomUUID()
const IDS = {
  stq: randomUUID(),
  code: randomUUID(),
  sheet: randomUUID(),
  worksheet: randomUUID(),
  worksheetTemplate: randomUUID(),
  markWorksheet: randomUUID(),
  fileOn: randomUUID(),
  fileOff: randomUUID(),
  paper: randomUUID(),
  text: randomUUID(),
}

const BODIES: Array<[string, string, Record<string, unknown>]> = [
  [IDS.stq, 'short-text-question', { question: 'What is a resistor?', modelAnswer: 'A component that limits current.' }],
  [IDS.code, 'upload-code', { task: 'Print hello', markingGuidance: '<p>One mark for print("hello")</p>', language: 'python', starterCode: '# start\n' }],
  [IDS.sheet, 'upload-spreadsheet', { task: 'Sum column A', markingGuidance: 'One mark for =SUM(A1:A5)' }],
  [IDS.worksheet, 'upload-worksheet', { task: 'Answer Q1', markingGuidance: 'Award a mark for 42' }],
  [IDS.worksheetTemplate, 'upload-worksheet', { task: 'Answer Q2', markingGuidance: '', markingGuidanceId: TEMPLATE }],
  [IDS.markWorksheet, 'mark-worksheet', { worksheetImages: [{ filePath: 'x/blank.png', fileName: 'blank.png' }], answerImages: [], markingGuidance: 'Check units' }],
  [IDS.fileOn, 'upload-file', { instructions: 'Upload your design', aiMarking: true, markingGuidance: 'Look for a labelled sketch' }],
  [IDS.fileOff, 'upload-file', { instructions: 'Upload your design' }],
  [IDS.paper, 'assessment-paper', { instructions: 'Sit the paper' }],
  [IDS.text, 'text', { text: 'Read this' }],
]

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Prompt', 'Check')", [PUPIL])
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil')", [PUPIL])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Marking prompt check ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Marking prompt check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    "insert into marking_guidances (id, subject, title, content) values ($1, $2, $3, 'Award marks for working.')",
    [TEMPLATE, subject, `Template ${tag}`],
  )
  let order = 0
  for (const [id, type, body] of BODIES) {
    await query(
      'insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, $3, $4, $5::jsonb, $6)',
      [id, LESSON, type, `${type} check`, JSON.stringify(body), order++],
    )
  }
}

async function tearDown() {
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = $1)", [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from marking_guidances where id = $1', [TEMPLATE])
  await query('delete from user_roles where user_id = $1', [PUPIL])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

async function body(id: string): Promise<Record<string, unknown>> {
  const { rows } = await query<{ body_data: Record<string, unknown> }>('select body_data from activities where activity_id = $1', [id])
  return rows[0].body_data
}

async function checkReads() {
  const stq = await getActivityMarkingPrompt(IDS.stq)
  check('short-text-question: has a prompt, none set, not required, model answer returned',
    stq.ai_marked && stq.has_marking_prompt && stq.marking_prompt === '' && !stq.prompt_required
      && stq.model_answer === 'A component that limits current.' && stq.ai_marking === null, JSON.stringify(stq))

  const code = await getActivityMarkingPrompt(IDS.code)
  check('upload-code: the stored prompt, required, no template or model answer',
    code.marking_prompt === '<p>One mark for print("hello")</p>' && code.prompt_required
      && code.model_answer === null && code.marking_guidance_template === null, JSON.stringify(code))

  const sheet = await getActivityMarkingPrompt(IDS.sheet)
  check('upload-spreadsheet: the stored prompt, required', sheet.marking_prompt === 'One mark for =SUM(A1:A5)' && sheet.prompt_required)

  const worksheet = await getActivityMarkingPrompt(IDS.worksheet)
  check('upload-worksheet without a template: required, no template',
    worksheet.prompt_required && worksheet.marking_guidance_template === null && worksheet.marking_prompt === 'Award a mark for 42')

  const templated = await getActivityMarkingPrompt(IDS.worksheetTemplate)
  check('upload-worksheet with a template: not required, the template returned',
    !templated.prompt_required && templated.marking_guidance_template?.id === TEMPLATE
      && templated.marking_guidance_template?.content === 'Award marks for working.', JSON.stringify(templated))

  const mark = await getActivityMarkingPrompt(IDS.markWorksheet)
  check('mark-worksheet: optional prompt', mark.has_marking_prompt && !mark.prompt_required && mark.marking_prompt === 'Check units')

  const on = await getActivityMarkingPrompt(IDS.fileOn)
  check('upload-file on: AI-marked, switch on, prompt required',
    on.ai_marked && on.ai_marking === true && on.prompt_required && on.marking_prompt === 'Look for a labelled sketch')
  const off = await getActivityMarkingPrompt(IDS.fileOff)
  check('upload-file off: not AI-marked, switch off, a prompt slot that is not required',
    !off.ai_marked && off.ai_marking === false && off.has_marking_prompt && !off.prompt_required && off.marking_prompt === '')

  const paper = await getActivityMarkingPrompt(IDS.paper)
  check('assessment-paper: AI-marked, no single prompt, points to the per-question tools',
    paper.ai_marked && !paper.has_marking_prompt && paper.marking_prompt === null
      && /set_assessment_activity_questions/.test(paper.note) && /get_assessment_activity/.test(paper.note), JSON.stringify(paper))

  const text = await getActivityMarkingPrompt(IDS.text)
  check('text: not AI-marked, no prompt', !text.ai_marked && !text.has_marking_prompt && text.marking_prompt === null && /not marked by AI/.test(text.note))

  const [missing, missingMessage] = await refused(() => getActivityMarkingPrompt(randomUUID()), /not found/)
  check('an unknown activity is refused', missing, missingMessage)
}

async function checkWrites() {
  // A pupil's work on the upload-code activity: writing the prompt must not
  // queue or change anything about it.
  const { rows: [{ submission_id: submissionId }] } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
     values ($1, $2, 1, $3, now(), 'submitted') returning submission_id`,
    [IDS.code, PUPIL, JSON.stringify({ code: 'print("hello")' })],
  )
  const { rows: [before] } = await query<{ snapshot: string }>('select row_to_json(s)::text as snapshot from submissions s where submission_id = $1', [submissionId])
  await query("update unit_audits set changed_at = now() - interval '1 day' where unit_id = $1", [UNIT])

  const code = await setActivityMarkingPrompt(IDS.code, { markingPrompt: '  Two marks: print and the exact text.  ' })
  check('upload-code: the prompt is replaced and trimmed, and returned', code.marking_prompt === 'Two marks: print and the exact text.')
  const codeBody = await body(IDS.code)
  check('upload-code: the rest of the body is kept',
    codeBody.task === 'Print hello' && codeBody.language === 'python' && codeBody.starterCode === '# start\n', JSON.stringify(codeBody))

  const { rows: [after] } = await query<{ snapshot: string }>('select row_to_json(s)::text as snapshot from submissions s where submission_id = $1', [submissionId])
  check('writing a prompt leaves the pupil\'s submission unchanged', before.snapshot === after.snapshot)
  const { rows: [{ n: jobs }] } = await query<{ n: number }>(
    "select count(*)::int as n from external_jobs where payload->>'submissionId' = $1", [submissionId],
  )
  check('writing a prompt queues no marking', jobs === 0, `${jobs} jobs`)
  const { rows: audit } = await query<{ fresh: boolean }>(
    "select changed_at > now() - interval '1 hour' as fresh from unit_audits where unit_id = $1", [UNIT],
  )
  check('the unit audit is stamped as changed', audit[0]?.fresh === true, JSON.stringify(audit))

  const [codeEmpty, codeEmptyMessage] = await refused(() => setActivityMarkingPrompt(IDS.code, { markingPrompt: '  ' }), /markingGuidance/)
  check('upload-code: an empty prompt is refused', codeEmpty, codeEmptyMessage)
  check('upload-code: the refused write left the prompt', (await body(IDS.code)).markingGuidance === 'Two marks: print and the exact text.')

  const [sheetEmpty, sheetEmptyMessage] = await refused(() => setActivityMarkingPrompt(IDS.sheet, { markingPrompt: '' }), /markingGuidance/)
  check('upload-spreadsheet: an empty prompt is refused', sheetEmpty, sheetEmptyMessage)

  const stq = await setActivityMarkingPrompt(IDS.stq, { markingPrompt: 'Accept "reduces current".' })
  const stqBody = await body(IDS.stq)
  check('short-text-question: the prompt is set beside the question and model answer',
    stq.marking_prompt === 'Accept "reduces current".' && stqBody.question === 'What is a resistor?' && stqBody.modelAnswer === 'A component that limits current.')
  await setActivityMarkingPrompt(IDS.stq, { markingPrompt: '' })
  check('short-text-question: an empty prompt removes it', !('markingGuidance' in (await body(IDS.stq))))

  const [worksheetEmpty, worksheetEmptyMessage] = await refused(() => setActivityMarkingPrompt(IDS.worksheet, { markingPrompt: '' }), /marking guidance/i)
  check('upload-worksheet without a template: an empty prompt is refused', worksheetEmpty, worksheetEmptyMessage)
  check('upload-worksheet: the refused write left the prompt', (await body(IDS.worksheet)).markingGuidance === 'Award a mark for 42')
  await setActivityMarkingPrompt(IDS.worksheet, { markingPrompt: 'Award a mark for 42 with units.' })
  check('upload-worksheet: the prompt is replaced', (await body(IDS.worksheet)).markingGuidance === 'Award a mark for 42 with units.')
  const templated = await setActivityMarkingPrompt(IDS.worksheetTemplate, { markingPrompt: 'Also accept 6 × 7.' })
  check('upload-worksheet with a template: the prompt is set and the template kept',
    templated.marking_prompt === 'Also accept 6 × 7.' && (await body(IDS.worksheetTemplate)).markingGuidanceId === TEMPLATE)

  await setActivityMarkingPrompt(IDS.markWorksheet, { markingPrompt: '' })
  const markBody = await body(IDS.markWorksheet)
  check('mark-worksheet: an empty prompt removes it and keeps the images',
    !('markingGuidance' in markBody) && Array.isArray(markBody.worksheetImages) && (markBody.worksheetImages as unknown[]).length === 1)

  const [onWithout, onWithoutMessage] = await refused(() => setActivityMarkingPrompt(IDS.fileOff, { aiMarking: true }), /marking prompt/i)
  check('upload-file: turning AI marking on with no prompt is refused', onWithout, onWithoutMessage)
  const fileOn = await setActivityMarkingPrompt(IDS.fileOff, { aiMarking: true, markingPrompt: 'Look for a circuit with a resistor.' })
  check('upload-file: AI marking turned on with a prompt',
    fileOn.ai_marked && fileOn.ai_marking === true && fileOn.marking_prompt === 'Look for a circuit with a resistor.'
      && (await body(IDS.fileOff)).instructions === 'Upload your design')
  const fileOff = await setActivityMarkingPrompt(IDS.fileOn, { aiMarking: false })
  check('upload-file: turning AI marking off keeps the prompt',
    !fileOff.ai_marked && fileOff.ai_marking === false && fileOff.marking_prompt === 'Look for a labelled sketch')
  const [clearOn, clearOnMessage] = await refused(() => setActivityMarkingPrompt(IDS.fileOff, { markingPrompt: '' }), /marking prompt/i)
  check('upload-file: clearing the prompt while AI marking is on is refused', clearOn, clearOnMessage)
  check('the MCP ai_marking param takes the string "false"', mcpBoolean.safeParse('false').data === false)

  const [nothing, nothingMessage] = await refused(() => setActivityMarkingPrompt(IDS.code, {}), /marking_prompt/)
  check('a call with nothing to set is refused', nothing, nothingMessage)
  const [switchOther, switchOtherMessage] = await refused(() => setActivityMarkingPrompt(IDS.code, { aiMarking: false }), /upload-file activities only/)
  check('ai_marking on an upload-code is refused', switchOther, switchOtherMessage)
  const [paper, paperMessage] = await refused(() => setActivityMarkingPrompt(IDS.paper, { markingPrompt: 'x' }), /set_assessment_activity_questions/)
  check('an assessment paper is refused with the per-question tool named', paper, paperMessage)
  check('the refused assessment paper body is unchanged', !('markingGuidance' in (await body(IDS.paper))))
  const [text, textMessage] = await refused(() => setActivityMarkingPrompt(IDS.text, { markingPrompt: 'x' }), /not marked by AI/)
  check('a text activity is refused', text, textMessage)
  const [missing, missingMessage] = await refused(() => setActivityMarkingPrompt(randomUUID(), { markingPrompt: 'x' }), /not found/)
  check('an unknown activity is refused', missing, missingMessage)
}

async function main() {
  if (process.env.MARKING_QUEUE_SECRET) {
    throw new Error('Run with MARKING_QUEUE_SECRET empty so nothing can trigger the queue.')
  }
  await tearDown()
  await setUp()
  try {
    await checkReads()
    await checkWrites()
  } finally {
    await tearDown()
  }
  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
