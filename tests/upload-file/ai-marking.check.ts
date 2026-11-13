import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { buildMarkingCall } from '@/lib/ai/marking'
import { enqueueMarkingTasks } from '@/lib/ai/marking-queue'
import { recordCriterionMark } from '@/lib/scoring/aggregate-sc-marks'
import {
  UploadFileMarkingError,
  buildUploadFileMarkingRequest,
  currentUploadedFiles,
} from '@/lib/ai/upload-file-marking'
import {
  ActivityBodyDataError,
  createActivity,
  mcpBoolean,
  updateActivity,
  uploadFileMarkingFields,
  validateBodyDataForType,
} from '@/lib/mcp/activities'
import { classifyUploadFile, uploadFileAiMarkingError, unreadableUploadMessage } from '@/lib/upload-file/ai-marking'
import { isAiMarkedActivity } from '@/dino.config'
import { UploadFileActivityBodySchema } from '@/types'

// AI marking of upload-file activities: the body schema (old and new
// bodies), the editor/MCP rule that AI marking needs a marking prompt,
// queueing (off → nothing, on with criteria → one ai_mark job per criterion,
// on without criteria → nothing, an unreadable file → marking-error and no
// job), the request sent for an image, a PDF and a text file (no base64 in
// what is stored on the job), and the MCP ai_marking / marking_prompt params.
// No model is called and the queue is never processed: jobs are only
// inserted, inspected and removed. Creates its own unit, lesson, activities
// and pupil and removes them. Never prints names.
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/upload-file/ai-marking.check.ts

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
const UNIT = `uf-check-unit-${tag}`
const LESSON = `uf-check-lesson-${tag}`
const AI_ON = randomUUID()
const AI_OFF = randomUUID()
const NO_CRITERIA = randomUUID()
const PUPIL = `uf-check-pupil-${tag}`
const ASSIGNMENT = `uf-check-group-${tag}__${LESSON}`
let criteriaIds: string[] = []

const PROMPT = 'Award the mark when the circuit diagram shows a resistor in series with the LED.'

function uploadBody(names: string[]) {
  return {
    submission_type: 'upload-file',
    upload_submission: true,
    uploaded_files: names.map((name) => ({ name, path: `lessons/${LESSON}/activities/x/${PUPIL}/${name}`, status: 'inprogress' })),
    upload_file_name: names[0] ?? null,
    success_criteria_scores: {},
  }
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Upload', 'Check')", [PUPIL])
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil')", [PUPIL])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Upload file check ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Upload file check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $4, 'upload-file', 'AI on', $5::jsonb, 0),
       ($2, $4, 'upload-file', 'AI off', '{"instructions": "<p>Upload your design</p>"}'::jsonb, 1),
       ($3, $4, 'upload-file', 'AI on, no criteria', $5::jsonb, 2)`,
    [AI_ON, AI_OFF, NO_CRITERIA, LESSON, JSON.stringify({ instructions: '<p>Upload a photo of your <strong>circuit</strong></p>', aiMarking: true, markingGuidance: PROMPT })],
  )
  const { rows } = await query<{ success_criteria_id: string }>(
    "select success_criteria_id from success_criteria where active is not false and sc_type = 'binary' order by success_criteria_id limit 2",
  )
  criteriaIds = rows.map((row) => row.success_criteria_id)
  for (const activityId of [AI_ON, AI_OFF]) {
    for (const id of criteriaIds) {
      await query('insert into activity_success_criteria (activity_id, success_criteria_id) values ($1, $2)', [activityId, id])
    }
  }
}

async function tearDown() {
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = $1)", [PUPIL])
  await query('delete from submission_sc_marks where submission_id in (select submission_id from submissions where user_id = $1)', [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activity_success_criteria where activity_id = any($1::text[])', [[AI_ON, AI_OFF, NO_CRITERIA]])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from user_roles where user_id = $1', [PUPIL])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

let attempt = 0
async function submit(activityId: string, names: string[]) {
  attempt += 1
  const { rows } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
     values ($1, $2, $3, $4, now(), 'inprogress') returning submission_id`,
    [activityId, PUPIL, attempt, JSON.stringify(uploadBody(names))],
  )
  return rows[0].submission_id
}

async function state(submissionId: string) {
  const { rows: [sub] } = await query<{ mark_status: string | null; mark_error: string | null }>(
    'select mark_status, mark_error from submissions where submission_id = $1',
    [submissionId],
  )
  const { rows: jobs } = await query<{ status: string; criterion: string | null }>(
    "select status, payload->>'successCriteriaId' as criterion from external_jobs where job_type = 'ai_mark' and payload->>'submissionId' = $1",
    [submissionId],
  )
  return { ...sub, jobs }
}

