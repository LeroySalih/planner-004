import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { query } from '@/lib/db'
import { ASSESSMENT_SCRIPTS_BUCKET } from '@/lib/assessment-paper/files'
import { setAssessmentQuestions } from '@/lib/assessment-paper/store'
import type { ModelJsonCall } from '@/lib/assessment-paper/reading'
import { markRequestHash } from '@/lib/assessment-paper/mark-reuse'
import { buildClaudeMessageParams, MAX_CACHE_BREAKPOINTS } from '@/lib/ai/anthropic-client'
import { callModelJson, claudeRequestOf, type ModelRequest } from '@/lib/ai/model-client'
import { anthropicUsage, geminiUsage } from '@/lib/ai/model-usage'
import { runCacheStaggered } from '@/lib/ai/cache-warm-order'
import { modelResponseStarted, runNotifyingModelStart } from '@/lib/ai/model-call-started'
import { LESSONS_BUCKET, handInPowerPointAssessment, storePracticalFile } from '@/lib/powerpoint-assessment/files'
import { runPowerPointMarkJob, runPowerPointReadJob } from '@/lib/powerpoint-assessment/jobs'
import { POWERPOINT_MARK_SYSTEM } from '@/lib/powerpoint-assessment/marking'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { restoreBatchSwitch, turnBatchSwitchOff } from '../ai/batch-switch'

// Prompt caching of practical-assessment marking, with every model call
// stubbed (never a real one). One pupil hands in a presentation; its
// questions select overlapping report sections. Checks: the report parts come
// before anything question-specific, in the fixed group order (slides,
// layouts, masters, the rest), and carry the cache flag at their ends; two
// questions with the same sections send byte-identical parts up to the last
// breakpoint; a question with fewer sections shares the leading parts; at
// most 4 breakpoints, system text included; the cache flag never changes the
// mark-reuse fingerprint; the Anthropic transport puts cache_control on
// exactly the flagged blocks (built without a network call, and sent to a
// local stand-in for the API whose usage lands in model_response.usage); and
// the worker staggers a hand-in's jobs, each starting once the one before
// has begun its response (streamed for that purpose).
// Run with DATABASE_URL set (and MARKING_QUEUE_SECRET empty):
//   npx tsx tests/powerpoint-assessment/prompt-cache.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')
const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-cache-check-unit-${tag}`
const LESSON = `ppt-cache-check-lesson-${tag}`
const PPT = randomUUID()
const GROUP = `ppt-cache-check-group-${tag}`
const PUPIL = `ppt-cache-check-pupil-${tag}`
const SLOTS = [{ key: 'deck', label: 'Presentation', kind: 'pptx', required: true }]
const USAGE = { input_tokens: 120, output_tokens: 80, cache_creation_input_tokens: 3000, cache_read_input_tokens: 9000 }

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa')", [PUPIL])
  await query("insert into user_roles (user_id, role_id) values ($1, 'pupil')", [PUPIL])
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Prompt cache unit ${tag}`, subject])
  await query("insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Prompt cache check', 0, 'standard')", [LESSON, UNIT])
  await query(
    "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'powerpoint-assessment', 'Presentation task', $3::jsonb, 0)",
    [PPT, LESSON, JSON.stringify({ instructions: 'Build the presentation.', uploadSlots: SLOTS })],
  )
  await query('insert into groups (group_id, subject) values ($1, $2)', [GROUP, subject])
  await query('insert into group_membership (group_id, user_id) values ($1, $2)', [GROUP, PUPIL])
  await query(
    "insert into planner_assignments (group_id, lesson_id, week_start_date, day, period, feedback_visible) values ($1, $2, current_date, 'sunday', 1, false)",
    [GROUP, LESSON],
  )
}

