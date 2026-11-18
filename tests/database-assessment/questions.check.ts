import { randomUUID } from 'node:crypto'

import { query, withDbClient } from '@/lib/db'
import { readAssessmentQuestions, setAssessmentQuestions, type AssessmentQuestionInput } from '@/lib/assessment-paper/store'
import { createActivity } from '@/lib/mcp/activities'
import {
  defaultPracticalBody,
  powerPointBodyProblem,
  practicalBodyProblem,
  validateQuestionEvidence,
} from '@/lib/powerpoint-assessment/evidence-spec'
import { applyUploadSlotChange } from '@/lib/powerpoint-assessment/slot-changes'
import { defaultDatabaseAssessmentBody, defaultPowerPointAssessmentBody } from '@/lib/practical-assessment/types'

// A database assessment's questions' evidence: the `database` source
// (validated and its section selectors canonicalised), the sources each
// practical type takes (and the PowerPoint messages unchanged), evidence
// saved through setAssessmentQuestions and read back, and a slot change
// through applyUploadSlotChange (an evidence slot removed is refused, a
// rename is carried into the evidence). No model is called and no file is
// stored. Creates its own unit, lesson and activity, and removes them.
// Run with DATABASE_URL set:
//   npx tsx tests/database-assessment/questions.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

// jsonb does not keep key order, so compare with keys sorted.
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v)
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
const UNIT = `db-q-check-unit-${tag}`
const LESSON = `db-q-check-lesson-${tag}`

const DB_BODY = defaultDatabaseAssessmentBody()
const PPT_BODY = { uploadSlots: [...defaultPowerPointAssessmentBody().uploadSlots, { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true }] }
const DB_TYPE = 'database-assessment' as const
const PPT_TYPE = 'powerpoint-assessment' as const

function validate(evidence: unknown[], type: typeof DB_TYPE | typeof PPT_TYPE = DB_TYPE, body: unknown = DB_BODY) {
  return validateQuestionEvidence([{ label: 'Q1', evidence }], body, type)
}

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [UNIT, `Database questions unit ${tag}`, subject])
  await query(
    "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database questions check', 0, 'standard')",
    [LESSON, UNIT],
  )
}

async function tearDown() {
  await query('delete from activities where lesson_id = $1', [LESSON])
  await query('delete from lessons where lesson_id = $1', [LESSON])
  await query('delete from units where unit_id = $1', [UNIT])
}