function checkSchema() {
  const old = UploadFileActivityBodySchema.safeParse({ instructions: '<p>Upload it</p>' })
  check('an old body (instructions only) parses', old.success && old.data.aiMarking === undefined)
  check('an old body with null instructions parses', UploadFileActivityBodySchema.safeParse({ instructions: null }).success)
  const next = UploadFileActivityBodySchema.safeParse({ instructions: 'x', aiMarking: true, markingGuidance: PROMPT, extra: 1 })
  check('a new body parses and keeps other fields', next.success && next.data.aiMarking === true && (next.data as Record<string, unknown>).extra === 1)
  check('a missing body is not AI-marked', !isAiMarkedActivity('upload-file', null))
  check('an old body is not AI-marked', !isAiMarkedActivity('upload-file', { instructions: 'x' }))
  check('a body with aiMarking true is AI-marked', isAiMarkedActivity('upload-file', { aiMarking: true }))
  check('other AI-marked types need no switch', isAiMarkedActivity('upload-code', {}))
  check('AI marking on without a prompt is refused', /marking prompt/.test(uploadFileAiMarkingError({ aiMarking: true, markingGuidance: '  ' }) ?? ''))
  check('AI marking on with a prompt is allowed', uploadFileAiMarkingError({ aiMarking: true, markingGuidance: PROMPT }) === null)
  check('AI marking off without a prompt is allowed', uploadFileAiMarkingError({ instructions: 'x' }) === null)
  check('readable types are classified', ['a.PNG', 'b.jpeg', 'c.webp', 'd.gif', 'e.pdf', 'f.py', 'g.csv', 'h.json'].every((n) => classifyUploadFile(n) !== null))
  check('docx, pptx and zip are not readable', ['a.docx', 'b.pptx', 'c.zip', 'noext'].every((n) => classifyUploadFile(n) === null))
  check(
    'the unreadable message names the extensions',
    unreadableUploadMessage(['b.docx', 'c.DOCX', 'd.zip']) === "AI can't read .docx, .zip files; mark this yourself.",
    unreadableUploadMessage(['b.docx', 'c.DOCX', 'd.zip']) ?? '',
  )
  check('a mix with a readable file is not refused', unreadableUploadMessage(['a.png', 'b.docx']) === null)
  const current = currentUploadedFiles({
    uploaded_files: [
      { name: 'design.png', path: 'p/design.png' },
      { name: 'design_12-11-2026_10-01-02-345.png', path: 'p/design_12-11-2026_10-01-02-345.png' },
      { name: 'notes_12-11-2026_10-01-02-345.txt', path: 'p/notes_12-11-2026_10-01-02-345.txt' },
    ],
  }).map((file) => file.name)
  check(
    'a replaced file is a past version and is not marked; a stamped file with no current copy is',
    JSON.stringify(current) === JSON.stringify(['design.png', 'notes_12-11-2026_10-01-02-345.txt']),
    current.join(', '),
  )
}