async function tearDown() {
  const { rows } = await query<{ scope_path: string; file_name: string }>(
    'select scope_path, file_name from stored_files where bucket = $1 and scope_path like $2',
    [ASSESSMENT_SCRIPTS_BUCKET, `${PPT}%`],
  )
  const paths = rows.map((f) => `${f.scope_path}/${f.file_name}`)
  if (paths.length > 0) await createLocalStorageClient(ASSESSMENT_SCRIPTS_BUCKET).remove(paths)
  await query('delete from stored_files where bucket = $1 and scope_path like $2', [ASSESSMENT_SCRIPTS_BUCKET, `${PPT}%`])
  await rm(path.join(process.cwd(), 'files', ASSESSMENT_SCRIPTS_BUCKET, PPT), { recursive: true, force: true })
  await rm(path.join(process.cwd(), 'files', LESSONS_BUCKET, LESSON), { recursive: true, force: true })
  await query("delete from external_jobs where payload->>'submissionId' in (select submission_id from submissions where user_id = $1)", [PUPIL])
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from planner_assignments where lesson_id = $1', [LESSON])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from group_membership where group_id = $1', [GROUP])
  await query('delete from groups where group_id = $1', [GROUP])
  await query('delete from user_roles where user_id = $1', [PUPIL])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

const questionPart = (request: ModelRequest) => request.parts.find((part) => part.text?.startsWith('PART '))?.text ?? ''
/** The text parts before the question, as sent. */
const sharedParts = (request: ModelRequest) => request.parts.slice(0, request.parts.findIndex((part) => part.text?.startsWith('PART ')))
const lastBreakpoint = (request: ModelRequest) => request.parts.map((part) => Boolean(part.cache)).lastIndexOf(true)
const breakpoints = (request: ModelRequest) => request.parts.filter((part) => part.cache).length + (request.cacheSystem ? 1 : 0)

/** A stub model: captures the request and replies with each criterion's full allocation, with usage. */
function stubModel(captured: Map<string, ModelRequest>): ModelJsonCall {
  return async (request) => {
    const prompt = questionPart(request)
    const label = /^PART (\S+) /.exec(prompt)?.[1] ?? '?'
    captured.set(label, request)
    const criteria = [...prompt.matchAll(/success_criteria_id "([^"]+)" \(topic: [^)]*\): holds 0 to (\d+)\./g)].map((m) => ({
      success_criteria_id: m[1],
      awarded: Number(m[2]),
      why_not_awarded: '',
      how_to_improve: '',
    }))
    const data = { evidence_note: `Note for ${label}.`, criteria }
    return { data: data as never, raw: JSON.stringify(data), durationMs: 5, attempts: 1, usage: anthropicUsage(USAGE) }
  }
}

/** A local stand-in for the Messages API: records each request body, replies with a fixed message and usage. */
async function fakeAnthropicApi() {
  const bodies: any[] = []
  const message = {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
    content: [{ type: 'text', text: '{"ok":true}' }],
    stop_reason: 'end_turn', stop_sequence: null, usage: USAGE,
  }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      bodies.push(body)
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(message))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { ...USAGE, output_tokens: 1 } } })
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"ok":true}' } })
      send('content_block_stop', { type: 'content_block_stop', index: 0 })
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } })
      send('message_stop', { type: 'message_stop' })
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { bodies, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }
}

async function workerOrdering() {
  const events: string[] = []
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  // signal: ms after its start that the job's model response begins (null: never).
  const item = (id: string, group: string | null, signal: number | null, ms: number) => ({ id, group, signal, ms })
  const items = [
    item('a1', 'A', 10, 80), item('a2', 'A', 10, 40), item('x', null, null, 5), item('b1', 'B', null, 20),
    item('a3', 'A', 10, 20), item('b2', 'B', null, 5), item('c1', 'C', null, 400), item('c2', 'C', null, 5),
  ]
  const results = await runCacheStaggered(items, (i) => i.group, async (i) => {
    events.push(`start ${i.id}`)
    if (i.signal !== null) {
      await wait(i.signal)
      events.push(`began ${i.id}`)
      modelResponseStarted()
      await wait(i.ms - i.signal)
    } else {
      await wait(i.ms)
    }
    events.push(`end ${i.id}`)
    if (i.id === 'b1') throw new Error('b1 failed')
    return i.id
  }, { maxWaitMs: 100 })
  const at = (e: string) => events.indexOf(e)
  check('worker: a job of a group starts once the one before has begun its response, not after it ends',
    at('began a1') < at('start a2') && at('start a2') < at('end a1') && at('began a2') < at('start a3') && at('start a3') < at('end a2'), events.join(', '))
  check('worker: a job that never begins a response holds the next until it ends',
    at('end b1') < at('start b2'), events.join(', '))
  check('worker: …or until the longest wait', at('start c2') < at('end c1'), events.join(', '))
  check('worker: groups and ungrouped jobs start at once',
    at('start x') < at('began a1') && at('start b1') < at('began a1') && at('start c1') < at('began a1'), events.join(', '))
  check('worker: a failed job does not stop the others; results in item order',
    results.map((r) => (r.status === 'fulfilled' ? r.value : 'rejected')).join() === 'a1,a2,x,rejected,a3,b2,c1,c2')
}

