import Module from 'node:module'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'

import { query } from '@/lib/db'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { validateQuestionEvidence } from '@/lib/powerpoint-assessment/evidence-spec'
import {
  compatibleSlots,
  fromDraftSources,
  newDraftSource,
  toDraftSources,
} from '@/components/lessons/question-evidence-editor'

// The lesson editor of a database assessment. Pure: the question evidence
// editor's drafts round-trip database sources (fixed sections, records of
// named tables, named saved queries, required), a new source of the type's
// first kind reads the database slot, and only the accdb slot is offered for
// a database source. Server side, through the actions the editor calls: a new
// database assessment gets the default body (a required accdb slot and a
// required evidence document slot); slots save, and a body with no accdb slot
// or two is refused; the starting database is saved, checked (3 tables, no
// queries) and cleared when sent as null; and the template check finds every
// heading 1-9 and B1-B8 the questions read in the blank EVIDENCE document.
// The actions run outside Next, so the session guard and revalidatePath are
// stubbed. No model is called. Creates its own unit, lesson and activities,
// and removes them.
// Run with DATABASE_URL set:
//   npx tsx tests/database-assessment/editor.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

function stub(specifier: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(specifier)
  const module = new Module(resolved)
  module.exports = exports
  module.loaded = true
  require.cache[resolved] = module
}

const tag = randomUUID().slice(0, 8)
const UNIT = `db-ed-check-unit-${tag}`
const LESSON = `db-ed-check-lesson-${tag}`
const TEACHER = `db-ed-check-teacher-${tag}`
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const START_FILE = 'PALM GROVE VETS.accdb'
const TEMPLATE_FILE = 'EVIDENCE.docx'

const SLOTS = [
  { key: 'database', label: 'Database', kind: 'accdb', required: true },
  { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true },
  { key: 'printout', label: 'Report printout', kind: 'pdf', required: false },
]

const teacherProfile = { userId: TEACHER, roles: ['teacher'], isTeacher: true }

async function tearDown(activityIds: string[]) {
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
  const paths = activityIds.flatMap((id) => [START_FILE, TEMPLATE_FILE].map((name) => `lessons/${LESSON}/activities/${id}/${name}`))
  if (paths.length > 0) await createLocalStorageClient('lessons').remove(paths).catch(() => {})
  await query("delete from stored_files where bucket = 'lessons' and scope_path like $1", [`%${LESSON}%`])
  await rm(path.join(process.cwd(), 'files', 'lessons', LESSON), { recursive: true, force: true })
}