async function checkQueueing() {
  const off = await submit(AI_OFF, ['design.png'])
  await enqueueMarkingTasks(ASSIGNMENT, [{ submissionId: off }])
  const offState = await state(off)
  check('AI marking off: no job queued', offState.jobs.length === 0, JSON.stringify(offState.jobs))
  check('AI marking off: no mark status', offState.mark_status === null, String(offState.mark_status))

  const on = await submit(AI_ON, ['design.png', 'report.pdf', 'notes.txt'])
  await enqueueMarkingTasks(ASSIGNMENT, [{ submissionId: on }])
  const onState = await state(on)
  check(
    'AI marking on with criteria: one pending ai_mark job per criterion',
    criteriaIds.length > 0 && onState.jobs.length === criteriaIds.length &&
      onState.jobs.every((job) => job.status === 'pending' && criteriaIds.includes(job.criterion ?? '')),
    JSON.stringify(onState.jobs),
  )
  check('AI marking on: the submission waits for marking', onState.mark_status === 'waiting', String(onState.mark_status))

  const later = await submit(AI_ON, ['design.png', 'report.pdf', 'notes.txt', 'more.md'])
  await enqueueMarkingTasks(ASSIGNMENT, [{ submissionId: later }])
  const supersededState = await state(on)
  check(
    'a later upload drops the earlier attempt\'s queued jobs',
    supersededState.jobs.every((job) => job.status === 'error') && supersededState.mark_status === null,
    JSON.stringify(supersededState),
  )
  check('…and queues its own', (await state(later)).jobs.filter((job) => job.status === 'pending').length === criteriaIds.length)

  // An attempt already being marked (a sibling claimed) is not left in 'marking'.
  await query("update submissions set mark_status = 'marking' where submission_id = $1", [later])
  const latest = await submit(AI_ON, ['design.png'])
  await enqueueMarkingTasks(ASSIGNMENT, [{ submissionId: latest }])
  const claimedState = await state(later)
  check('a superseded attempt in marking is not left there', claimedState.mark_status === null, String(claimedState.mark_status))

  // The AI's marks reach the canonical score (upload-file reads `score`, not ai_model_score).
  for (const id of criteriaIds) {
    await recordCriterionMark({ submissionId: latest, activityId: AI_ON, successCriteriaId: id, awarded: 1, available: 1, feedback: null })
  }
  const { rows: [scored] } = await query<{ score: string | null; mark_status: string | null }>(
    `select compute_submission_base_score(s.body, a.type, a.max_marks)::text as score, s.mark_status
     from submissions s join activities a on a.activity_id = s.activity_id where s.submission_id = $1`,
    [latest],
  )
  check(
    'an AI-marked upload-file is scored by compute_submission_base_score',
    criteriaIds.length > 0 && Number(scored.score) === 1 && scored.mark_status === 'marked',
    JSON.stringify(scored),
  )

  const noCriteria = await submit(NO_CRITERIA, ['design.png'])
  await enqueueMarkingTasks(ASSIGNMENT, [{ submissionId: noCriteria }])
  const noCriteriaState = await state(noCriteria)
  check('AI marking on without criteria: no job queued', noCriteriaState.jobs.length === 0, JSON.stringify(noCriteriaState.jobs))
  check('AI marking on without criteria: no mark status', noCriteriaState.mark_status === null, String(noCriteriaState.mark_status))

  const mixed = await submit(AI_ON, ['design.png', 'essay.docx'])
  await enqueueMarkingTasks(ASSIGNMENT, [{ submissionId: mixed }])
  const mixedState = await state(mixed)
  check('a mix with a readable file: queued', mixedState.jobs.length > 0 && mixedState.mark_status === 'waiting', `${mixedState.mark_status} ${JSON.stringify(mixedState.jobs)}`)

  const unreadable = await submit(AI_ON, ['essay.docx'])
  await enqueueMarkingTasks(ASSIGNMENT, [{ submissionId: unreadable }])
  const unreadableState = await state(unreadable)
  check('only unreadable files: no job queued', unreadableState.jobs.length === 0, JSON.stringify(unreadableState.jobs))
  check(
    'only unreadable files: marking-error with the reason, never left in marking',
    unreadableState.mark_status === 'marking-error' && unreadableState.mark_error === "AI can't read .docx files; mark this yourself.",
    `${unreadableState.mark_status}: ${unreadableState.mark_error}`,
  )
}