function transportChecks(sample: ModelRequest) {
  const body = buildClaudeMessageParams(claudeRequestOf(sample))
  const content = (body.messages.at(-1)!.content as any[])
  const flagged = sample.parts.filter((part) => part.text !== undefined || part.inline_data).map((part) => Boolean(part.cache))
  check('transport: cache_control on exactly the flagged blocks',
    content.length === flagged.length && content.every((block, i) => (block.cache_control?.type === 'ephemeral') === flagged[i]),
    JSON.stringify(content.map((b) => Boolean(b.cache_control))))
  check('transport: and on the system text', Array.isArray(body.system) && (body.system as any[])[0].cache_control?.type === 'ephemeral'
    && (body.system as any[])[0].text === POWERPOINT_MARK_SYSTEM)
  check('transport: no cache_control without the flags', (() => {
    const plain = buildClaudeMessageParams({ system: 'S', userParts: [{ kind: 'text', text: 'a' }] })
    return typeof plain.system === 'string' && !JSON.stringify(plain).includes('cache_control')
  })())
  const tooMany = (() => {
    try {
      buildClaudeMessageParams({ system: 'S', cacheSystem: true, userParts: Array.from({ length: MAX_CACHE_BREAKPOINTS }, (_, i) => ({ kind: 'text' as const, text: `p${i}`, cache: true })) })
      return null
    } catch (error) {
      return error as Error
    }
  })()
  check(`transport: more than ${MAX_CACHE_BREAKPOINTS} breakpoints is refused before any call`, tooMany instanceof Error && /at most 4 cache breakpoints/.test(tooMany.message), String(tooMany))
  const fingerprint = (request: ModelRequest) => markRequestHash({
    provider: 'anthropic', model: 'm', effort: null, systemText: request.systemText ?? '', responseSchema: null, maxTokens: null,
    parts: request.parts, criteria: [],
  })
  const unflagged: ModelRequest = { ...sample, parts: sample.parts.map((part) => (part.cache ? { text: part.text } : part)) }
  check('fingerprint: the cache flags do not change it', fingerprint(sample) === fingerprint(unflagged))
  check('usage: Gemini usageMetadata in the same shape', JSON.stringify(geminiUsage({ promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 10, thoughtsTokenCount: 5 }))
    === JSON.stringify({ inputTokens: 60, outputTokens: 15, cacheCreationInputTokens: null, cacheReadInputTokens: 40 }))
}