function pureChecks() {
  const stored = [
    { source: 'database', slot: 'database', sections: ['tables', 'fields', 'records:OWNERS', 'records:PETS', 'query:MICROCHIP REMINDER'], required: true },
    { source: 'database', slot: 'database' },
    { source: 'database', slot: 'database', sections: ['records:APPOINTMENTS'] },
    { source: 'evidence_section', slot: 'evidence', heading: 'B1', want: 'text', required: true },
    { source: 'reference_file', fileName: 'MARK SCHEME.pdf' },
  ]
  // As validateQuestionEvidence stores them, so the round trip is checked against the canonical form.
  const canonical = validateQuestionEvidence(
    [{ label: '1a', evidence: stored }],
    { uploadSlots: SLOTS },
    'database-assessment',
  )
  check('the stored sources are valid database evidence', canonical.errors.length === 0, canonical.errors.join(' '))
  const drafts = toDraftSources(canonical.evidence[0])
  const first = drafts[0]
  check(
    'a database source becomes a draft: fixed sections ticked, named tables and queries in their boxes, required',
    first.source === 'database' && first.slot === 'database' && JSON.stringify(first.databaseSections) === '["tables","fields"]'
      && first.recordTables === 'OWNERS, PETS' && first.queryNames === 'MICROCHIP REMINDER' && first.required,
    JSON.stringify(first),
  )
  check('a database source with no sections drafts with the default sections ticked', drafts[1].databaseSections.length === 9 && !drafts[1].databaseSections.includes('records'), JSON.stringify(drafts[1]))
  const back = fromDraftSources(drafts, '1a')
  check('fromDraftSources(toDraftSources(x)) gives the stored sources back', JSON.stringify(back) === JSON.stringify(canonical.evidence[0]), JSON.stringify(back))
  check('toDraftSources(fromDraftSources(x)) round-trips the drafts', JSON.stringify(toDraftSources(back as never).map(({ id: _id, ...rest }) => rest)) === JSON.stringify(drafts.map(({ id: _id, ...rest }) => rest)))

  const typed = { ...newDraftSource('database', SLOTS as never), recordTables: ' OWNERS , owners, PETS,, ', queryNames: 'QUERY ONE' }
  const typedStored = fromDraftSources([typed], '1a')[0] as { sections?: string[] }
  check(
    'the text boxes give records:X and query:X, trimmed, a repeated name (any case) once',
    JSON.stringify(typedStored.sections?.filter((s) => s.includes(':'))) === '["records:OWNERS","records:PETS","query:QUERY ONE"]',
    JSON.stringify(typedStored),
  )
  const untouched = fromDraftSources([newDraftSource('database', SLOTS as never)], '1a')[0]
  check('an untouched database source is stored with the default sections left out', JSON.stringify(untouched) === '{"source":"database","slot":"database"}', JSON.stringify(untouched))

  const offered = compatibleSlots('database', SLOTS as never) as Array<{ key: string }>
  check("compatibleSlots('database', slots) gives only the accdb slot", offered.length === 1 && offered[0].key === 'database', JSON.stringify(offered))
  check('an evidence_section source is offered only the docx slot', (compatibleSlots('evidence_section', SLOTS as never) as Array<{ key: string }>).map((s) => s.key).join() === 'evidence')
  check('a reference file is offered no slot', compatibleSlots('reference_file', SLOTS as never).length === 0)
}