async function checkRequests() {
  const png = Buffer.from('89504e470d0a1a0a-fake-png-bytes')
  const pdf = Buffer.from('%PDF-1.4 fake pdf bytes for the check')
  const files: Record<string, Buffer> = {
    'design.png': png,
    'report.pdf': pdf,
    'notes.txt': Buffer.from('My resistor is 220 ohms.\n'),
  }
  const reader = async (path: string) => {
    const name = path.split('/').pop() ?? ''
    if (!files[name]) throw new Error(`no stub for ${name}`)
    return files[name]
  }
  const activityBody = { instructions: '<p>Upload a photo of your <strong>circuit</strong></p>', aiMarking: true, markingGuidance: PROMPT }
  const criterion = { successCriteriaId: 'sc-1', scType: 'binary' as const, description: 'Draws a series circuit', descriptors: [] }

  const request = await buildUploadFileMarkingRequest({
    activityBody,
    submissionBody: uploadBody(['design.png', 'report.pdf', 'notes.txt']),
    maxMarks: 1,
    criterion,
    readFile: reader,
  })
  const call = buildMarkingCall(request)
  const inline = call.parts.filter((part) => part.inline_data).map((part) => part.inline_data!)
  check('the image goes as an image part', inline.some((part) => part.mime_type === 'image/png' && part.data === png.toString('base64')))
  check('the PDF goes as a document part', inline.some((part) => part.mime_type === 'application/pdf' && part.data === pdf.toString('base64')))
  check('the text file goes in the prompt', call.prompt.includes('--- File: notes.txt ---\nMy resistor is 220 ohms.'))
  check('the prompt has the instructions as plain text', call.prompt.includes('QUESTION / TASK:\nUpload a photo of your circuit'))
  check('the prompt has the marking prompt', call.prompt.includes(`MARKING GUIDANCE:\n${PROMPT}`))
  check('the prompt has the criterion', call.prompt.includes('"Draws a series circuit"'))
  check('the prompt lists every file', ['design.png (attached image)', 'report.pdf (attached PDF)', 'notes.txt (shown below)'].every((s) => call.prompt.includes(s)))
  const stored = JSON.stringify({ prompt: call.prompt, images: call.imageMeta })
  check(
    'what is stored on the job has file metadata and no base64',
    !stored.includes(png.toString('base64')) && !stored.includes(pdf.toString('base64')) &&
      call.imageMeta.length === 2 && call.imageMeta.every((meta) => meta.fileName && meta.mimeType && meta.bytes > 0),
    JSON.stringify(call.imageMeta),
  )

  const textOnly = buildMarkingCall(await buildUploadFileMarkingRequest({
    activityBody,
    submissionBody: uploadBody(['notes.txt']),
    maxMarks: 1,
    criterion,
    readFile: reader,
  }))
  check('a text file alone is sent as text with no attachments', textOnly.parts.length === 1 && textOnly.prompt.includes('My resistor is 220 ohms.'))

  const mixedCall = buildMarkingCall(await buildUploadFileMarkingRequest({
    activityBody,
    submissionBody: uploadBody(['design.png', 'slides.pptx']),
    maxMarks: 1,
    criterion,
    readFile: reader,
  }))
  check(
    'a mix sends the readable file and names the other as not shown',
    mixedCall.imageMeta.length === 1 && mixedCall.imageMeta[0].fileName === 'design.png' &&
      mixedCall.prompt.includes('slides.pptx, which you cannot read') && !mixedCall.prompt.includes('slides.pptx (attached'),
    mixedCall.prompt,
  )
  const [unreadable, unreadableMessage] = await refused(
    () => buildUploadFileMarkingRequest({ activityBody, submissionBody: uploadBody(['slides.pptx']), maxMarks: 1, criterion, readFile: reader }),
    /^AI can't read \.pptx files; mark this yourself\.$/,
  )
  check('only unreadable files are refused before any file is read', unreadable, unreadableMessage)
  let permanent = false
  try {
    await buildUploadFileMarkingRequest({ activityBody, submissionBody: uploadBody(['a.zip']), maxMarks: 1, criterion, readFile: reader })
  } catch (error) {
    permanent = error instanceof UploadFileMarkingError && error.permanent === true
  }
  check('…as a permanent error, so the queue does not retry it', permanent)

  const [offRefused, offMessage] = await refused(
    () => buildUploadFileMarkingRequest({ activityBody: { instructions: 'x' }, submissionBody: uploadBody(['design.png']), maxMarks: 1, criterion, readFile: reader }),
    /turned off/,
  )
  check('a job for an activity with AI marking off is refused', offRefused, offMessage)

  const big = Buffer.alloc(6 * 1024 * 1024, 1)
  const [bigRefused, bigMessage] = await refused(
    () => buildUploadFileMarkingRequest({ activityBody, submissionBody: uploadBody(['huge.png']), maxMarks: 1, criterion, readFile: async () => big }),
    /larger than the AI reads/,
  )
  check('an image over the cap is refused', bigRefused, bigMessage)

  const [textCapRefused, textCapMessage] = await refused(
    () => buildUploadFileMarkingRequest({ activityBody, submissionBody: uploadBody(['a.txt', 'b.txt']), maxMarks: 1, criterion, readFile: async () => Buffer.from('x'.repeat(40_000)) }),
    /^The text files are longer than the AI reads/,
  )
  check('the text cap is on all the text files together', textCapRefused, textCapMessage)

  const [binaryRefused, binaryMessage] = await refused(
    () => buildUploadFileMarkingRequest({ activityBody, submissionBody: uploadBody(['data.csv']), maxMarks: 1, criterion, readFile: async () => Buffer.from([0x50, 0x4b, 0x00, 0x03]) }),
    /not a text file/,
  )
  check('a binary file with a text extension is refused', binaryRefused, binaryMessage)
}

