import Module from 'node:module'
import { randomUUID } from 'node:crypto'

import { Document, HeadingLevel, Packer, Paragraph } from 'docx'

import { query, withDbClient } from '@/lib/db'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { validateQuestionEvidence } from '@/lib/powerpoint-assessment/evidence-spec'

// The lesson editor's server side of a PowerPoint assessment: a new one gets
// the default body (one required pptx slot); the app's save path refuses a
// bad body and a slot the questions' evidence reads, carries a rename into
// the evidence and the pupils' files, keeps the paper files and clears a
// setting sent as null; the questions save action passes evidence through
// (and leaves it alone when omitted, as the assessment paper editor does);
// the setup read gives the slots and each question's evidence; and the
// template check names the headings a blank evidence document lacks. The
// actions run outside Next, so the session guard and revalidatePath are
// stubbed. No model is called. Creates its own unit, lesson and activities,
// and removes them.
// Run with DATABASE_URL set:
//   npx tsx tests/powerpoint-assessment/editor.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

function stub(specifier: string, exports: Record<string, unknown>) {
  const path = require.resolve(specifier)
  const module = new Module(path)
  module.exports = exports
  module.loaded = true
  require.cache[path] = module
}

const tag = randomUUID().slice(0, 8)
const UNIT = `ppt-ed-check-unit-${tag}`
const LESSON = `ppt-ed-check-lesson-${tag}`
const TEACHER = `ppt-ed-check-teacher-${tag}`
const PUPIL = `ppt-ed-check-pupil-${tag}`
const TEMPLATE = 'EVIDENCE.docx'

const SLOTS = [
  { key: 'presentation', label: 'Presentation', kind: 'pptx', required: true },
  { key: 'handouts', label: 'Handouts printout', kind: 'pdf', required: false },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true },
]

const teacherProfile = { userId: TEACHER, roles: ['teacher'], isTeacher: true }

async function tearDown(activityIds: string[]) {
  await query('delete from submissions where user_id = $1', [PUPIL])
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  for (const activityId of activityIds) {
    const path = `lessons/${LESSON}/activities/${activityId}/${TEMPLATE}`
    await createLocalStorageClient('lessons').remove([path]).catch(() => {})
  }
  await query("delete from stored_files where bucket = 'lessons' and scope_path like $1", [`%${LESSON}%`])
  await query('delete from profiles where user_id = any($1::text[])', [[PUPIL]])
}