async function main() {
  pureChecks()

  stub('@/lib/auth', {
    requireRole: async () => teacherProfile,
    requireAuthenticatedProfile: async () => teacherProfile,
    getAuthenticatedProfile: async () => teacherProfile,
    hasRole: (profile: { roles?: string[] } | null, role: string) => Boolean(profile?.roles?.includes(role)),
  })
  stub('next/cache', { revalidatePath: () => {} })
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createLessonActivityAction, updateLessonActivityAction } = require('@/lib/server-actions/lesson-activities')
  const { saveAssessmentQuestionsAction } = require('@/lib/server-actions/assessment-paper-activity')
  const { checkEvidenceTemplateAction, checkStartingDatabaseAction } = require('@/lib/server-actions/powerpoint-assessment-editor')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const startDb = await readFile(path.join(FIXTURES, 'palm-grove-start.accdb'))
  const template = await readFile(path.join(FIXTURES, 'palm-grove-evidence-template.docx'))

  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database editor unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database editor check', 0, 'standard')",
    [LESSON, UNIT],
  )
  const created: string[] = []

  try {
    const { rows: [{ success_criteria_id: A }] } = await query<{ success_criteria_id: string }>(
      'select success_criteria_id from success_criteria order by success_criteria_id limit 1',
    )

    // --- Create ----------------------------------------------------------------
    const bare = await createLessonActivityAction(UNIT, LESSON, { title: 'Bare', type: 'database-assessment' })
    if (bare.data) created.push(bare.data.activity_id)
    const bareSlots = (bare.data?.body_data as { uploadSlots?: Array<Record<string, unknown>> } | undefined)?.uploadSlots ?? []
    check(
      'a new database assessment with no body gets a required accdb slot and a required docx slot',
      bare.success && bareSlots.length === 2 && bareSlots[0].key === 'database' && bareSlots[0].kind === 'accdb' && bareSlots[0].required === true
        && bareSlots[1].key === 'evidence' && bareSlots[1].kind === 'docx' && bareSlots[1].required === true,
      JSON.stringify(bare),
    )

    // As the lesson editor sends it on create: the instructions and the default body.
    const task = await createLessonActivityAction(UNIT, LESSON, {
      title: 'Palm Grove Vets',
      type: 'database-assessment',
      bodyData: { instructions: 'Build the database.', uploadSlots: bareSlots },
    })
    if (task.data) created.push(task.data.activity_id)
    check('a database assessment with the default body is created', task.success, JSON.stringify(task))
    const ACT: string = task.data.activity_id

    const noAccdb = await createLessonActivityAction(UNIT, LESSON, {
      title: 'No database', type: 'database-assessment', bodyData: { uploadSlots: [SLOTS[1]] },
    })
    if (noAccdb.data) created.push(noAccdb.data.activity_id)
    check('a body with no accdb slot is refused on create', !noAccdb.success && /exactly one accdb slot/.test(noAccdb.error ?? ''), JSON.stringify(noAccdb))
    const pptx = await createLessonActivityAction(UNIT, LESSON, {
      title: 'Presentation', type: 'database-assessment', bodyData: { uploadSlots: [SLOTS[0], { key: 'p', label: 'P', kind: 'pptx', required: false }] },
    })
    if (pptx.data) created.push(pptx.data.activity_id)
    check('a pptx slot is refused on a database assessment', !pptx.success, JSON.stringify(pptx))

    // --- Slots -----------------------------------------------------------------
    const savedSlots = await updateLessonActivityAction(UNIT, LESSON, ACT, { bodyData: { uploadSlots: SLOTS } })
    check(
      'the upload slots save through the app save path, keeping the instructions',
      savedSlots.success && savedSlots.data?.body_data?.uploadSlots?.length === 3 && savedSlots.data?.body_data?.instructions === 'Build the database.',
      JSON.stringify(savedSlots),
    )
    const twoAccdb = await updateLessonActivityAction(UNIT, LESSON, ACT, {
      bodyData: { uploadSlots: [...SLOTS, { key: 'second', label: 'Second', kind: 'accdb', required: true }] },
    })
    check('a save with two accdb slots is refused', !twoAccdb.success && /exactly one accdb slot/.test(twoAccdb.error ?? ''), JSON.stringify(twoAccdb))

    // --- Starting database -----------------------------------------------------
    const lessons = createLocalStorageClient('lessons')
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${START_FILE}`, startDb, { contentType: 'application/octet-stream' })
    await lessons.upload(`lessons/${LESSON}/activities/${ACT}/${TEMPLATE_FILE}`, template, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const setStart = await updateLessonActivityAction(UNIT, LESSON, ACT, { bodyData: { startingDatabaseFile: START_FILE } })
    check('the starting database is saved through the app save path', setStart.success && setStart.data?.body_data?.startingDatabaseFile === START_FILE, JSON.stringify(setStart))
    const badStart = await updateLessonActivityAction(UNIT, LESSON, ACT, { bodyData: { startingDatabaseFile: 'notes.docx' } })
    check('a starting database that is not .accdb is refused', !badStart.success && /\.accdb/.test(badStart.error ?? ''), JSON.stringify(badStart))

    const startCheck = await checkStartingDatabaseAction(ACT, START_FILE)
    check(
      'checkStartingDatabaseAction gives 3 tables with record counts and no queries, forms or reports',
      !startCheck.error && startCheck.data?.fileName === START_FILE && startCheck.data?.tables?.length === 3
        && startCheck.data.tables.every((t: { rows: number }) => Number.isInteger(t.rows))
        && startCheck.data.queries.length === 0 && startCheck.data.forms.length === 0 && startCheck.data.reports.length === 0,
      JSON.stringify(startCheck),
    )
    const storedStart = await checkStartingDatabaseAction(ACT, null)
    check('with no name the saved starting database is checked', storedStart.data?.fileName === START_FILE, JSON.stringify(storedStart))
    const missingStart = await checkStartingDatabaseAction(ACT, 'NOPE.accdb')
    check('a missing starting database is a clear error', /no file called "NOPE.accdb"/.test(missingStart.error ?? ''), JSON.stringify(missingStart))
    const unset = await checkStartingDatabaseAction(bare.data.activity_id, null)
    check('with nothing saved the check asks for a choice', unset.error === 'Choose the starting database first.', JSON.stringify(unset))

    // --- Questions and the evidence template ------------------------------------
    const labels = [...Array.from({ length: 9 }, (_, i) => String(i + 1)), ...Array.from({ length: 8 }, (_, i) => `B${i + 1}`)]
    const savedQuestions = await saveAssessmentQuestionsAction(
      ACT,
      labels.map((label) => ({
        label,
        maxMarks: 1,
        markScheme: `Mark scheme for ${label}.`,
        evidence: label.startsWith('B')
          ? [{ source: 'evidence_section', slot: 'evidence', want: 'text' }]
          : [
            { source: 'database', slot: 'database', sections: ['tables', 'records:OWNERS'] },
            { source: 'evidence_section', slot: 'evidence', want: 'screenshots' },
          ],
        criteria: [{ successCriteriaId: A, maxMarks: 1 }],
      })),
    )
    check('17 questions with database and evidence sources save', !savedQuestions.error && savedQuestions.data?.questions?.length === 17, JSON.stringify(savedQuestions.error))
    const setTemplate = await updateLessonActivityAction(UNIT, LESSON, ACT, { bodyData: { evidenceTemplateFile: TEMPLATE_FILE } })
    check('the evidence template is saved', setTemplate.success && setTemplate.data?.body_data?.evidenceTemplateFile === TEMPLATE_FILE, JSON.stringify(setTemplate))
    const templateCheck = await checkEvidenceTemplateAction(ACT, TEMPLATE_FILE)
    check(
      'the template check with headings 1-9 and B1-B8 gives missingHeadings []',
      !templateCheck.error && templateCheck.data?.headings?.length === 17 && templateCheck.data?.missingHeadings?.length === 0,
      JSON.stringify(templateCheck),
    )

    // --- Clearing ----------------------------------------------------------------
    const clearStart = await updateLessonActivityAction(UNIT, LESSON, ACT, { bodyData: { startingDatabaseFile: null } })
    check(
      'the starting database sent as null is cleared, the template kept',
      clearStart.success && !('startingDatabaseFile' in (clearStart.data?.body_data ?? {})) && clearStart.data?.body_data?.evidenceTemplateFile === TEMPLATE_FILE,
      JSON.stringify(clearStart.data?.body_data),
    )

    // --- Type changes ------------------------------------------------------------
    const TYPE_CHANGE = /^An activity cannot be changed to or from an assessment paper or PowerPoint assessment\./
    const toText = await updateLessonActivityAction(UNIT, LESSON, ACT, { type: 'text', bodyData: { text: 'x' } })
    check('a database assessment cannot become another type', !toText.success && TYPE_CHANGE.test(toText.error ?? ''), JSON.stringify(toText))
    const toPpt = await updateLessonActivityAction(UNIT, LESSON, ACT, { type: 'powerpoint-assessment' })
    check('a database assessment cannot become a PowerPoint assessment', !toPpt.success && TYPE_CHANGE.test(toPpt.error ?? ''), JSON.stringify(toPpt))
    const plain = await createLessonActivityAction(UNIT, LESSON, { title: 'Plain', type: 'text', bodyData: { text: 'x' } })
    if (plain.data) created.push(plain.data.activity_id)
    const toDb = await updateLessonActivityAction(UNIT, LESSON, plain.data?.activity_id, { type: 'database-assessment' })
    check('another type cannot become a database assessment', !toDb.success && TYPE_CHANGE.test(toDb.error ?? ''), JSON.stringify(toDb))
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