async function sdkUsage() {
  const api = await fakeAnthropicApi()
  const saved = { base: process.env.ANTHROPIC_BASE_URL, claude: process.env.CLAUDE_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY }
  process.env.ANTHROPIC_BASE_URL = api.url
  process.env.CLAUDE_API_KEY = 'test-key-not-real'
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
  try {
    const reply = await callModelJson({
      provider: 'anthropic', model: 'claude-sonnet-5', systemText: 'System.', cacheSystem: true,
      parts: [{ text: 'Report.', cache: true }, { text: 'Question.' }],
      responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    })
    check('SDK: usage from the response, in the stored shape', JSON.stringify(reply.usage)
      === JSON.stringify({ inputTokens: 120, outputTokens: 80, cacheCreationInputTokens: 3000, cacheReadInputTokens: 9000 }), JSON.stringify(reply.usage))
    const sent = api.bodies[0]
    check('SDK: the request on the wire carries cache_control where flagged', sent?.system?.[0]?.cache_control?.type === 'ephemeral'
      && sent.messages[0].content[0].cache_control?.type === 'ephemeral' && !sent.messages[0].content[1].cache_control, JSON.stringify(sent).slice(0, 400))
    let began = 0
    const streamed = await runNotifyingModelStart(() => { began += 1 }, () => callModelJson({
      provider: 'anthropic', model: 'claude-sonnet-5', systemText: 'System.', parts: [{ text: 'Question.' }],
      responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    }))
    check('SDK: a caller waiting for the response to begin gets it streamed, and is told',
      api.bodies[1]?.stream === true && began > 0 && (streamed.data as any)?.ok === true, JSON.stringify({ stream: api.bodies[1]?.stream, began }))
    check('SDK: …with the same usage', streamed.usage?.inputTokens === 120 && streamed.usage?.outputTokens === 80
      && streamed.usage?.cacheCreationInputTokens === 3000 && streamed.usage?.cacheReadInputTokens === 9000, JSON.stringify(streamed.usage))
    check('SDK: no stream otherwise', api.bodies[0]?.stream !== true)
  } finally {
    api.close()
    for (const [key, value] of [['ANTHROPIC_BASE_URL', saved.base], ['CLAUDE_API_KEY', saved.claude], ['ANTHROPIC_API_KEY', saved.anthropic]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function main() {
  await workerOrdering()
  await sdkUsage()

  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const { rows: [{ success_criteria_id: A }] } = await query<{ success_criteria_id: string }>('select success_criteria_id from success_criteria order by success_criteria_id limit 1')

  await turnBatchSwitchOff()
  await setUp()
  try {
    const q = (label: string, sections?: string[]) => ({
      label,
      maxMarks: 1,
      markScheme: `Mark scheme for ${label}.`,
      evidence: [{ source: 'presentation', slot: 'deck', ...(sections ? { sections } : {}) }],
      criteria: [{ successCriteriaId: A, maxMarks: 1 }],
    })
    const saved = await setAssessmentQuestions(PPT, [
      q('M1', ['master', 'layouts', 'slides']),
      q('M2', ['slides', 'master', 'layouts']),
      q('L1', ['layouts', 'slides']),
      q('S1', ['slides']),
      q('T3', ['slides:3']),
      q('ALL'),
    ])
    const labelOf = (questionId: string) => saved.find((s) => s.questionId === questionId)?.label ?? '?'

    await storePracticalFile({ activityId: PPT, pupilId: PUPIL, slotKey: 'deck', bytes: pptx, originalName: 'My Deck.pptx', uploadedBy: PUPIL })
    await handInPowerPointAssessment(PPT, PUPIL, { userId: PUPIL, isTeacher: false })
    const { rows: [sub] } = await query<{ submission_id: string }>('select submission_id from submissions where activity_id = $1 and user_id = $2', [PPT, PUPIL])
    const { rows: [read] } = await query<{ job_id: string; assignment_id: string }>(
      `update external_jobs set status = 'processing' where job_type = 'ai_read' and payload->>'submissionId' = $1
        returning job_id, payload->>'assignmentId' as assignment_id`, [sub.submission_id])
    const readOutcome = await runPowerPointReadJob({ jobId: read.job_id, submissionId: sub.submission_id, assignmentId: read.assignment_id })
    check('the read is not held', readOutcome.held === null, String(readOutcome.held))

    const { rows: jobs } = await query<{ job_id: string; assignment_id: string; question_id: string }>(
      `update external_jobs set status = 'processing' where job_type = 'ai_mark' and status = 'pending' and payload->>'submissionId' = $1
        returning job_id, payload->>'assignmentId' as assignment_id, payload->>'questionId' as question_id`, [sub.submission_id])
    const captured = new Map<string, ModelRequest>()
    for (const job of jobs) {
      await runPowerPointMarkJob({ jobId: job.job_id, submissionId: sub.submission_id, assignmentId: job.assignment_id, questionId: job.question_id }, stubModel(captured))
    }
    check('every question is marked', [...captured.keys()].sort().join() === 'ALL,L1,M1,M2,S1,T3', [...captured.keys()].join())
    const r = (label: string) => captured.get(label)!
    const [m1, m2, l1, s1, t3, all] = ['M1', 'M2', 'L1', 'S1', 'T3', 'ALL'].map(r)

    check('the system text carries a breakpoint on every call', [...captured.values()].every((c) => c.cacheSystem === true && c.systemText === POWERPOINT_MARK_SYSTEM))
    check('at most 4 breakpoints, system included', [...captured.values()].every((c) => breakpoints(c) <= 4), [...captured.values()].map(breakpoints).join())
    if (process.env.DUMP_PROMPTS) for (const [label, c] of captured) console.log(`----- ${label}\n${sharedParts(c).map((p) => p.text).join('<<PART>>')}`)
    check('the report parts come first, the question after them',
      [...captured.values()].every((c) => sharedParts(c).length > 0 && lastBreakpoint(c) < c.parts.indexOf(c.parts.find((p) => p.text?.startsWith('PART '))!)
        && sharedParts(c).every((p) => !/^PART |MARK SCHEME|WHERE TO RECORD|THE TASK'S INSTRUCTIONS|Mark scheme for/m.test(p.text ?? ''))))
    check('…and the question names them as its evidence', /PRESENTATION REPORT, Presentation \(deck\.pptx\), master, layouts, slides: given above/.test(questionPart(m1)), questionPart(m1).slice(-1600, -900))

    const upTo = (c: ModelRequest) => JSON.stringify(c.parts.slice(0, lastBreakpoint(c) + 1))
    check('the same sections (in any order) send byte-identical parts up to the last breakpoint, flags included',
      upTo(m1) === upTo(m2) && m1.parts.slice(0, lastBreakpoint(m1) + 1).every((p) => p.cache === true), `${upTo(m1).length} vs ${upTo(m2).length}`)
    check('three groups: slides, layouts, masters, in that order, each with a breakpoint',
      sharedParts(m1).length === 3 && /SLIDE 1 \(/.test(sharedParts(m1)[0].text!) && /^LAYOUT MASTERS/m.test(sharedParts(m1)[1].text!)
        && /^SLIDE MASTER 1/m.test(sharedParts(m1)[2].text!) && !/^SLIDE MASTER|^LAYOUT MASTERS/m.test(sharedParts(m1)[0].text!),
      sharedParts(m1).map((p) => (p.text ?? '').split('\n')[0]).join(' | '))
    check('layouts + slides shares the first two parts of master + layouts + slides',
      JSON.stringify(sharedParts(l1)) === JSON.stringify(sharedParts(m1).slice(0, 2)))
    check('slides alone shares the first part', JSON.stringify(sharedParts(s1)) === JSON.stringify(sharedParts(m1).slice(0, 1)))
    check('one slide shares nothing with all slides, and has its own breakpoint',
      sharedParts(t3).length === 1 && sharedParts(t3)[0].cache === true && sharedParts(t3)[0].text !== sharedParts(s1)[0].text && /SLIDE 3 \(/.test(sharedParts(t3)[0].text!) && !/SLIDE 2 \(/.test(sharedParts(t3)[0].text!))
    const allShared = sharedParts(all)
    check('every part (default sections): four groups, breakpoints on the first two and the last',
      allShared.length === 4 && allShared.map((p) => Boolean(p.cache)).join() === 'true,true,false,true' && breakpoints(all) === 4
        && JSON.stringify(allShared.slice(0, 1)) === JSON.stringify(sharedParts(m1).slice(0, 1)) && /^PRESENTATION$/m.test(allShared[3].text!),
      allShared.map((p) => `${(p.text ?? '').split('\n')[1] ?? ''}:${Boolean(p.cache)}`).join(' | '))
    check('no pupil file name in any part', [...captured.values()].every((c) => !JSON.stringify(c.parts).includes('My Deck')))

    transportChecks(m1)

    const { rows: rowsOut } = await query<{ question_id: string; model_request: any; model_response: any }>(
      `select payload->>'questionId' as question_id, model_request, model_response from external_jobs
        where job_type = 'ai_mark' and payload->>'submissionId' = $1`, [sub.submission_id])
    const u = (row: { model_response: any }) => row.model_response?.usage ?? {}
    check('usage lands in model_response.usage', rowsOut.length === 6 && rowsOut.every((row) => u(row).inputTokens === 120 && u(row).outputTokens === 80
      && u(row).cacheCreationInputTokens === 3000 && u(row).cacheReadInputTokens === 9000), JSON.stringify(rowsOut[0]?.model_response?.usage))
    const m1Row = rowsOut.find((row) => labelOf(row.question_id) === 'M1')?.model_request
    check('the job row records the breakpoints and the report sections', m1Row?.cacheBreakpoints === 4
      && m1Row.textSections[0].key.startsWith('report:presentation:deck:slide:') && /PART M1 /.test(m1Row.prompt), JSON.stringify(m1Row?.textSections?.slice(0, 2)))
  } finally {
    await restoreBatchSwitch()
    await tearDown()
  }
  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  restoreBatchSwitch().catch(console.error).then(() => tearDown()).finally(() => process.exit(1))
})