async function main() {
  stub('@/lib/auth', {
    requireRole: async () => teacherProfile,
    requireAuthenticatedProfile: async () => teacherProfile,
    getAuthenticatedProfile: async () => teacherProfile,
    hasRole: (profile: { roles?: string[] } | null, role: string) => Boolean(profile?.roles?.includes(role)),
  })
  stub('next/cache', { revalidatePath: () => {} })
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createLessonActivityAction, updateLessonActivityAction } = require('@/lib/server-actions/lesson-activities')
  const { saveAssessmentQuestionsAction, readAssessmentPaperSetupAction } = require('@/lib/server-actions/assessment-paper-activity')
  const { checkEvidenceTemplateAction, renameSuppliedImageAction } = require('@/lib/server-actions/powerpoint-assessment-editor')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `PowerPoint editor unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'PowerPoint editor check', 0, 'standard')",
    [LESSON, UNIT],
  )
  const created: string[] = []

  try {
    const { rows: scs } = await query<{ success_criteria_id: string }>(
      `select sc.success_criteria_id from success_criteria sc
        where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                            group by 1 having count(*) >= 2 limit 1)
        order by sc.success_criteria_id limit 2`,
    )
    const [A, B] = scs.map((row) => row.success_criteria_id)

    // --- Create ----------------------------------------------------------------
    const bare = await createLessonActivityAction(UNIT, LESSON, { title: 'Bare', type: 'powerpoint-assessment' })
    if (bare.data) created.push(bare.data.activity_id)
    const bareBody = bare.data?.body_data as { uploadSlots?: Array<Record<string, unknown>> } | undefined
    const bareSlot = bareBody?.uploadSlots?.[0]
    check(
      'a new PowerPoint assessment with no body gets one required pptx slot',
      bare.success && bareBody?.uploadSlots?.length === 1 && bareSlot?.key === 'presentation' && bareSlot?.label === 'Presentation'
        && bareSlot?.kind === 'pptx' && bareSlot?.required === true,
      JSON.stringify(bare),
    )
    const withInstructions = await createLessonActivityAction(UNIT, LESSON, {
      title: 'Instructions only',
      type: 'powerpoint-assessment',
      bodyData: { instructions: 'Build it.', questionPaperPath: 'x/paper/question-paper.pdf' },
    })
    if (withInstructions.data) created.push(withInstructions.data.activity_id)
    const wiBody = withInstructions.data?.body_data as Record<string, unknown> | undefined
    check(
      'instructions alone get the default slot, and a hand-set paper path is dropped',
      withInstructions.success && wiBody?.instructions === 'Build it.' && Array.isArray(wiBody?.uploadSlots) && !('questionPaperPath' in (wiBody ?? {})),
      JSON.stringify(wiBody),
    )
    const twoPptx = await createLessonActivityAction(UNIT, LESSON, {
      title: 'Two presentations',
      type: 'powerpoint-assessment',
      bodyData: { uploadSlots: [SLOTS[0], { ...SLOTS[0], key: 'second', label: 'Second' }] },
    })
    if (twoPptx.data) created.push(twoPptx.data.activity_id)
    check('a body with two pptx slots is refused on create', !twoPptx.success && /exactly one pptx slot/.test(twoPptx.error ?? ''), JSON.stringify(twoPptx))

    const task = await createLessonActivityAction(UNIT, LESSON, {
      title: 'Presentation task',
      type: 'powerpoint-assessment',
      bodyData: { instructions: 'Build the presentation.', uploadSlots: SLOTS },
    })
    if (task.data) created.push(task.data.activity_id)
    check('a PowerPoint assessment with its slots is created', task.success, JSON.stringify(task))
    const PPT: string = task.data.activity_id
    await query("update activities set body_data = body_data || '{\"questionPaperPath\": \"kept/paper/question-paper.pdf\"}'::jsonb where activity_id = $1", [PPT])

    // --- Questions with evidence ------------------------------------------------
    const evidence1a = [
      { source: 'evidence_section', slot: 'evidence', want: 'screenshots', required: true },
      { source: 'presentation', slot: 'presentation', sections: ['master', 'Slides: 3, 6'] },
    ]
    const evidence2 = [{ source: 'file', slot: 'handouts', required: true }]
    const saved = await saveAssessmentQuestionsAction(PPT, [
      { label: '1a', maxMarks: 2, markScheme: 'Two points.', evidence: evidence1a, criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      { label: '2', maxMarks: 1, markScheme: 'One point.', evidence: evidence2, criteria: [{ successCriteriaId: B, maxMarks: 1 }] },
    ])
    const savedQ = saved.data?.questions ?? []
    check(
      'the questions save action passes evidence through (canonical selectors)',
      !saved.error && JSON.stringify(savedQ[0]?.evidence?.[1]?.sections) === '["master","slides:3,6"]' && savedQ[1]?.evidence?.[0]?.slot === 'handouts',
      JSON.stringify(saved),
    )
    check(
      'the setup read gives the type and the upload slots',
      saved.data?.type === 'powerpoint-assessment' && saved.data?.powerpoint?.uploadSlots?.length === 3 && saved.data?.maxMarks === 3,
      JSON.stringify(saved.data?.powerpoint),
    )
    const badEvidence = await saveAssessmentQuestionsAction(PPT, [
      { label: '1a', maxMarks: 2, evidence: [{ source: 'file', slot: 'presentation' }], criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      { label: '2', maxMarks: 1, criteria: [{ successCriteriaId: B, maxMarks: 1 }] },
    ])
    check(
      'evidence that does not fit the slots is refused with the question named',
      Boolean(badEvidence.error) && /Question "1a"/.test(badEvidence.error) && /takes the presentation/.test(badEvidence.error),
      JSON.stringify(badEvidence),
    )
    const omitted = await saveAssessmentQuestionsAction(PPT, [
      { label: '1a', maxMarks: 2, markScheme: 'Two points, edited.', criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      { label: '2', maxMarks: 1, markScheme: 'One point.', criteria: [{ successCriteriaId: B, maxMarks: 1 }] },
    ])
    check(
      'questions saved without evidence keep their stored evidence',
      !omitted.error && omitted.data?.questions?.[0]?.evidence?.length === 2 && omitted.data?.questions?.[0]?.markScheme === 'Two points, edited.',
      JSON.stringify(omitted),
    )
    const clientCheck = validateQuestionEvidence(
      (omitted.data?.questions ?? []).map((q: { label: string; marking: string; evidence: unknown }) => ({ label: q.label, marking: q.marking, evidence: q.evidence })),
      { uploadSlots: SLOTS },
    )
    check('the stored evidence passes the editor\'s client-side check', clientCheck.errors.length === 0, clientCheck.errors.join(' '))

    // --- App save path -----------------------------------------------------------
    const noPptx = await updateLessonActivityAction(UNIT, LESSON, PPT, { bodyData: { uploadSlots: SLOTS.slice(1) } })
    check('the app save path refuses a body with no pptx slot', !noPptx.success && /exactly one pptx slot/.test(noPptx.error ?? ''), JSON.stringify(noPptx))
    const removeUsed = await updateLessonActivityAction(UNIT, LESSON, PPT, {
      bodyData: { uploadSlots: SLOTS.filter((slot) => slot.key !== 'handouts') },
    })
    check(
      'the app save path refuses removing a slot the evidence reads, naming it',
      !removeUsed.success && /no longer fit the questions' evidence/.test(removeUsed.error ?? '') && /"handouts"/.test(removeUsed.error ?? ''),
      JSON.stringify(removeUsed),
    )
    const kindChange = await updateLessonActivityAction(UNIT, LESSON, PPT, {
      bodyData: { uploadSlots: SLOTS.map((slot) => (slot.key === 'handouts' ? { ...slot, kind: 'docx' } : slot)) },
    })
    check('the app save path refuses changing the kind of a slot the evidence reads', !kindChange.success && /handouts/.test(kindChange.error ?? ''), JSON.stringify(kindChange))
    const { rows: [afterRefusals] } = await query<{ body_data: { uploadSlots: unknown[] } }>('select body_data from activities where activity_id = $1', [PPT])
    check('a refused save writes nothing', afterRefusals.body_data.uploadSlots.length === 3)

    // A pupil's file in the slot, so the rename is seen to reach it too.
    await query("insert into profiles (user_id, first_name, last_name) values ($1, 'Editor', 'Check')", [PUPIL])
    const { rows: [sub] } = await query<{ submission_id: string }>(
      "insert into submissions (activity_id, user_id, body, attempt_number) values ($1, $2, '{}'::jsonb, 1) returning submission_id",
      [PPT, PUPIL],
    )
    const handoutsFile = randomUUID()
    await query(
      `insert into practical_submission_files (file_id, activity_id, pupil_id, submission_id, slot_key, original_name, storage_path, bytes, sha256, uploaded_by)
       values ($1, $2, $3, $4, 'handouts', 'h.pdf', $5, 10, 'x', $3)`,
      [handoutsFile, PPT, PUPIL, sub.submission_id, `${PPT}/practical/x/original.pdf`],
    )
    // …and what the reader stored from it.
    await query(
      `insert into practical_submission_evidence (file_id, submission_id, slot_key, kind, status, cache_key, report)
       values ($1::uuid, $2, 'handouts', 'pdf', 'ok', 'check', '{}'::jsonb)`,
      [handoutsFile, sub.submission_id],
    )

    const renamedSlots = SLOTS.map((slot) => (slot.key === 'handouts' ? { ...slot, key: 'printout', label: 'Printout' } : slot))
    const rename = await updateLessonActivityAction(UNIT, LESSON, PPT, { bodyData: { uploadSlots: renamedSlots } })
    const { rows: renamedQuestions } = await query<{ label: string; evidence: Array<{ slot?: string }> }>(
      'select label, evidence from activity_questions where activity_id = $1 order by position',
      [PPT],
    )
    const { rows: renamedFiles } = await query<{ slot_key: string }>('select slot_key from practical_submission_files where activity_id = $1', [PPT])
    check(
      'a rename through the app save path carries the evidence and the pupils\' files',
      rename.success && renamedQuestions[1]?.evidence[0]?.slot === 'printout' && renamedFiles[0]?.slot_key === 'printout',
      JSON.stringify({ rename, renamedQuestions, renamedFiles }),
    )
    const { rows: renamedEvidence } = await query<{ slot_key: string }>(
      'select slot_key from practical_submission_evidence where file_id = $1::uuid', [handoutsFile])
    check('…and what was read from those files', renamedEvidence[0]?.slot_key === 'printout', JSON.stringify(renamedEvidence))
    const renamedBody = rename.data?.body_data as Record<string, unknown> | undefined
    check(
      'the app save path keeps the instructions and the uploaded paper path',
      renamedBody?.instructions === 'Build the presentation.' && renamedBody?.questionPaperPath === 'kept/paper/question-paper.pdf',
      JSON.stringify(renamedBody),
    )
    const sneakyPath = await updateLessonActivityAction(UNIT, LESSON, PPT, { bodyData: { markSchemePath: 'evil/path.pdf' } })
    check('a body save cannot set the mark scheme path', sneakyPath.success && !('markSchemePath' in (sneakyPath.data?.body_data ?? {})))

    // Stored evidence that no longer fits (here planted) never blocks a save
    // that leaves the slots alone; a save that changes them is still checked.
    const { rows: [q2Before] } = await query<{ evidence: unknown }>(
      "select evidence from activity_questions where activity_id = $1 and label = '2'", [PPT])
    await query(
      `update activity_questions set evidence = '[{"source": "file", "slot": "gone"}]'::jsonb
        where activity_id = $1 and label = '2'`, [PPT])
    const instructionsOnly = await updateLessonActivityAction(UNIT, LESSON, PPT, { bodyData: { instructions: 'Build the presentation.' } })
    check('saving the instructions is not blocked by stored evidence problems', instructionsOnly.success, JSON.stringify(instructionsOnly))
    const sameSlots = await updateLessonActivityAction(UNIT, LESSON, PPT, {
      title: 'Presentation task',
      bodyData: { uploadSlots: renamedSlots.map((slot) => ({ required: slot.required, kind: slot.kind, label: slot.label, key: slot.key })) },
    })
    check('…nor is resending the same slots (in another key order)', sameSlots.success, JSON.stringify(sameSlots))
    const relabel = await updateLessonActivityAction(UNIT, LESSON, PPT, {
      bodyData: { uploadSlots: renamedSlots.map((slot) => (slot.key === 'printout' ? { ...slot, label: 'Printouts' } : slot)) },
    })
    check('a save that changes the slots is still checked against the evidence', !relabel.success && /"gone"/.test(relabel.error ?? ''), JSON.stringify(relabel))
    await query("update activity_questions set evidence = $2::jsonb where activity_id = $1 and label = '2'", [PPT, JSON.stringify(q2Before.evidence)])

    // A mark scheme uploaded while a body save is under way is kept: the save
    // merges onto the row as it is when locked, not as it was first read.
    let releaseUpload: () => void = () => {}
    let uploadLocked: () => void = () => {}
    const lockedSignal = new Promise<void>((resolve) => { uploadLocked = resolve })
    const releaseSignal = new Promise<void>((resolve) => { releaseUpload = resolve })
    const upload = withDbClient(async (client) => {
      await client.query('begin')
      await client.query('select 1 from activities where activity_id = $1 for update', [PPT])
      await client.query(
        "update activities set body_data = body_data || '{\"markSchemePath\": \"uploaded/paper/mark-scheme.pdf\"}'::jsonb where activity_id = $1",
        [PPT],
      )
      uploadLocked()
      await releaseSignal
      await client.query('commit')
    })
    await lockedSignal
    const racing = updateLessonActivityAction(UNIT, LESSON, PPT, { bodyData: { instructions: 'Build the presentation, edited.' } })
    await new Promise((resolve) => setTimeout(resolve, 500))
    releaseUpload()
    await upload
    const raced = await racing
    const { rows: [racedRow] } = await query<{ body_data: Record<string, unknown> }>('select body_data from activities where activity_id = $1', [PPT])
    check(
      'a mark scheme uploaded during a body save is kept, and the save lands',
      raced.success && racedRow.body_data.markSchemePath === 'uploaded/paper/mark-scheme.pdf'
        && racedRow.body_data.instructions === 'Build the presentation, edited.' && racedRow.body_data.questionPaperPath === 'kept/paper/question-paper.pdf',
      JSON.stringify({ raced: raced.error, body: racedRow.body_data }),
    )

    // --- Evidence template ----------------------------------------------------------
    const templateBytes = Buffer.from(await Packer.toBuffer(new Document({
      sections: [{ children: [
        new Paragraph({ text: 'Evidence document', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: '1a', heading: HeadingLevel.HEADING_1 }),
        new Paragraph('Paste your screenshot here.'),
        new Paragraph({ text: 'Task 4d', heading: HeadingLevel.HEADING_1 }),
      ] }],
    })))
    await createLocalStorageClient('lessons').upload(`lessons/${LESSON}/activities/${PPT}/${TEMPLATE}`, templateBytes, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const setTemplate = await updateLessonActivityAction(UNIT, LESSON, PPT, { bodyData: { evidenceTemplateFile: TEMPLATE } })
    check('the evidence template is saved through the app save path', setTemplate.success && setTemplate.data?.body_data?.evidenceTemplateFile === TEMPLATE, JSON.stringify(setTemplate))

    await saveAssessmentQuestionsAction(PPT, [
      { label: '1a', maxMarks: 2, markScheme: 'Two points.', criteria: [{ successCriteriaId: A, maxMarks: 2 }] },
      {
        label: '2', maxMarks: 1, markScheme: 'One point.',
        evidence: [
          { source: 'evidence_section', slot: 'evidence', heading: '3e', want: 'text' },
          { source: 'evidence_section', slot: 'evidence', heading: '4d', want: 'screenshots' },
        ],
        criteria: [{ successCriteriaId: B, maxMarks: 1 }],
      },
    ])
    const templateCheck = await checkEvidenceTemplateAction(PPT, TEMPLATE)
    check(
      'the template check reads the questions\' headings and returns the missing ones',
      !templateCheck.error && JSON.stringify(templateCheck.data?.headings) === '["1a","3e","4d"]' && JSON.stringify(templateCheck.data?.missingHeadings) === '["3e"]',
      JSON.stringify(templateCheck),
    )
    const storedCheck = await checkEvidenceTemplateAction(PPT, null)
    check('with no name the stored template is checked', storedCheck.data?.fileName === TEMPLATE && storedCheck.data?.missingHeadings?.length === 1, JSON.stringify(storedCheck))
    const missingFile = await checkEvidenceTemplateAction(PPT, 'NOPE.docx')
    check('a template that is not one of the activity\'s files is a clear error', /no file called "NOPE.docx"/.test(missingFile.error ?? ''), JSON.stringify(missingFile))
    const notDocx = await checkEvidenceTemplateAction(PPT, 'notes.pdf')
    check('a template that is not a .docx is refused', /\.docx/.test(notDocx.error ?? ''), JSON.stringify(notDocx))

    const clearTemplate = await updateLessonActivityAction(UNIT, LESSON, PPT, { bodyData: { evidenceTemplateFile: null } })
    check('a setting sent as null is cleared', clearTemplate.success && !('evidenceTemplateFile' in (clearTemplate.data?.body_data ?? {})), JSON.stringify(clearTemplate.data?.body_data))

    // --- Supplied image rename -------------------------------------------------------
    await query(
      `insert into practical_supplied_images (activity_id, name, file_name, storage_path, sha256, fingerprint, width, height)
       values ($1, 'LOGO', 'LOGO.png', 'x/logo.png', 'a', 'f', 1, 1), ($1, 'MAP', 'MAP.png', 'x/map.png', 'b', 'g', 1, 1)`,
      [PPT],
    )
    const clash = await renameSuppliedImageAction(PPT, 'LOGO', 'MAP')
    check('renaming a supplied image onto another\'s name is refused', /already called "MAP"/.test(clash.error ?? ''), JSON.stringify(clash))
    const renamedImage = await renameSuppliedImageAction(PPT, 'LOGO', ' Company logo ')
    check(
      'a supplied image is renamed',
      !renamedImage.error && renamedImage.data?.images?.map((image: { name: string }) => image.name).join('|') === 'Company logo|MAP',
      JSON.stringify(renamedImage),
    )

    // --- Type changes and papers --------------------------------------------------------
    const toText = await updateLessonActivityAction(UNIT, LESSON, PPT, { type: 'text', bodyData: { text: 'x' } })
    check('a PowerPoint assessment cannot change type in the app', !toText.success && /cannot be changed/.test(toText.error ?? ''))
    const paper = await createLessonActivityAction(UNIT, LESSON, { title: 'A paper', type: 'assessment-paper', bodyData: { instructions: 'Sit it.' } })
    if (paper.data) created.push(paper.data.activity_id)
    const paperQuestions = await saveAssessmentQuestionsAction(paper.data.activity_id, [
      { label: '1', maxMarks: 1, criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
    ])
    check(
      'an assessment paper still saves its questions, with no evidence and no slots',
      !paperQuestions.error && paperQuestions.data?.type === 'assessment-paper' && paperQuestions.data?.powerpoint === null && paperQuestions.data?.questions?.[0]?.evidence?.length === 0,
      JSON.stringify(paperQuestions),
    )
    const paperEvidence = await saveAssessmentQuestionsAction(paper.data.activity_id, [
      { label: '1', maxMarks: 1, evidence: evidence2, criteria: [{ successCriteriaId: A, maxMarks: 1 }] },
    ])
    check('an assessment paper refuses evidence sources', /take no evidence sources/.test(paperEvidence.error ?? ''), JSON.stringify(paperEvidence))
    const setup = await readAssessmentPaperSetupAction(PPT)
    check('the setup read of a PowerPoint assessment works for the editor', !setup.error && setup.data?.powerpoint?.pupilsWithFiles === 1 && setup.data?.powerpoint?.handedIn === 0, JSON.stringify(setup.data?.powerpoint))
  } finally {
    await tearDown(created)
  }

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