async function main() {
  // --- Pure validation ---------------------------------------------------------
  let v = validate([{ source: 'database', slot: 'database', sections: ['Query:MICROCHIP REMINDER', 'records:owners', ' Tables '] }])
  check('a database source on the accdb slot passes', v.errors.length === 0, v.errors.join(' '))
  check(
    'database selectors are canonicalised, names keep their case',
    JSON.stringify(v.evidence[0]) === JSON.stringify([{ source: 'database', slot: 'database', sections: ['query:MICROCHIP REMINDER', 'records:owners', 'tables'] }]),
    JSON.stringify(v.evidence[0]),
  )
  v = validate([{ source: 'database', slot: 'database', required: true }])
  check('a database source with no sections passes as given', v.errors.length === 0
    && JSON.stringify(v.evidence[0]) === JSON.stringify([{ source: 'database', slot: 'database', required: true }]), v.errors.join(' '))

  v = validate([{ source: 'database', slot: 'evidence' }])
  check(
    'a database source on the docx slot is refused',
    v.errors.join(' ') === 'Question "Q1", evidence source 1 reads the slot "evidence" as the database (.accdb), but that slot takes an evidence document (docx).',
    v.errors.join(' '),
  )

  v = validate([{ source: 'presentation', slot: 'database' }])
  check(
    'presentation is refused for the database type with its list',
    v.errors.join(' ') === 'Question "Q1", evidence source 1 has the source "presentation", which a database assessment does not take; use one of database, evidence_section, file, reference_file.'
      + ' Question "Q1" has no evidence from the pupil\'s files, so the marker would see nothing to mark. Add a source, or mark it yourself.',
    v.errors.join(' '),
  )
  v = validate([{ source: 'slide_images', slot: 'database' }, { source: 'database', slot: 'database' }])
  check(
    'slide_images is refused for the database type with its list',
    v.errors.join(' ') === 'Question "Q1", evidence source 1 has the source "slide_images", which a database assessment does not take; use one of database, evidence_section, file, reference_file.',
    v.errors.join(' '),
  )
  v = validate([{ source: 'nonsense', slot: 'database' }, { source: 'database', slot: 'database' }])
  check(
    'an unknown source names the database type\'s list',
    v.errors.join(' ') === 'Question "Q1", evidence source 1 has an unknown source "nonsense"; use one of database, evidence_section, file, reference_file.',
    v.errors.join(' '),
  )
  v = validate([{ slot: 'database' }, { source: 'database', slot: 'database' }])
  check(
    'a missing source names the database type\'s list',
    v.errors.join(' ') === 'Question "Q1", evidence source 1 has no source; choose one of database, evidence_section, file, reference_file.',
    v.errors.join(' '),
  )

  v = validate([{ source: 'database', slot: 'presentation' }, { source: 'evidence_section', slot: 'evidence', want: 'text' }], PPT_TYPE, PPT_BODY)
  check(
    'database is refused for the PowerPoint type with today\'s message',
    v.errors.join(' ') === 'Question "Q1", evidence source 1 has an unknown source "database"; use one of presentation, slide_images, file, evidence_section, reference_file.',
    v.errors.join(' '),
  )
  v = validate([{ source: 'database', slot: 'presentation' }], PPT_TYPE, PPT_BODY)
  check(
    'a PowerPoint question with only a database source has no pupil evidence',
    /has no evidence from the pupil's files/.test(v.errors.join(' ')),
    v.errors.join(' '),
  )
  check(
    'the two-argument call is the PowerPoint check',
    JSON.stringify(validateQuestionEvidence([{ label: 'Q1', evidence: [{ source: 'database', slot: 'presentation' }] }], PPT_BODY).errors)
      === JSON.stringify(v.errors),
  )

  const SECTION_LIST = 'tables, fields, relationships, lookups, table-sort, records, changes, queries, objects, warnings, records:TABLE or query:NAME'
  v = validate([{ source: 'database', slot: 'database', sections: ['forms'] }])
  check(
    'an unknown selector is refused',
    v.errors.join(' ') === `Question "Q1", evidence source 1 asks for the section "forms", which is not one; use ${SECTION_LIST}.`,
    v.errors.join(' '),
  )
  v = validate([{ source: 'database', slot: 'database', sections: ['records:'] }])
  check('an empty records: is refused', /asks for the section "records:", which is not one/.test(v.errors.join(' ')), v.errors.join(' '))
  v = validate([{ source: 'database', slot: 'database', sections: ['query'] }])
  check('query without a name is refused', /asks for the section "query", which is not one/.test(v.errors.join(' ')), v.errors.join(' '))
  v = validate([{ source: 'database', slot: 'database', sections: ['tables', 'Tables'] }])
  check('a duplicate selector is refused', v.errors.join(' ') === 'Question "Q1", evidence source 1 asks for the section "tables" twice.', v.errors.join(' '))
  v = validate([{ source: 'database', slot: 'database', sections: ['records:OWNERS', 'records: owners'] }])
  check('a duplicate table name (any case) is refused', /asks for the section "records:owners" twice/.test(v.errors.join(' ')), v.errors.join(' '))
  v = validate([{ source: 'database', slot: 'database', sections: [] }])
  check('an empty sections list is refused', /sections lists none/.test(v.errors.join(' ')), v.errors.join(' '))
  v = validate([{ source: 'database', slot: 'database', section: ['tables'] }])
  check('a misspelt field is named', /unknown field 'section' \(did you mean 'sections'\?\)/.test(v.errors.join(' ')), v.errors.join(' '))
  v = validate([{ source: 'reference_file', fileName: 'MARK NOTES.docx' }])
  check(
    'a question with only reference_file is refused',
    v.errors.join(' ') === 'Question "Q1" has no evidence from the pupil\'s files, so the marker would see nothing to mark. Add a source, or mark it yourself.',
    v.errors.join(' '),
  )
  v = validateQuestionEvidence([{ label: 'Q1', evidence: [{ source: 'database', slot: 'database' }] }], PPT_BODY, DB_TYPE)
  check('a PowerPoint body is not a database body', /^The activity's upload slots are not set up: uploadSlots\.0\.kind /.test(v.errors.join(' ')), v.errors.join(' '))

  // Bodies.
  check('defaultPracticalBody per type', JSON.stringify(defaultPracticalBody(DB_TYPE)) === JSON.stringify(DB_BODY)
    && JSON.stringify(defaultPracticalBody(PPT_TYPE)) === JSON.stringify(defaultPowerPointAssessmentBody()))
  check('the database default body has no problem', practicalBodyProblem(DB_BODY, DB_TYPE) === null)
  check(
    'a database body with no accdb slot',
    practicalBodyProblem({ uploadSlots: [DB_BODY.uploadSlots[1]] }, DB_TYPE) === 'Upload slots: a database assessment needs exactly one accdb slot (the database), not 0.',
    String(practicalBodyProblem({ uploadSlots: [DB_BODY.uploadSlots[1]] }, DB_TYPE)),
  )
  check(
    'a pptx slot on a database body is named',
    /^Upload slot "Slides" \(kind\): /.test(String(practicalBodyProblem({ uploadSlots: [...DB_BODY.uploadSlots, { key: 'slides', label: 'Slides', kind: 'pptx', required: false }] }, DB_TYPE))),
  )
  check('powerPointBodyProblem is the PowerPoint check', powerPointBodyProblem(DB_BODY) === practicalBodyProblem(DB_BODY, PPT_TYPE)
    && powerPointBodyProblem(DB_BODY) !== null && powerPointBodyProblem(defaultPowerPointAssessmentBody()) === null)

  // --- With the database -------------------------------------------------------
  await setUp()
  let activityId = ''
  try {
    const { rows: scs } = await query<{ success_criteria_id: string }>(
      `select sc.success_criteria_id from success_criteria sc
        where sc.learning_objective_id = (select learning_objective_id from success_criteria
                                            group by 1 having count(*) >= 2 limit 1)
        order by sc.success_criteria_id limit 2`,
    )
    const [A, B] = scs.map((row) => row.success_criteria_id)
    const activity = await createActivity(LESSON, DB_TYPE, 'Palm Grove Vets', DB_BODY)
    activityId = activity.activity_id
    check('a database assessment is created', activity.type === DB_TYPE, String(activity.type))

    const q = (label: string, criterion: string, evidence: unknown[]): AssessmentQuestionInput => ({
      label,
      maxMarks: 1,
      markScheme: `Mark scheme for ${label}.`,
      criteria: [{ successCriteriaId: criterion, maxMarks: 1 }],
      evidence,
    })
    const QUESTIONS = [
      q('1a', A, [
        { source: 'database', slot: 'database', sections: ['Fields', 'records:OWNERS'], required: true },
        { source: 'evidence_section', slot: 'evidence', heading: '1', want: 'screenshots' },
      ]),
      q('6b', B, [{ source: 'database', slot: 'database', sections: ['Query: MICROCHIP REMINDER'] }]),
      q('B1', A, [{ source: 'evidence_section', slot: 'evidence', want: 'text', required: true }]),
    ]
    await setAssessmentQuestions(activityId, QUESTIONS)
    let stored = await readAssessmentQuestions(activityId)
    const evidenceOf = (label: string) => canon(stored.find((question) => question.label === label)?.evidence)
    check(
      'database and evidence_section sources save and read back canonical',
      evidenceOf('1a') === canon([
        { source: 'database', slot: 'database', sections: ['fields', 'records:OWNERS'], required: true },
        { source: 'evidence_section', slot: 'evidence', heading: '1', want: 'screenshots' },
      ]) && evidenceOf('6b') === canon([{ source: 'database', slot: 'database', sections: ['query:MICROCHIP REMINDER'] }])
        && evidenceOf('B1') === canon([{ source: 'evidence_section', slot: 'evidence', want: 'text', required: true }]),
      `${evidenceOf('1a')} ${evidenceOf('6b')} ${evidenceOf('B1')}`,
    )

    let [ok, detail] = await refused(
      () => setAssessmentQuestions(activityId, [q('1a', A, [{ source: 'presentation', slot: 'database' }])]),
      /has the source "presentation", which a database assessment does not take/,
    )
    check('setAssessmentQuestions refuses a PowerPoint source on a database assessment', ok, detail)
    ;[ok, detail] = await refused(
      () => setAssessmentQuestions(activityId, [q('1a', A, [{ source: 'database', slot: 'database', sections: ['forms'] }])]),
      /asks for the section "forms", which is not one/,
    )
    check('setAssessmentQuestions refuses an unknown selector', ok, detail)
    stored = await readAssessmentQuestions(activityId)
    check('nothing is written by a refused save', stored.length === 3 && evidenceOf('6b').includes('MICROCHIP'))

    // --- Slot changes ------------------------------------------------------------
    const slotChange = (after: unknown) => withDbClient(async (client) => {
      await client.query('begin')
      try {
        const result = await applyUploadSlotChange(client, activityId, DB_BODY, after, { rename: true, type: DB_TYPE })
        await client.query(result.errors.length > 0 ? 'rollback' : 'commit')
        return result
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    })
    const removed = await slotChange({ uploadSlots: [DB_BODY.uploadSlots[0]] })
    check(
      'removing a slot the evidence reads is refused',
      removed.rename === null && removed.errors.some((error) => /names the slot "evidence", which is not one of this activity's upload slots \(database\)/.test(error)),
      removed.errors.join(' '),
    )
    const renamedBody = { uploadSlots: [{ ...DB_BODY.uploadSlots[0], key: 'access-db' }, DB_BODY.uploadSlots[1]] }
    const renamed = await slotChange(renamedBody)
    check('renaming the database slot is allowed', renamed.errors.length === 0 && renamed.rename?.from === 'database' && renamed.rename?.to === 'access-db', renamed.errors.join(' '))
    stored = await readAssessmentQuestions(activityId)
    check(
      'the rename is carried into the evidence',
      evidenceOf('1a').includes('"slot":"access-db"') && evidenceOf('6b').includes('"slot":"access-db"') && !evidenceOf('1a').includes('"slot":"database"'),
      `${evidenceOf('1a')} ${evidenceOf('6b')}`,
    )
    const unchanged = await withDbClient((client) =>
      applyUploadSlotChange(client, activityId, renamedBody, { ...renamedBody, instructions: 'x' }, { rename: true, type: DB_TYPE }))
    check('unchanged slots are not checked', unchanged.errors.length === 0 && unchanged.rename === null)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from units where unit_id = $1)
          + (select count(*) from activities where activity_id = $2)
          + (select count(*) from activity_questions where activity_id = $2) as left`,
    [UNIT, activityId],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
