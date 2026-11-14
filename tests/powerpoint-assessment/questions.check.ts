import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { readAssessmentQuestions, setAssessmentQuestions, type AssessmentQuestionInput } from '@/lib/assessment-paper/store'
import { updateActivity, validateBodyDataForType } from '@/lib/mcp/activities'
import { formatPresentationSection, parsePresentationSection, PRESENTATION_SECTION_KEYS } from '@/lib/powerpoint-assessment/evidence-spec'
import { isPresentationSectionSelector } from '@/lib/pptx/describe'
import { PowerPointAssessmentActivityBodySchema } from '@/types'

// A PowerPoint assessment's body (upload slots) and its questions' evidence
// sources: the body schema's refusals, evidence saved and read back, every
// refusal (unknown slot, wrong kind, bad section, a heading read twice, no
// pupil evidence on a marked question, evidence on an assessment paper) with
// nothing written, omitted evidence kept on update, a slot the evidence reads
// not removable, and max_marks still the sum of the questions. The slots and
// evidence are test data shaped like a real task. No model is called and no
// file is stored. Creates its own unit, lesson and activities, and removes
// them.
// Run with DATABASE_URL set:
//   npx tsx tests/powerpoint-assessment/questions.check.ts

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

// jsonb does not keep key order, so compare with keys sorted.
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v)
}