async function checkMcp() {
  check('mcpBoolean takes "true" and "false"', mcpBoolean.parse('true') === true && mcpBoolean.parse('false') === false && mcpBoolean.parse(true) === true)
  check('mcpBoolean refuses anything else', !mcpBoolean.safeParse('yes').success)
  check(
    'ai_marking and marking_prompt map to aiMarking and markingGuidance',
    JSON.stringify(uploadFileMarkingFields('upload-file', { aiMarking: true, markingPrompt: `  ${PROMPT} ` })) ===
      JSON.stringify({ aiMarking: true, markingGuidance: PROMPT }),
  )
  check('nothing given, nothing set', Object.keys(uploadFileMarkingFields('text', {})).length === 0)
  const [wrongType, wrongTypeMessage] = await refused(() => uploadFileMarkingFields('text', { aiMarking: true }), /upload-file activities only/)
  check('ai_marking on another type is refused', wrongType, wrongTypeMessage)
  const [noPrompt, noPromptMessage] = await refused(() => validateBodyDataForType('upload-file', { aiMarking: true }), /marking prompt/)
  check('a body with AI marking and no prompt is refused', noPrompt, noPromptMessage)

  const [createRefused, createMessage] = await refused(
    () => createActivity(LESSON, 'upload-file', 'MCP no prompt', { instructions: 'x', ...uploadFileMarkingFields('upload-file', { aiMarking: true }) }),
    /marking prompt/,
  )
  check('create_activity with ai_marking and no marking_prompt is refused', createRefused, createMessage)

  let createError: unknown = null
  try {
    await createActivity(LESSON, 'upload-file', 'MCP no prompt', { instructions: 'x', aiMarking: true })
  } catch (error) {
    createError = error
  }
  check('…as INVALID_BODY_DATA', createError instanceof ActivityBodyDataError && createError.code === 'INVALID_BODY_DATA')

  const created = await createActivity(LESSON, 'upload-file', 'MCP with prompt', {
    instructions: 'x',
    ...uploadFileMarkingFields('upload-file', { aiMarking: true, markingPrompt: PROMPT }),
  })
  const body = async (id: string) =>
    (await query<{ body_data: Record<string, unknown> }>('select body_data from activities where activity_id = $1', [id])).rows[0].body_data
  const createdBody = await body(created.activity_id)
  check('create_activity stores aiMarking and markingGuidance', createdBody.aiMarking === true && createdBody.markingGuidance === PROMPT && createdBody.instructions === 'x')

  await updateActivity(created.activity_id, { uploadFileMarking: { aiMarking: false } })
  const offBody = await body(created.activity_id)
  check('update_activity ai_marking false turns it off and keeps the prompt', offBody.aiMarking === false && offBody.markingGuidance === PROMPT)

  await updateActivity(created.activity_id, { uploadFileMarking: { aiMarking: true } })
  check('turning it back on uses the stored prompt', (await body(created.activity_id)).aiMarking === true)

  const plain = await createActivity(LESSON, 'upload-file', 'MCP plain', { instructions: 'y' })
  const [updateRefused, updateMessage] = await refused(
    () => updateActivity(plain.activity_id, { uploadFileMarking: { aiMarking: true } }),
    /marking prompt/,
  )
  check('update_activity turning it on with no prompt stored or given is refused', updateRefused, updateMessage)
  check('…and nothing is stored', (await body(plain.activity_id)).aiMarking === undefined)

  await updateActivity(plain.activity_id, { uploadFileMarking: { aiMarking: true, markingPrompt: PROMPT } })
  const plainBody = await body(plain.activity_id)
  check('update_activity with both sets them and keeps the instructions', plainBody.aiMarking === true && plainBody.markingGuidance === PROMPT && plainBody.instructions === 'y')

  const text = await createActivity(LESSON, 'text', 'MCP text', { text: 'hello' })
  const [textRefused, textMessage] = await refused(
    () => updateActivity(text.activity_id, { uploadFileMarking: { markingPrompt: PROMPT } }),
    /upload-file activities only/,
  )
  check('update_activity marking_prompt on a text activity is refused', textRefused, textMessage)
}

async function main() {
  if (process.env.MARKING_QUEUE_SECRET) {
    throw new Error('Run with MARKING_QUEUE_SECRET empty so nothing can trigger the queue.')
  }
  await tearDown()
  await setUp()
  try {
    checkSchema()
    await checkQueueing()
    await checkRequests()
    await checkMcp()
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