const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-q-check-unit-${tag}`
const LESSON = `ppt-q-check-lesson-${tag}`
const PPT = randomUUID()
const PAPER = randomUUID()
const PUPIL = `ppt-q-check-pupil-${tag}`

const SLOTS = [
  { key: 'presentation', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'handouts', label: 'Handouts printout', kind: 'pdf', required: false },
  { key: 'notes', label: 'Notes printout', kind: 'pdf', required: false },
  { key: 'full-page', label: 'Full page printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true, hint: 'Paste screenshots under each heading.' },
]
const BODY = { instructions: 'Build the presentation.', uploadSlots: SLOTS }

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint questions unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint questions check', 0, 'standard')",
    [LESSON, UNIT],
  )
  await query(
    `insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values
       ($1, $3, 'powerpoint-assessment', 'Presentation task', $4::jsonb, 0),
       ($2, $3, 'assessment-paper', 'A paper', '{}'::jsonb, 1)`,
    [PPT, PAPER, LESSON, JSON.stringify(BODY)],
  )
}

async function tearDown() {
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  await query('delete from profiles where user_id = $1', [PUPIL])
}

async function storedEvidence(activityId: string) {
  const { rows } = await query<{ label: string; evidence: unknown; mark_scheme: string | null }>(
    'select label, evidence, mark_scheme from activity_questions where activity_id = $1 order by position',
    [activityId],
  )
  return rows
}

async function main() {
  const { rows: scs } = await query<{ success_criteria_id: string }>(
    `select sc.success_criteria_id from success_criteria sc
      where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                          group by 1 having count(*) >= 3 limit 1)
      order by sc.success_criteria_id limit 3`,
  )
  const [A, B, C] = scs.map((row) => row.success_criteria_id)

  // --- Body schema -------------------------------------------------------------
  const parse = (slots: unknown) => PowerPointAssessmentActivityBodySchema.safeParse({ uploadSlots: slots })
  check('the body with one required pptx slot and supporting slots parses', parse(SLOTS).success)
  const noPptx = parse(SLOTS.filter((s) => s.kind !== 'pptx'))
  check('a body with no pptx slot is refused', !noPptx.success && /exactly one pptx slot/.test(noPptx.error.issues[0].message))
  const twoPptx = parse([...SLOTS, { key: 'second', label: 'Second', kind: 'pptx', required: true }])
  check('a body with two pptx slots is refused', !twoPptx.success && /exactly one pptx slot.*not 2/.test(twoPptx.error.issues[0].message))
  const optional = parse(SLOTS.map((s) => (s.kind === 'pptx' ? { ...s, required: false } : s)))
  check('an optional pptx slot is refused', !optional.success && /must be required/.test(optional.error.issues[0].message))
  const badKey = parse([{ ...SLOTS[0], key: 'Pres entation' }])
  check('a bad slot key is refused', !badKey.success && /lower-case letters/.test(badKey.error.issues[0].message))
  const dupKey = parse([SLOTS[0], { ...SLOTS[1], key: 'presentation' }])
  check('duplicate slot keys are refused', !dupKey.success && /used twice/.test(dupKey.error.issues[0].message))
  const badKind = parse([SLOTS[0], { ...SLOTS[1], kind: 'xlsx' }])
  check('an unknown slot kind is refused', !badKind.success)
  check('no slots is refused', !parse([]).success)
  check('more than 8 slots is refused', !parse([SLOTS[0], ...Array.from({ length: 8 }, (_, i) => ({ key: `p${i}`, label: 'P', kind: 'pdf', required: false }))]).success)
  check('other body keys pass through', PowerPointAssessmentActivityBodySchema.safeParse({ ...BODY, extra: 1 }).success
    && (PowerPointAssessmentActivityBodySchema.parse({ ...BODY, extra: 1 }) as Record<string, unknown>).extra === 1)

  let [ok, detail] = await refused(() => validateBodyDataForType('powerpoint-assessment', { uploadSlots: [SLOTS[1]] }), /exactly one pptx slot/)
  check('MCP body validation refuses a body with no pptx slot', ok, detail)
  ;[ok, detail] = await refused(() => validateBodyDataForType('powerpoint-assessment', null), /uploadSlots/)
  check('MCP body validation refuses a PowerPoint assessment with no body', ok, detail)
  check('MCP body validation accepts the slots', (() => {
    try { validateBodyDataForType('powerpoint-assessment', BODY); return true } catch { return false }
  })())

  // --- Section selectors -------------------------------------------------------
  check('section selectors parse', JSON.stringify(parsePresentationSection('Slides: 3, 6')) === '{"key":"slides","slides":[3,6]}'
    && parsePresentationSection('slides:0') === null && parsePresentationSection('slides:3,3') === null
    && parsePresentationSection('slide-3') === null
    && PRESENTATION_SECTION_KEYS.every((key) => parsePresentationSection(key)?.key === key))
  const stored = [...PRESENTATION_SECTION_KEYS, 'slides:3', 'Slides: 3, 6'].map((selector) => {
    const parsed = parsePresentationSection(selector)
    return parsed ? formatPresentationSection(parsed) : `unparsed ${selector}`
  })
  check('every stored selector is one the presentation describer accepts', stored.every(isPresentationSectionSelector), JSON.stringify(stored))
  check('the describer refuses what the spec refuses', ['slide-3', 'slide:3', 'slides', 'images'].every((selector) =>
    (parsePresentationSection(selector) === null) === !isPresentationSectionSelector(selector)))

  await setUp()
  try {
    const q = (
      label: string,
      criterion: string,
      evidence: unknown[] | undefined,
      extra: Partial<AssessmentQuestionInput> = {},
    ): AssessmentQuestionInput => ({
      label,
      maxMarks: 1,
      markScheme: `Mark scheme for ${label}.`,
      criteria: [{ successCriteriaId: criterion, maxMarks: 1 }],
      ...(evidence === undefined ? {} : { evidence }),
      ...extra,
    })

    const QUESTIONS: AssessmentQuestionInput[] = [
      q('1a', A, [
        { source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true },
        { source: 'presentation', slot: 'presentation', sections: ['presentation'] },
      ]),
      q('1b', B, [{ source: 'presentation', slot: 'presentation', sections: ['master', 'layouts', 'slides', 'supplied-images'] }]),
      q('1h', C, [
        { source: 'presentation', slot: 'presentation', sections: ['layouts', 'slides'] },
        { source: 'evidence_section', slot: 'evidence', heading: '1j', want: 'screenshots' },
      ]),
      q('1j', A, [{ source: 'evidence_section', slot: 'evidence', heading: '1j', want: 'screenshots', required: true }]),
      q('2b', B, [
        { source: 'presentation', slot: 'presentation', sections: ['slides:3,4'] },
        { source: 'reference_file', fileName: 'TASK TEXT.docx' },
      ]),
      q('2f', C, [
        { source: 'presentation', slot: 'presentation', sections: ['slides'] },
        { source: 'slide_images', slot: 'presentation' },
      ]),
      q('4c', A, [{ source: 'presentation', slot: 'presentation', sections: ['slides:3,4,5,6', 'action-buttons'] }]),
      q('5b', B, [
        { source: 'presentation', slot: 'presentation', sections: ['notes'] },
        { source: 'file', slot: 'handouts' },
        { source: 'file', slot: 'notes' },
      ]),
      q('5e', C, [{ source: 'file', slot: 'full-page', required: true }]),
      q('S1', A, [{ source: 'evidence_section', slot: 'evidence', want: 'text', required: true }]),
      q('T1', B, [], { marking: 'teacher' }),
      q('P1', C, [{ source: 'presentation', slot: 'presentation' }], { marking: 'ai_check' }),
    ]

    const saved = await setAssessmentQuestions(PPT, QUESTIONS)
    const expected = QUESTIONS.map((question) => question.evidence)
    check(
      'evidence is saved and returned as given',
      canon(saved.map((s) => s.evidence)) === canon(expected),
      JSON.stringify(saved.map((s) => s.evidence)),
    )
    const read = await readAssessmentQuestions(PPT)
    check('evidence reads back equal', canon(read.map((s) => s.evidence)) === canon(expected))
    check('a teacher-marked question may have no evidence', read.find((s) => s.label === 'T1')?.marking === 'teacher'
      && read.find((s) => s.label === 'T1')?.evidence.length === 0)

    const maxMarks = async (id: string) => {
      const { rows: [row] } = await query<{ max_marks: number }>('select max_marks from activities where activity_id = $1', [id])
      return Number(row.max_marks)
    }
    check('max_marks is the sum of the questions', (await maxMarks(PPT)) === QUESTIONS.length, String(await maxMarks(PPT)))

    // --- Refusals: all or nothing ------------------------------------------------
    const before = JSON.stringify(await storedEvidence(PPT))
    const withChange = (label: string, evidence: unknown[], extra: Partial<AssessmentQuestionInput> = {}) =>
      QUESTIONS.map((question) => (question.label === label ? { ...question, evidence, ...extra } : question))
    const cases: Array<[string, AssessmentQuestionInput[], RegExp]> = [
      ['an unknown slot', withChange('1b', [{ source: 'presentation', slot: 'slides-file' }]),
        /Question "1b", evidence source 1 names the slot "slides-file", which is not one of this activity's upload slots \(presentation, handouts/],
      ['a presentation source on a PDF slot', withChange('1b', [{ source: 'presentation', slot: 'handouts' }]),
        /reads the slot "handouts" as the presentation \(pptx\), but that slot takes a PDF/],
      ['a file source on the pptx slot', withChange('5e', [{ source: 'file', slot: 'presentation' }]),
        /reads the slot "presentation" as a PDF/],
      ['an evidence section on a PDF slot', withChange('S1', [{ source: 'evidence_section', slot: 'notes', want: 'text' }]),
        /reads the slot "notes" as an evidence document/],
      ['an unknown section', withChange('1b', [{ source: 'presentation', slot: 'presentation', sections: ['slide-3'] }]),
        /asks for the section "slide-3", which is not one/],
      ['a section asked twice', withChange('1b', [{ source: 'presentation', slot: 'presentation', sections: ['master', ' Master'] }]),
        /asks for the section "master" twice/],
      ['two slides lists in one source', withChange('1b', [{ source: 'presentation', slot: 'presentation', sections: ['slides:3', 'Slides: 6'] }]),
        /asks for slides more than once; use one slides list, e\.g\. slides:3,6/],
      ['a heading read twice by one question', withChange('1j', [
        { source: 'evidence_section', slot: 'evidence', heading: '1j', want: 'screenshots' },
        { source: 'evidence_section', slot: 'evidence', heading: '1J ', want: 'text' },
      ]), /reads the heading "1J" in the slot "evidence" again/],
      ['an unknown source', withChange('1b', [{ source: 'webcam', slot: 'presentation' }]),
        /has an unknown source "webcam"/],
      ['an unknown want', withChange('S1', [{ source: 'evidence_section', slot: 'evidence', want: 'video' }]),
        /evidence source 1 \(evidence_section\): want/],
      ['an unknown key on a source', withChange('1b', [{ source: 'presentation', slot: 'presentation', section: ['slides'] }]),
        /evidence source 1 \(presentation\): unknown field 'section' \(did you mean 'sections'\?\)\./],
      ['an unknown key with no near match', withChange('1b', [{ source: 'presentation', slot: 'presentation', colour: 'red' }]),
        /evidence source 1 \(presentation\): unknown field 'colour'\./],
      ['a source with no slot', withChange('1b', [{ source: 'presentation' }]),
        /evidence source 1 \(presentation\): choose an upload slot\./],
      ['a source with an empty slot', withChange('1b', [{ source: 'presentation', slot: ' ' }]),
        /evidence source 1 \(presentation\): choose an upload slot\./],
      ['an evidence section with no want', withChange('S1', [{ source: 'evidence_section', slot: 'evidence' }]),
        /evidence source 1 \(evidence_section\): choose what to read: screenshots, text or both\./],
      ['a reference file with no name', withChange('2b', [{ source: 'presentation', slot: 'presentation' }, { source: 'reference_file' }]),
        /evidence source 2 \(reference_file\): name the reference file\./],
      ['a required that is not true or false', withChange('5e', [{ source: 'file', slot: 'full-page', required: 'yes' }]),
        /evidence source 1 \(file\): required must be true or false\./],
      ['a source with no source', withChange('1b', [{ slot: 'presentation' }]),
        /evidence source 1 has no source; choose one of/],
      ['the same heading written differently', withChange('1j', [
        { source: 'evidence_section', slot: 'evidence', heading: '(1j)', want: 'screenshots' },
        { source: 'evidence_section', slot: 'evidence', heading: '1 J.', want: 'text' },
      ]), /evidence source 2 reads the heading "1 J." in the slot "evidence" again/],
      ['a heading with no letter or digit', withChange('S1', [{ source: 'evidence_section', slot: 'evidence', heading: '--', want: 'text' }]),
        /evidence source 1 \(evidence_section\): heading must contain a letter or digit\./],
      ['no evidence on an ai question', withChange('1b', []),
        /Question "1b" has no evidence from the pupil's files/],
      ['only a reference file on an ai question', withChange('2b', [{ source: 'reference_file', fileName: 'TASK TEXT.docx' }]),
        /Question "2b" has no evidence from the pupil's files/],
      ['evidence that is not a list', withChange('1b', 'slides' as unknown as unknown[]),
        /evidence must be a list/],
    ]
    for (const [name, input, pattern] of cases) {
      ;[ok, detail] = await refused(() => setAssessmentQuestions(PPT, input), pattern)
      check(`${name} is refused`, ok, detail)
    }
    // Two problems at once are both reported.
    ;[ok, detail] = await refused(
      () => setAssessmentQuestions(PPT, withChange('1b', [{ source: 'presentation', slot: 'nope' }]).map((question) =>
        question.label === '5e' ? { ...question, evidence: [{ source: 'file', slot: 'presentation' }] } : question)),
      /"1b".*"nope".*"5e".*as a PDF/,
    )
    check('every problem is reported at once', ok, detail)
    // An ai question becoming teacher-only may drop its evidence; moving to ai with none may not.
    ;[ok, detail] = await refused(() => setAssessmentQuestions(PPT, QUESTIONS.map((question) =>
      question.label === 'T1' ? { ...question, marking: 'ai' as const } : question)), /Question "T1" has no evidence/)
    check('a teacher question set to ai without evidence is refused', ok, detail)
    check('refusals wrote nothing', JSON.stringify(await storedEvidence(PPT)) === before)

    // --- Omitted evidence is kept ------------------------------------------------
    const withoutEvidence = QUESTIONS.map(({ evidence: _evidence, ...rest }) => ({ ...rest, markScheme: `${rest.markScheme} Updated.` }))
    await setAssessmentQuestions(PPT, withoutEvidence)
    const kept = await storedEvidence(PPT)
    check(
      'omitted evidence keeps the stored evidence',
      canon(kept.map((row) => row.evidence)) === canon(expected)
        && kept.every((row) => row.mark_scheme?.endsWith('Updated.')),
    )
    // A new question with no evidence given starts with none, so an ai one is refused.
    ;[ok, detail] = await refused(() => setAssessmentQuestions(PPT, [...withoutEvidence, q('9z', A, undefined)]), /Question "9z" has no evidence/)
    check('a new ai question with evidence omitted is refused', ok, detail)
    // Selectors are stored in their canonical form.
    await setAssessmentQuestions(PPT, withChange('2b', [{ source: 'presentation', slot: 'presentation', sections: [' Slides: 3, 4 '] }]))
    const canonical = (await readAssessmentQuestions(PPT)).find((s) => s.label === '2b')?.evidence
    check('a section selector is stored canonically', canon(canonical) === canon([{ source: 'presentation', slot: 'presentation', sections: ['slides:3,4'] }]),
      JSON.stringify(canonical))
    // Remove a question; max_marks follows.
    await setAssessmentQuestions(PPT, QUESTIONS.filter((question) => question.label !== 'P1'))
    check('max_marks follows a removed question', (await maxMarks(PPT)) === QUESTIONS.length - 1, String(await maxMarks(PPT)))

    // --- A slot the evidence reads cannot be removed or change kind -------------
    ;[ok, detail] = await refused(
      () => updateActivity(PPT, { bodyPatch: { uploadSlots: SLOTS.filter((s) => s.key !== 'notes') } }),
      /no longer fits.*"notes"/,
    )
    check('removing a slot the evidence reads is refused', ok, detail)
    ;[ok, detail] = await refused(
      () => updateActivity(PPT, { bodyPatch: { uploadSlots: SLOTS.map((s) => (s.key === 'full-page' ? { ...s, kind: 'docx' } : s)) } }),
      /no longer fits.*"full-page"/,
    )
    check('changing the kind of a slot the evidence reads is refused', ok, detail)
    await updateActivity(PPT, { bodyPatch: { questionPaperPath: 'x/y.pdf' } })
    const { rows: [afterPatch] } = await query<{ body_data: Record<string, unknown> }>('select body_data from activities where activity_id = $1', [PPT])
    check('a hand-set paper file key is not stored', !('questionPaperPath' in afterPatch.body_data), JSON.stringify(afterPatch.body_data))
    await updateActivity(PPT, { bodyPatch: { uploadSlots: [...SLOTS, { key: 'extra', label: 'Extra', kind: 'pdf', required: false }] } })
    const { rows: [afterAdd] } = await query<{ body_data: { uploadSlots: unknown[] } }>('select body_data from activities where activity_id = $1', [PPT])
    check('adding a slot is allowed', afterAdd.body_data.uploadSlots.length === SLOTS.length + 1)

    // --- Renaming a slot carries its evidence and files -------------------------
    const slotsNow = async () => {
      const { rows: [row] } = await query<{ body_data: { uploadSlots: Array<{ key: string; kind: string }> } }>(
        'select body_data from activities where activity_id = $1', [PPT])
      return row.body_data.uploadSlots
    }
    const slotsOf = async (label: string) => ((await readAssessmentQuestions(PPT)).find((s) => s.label === label)?.evidence ?? [])
      .map((e) => ('slot' in e ? e.slot : `ref:${e.fileName}`))
    await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Rene', 'Name')", [PUPIL])
    const { rows: [{ submission_id: submissionId }] } = await query<{ submission_id: string }>(
      `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body, submission_status)
       values ($1, $2, 1, now(), '{}'::json, 'inprogress') returning submission_id`,
      [PPT, PUPIL],
    )
    await query(
      `insert into practical_submission_files (activity_id, pupil_id, submission_id, slot_key, original_name, storage_path, bytes, sha256)
       values ($1, $2, $3, 'notes', 'NOTES.pdf', 'x/notes.pdf', 1, 'h'), ($1, $2, $3, 'presentation', 'P.pptx', 'x/p.pptx', 1, 'h')`,
      [PPT, PUPIL, submissionId],
    )
    const fileSlots = async () => (await query<{ slot_key: string }>(
      'select slot_key from practical_submission_files where submission_id = $1 order by slot_key', [submissionId])).rows.map((r) => r.slot_key)

    await updateActivity(PPT, { bodyPatch: { uploadSlots: (await slotsNow()).map((s) => (s.key === 'notes' ? { ...s, key: 'notes-printout' } : s)) } })
    check('renaming a PDF slot rewrites the evidence that reads it',
      JSON.stringify(await slotsOf('5b')) === JSON.stringify(['presentation', 'handouts', 'notes-printout']), JSON.stringify(await slotsOf('5b')))
    check('renaming a slot moves the pupils\' files with it', JSON.stringify(await fileSlots()) === JSON.stringify(['notes-printout', 'presentation']),
      JSON.stringify(await fileSlots()))
    await updateActivity(PPT, { bodyPatch: { uploadSlots: (await slotsNow()).map((s) => (s.key === 'presentation' ? { ...s, key: 'deck' } : s)) } })
    check('renaming the pptx slot rewrites every source that names it',
      JSON.stringify(await slotsOf('2f')) === JSON.stringify(['deck', 'deck'])
        && JSON.stringify(await slotsOf('2b')) === JSON.stringify(['deck', 'ref:TASK TEXT.docx'])
        && JSON.stringify(await slotsOf('5b')) === JSON.stringify(['deck', 'handouts', 'notes-printout']),
      JSON.stringify([await slotsOf('2f'), await slotsOf('2b')]))
    check('the renamed pptx slot keeps the pupil\'s presentation', (await fileSlots()).includes('deck'))
    const evidenceBefore = JSON.stringify(await storedEvidence(PPT))
    ;[ok, detail] = await refused(
      () => slotsNow().then((slots) => updateActivity(PPT, { bodyPatch: { uploadSlots: slots.map((s) => (s.key === 'handouts' ? { ...s, key: 'handouts-doc', kind: 'docx' } : s)) } })),
      /no longer fits.*"handouts".*Move the questions' evidence to another slot first.*rename the slot's key in place/,
    )
    check('a "rename" that changes kind is refused, explaining the route', ok, detail)
    ;[ok, detail] = await refused(
      () => slotsNow().then((slots) => updateActivity(PPT, { bodyPatch: { uploadSlots: [
        ...slots.filter((s) => s.key !== 'handouts' && s.key !== 'full-page'), { key: 'printouts', label: 'Printouts', kind: 'pdf', required: false },
      ] } })),
      /no longer fits.*"handouts"/,
    )
    check('removing two referenced slots for one new one is refused', ok, detail)
    check('a refused rename changes no evidence', JSON.stringify(await storedEvidence(PPT)) === evidenceBefore)

    // --- Type changes ---------------------------------------------------------------
    await query('delete from submissions where activity_id = $1', [PPT])
    ;[ok, detail] = await refused(() => updateActivity(PPT, { type: 'assessment-paper' }),
      /^An activity cannot be changed to or from an assessment paper or PowerPoint assessment\. Create a new activity instead\.$/)
    check('a PowerPoint assessment with questions cannot become an assessment paper', ok, detail)

    // --- Assessment paper: no evidence ------------------------------------------
    ;[ok, detail] = await refused(
      () => setAssessmentQuestions(PAPER, [q('Q1', A, [{ source: 'file', slot: 'handouts' }])]),
      /"Q1": an assessment paper's questions take no evidence sources/,
    )
    check('evidence on an assessment paper question is refused', ok, detail)
    const paper = await setAssessmentQuestions(PAPER, [q('Q1', A, []), q('Q2', B, undefined)])
    check('an assessment paper question reads back with no evidence', paper.every((s) => Array.isArray(s.evidence) && s.evidence.length === 0))
    check('an assessment paper is still out of its questions', (await maxMarks(PAPER)) === 2)
    ;[ok, detail] = await refused(() => updateActivity(PAPER, { type: 'powerpoint-assessment', bodyData: BODY }),
      /^An activity cannot be changed to or from an assessment paper or PowerPoint assessment\./)
    check('an assessment paper with questions cannot become a PowerPoint assessment', ok, detail)
    ;[ok, detail] = await refused(() => updateActivity(PAPER, { type: 'text', bodyData: { text: 'x' } }),
      /^An activity cannot be changed to or from an assessment paper or PowerPoint assessment\./)
    check('an assessment paper with questions cannot become another type', ok, detail)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from units where unit_id = $1)
          + (select count(*) from activities where activity_id = any($2::text[]))
          + (select count(*) from activity_questions where activity_id = any($2::text[]))
          + (select count(*) from profiles where user_id = $3) as left`,
    [UNIT, [PPT, PAPER], PUPIL],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
